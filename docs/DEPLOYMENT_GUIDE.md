# Deployment Guide

## Secure MCP Server Production Deployment

This guide provides comprehensive instructions for deploying the Secure MCP Server in production environments using Docker, Kubernetes, and cloud platforms.

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Infrastructure Requirements](#infrastructure-requirements)
3. [Docker Deployment](#docker-deployment)
4. [Kubernetes Deployment](#kubernetes-deployment)
5. [Cloud Platform Deployment](#cloud-platform-deployment)
6. [Configuration Management](#configuration-management)
7. [Database Setup](#database-setup)
8. [Security Configuration](#security-configuration)
9. [Load Balancing](#load-balancing)
10. [Monitoring Setup](#monitoring-setup)
11. [Backup and Recovery](#backup-and-recovery)
12. [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- **Operating System**: Linux (Ubuntu 20.04+, RHEL 8+, Amazon Linux 2)
- **CPU**: Minimum 4 vCPUs (8 recommended for production)
- **Memory**: Minimum 8GB RAM (16GB recommended)
- **Storage**: 100GB SSD (NVMe recommended for database)
- **Network**: 1Gbps network interface

### Software Requirements

```bash
# Check versions
docker --version  # >= 20.10
kubectl version   # >= 1.24
helm version      # >= 3.10
terraform version # >= 1.3
```

### Required Tools Installation

```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Install kubectl
curl -LO "https://dl.k8s.io/release/$(curl -L -s https://dl.k8s.io/release/stable.txt)/bin/linux/amd64/kubectl"
sudo install -o root -g root -m 0755 kubectl /usr/local/bin/kubectl

# Install Helm
curl https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

# Install Terraform
wget -O- https://apt.releases.hashicorp.com/gpg | sudo gpg --dearmor -o /usr/share/keyrings/hashicorp-archive-keyring.gpg
echo "deb [signed-by=/usr/share/keyrings/hashicorp-archive-keyring.gpg] https://apt.releases.hashicorp.com $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/hashicorp.list
sudo apt update && sudo apt install terraform
```

## Infrastructure Requirements

### Network Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                         Internet                             │
└────────────────────────┬────────────────────────────────────┘
                         │
                    ┌────▼─────┐
                    │   CDN     │
                    │(CloudFlare)│
                    └────┬─────┘
                         │
                    ┌────▼─────┐
                    │   WAF     │
                    │  (AWS)    │
                    └────┬─────┘
                         │
          ┌──────────────┼──────────────┐
          │              │              │
     ┌────▼─────┐  ┌────▼─────┐  ┌────▼─────┐
     │  LB-1    │  │  LB-2    │  │  LB-3    │
     │  (AZ-1)  │  │  (AZ-2)  │  │  (AZ-3)  │
     └────┬─────┘  └────┬─────┘  └────┬─────┘
          │              │              │
     ┌────▼─────────────▼──────────────▼─────┐
     │         Kubernetes Cluster              │
     │  ┌──────────┐ ┌──────────┐ ┌──────────┐│
     │  │  Node-1  │ │  Node-2  │ │  Node-3  ││
     │  └──────────┘ └──────────┘ └──────────┘│
     └─────────────────────────────────────────┘
                         │
     ┌───────────────────┼───────────────────┐
     │                   │                   │
┌────▼─────┐      ┌─────▼──────┐     ┌──────▼─────┐
│PostgreSQL│      │   Redis    │     │   Vault    │
│ Primary  │      │  Cluster   │     │   Cluster  │
└────┬─────┘      └────────────┘     └────────────┘
     │
┌────▼─────┐
│PostgreSQL│
│ Replicas │
└──────────┘
```

### Port Requirements

| Service | Port | Protocol | Direction | Description |
|---------|------|----------|-----------|-------------|
| HTTP | 80 | TCP | Inbound | HTTP traffic (redirects to HTTPS) |
| HTTPS | 443 | TCP | Inbound | HTTPS traffic |
| WebSocket | 443 | TCP/WS | Inbound | WebSocket connections |
| PostgreSQL | 5432 | TCP | Internal | Database connections |
| Redis | 6379 | TCP | Internal | Cache connections |
| Vault | 8200 | TCP | Internal | Secrets management |
| Prometheus | 9090 | TCP | Internal | Metrics collection |
| Grafana | 3001 | TCP | Internal | Monitoring dashboard |
| Node Exporter | 9100 | TCP | Internal | Node metrics |

## Docker Deployment

### 1. Build Production Image

```bash
# Clone repository
git clone https://github.com/enterprise/secure-mcp-server.git
cd secure-mcp-server

# Build multi-stage production image
docker build \
  --target production \
  --build-arg NODE_ENV=production \
  --tag secure-mcp-server:latest \
  --tag secure-mcp-server:v1.0.0 \
  .
```

### 2. Create Docker Network

```bash
# Create custom network for service isolation
docker network create \
  --driver bridge \
  --subnet=172.20.0.0/16 \
  --ip-range=172.20.240.0/20 \
  --gateway=172.20.0.1 \
  mcp-network
```

### 3. Deploy Database Services

```bash
# Deploy PostgreSQL
docker run -d \
  --name mcp-postgres \
  --network mcp-network \
  --restart always \
  -e POSTGRES_DB=mcp_production \
  -e POSTGRES_USER=mcp_user \
  -e POSTGRES_PASSWORD=$(openssl rand -base64 32) \
  -e POSTGRES_INITDB_ARGS="--encoding=UTF8 --locale=C" \
  -v postgres-data:/var/lib/postgresql/data \
  -v ./scripts/postgres-init.sql:/docker-entrypoint-initdb.d/init.sql \
  postgres:15-alpine

# Deploy Redis with persistence
docker run -d \
  --name mcp-redis \
  --network mcp-network \
  --restart always \
  -v redis-data:/data \
  redis:7-alpine \
  redis-server \
  --appendonly yes \
  --maxmemory 2gb \
  --maxmemory-policy allkeys-lru \
  --requirepass $(openssl rand -base64 32)

# Deploy HashiCorp Vault
docker run -d \
  --name mcp-vault \
  --network mcp-network \
  --restart always \
  --cap-add IPC_LOCK \
  -e VAULT_LOCAL_CONFIG='{"storage": {"file": {"path": "/vault/file"}}, "listener": {"tcp": {"address": "0.0.0.0:8200", "tls_disable": false, "tls_cert_file": "/vault/certs/cert.pem", "tls_key_file": "/vault/certs/key.pem"}}}' \
  -v vault-data:/vault/file \
  -v ./certs:/vault/certs:ro \
  vault:1.15 server
```

### 4. Initialize Vault

```bash
# Initialize Vault
docker exec mcp-vault vault operator init \
  -key-shares=5 \
  -key-threshold=3 \
  -format=json > vault-keys.json

# Unseal Vault (use 3 of the 5 keys)
docker exec mcp-vault vault operator unseal $(jq -r '.unseal_keys_b64[0]' vault-keys.json)
docker exec mcp-vault vault operator unseal $(jq -r '.unseal_keys_b64[1]' vault-keys.json)
docker exec mcp-vault vault operator unseal $(jq -r '.unseal_keys_b64[2]' vault-keys.json)

# Login to Vault
export VAULT_TOKEN=$(jq -r '.root_token' vault-keys.json)
docker exec -e VAULT_TOKEN=$VAULT_TOKEN mcp-vault vault login $VAULT_TOKEN

# Create secrets engine
docker exec -e VAULT_TOKEN=$VAULT_TOKEN mcp-vault vault secrets enable -path=mcp kv-v2

# Store application secrets
docker exec -e VAULT_TOKEN=$VAULT_TOKEN mcp-vault vault kv put mcp/production \
  jwt_secret=$(openssl rand -base64 64) \
  database_password=$(openssl rand -base64 32) \
  redis_password=$(openssl rand -base64 32) \
  encryption_key=$(openssl rand -hex 32)
```

### 5. Deploy Application

```bash
# Create environment file
cat > .env.production <<EOF
NODE_ENV=production
PORT=3000
HOST=0.0.0.0

# Database
DATABASE_URL=postgresql://mcp_user:password@mcp-postgres:5432/mcp_production
DATABASE_SSL=true
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=20

# Redis
REDIS_HOST=mcp-redis
REDIS_PORT=6379
REDIS_PASSWORD=password
REDIS_TLS=true

# Vault
VAULT_ADDR=http://mcp-vault:8200
VAULT_TOKEN=${VAULT_TOKEN}
VAULT_PATH=mcp/production

# Security
JWT_SECRET_PATH=mcp/data/production/jwt_secret
ENCRYPTION_KEY_PATH=mcp/data/production/encryption_key
CORS_ORIGINS=https://app.example.com,https://admin.example.com

# Monitoring
METRICS_ENABLED=true
TRACING_ENABLED=true
LOG_LEVEL=info
EOF

# Run application container
docker run -d \
  --name mcp-server \
  --network mcp-network \
  --restart always \
  --env-file .env.production \
  -p 3000:3000 \
  -v ./logs:/app/logs \
  --health-cmd="curl -f http://localhost:3000/health || exit 1" \
  --health-interval=30s \
  --health-timeout=10s \
  --health-retries=3 \
  secure-mcp-server:latest
```

### 6. Docker Compose Production

```yaml
# docker-compose.production.yml
version: '3.8'

services:
  nginx:
    image: nginx:alpine
    container_name: mcp-nginx
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/ssl:/etc/nginx/ssl:ro
      - ./nginx/cache:/var/cache/nginx
    depends_on:
      - app
    networks:
      - mcp-network

  app:
    image: secure-mcp-server:latest
    container_name: mcp-app
    restart: always
    env_file: .env.production
    deploy:
      replicas: 3
      resources:
        limits:
          cpus: '2'
          memory: 4G
        reservations:
          cpus: '1'
          memory: 2G
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      vault:
        condition: service_started
    networks:
      - mcp-network

  postgres:
    image: postgres:15-alpine
    container_name: mcp-postgres
    restart: always
    environment:
      POSTGRES_DB: mcp_production
      POSTGRES_USER_FILE: /run/secrets/db_user
      POSTGRES_PASSWORD_FILE: /run/secrets/db_password
    secrets:
      - db_user
      - db_password
    volumes:
      - postgres-data:/var/lib/postgresql/data
      - ./scripts/postgres-init.sql:/docker-entrypoint-initdb.d/init.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U mcp_user"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - mcp-network

  redis:
    image: redis:7-alpine
    container_name: mcp-redis
    restart: always
    command: >
      redis-server
      --requirepass ${REDIS_PASSWORD}
      --maxmemory 2gb
      --maxmemory-policy allkeys-lru
      --appendonly yes
      --appendfsync everysec
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - mcp-network

  vault:
    image: vault:1.15
    container_name: mcp-vault
    restart: always
    cap_add:
      - IPC_LOCK
    environment:
      VAULT_LOCAL_CONFIG: |
        {
          "storage": {"file": {"path": "/vault/file"}},
          "listener": {
            "tcp": {
              "address": "0.0.0.0:8200",
              "tls_cert_file": "/vault/certs/cert.pem",
              "tls_key_file": "/vault/certs/key.pem"
            }
          },
          "ui": true
        }
    volumes:
      - vault-data:/vault/file
      - ./certs:/vault/certs:ro
    networks:
      - mcp-network

  prometheus:
    image: prom/prometheus:latest
    container_name: mcp-prometheus
    restart: always
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus-data:/prometheus
    networks:
      - mcp-network

  grafana:
    image: grafana/grafana:latest
    container_name: mcp-grafana
    restart: always
    environment:
      GF_SECURITY_ADMIN_PASSWORD_FILE: /run/secrets/grafana_password
      GF_INSTALL_PLUGINS: redis-datasource
    secrets:
      - grafana_password
    volumes:
      - grafana-data:/var/lib/grafana
      - ./monitoring/grafana/dashboards:/etc/grafana/provisioning/dashboards
      - ./monitoring/grafana/datasources:/etc/grafana/provisioning/datasources
    ports:
      - "3001:3000"
    networks:
      - mcp-network

networks:
  mcp-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16

volumes:
  postgres-data:
  redis-data:
  vault-data:
  prometheus-data:
  grafana-data:

secrets:
  db_user:
    file: ./secrets/db_user.txt
  db_password:
    file: ./secrets/db_password.txt
  grafana_password:
    file: ./secrets/grafana_password.txt
```

## Kubernetes Deployment

### 1. Create Namespace and Secrets

```bash
# Create namespace
kubectl create namespace mcp-production

# Create secrets
kubectl create secret generic mcp-secrets \
  --namespace=mcp-production \
  --from-literal=jwt-secret=$(openssl rand -base64 64) \
  --from-literal=database-password=$(openssl rand -base64 32) \
  --from-literal=redis-password=$(openssl rand -base64 32) \
  --from-literal=encryption-key=$(openssl rand -hex 32)

# Create TLS certificate secret
kubectl create secret tls mcp-tls \
  --namespace=mcp-production \
  --cert=path/to/tls.crt \
  --key=path/to/tls.key
```

### 2. Apply ConfigMaps

```yaml
# configmap.yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: mcp-config
  namespace: mcp-production
data:
  NODE_ENV: "production"
  PORT: "3000"
  HOST: "0.0.0.0"
  DATABASE_HOST: "postgres-service"
  DATABASE_PORT: "5432"
  DATABASE_NAME: "mcp_production"
  REDIS_HOST: "redis-service"
  REDIS_PORT: "6379"
  VAULT_ADDR: "http://vault-service:8200"
  METRICS_ENABLED: "true"
  LOG_LEVEL: "info"
  CORS_ORIGINS: "https://app.example.com"
```

```bash
kubectl apply -f configmap.yaml
```

### 3. Deploy StatefulSets for Databases

```yaml
# postgres-statefulset.yaml
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: mcp-production
spec:
  serviceName: postgres-service
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:15-alpine
        ports:
        - containerPort: 5432
        env:
        - name: POSTGRES_DB
          value: mcp_production
        - name: POSTGRES_USER
          value: mcp_user
        - name: POSTGRES_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mcp-secrets
              key: database-password
        volumeMounts:
        - name: postgres-storage
          mountPath: /var/lib/postgresql/data
        resources:
          requests:
            memory: "1Gi"
            cpu: "500m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        livenessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - mcp_user
          initialDelaySeconds: 30
          periodSeconds: 10
        readinessProbe:
          exec:
            command:
            - pg_isready
            - -U
            - mcp_user
          initialDelaySeconds: 5
          periodSeconds: 5
  volumeClaimTemplates:
  - metadata:
      name: postgres-storage
    spec:
      accessModes: ["ReadWriteOnce"]
      storageClassName: gp3
      resources:
        requests:
          storage: 100Gi
---
apiVersion: v1
kind: Service
metadata:
  name: postgres-service
  namespace: mcp-production
spec:
  selector:
    app: postgres
  ports:
  - port: 5432
    targetPort: 5432
```

### 4. Deploy Application

```yaml
# deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: mcp-server
  namespace: mcp-production
spec:
  replicas: 3
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  selector:
    matchLabels:
      app: mcp-server
  template:
    metadata:
      labels:
        app: mcp-server
      annotations:
        prometheus.io/scrape: "true"
        prometheus.io/port: "3000"
        prometheus.io/path: "/metrics"
    spec:
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
          - weight: 100
            podAffinityTerm:
              labelSelector:
                matchExpressions:
                - key: app
                  operator: In
                  values:
                  - mcp-server
              topologyKey: kubernetes.io/hostname
      containers:
      - name: mcp-server
        image: secure-mcp-server:latest
        ports:
        - containerPort: 3000
          name: http
        - containerPort: 3000
          name: websocket
        envFrom:
        - configMapRef:
            name: mcp-config
        env:
        - name: DATABASE_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mcp-secrets
              key: database-password
        - name: REDIS_PASSWORD
          valueFrom:
            secretKeyRef:
              name: mcp-secrets
              key: redis-password
        - name: JWT_SECRET
          valueFrom:
            secretKeyRef:
              name: mcp-secrets
              key: jwt-secret
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "2Gi"
            cpu: "1000m"
        livenessProbe:
          httpGet:
            path: /health
            port: 3000
          initialDelaySeconds: 30
          periodSeconds: 30
          timeoutSeconds: 10
          failureThreshold: 3
        readinessProbe:
          httpGet:
            path: /ready
            port: 3000
          initialDelaySeconds: 10
          periodSeconds: 10
          timeoutSeconds: 5
          failureThreshold: 3
        volumeMounts:
        - name: app-logs
          mountPath: /app/logs
      volumes:
      - name: app-logs
        emptyDir: {}
---
apiVersion: v1
kind: Service
metadata:
  name: mcp-service
  namespace: mcp-production
spec:
  selector:
    app: mcp-server
  ports:
  - name: http
    port: 80
    targetPort: 3000
  - name: websocket
    port: 3000
    targetPort: 3000
  type: ClusterIP
```

### 5. Configure Ingress

```yaml
# ingress.yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: mcp-ingress
  namespace: mcp-production
  annotations:
    kubernetes.io/ingress.class: nginx
    cert-manager.io/cluster-issuer: letsencrypt-prod
    nginx.ingress.kubernetes.io/websocket-services: mcp-service
    nginx.ingress.kubernetes.io/proxy-read-timeout: "3600"
    nginx.ingress.kubernetes.io/proxy-send-timeout: "3600"
    nginx.ingress.kubernetes.io/ssl-redirect: "true"
    nginx.ingress.kubernetes.io/force-ssl-redirect: "true"
    nginx.ingress.kubernetes.io/rate-limit: "100"
    nginx.ingress.kubernetes.io/limit-rps: "10"
spec:
  tls:
  - hosts:
    - api.secure-mcp.example.com
    secretName: mcp-tls
  rules:
  - host: api.secure-mcp.example.com
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: mcp-service
            port:
              number: 80
      - path: /ws
        pathType: Prefix
        backend:
          service:
            name: mcp-service
            port:
              number: 3000
```

### 6. Horizontal Pod Autoscaler

```yaml
# hpa.yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: mcp-hpa
  namespace: mcp-production
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: mcp-server
  minReplicas: 3
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  - type: Pods
    pods:
      metric:
        name: mcp_websocket_connections
      target:
        type: AverageValue
        averageValue: "1000"
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 60
      policies:
      - type: Percent
        value: 100
        periodSeconds: 60
      - type: Pods
        value: 2
        periodSeconds: 60
```

### 7. Apply All Kubernetes Resources

```bash
# Apply all configurations
kubectl apply -f configmap.yaml
kubectl apply -f postgres-statefulset.yaml
kubectl apply -f redis-deployment.yaml
kubectl apply -f vault-deployment.yaml
kubectl apply -f deployment.yaml
kubectl apply -f ingress.yaml
kubectl apply -f hpa.yaml

# Verify deployment
kubectl get all -n mcp-production
kubectl get ingress -n mcp-production
kubectl describe deployment mcp-server -n mcp-production

# Check pod logs
kubectl logs -n mcp-production deployment/mcp-server --tail=100 -f

# Execute into pod for debugging
kubectl exec -it -n mcp-production deployment/mcp-server -- /bin/sh
```

## Cloud Platform Deployment

### AWS Deployment

#### 1. Infrastructure with Terraform

```hcl
# main.tf
terraform {
  required_version = ">= 1.3"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

# VPC Configuration
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"

  name = "mcp-vpc"
  cidr = "10.0.0.0/16"

  azs             = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]

  enable_nat_gateway = true
  enable_vpn_gateway = true
  enable_dns_hostnames = true

  tags = {
    Environment = "production"
    Application = "mcp-server"
  }
}

# EKS Cluster
module "eks" {
  source = "terraform-aws-modules/eks/aws"

  cluster_name    = "mcp-cluster"
  cluster_version = "1.28"

  vpc_id     = module.vpc.vpc_id
  subnet_ids = module.vpc.private_subnets

  eks_managed_node_groups = {
    main = {
      desired_capacity = 3
      max_capacity     = 10
      min_capacity     = 3

      instance_types = ["t3.large"]

      k8s_labels = {
        Environment = "production"
        Application = "mcp-server"
      }
    }
  }
}

# RDS PostgreSQL
resource "aws_db_instance" "mcp_postgres" {
  identifier = "mcp-postgres"

  engine         = "postgres"
  engine_version = "15.4"
  instance_class = "db.r6g.xlarge"

  allocated_storage     = 100
  storage_type          = "gp3"
  storage_encrypted     = true

  db_name  = "mcp_production"
  username = "mcp_admin"
  password = random_password.db_password.result

  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.mcp.name

  backup_retention_period = 30
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"

  multi_az               = true
  publicly_accessible    = false

  enabled_cloudwatch_logs_exports = ["postgresql"]

  tags = {
    Environment = "production"
    Application = "mcp-server"
  }
}

# ElastiCache Redis
resource "aws_elasticache_replication_group" "mcp_redis" {
  replication_group_id       = "mcp-redis"
  replication_group_description = "Redis cluster for MCP server"

  engine               = "redis"
  node_type            = "cache.r6g.large"
  number_cache_clusters = 3
  port                 = 6379

  parameter_group_name = "default.redis7.cluster.on"

  subnet_group_name = aws_elasticache_subnet_group.mcp.name
  security_group_ids = [aws_security_group.redis.id]

  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_password.result

  automatic_failover_enabled = true
  multi_az_enabled          = true

  snapshot_retention_limit = 7
  snapshot_window          = "03:00-05:00"

  tags = {
    Environment = "production"
    Application = "mcp-server"
  }
}

# Application Load Balancer
resource "aws_lb" "mcp_alb" {
  name               = "mcp-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets           = module.vpc.public_subnets

  enable_deletion_protection = true
  enable_http2              = true
  enable_cross_zone_load_balancing = true

  tags = {
    Environment = "production"
    Application = "mcp-server"
  }
}

# Auto Scaling
resource "aws_autoscaling_policy" "mcp_scale_up" {
  name                   = "mcp-scale-up"
  scaling_adjustment     = 2
  adjustment_type        = "ChangeInCapacity"
  cooldown              = 300
  autoscaling_group_name = module.eks.eks_managed_node_groups.main.asg_name
}

resource "aws_autoscaling_policy" "mcp_scale_down" {
  name                   = "mcp-scale-down"
  scaling_adjustment     = -1
  adjustment_type        = "ChangeInCapacity"
  cooldown              = 300
  autoscaling_group_name = module.eks.eks_managed_node_groups.main.asg_name
}

# CloudWatch Alarms
resource "aws_cloudwatch_metric_alarm" "mcp_cpu_high" {
  alarm_name          = "mcp-cpu-high"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = "2"
  metric_name        = "CPUUtilization"
  namespace          = "AWS/EKS"
  period             = "300"
  statistic          = "Average"
  threshold          = "70"
  alarm_description  = "This metric monitors CPU utilization"
  alarm_actions      = [aws_autoscaling_policy.mcp_scale_up.arn]
}

# WAF
resource "aws_wafv2_web_acl" "mcp_waf" {
  name  = "mcp-waf"
  scope = "REGIONAL"

  default_action {
    allow {}
  }

  rule {
    name     = "RateLimitRule"
    priority = 1

    action {
      block {}
    }

    statement {
      rate_based_statement {
        limit              = 2000
        aggregate_key_type = "IP"
      }
    }

    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name               = "RateLimitRule"
      sampled_requests_enabled  = true
    }
  }
}

# Outputs
output "cluster_endpoint" {
  value = module.eks.cluster_endpoint
}

output "database_endpoint" {
  value = aws_db_instance.mcp_postgres.endpoint
}

output "redis_endpoint" {
  value = aws_elasticache_replication_group.mcp_redis.primary_endpoint_address
}

output "load_balancer_dns" {
  value = aws_lb.mcp_alb.dns_name
}
```

#### 2. Deploy to AWS

```bash
# Initialize Terraform
terraform init

# Plan deployment
terraform plan -out=tfplan

# Apply configuration
terraform apply tfplan

# Get EKS credentials
aws eks update-kubeconfig --region us-east-1 --name mcp-cluster

# Deploy application to EKS
kubectl apply -k kubernetes/overlays/production
```

### Google Cloud Platform Deployment

```bash
# Create GKE cluster
gcloud container clusters create mcp-cluster \
  --region us-central1 \
  --num-nodes 3 \
  --machine-type n2-standard-4 \
  --enable-autoscaling \
  --min-nodes 3 \
  --max-nodes 10 \
  --enable-autorepair \
  --enable-autoupgrade \
  --enable-stackdriver-kubernetes

# Get credentials
gcloud container clusters get-credentials mcp-cluster --region us-central1

# Create Cloud SQL instance
gcloud sql instances create mcp-postgres \
  --database-version=POSTGRES_15 \
  --tier=db-n1-standard-4 \
  --region=us-central1 \
  --availability-type=REGIONAL \
  --backup \
  --backup-start-time=03:00

# Create Memorystore Redis
gcloud redis instances create mcp-redis \
  --size=5 \
  --region=us-central1 \
  --redis-version=redis_7_0 \
  --tier=STANDARD_HA
```

### Azure Deployment

```bash
# Create resource group
az group create --name mcp-rg --location eastus

# Create AKS cluster
az aks create \
  --resource-group mcp-rg \
  --name mcp-cluster \
  --node-count 3 \
  --node-vm-size Standard_D4s_v3 \
  --enable-cluster-autoscaler \
  --min-count 3 \
  --max-count 10 \
  --enable-managed-identity \
  --network-plugin azure \
  --network-policy calico

# Get credentials
az aks get-credentials --resource-group mcp-rg --name mcp-cluster

# Create Azure Database for PostgreSQL
az postgres flexible-server create \
  --resource-group mcp-rg \
  --name mcp-postgres \
  --location eastus \
  --tier GeneralPurpose \
  --sku-name Standard_D4ds_v4 \
  --storage-size 100 \
  --version 15 \
  --high-availability Enabled \
  --backup-retention 30

# Create Azure Cache for Redis
az redis create \
  --resource-group mcp-rg \
  --name mcp-redis \
  --location eastus \
  --sku Premium \
  --vm-size P1 \
  --enable-non-ssl-port false
```

## Configuration Management

### Environment Variables

```bash
# Production environment variables
export NODE_ENV=production
export PORT=3000
export HOST=0.0.0.0

# Database configuration
export DATABASE_URL="postgresql://user:pass@host:5432/db?ssl=true"
export DATABASE_POOL_MIN=5
export DATABASE_POOL_MAX=20
export DATABASE_SSL=true

# Redis configuration
export REDIS_HOST=redis.example.com
export REDIS_PORT=6379
export REDIS_PASSWORD=secure_password
export REDIS_TLS=true
export REDIS_DB=0

# Security
export JWT_SECRET=$(openssl rand -base64 64)
export JWT_EXPIRY=1h
export REFRESH_TOKEN_EXPIRY=7d
export ENCRYPTION_KEY=$(openssl rand -hex 32)
export BCRYPT_ROUNDS=12

# CORS
export CORS_ORIGINS="https://app.example.com,https://admin.example.com"
export CORS_CREDENTIALS=true

# Rate limiting
export RATE_LIMIT_WINDOW_MS=60000
export RATE_LIMIT_MAX_REQUESTS=100

# Monitoring
export METRICS_ENABLED=true
export TRACING_ENABLED=true
export LOG_LEVEL=info
export LOG_FORMAT=json

# Vault
export VAULT_ADDR=https://vault.example.com:8200
export VAULT_TOKEN=s.xxxxxxxxxx
export VAULT_NAMESPACE=admin
```

### Secrets Management

```bash
# Using HashiCorp Vault
vault kv put secret/mcp/production \
  jwt_secret="$(openssl rand -base64 64)" \
  database_password="$(openssl rand -base64 32)" \
  redis_password="$(openssl rand -base64 32)" \
  encryption_key="$(openssl rand -hex 32)" \
  api_keys="key1,key2,key3"

# Kubernetes Secrets
kubectl create secret generic mcp-secrets \
  --from-literal=jwt-secret=$JWT_SECRET \
  --from-literal=db-password=$DB_PASSWORD \
  --namespace=mcp-production

# AWS Secrets Manager
aws secretsmanager create-secret \
  --name mcp/production/database \
  --secret-string '{"username":"mcp_user","password":"secure_password"}'
```

## Database Setup

### PostgreSQL Configuration

```sql
-- Create production database
CREATE DATABASE mcp_production
  WITH
  OWNER = mcp_user
  ENCODING = 'UTF8'
  LC_COLLATE = 'en_US.utf8'
  LC_CTYPE = 'en_US.utf8'
  TABLESPACE = pg_default
  CONNECTION LIMIT = 100;

-- Create user and grant permissions
CREATE USER mcp_user WITH ENCRYPTED PASSWORD 'secure_password';
GRANT ALL PRIVILEGES ON DATABASE mcp_production TO mcp_user;

-- Create schemas
CREATE SCHEMA IF NOT EXISTS mcp AUTHORIZATION mcp_user;
CREATE SCHEMA IF NOT EXISTS audit AUTHORIZATION mcp_user;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Configure connection pooling
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
ALTER SYSTEM SET random_page_cost = 1.1;

-- Reload configuration
SELECT pg_reload_conf();
```

### Database Migrations

```bash
# Run migrations
npm run db:migrate

# Generate Prisma client
npm run db:generate

# Seed database
npm run db:seed

# Backup database
pg_dump -h localhost -U mcp_user -d mcp_production -F c -b -v -f backup.dump

# Restore database
pg_restore -h localhost -U mcp_user -d mcp_production -v backup.dump
```

## Monitoring Setup

### Prometheus Configuration

```yaml
# prometheus.yml
global:
  scrape_interval: 15s
  evaluation_interval: 15s

scrape_configs:
  - job_name: 'mcp-server'
    kubernetes_sd_configs:
    - role: pod
      namespaces:
        names:
        - mcp-production
    relabel_configs:
    - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_scrape]
      action: keep
      regex: true
    - source_labels: [__meta_kubernetes_pod_annotation_prometheus_io_path]
      action: replace
      target_label: __metrics_path__
      regex: (.+)
    - source_labels: [__address__, __meta_kubernetes_pod_annotation_prometheus_io_port]
      action: replace
      regex: ([^:]+)(?::\d+)?;(\d+)
      replacement: $1:$2
      target_label: __address__

  - job_name: 'kubernetes-nodes'
    kubernetes_sd_configs:
    - role: node
    relabel_configs:
    - action: labelmap
      regex: __meta_kubernetes_node_label_(.+)

  - job_name: 'postgresql'
    static_configs:
    - targets: ['postgres-exporter:9187']

  - job_name: 'redis'
    static_configs:
    - targets: ['redis-exporter:9121']
```

### Grafana Dashboards

Import the following dashboard IDs:
- **Application Dashboard**: 13639
- **PostgreSQL Dashboard**: 9628
- **Redis Dashboard**: 11835
- **Kubernetes Dashboard**: 12114
- **Node Exporter Dashboard**: 1860

## Troubleshooting

### Common Issues and Solutions

#### 1. Connection Refused

```bash
# Check if services are running
kubectl get pods -n mcp-production
kubectl describe pod <pod-name> -n mcp-production

# Check service endpoints
kubectl get endpoints -n mcp-production

# Test connectivity
kubectl exec -it <pod-name> -n mcp-production -- nc -zv postgres-service 5432
```

#### 2. Database Connection Issues

```bash
# Check database status
kubectl exec -it postgres-0 -n mcp-production -- psql -U mcp_user -d mcp_production -c "SELECT 1"

# Check connection pool
kubectl logs -n mcp-production deployment/mcp-server | grep "database"

# Verify credentials
kubectl get secret mcp-secrets -n mcp-production -o jsonpath="{.data.database-password}" | base64 -d
```

#### 3. High Memory Usage

```bash
# Check memory usage
kubectl top pods -n mcp-production

# Get heap dump
kubectl exec -it <pod-name> -n mcp-production -- kill -USR2 1

# Analyze memory
kubectl cp mcp-production/<pod-name>:/tmp/heapdump.hprof ./heapdump.hprof
```

#### 4. WebSocket Connection Issues

```bash
# Test WebSocket connection
wscat -c wss://api.secure-mcp.example.com/ws -H "Authorization: Bearer <token>"

# Check Ingress configuration
kubectl describe ingress mcp-ingress -n mcp-production

# Verify nginx configuration
kubectl exec -it <nginx-pod> -- nginx -T | grep websocket
```

### Performance Tuning

```bash
# Increase resource limits
kubectl patch deployment mcp-server -n mcp-production -p '{"spec":{"template":{"spec":{"containers":[{"name":"mcp-server","resources":{"limits":{"cpu":"2000m","memory":"4Gi"}}}]}}}}'

# Scale horizontally
kubectl scale deployment mcp-server -n mcp-production --replicas=5

# Enable cluster autoscaling
kubectl autoscale deployment mcp-server -n mcp-production --min=3 --max=10 --cpu-percent=70
```

### Log Analysis

```bash
# View logs
kubectl logs -n mcp-production deployment/mcp-server --tail=100 -f

# Get logs from all pods
kubectl logs -n mcp-production -l app=mcp-server --tail=100

# Export logs
kubectl logs -n mcp-production deployment/mcp-server --since=1h > mcp-logs.txt

# Search for errors
kubectl logs -n mcp-production deployment/mcp-server | grep ERROR
```

## Backup and Recovery

### Automated Backups

```yaml
# cronjob-backup.yaml
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  namespace: mcp-production
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
          - name: postgres-backup
            image: postgres:15-alpine
            command:
            - /bin/sh
            - -c
            - |
              DATE=$(date +%Y%m%d_%H%M%S)
              pg_dump -h postgres-service -U mcp_user -d mcp_production | gzip > /backup/mcp_$DATE.sql.gz
              aws s3 cp /backup/mcp_$DATE.sql.gz s3://mcp-backups/postgres/
            env:
            - name: PGPASSWORD
              valueFrom:
                secretKeyRef:
                  name: mcp-secrets
                  key: database-password
            volumeMounts:
            - name: backup
              mountPath: /backup
          volumes:
          - name: backup
            emptyDir: {}
          restartPolicy: OnFailure
```

### Disaster Recovery

```bash
# Create snapshot
kubectl exec -it postgres-0 -n mcp-production -- pg_basebackup -h localhost -D /backup/base -U mcp_user -Fp -Xs -P

# Point-in-time recovery
kubectl exec -it postgres-0 -n mcp-production -- pg_restore -h localhost -U mcp_user -d mcp_production -t "2024-01-01 12:00:00" backup.dump

# Failover procedure
kubectl patch statefulset postgres -n mcp-production -p '{"spec":{"replicas":0}}'
kubectl patch statefulset postgres-replica -n mcp-production -p '{"spec":{"replicas":1}}'
kubectl patch service postgres-service -n mcp-production -p '{"spec":{"selector":{"app":"postgres-replica"}}}'
```

## Post-Deployment Checklist

- [ ] All pods are running and healthy
- [ ] Ingress is configured with SSL certificates
- [ ] Database connections are established
- [ ] Redis cache is operational
- [ ] Vault is unsealed and accessible
- [ ] Monitoring dashboards are displaying metrics
- [ ] Alerts are configured and firing correctly
- [ ] Backup jobs are scheduled and running
- [ ] Load balancer health checks are passing
- [ ] WebSocket connections are working
- [ ] Rate limiting is enforced
- [ ] Security groups/firewall rules are configured
- [ ] Logs are being collected and stored
- [ ] Performance meets SLA requirements
- [ ] Disaster recovery plan is tested

## Support

For deployment assistance:
- Documentation: https://docs.secure-mcp.enterprise.com
- Slack Channel: #mcp-deployment
- Email: devops@enterprise.com
- Emergency: +1-555-0123 (24/7 on-call)