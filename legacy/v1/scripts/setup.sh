#!/bin/bash

# Secure MCP Server - Setup Script
# Enterprise-grade installation and configuration

set -euo pipefail

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
LOG_FILE="/tmp/secure-mcp-setup-$(date +%Y%m%d-%H%M%S).log"

# Functions
log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1" | tee -a "$LOG_FILE"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE" >&2
    exit 1
}

warn() {
    echo -e "${YELLOW}[WARNING]${NC} $1" | tee -a "$LOG_FILE"
}

info() {
    echo -e "${BLUE}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

check_command() {
    if ! command -v "$1" &> /dev/null; then
        return 1
    fi
    return 0
}

check_prerequisites() {
    log "Checking prerequisites..."

    local missing_deps=()

    # Check Node.js
    if ! check_command "node"; then
        missing_deps+=("Node.js (20+)")
    else
        NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)
        if [[ $NODE_VERSION -lt 20 ]]; then
            warn "Node.js version is less than 20. Please upgrade."
        fi
    fi

    # Check npm
    if ! check_command "npm"; then
        missing_deps+=("npm (10+)")
    fi

    # Check Docker
    if ! check_command "docker"; then
        missing_deps+=("Docker (24+)")
    fi

    # Check Docker Compose
    if ! check_command "docker-compose" && ! docker compose version &> /dev/null; then
        missing_deps+=("Docker Compose (2.23+)")
    fi

    # Check git
    if ! check_command "git"; then
        missing_deps+=("git")
    fi

    # Check curl
    if ! check_command "curl"; then
        missing_deps+=("curl")
    fi

    if [ ${#missing_deps[@]} -ne 0 ]; then
        error "Missing required dependencies: ${missing_deps[*]}"
    fi

    log "All prerequisites met!"
}

setup_environment() {
    log "Setting up environment..."

    cd "$PROJECT_ROOT"

    # Create .env file if it doesn't exist
    if [ ! -f .env ]; then
        cp .env.example .env
        info "Created .env file from template"

        # Generate secure secrets
        JWT_SECRET=$(openssl rand -base64 32)
        JWT_REFRESH_SECRET=$(openssl rand -base64 32)
        ENCRYPTION_KEY=$(openssl rand -base64 32)
        MFA_SECRET=$(openssl rand -base64 16)

        # Update .env with generated secrets
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
            sed -i '' "s/JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET/" .env
            sed -i '' "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENCRYPTION_KEY/" .env
            sed -i '' "s/MFA_SECRET=.*/MFA_SECRET=$MFA_SECRET/" .env
        else
            # Linux
            sed -i "s/JWT_SECRET=.*/JWT_SECRET=$JWT_SECRET/" .env
            sed -i "s/JWT_REFRESH_SECRET=.*/JWT_REFRESH_SECRET=$JWT_REFRESH_SECRET/" .env
            sed -i "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$ENCRYPTION_KEY/" .env
            sed -i "s/MFA_SECRET=.*/MFA_SECRET=$MFA_SECRET/" .env
        fi

        info "Generated secure secrets"
    else
        warn ".env file already exists, skipping creation"
    fi

    # Create necessary directories
    mkdir -p logs
    mkdir -p data/postgres
    mkdir -p data/redis
    mkdir -p data/vault
    mkdir -p tmp

    log "Environment setup complete"
}

install_dependencies() {
    log "Installing dependencies..."

    cd "$PROJECT_ROOT"

    # Install npm dependencies
    npm ci --silent

    # Generate Prisma client
    npx prisma generate

    log "Dependencies installed"
}

setup_database() {
    log "Setting up database..."

    # Start PostgreSQL container
    docker-compose up -d postgres

    # Wait for PostgreSQL to be ready
    info "Waiting for PostgreSQL to be ready..."
    for i in {1..30}; do
        if docker-compose exec -T postgres pg_isready -U mcp_user &> /dev/null; then
            break
        fi
        sleep 2
    done

    # Run migrations
    npm run db:migrate

    log "Database setup complete"
}

setup_redis() {
    log "Setting up Redis..."

    # Start Redis container
    docker-compose up -d redis

    # Wait for Redis to be ready
    info "Waiting for Redis to be ready..."
    for i in {1..30}; do
        if docker-compose exec -T redis redis-cli ping &> /dev/null; then
            break
        fi
        sleep 2
    done

    log "Redis setup complete"
}

setup_vault() {
    log "Setting up HashiCorp Vault..."

    # Start Vault container
    docker-compose up -d vault

    # Wait for Vault to be ready
    info "Waiting for Vault to be ready..."
    for i in {1..30}; do
        if curl -s http://localhost:8200/v1/sys/health &> /dev/null; then
            break
        fi
        sleep 2
    done

    # Initialize Vault if not already initialized
    if ! curl -s http://localhost:8200/v1/sys/init | grep -q '"initialized":true'; then
        info "Initializing Vault..."
        VAULT_INIT=$(docker-compose exec -T vault vault operator init -key-shares=5 -key-threshold=3 -format=json)

        # Save init keys securely
        echo "$VAULT_INIT" > vault-init-keys.json
        chmod 600 vault-init-keys.json
        warn "Vault initialization keys saved to vault-init-keys.json - KEEP THIS FILE SECURE!"

        # Unseal Vault
        UNSEAL_KEY_1=$(echo "$VAULT_INIT" | jq -r '.unseal_keys_b64[0]')
        UNSEAL_KEY_2=$(echo "$VAULT_INIT" | jq -r '.unseal_keys_b64[1]')
        UNSEAL_KEY_3=$(echo "$VAULT_INIT" | jq -r '.unseal_keys_b64[2]')
        ROOT_TOKEN=$(echo "$VAULT_INIT" | jq -r '.root_token')

        docker-compose exec -T vault vault operator unseal "$UNSEAL_KEY_1"
        docker-compose exec -T vault vault operator unseal "$UNSEAL_KEY_2"
        docker-compose exec -T vault vault operator unseal "$UNSEAL_KEY_3"

        # Update .env with Vault token
        if [[ "$OSTYPE" == "darwin"* ]]; then
            sed -i '' "s/VAULT_TOKEN=.*/VAULT_TOKEN=$ROOT_TOKEN/" .env
        else
            sed -i "s/VAULT_TOKEN=.*/VAULT_TOKEN=$ROOT_TOKEN/" .env
        fi
    fi

    log "Vault setup complete"
}

setup_monitoring() {
    log "Setting up monitoring stack..."

    # Create monitoring directories
    mkdir -p docker/grafana/dashboards
    mkdir -p docker/prometheus/data
    mkdir -p docker/alertmanager/data

    # Start monitoring stack
    docker-compose -f docker/monitoring.yml up -d prometheus grafana

    info "Monitoring stack starting..."
    info "Prometheus: http://localhost:9090"
    info "Grafana: http://localhost:3001 (admin/admin)"

    log "Monitoring setup complete"
}

build_application() {
    log "Building application..."

    cd "$PROJECT_ROOT"

    # Build TypeScript
    npm run build

    # Build Docker image
    docker build -t secure-mcp-server:latest .

    log "Application built successfully"
}

run_tests() {
    log "Running tests..."

    cd "$PROJECT_ROOT"

    # Run unit tests
    npm run test:unit

    # Run security audit
    npm audit --audit-level=high

    log "Tests completed"
}

start_services() {
    log "Starting services..."

    cd "$PROJECT_ROOT"

    # Start all services
    docker-compose up -d

    # Wait for health check
    info "Waiting for services to be healthy..."
    for i in {1..60}; do
        if curl -s http://localhost:3000/health | grep -q '"status":"healthy"'; then
            break
        fi
        sleep 2
    done

    log "All services started"
}

print_summary() {
    echo ""
    echo "======================================"
    echo -e "${GREEN}Secure MCP Server Setup Complete!${NC}"
    echo "======================================"
    echo ""
    echo "Service URLs:"
    echo "  - MCP Server: http://localhost:3000"
    echo "  - Prometheus: http://localhost:9090"
    echo "  - Grafana: http://localhost:3001 (admin/admin)"
    echo "  - Jaeger: http://localhost:16686"
    echo ""
    echo "Next steps:"
    echo "  1. Review and update .env configuration"
    echo "  2. Change default passwords"
    echo "  3. Configure SSL/TLS certificates"
    echo "  4. Set up backup procedures"
    echo "  5. Review security settings"
    echo ""
    echo "Commands:"
    echo "  - Start server: npm run dev"
    echo "  - Run tests: npm test"
    echo "  - View logs: docker-compose logs -f"
    echo "  - Stop services: docker-compose down"
    echo ""
    echo "Documentation: docs/README.md"
    echo "Setup log: $LOG_FILE"
    echo ""
}

main() {
    log "Starting Secure MCP Server setup..."

    check_prerequisites
    setup_environment
    install_dependencies
    setup_database
    setup_redis
    setup_vault
    setup_monitoring
    build_application
    run_tests
    start_services

    print_summary
}

# Handle errors
trap 'error "Setup failed. Check log at $LOG_FILE"' ERR

# Run main function
main "$@"