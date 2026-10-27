#!/bin/bash

# Health check script for Secure MCP Server
# Validates all components are operational

set -euo pipefail

# Configuration
API_URL="${API_URL:-http://localhost:3000}"
PROMETHEUS_URL="${PROMETHEUS_URL:-http://localhost:9090}"
GRAFANA_URL="${GRAFANA_URL:-http://localhost:3001}"
TIMEOUT=5

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Track failures
FAILED_CHECKS=0
TOTAL_CHECKS=0

check_service() {
    local service_name=$1
    local url=$2
    local expected_response=$3

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    printf "Checking %-25s " "$service_name..."

    if response=$(curl -s -o /dev/null -w "%{http_code}" --max-time $TIMEOUT "$url" 2>/dev/null); then
        if [[ "$response" == "$expected_response" ]]; then
            echo -e "${GREEN}✓ OK${NC}"
            return 0
        else
            echo -e "${RED}✗ FAILED${NC} (HTTP $response)"
            FAILED_CHECKS=$((FAILED_CHECKS + 1))
            return 1
        fi
    else
        echo -e "${RED}✗ UNREACHABLE${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

check_json_health() {
    local service_name=$1
    local url=$2
    local json_path=$3
    local expected_value=$4

    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    printf "Checking %-25s " "$service_name..."

    if response=$(curl -s --max-time $TIMEOUT "$url" 2>/dev/null); then
        if echo "$response" | jq -e "$json_path == \"$expected_value\"" &>/dev/null; then
            echo -e "${GREEN}✓ OK${NC}"
            return 0
        else
            actual_value=$(echo "$response" | jq -r "$json_path" 2>/dev/null || echo "parse error")
            echo -e "${RED}✗ FAILED${NC} (expected: $expected_value, got: $actual_value)"
            FAILED_CHECKS=$((FAILED_CHECKS + 1))
            return 1
        fi
    else
        echo -e "${RED}✗ UNREACHABLE${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

check_database() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    printf "Checking %-25s " "PostgreSQL..."

    if docker-compose exec -T postgres pg_isready -U mcp_user &>/dev/null; then
        echo -e "${GREEN}✓ OK${NC}"
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

check_redis() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    printf "Checking %-25s " "Redis..."

    if docker-compose exec -T redis redis-cli ping 2>/dev/null | grep -q "PONG"; then
        echo -e "${GREEN}✓ OK${NC}"
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

check_vault() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    printf "Checking %-25s " "HashiCorp Vault..."

    if response=$(curl -s http://localhost:8200/v1/sys/health 2>/dev/null); then
        if echo "$response" | jq -e '.initialized == true and .sealed == false' &>/dev/null; then
            echo -e "${GREEN}✓ OK${NC}"
            return 0
        else
            echo -e "${YELLOW}⚠ SEALED${NC}"
            FAILED_CHECKS=$((FAILED_CHECKS + 1))
            return 1
        fi
    else
        echo -e "${RED}✗ UNREACHABLE${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

check_metrics() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    printf "Checking %-25s " "Metrics endpoint..."

    if response=$(curl -s "$API_URL/metrics" 2>/dev/null); then
        if echo "$response" | grep -q "# TYPE"; then
            echo -e "${GREEN}✓ OK${NC}"
            return 0
        else
            echo -e "${RED}✗ FAILED${NC}"
            FAILED_CHECKS=$((FAILED_CHECKS + 1))
            return 1
        fi
    else
        echo -e "${RED}✗ UNREACHABLE${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

check_websocket() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    printf "Checking %-25s " "WebSocket endpoint..."

    # Simple WebSocket connectivity check
    if timeout 2 bash -c "echo '' | nc -z localhost 3000" 2>/dev/null; then
        echo -e "${GREEN}✓ OK${NC}"
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

check_container_runtime() {
    TOTAL_CHECKS=$((TOTAL_CHECKS + 1))

    printf "Checking %-25s " "Container runtime..."

    if docker info &>/dev/null; then
        echo -e "${GREEN}✓ OK${NC}"
        return 0
    else
        echo -e "${RED}✗ FAILED${NC}"
        FAILED_CHECKS=$((FAILED_CHECKS + 1))
        return 1
    fi
}

main() {
    echo "======================================"
    echo "Secure MCP Server Health Check"
    echo "======================================"
    echo ""

    echo "Core Services:"
    check_json_health "MCP Server Health" "$API_URL/health" ".status" "healthy"
    check_json_health "MCP Server Ready" "$API_URL/ready" ".status" "ready"
    check_websocket
    check_metrics

    echo ""
    echo "Data Services:"
    check_database
    check_redis
    check_vault

    echo ""
    echo "Monitoring Services:"
    check_service "Prometheus" "$PROMETHEUS_URL/-/healthy" "200"
    check_service "Grafana" "$GRAFANA_URL/api/health" "200"

    echo ""
    echo "Infrastructure:"
    check_container_runtime

    echo ""
    echo "======================================"

    if [[ $FAILED_CHECKS -eq 0 ]]; then
        echo -e "${GREEN}✓ All health checks passed!${NC} ($TOTAL_CHECKS/$TOTAL_CHECKS)"
        exit 0
    else
        PASSED=$((TOTAL_CHECKS - FAILED_CHECKS))
        echo -e "${RED}✗ Health check failed!${NC} ($PASSED/$TOTAL_CHECKS passed)"
        echo ""
        echo "Troubleshooting:"
        echo "  1. Check service logs: docker-compose logs"
        echo "  2. Verify .env configuration"
        echo "  3. Check network connectivity"
        echo "  4. Review docs/TROUBLESHOOTING.md"
        exit 1
    fi
}

# Check for dependencies
if ! command -v curl &>/dev/null; then
    echo "Error: curl is required but not installed"
    exit 1
fi

if ! command -v jq &>/dev/null; then
    echo "Warning: jq is not installed, some checks may fail"
fi

# Run main function
main "$@"