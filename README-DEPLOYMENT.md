# Secure MCP Server - Deployment Guide

This guide provides comprehensive instructions for deploying the Secure MCP Server using Docker and Kubernetes.

## Table of Contents

1. [Docker Deployment](#docker-deployment)
2. [Docker Compose](#docker-compose)
3. [Kubernetes Deployment](#kubernetes-deployment)
4. [Helm Chart](#helm-chart)
5. [Security Considerations](#security-considerations)
6. [Monitoring & Observability](#monitoring--observability)
7. [Troubleshooting](#troubleshooting)

## Docker Deployment

### Building the Docker Image

```bash
# Build production image
docker build -t secure-mcp-server:latest .

# Build with specific target
docker build --target production -t secure-mcp-server:prod .

# Build with cache
docker build --cache-from secure-mcp-server:latest -t secure-mcp-server:latest .
```

### Running the Container

```bash
# Run with minimal configuration
docker run -d \
  --name secure-mcp \
  -p 3000:3000 \
  -e NODE_ENV=production \
  -e DATABASE_URL="postgresql://user:pass@host:5432/db" \
  -e REDIS_URL="redis://:pass@host:6379/0" \
  --read-only \
  --security-opt no-new-privileges \
  --cap-drop ALL \
  secure-mcp-server:latest

# Run with volume mounts
docker run -d \
  --name secure-mcp \
  -p 3000:3000 \
  -v $(pwd)/logs:/app/logs:rw \
  -v $(pwd)/config:/app/config:ro \
  --env-file .env.production \
  secure-mcp-server:latest
```

## Docker Compose

### Development Environment

```bash
# Start all services
docker-compose up -d

# Start with build
docker-compose up --build -d

# View logs
docker-compose logs -f app

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v
```

### Production Environment

```bash
# Use production compose file
docker-compose -f docker-compose.yml -f docker-compose.prod.yml up -d

# Scale application
docker-compose up -d --scale app=3
```

## Kubernetes Deployment

### Prerequisites

- Kubernetes 1.25+
- kubectl configured
- Ingress controller installed
- cert-manager (for TLS)
- Metrics server (for HPA)

### Using Kustomize

```bash
# Deploy to development
kubectl apply -k kubernetes/overlays/dev

# Deploy to staging
kubectl apply -k kubernetes/overlays/staging

# Deploy to production
kubectl apply -k kubernetes/overlays/production

# Dry run
kubectl apply -k kubernetes/overlays/production --dry-run=client -o yaml

# Delete deployment
kubectl delete -k kubernetes/overlays/production
```

### Manual Deployment

```bash
# Create namespace
kubectl create namespace secure-mcp

# Apply configurations
kubectl apply -f kubernetes/base/namespace.yaml
kubectl apply -f kubernetes/base/configmap.yaml
kubectl apply -f kubernetes/base/secret.yaml
kubectl apply -f kubernetes/base/deployment.yaml
kubectl apply -f kubernetes/base/service.yaml
kubectl apply -f kubernetes/base/ingress.yaml

# Check deployment status
kubectl get pods -n secure-mcp
kubectl get svc -n secure-mcp
kubectl get ingress -n secure-mcp

# View logs
kubectl logs -f deployment/secure-mcp -n secure-mcp

# Scale deployment
kubectl scale deployment secure-mcp --replicas=5 -n secure-mcp
```

### Updating Secrets

```bash
# Create secret from literal
kubectl create secret generic secure-mcp-secrets \
  --from-literal=DB_PASSWORD='NewPassword123!' \
  --from-literal=JWT_SECRET='NewJWTSecret!' \
  -n secure-mcp \
  --dry-run=client -o yaml | kubectl apply -f -

# Create secret from file
kubectl create secret generic secure-mcp-secrets \
  --from-env-file=secrets.env \
  -n secure-mcp \
  --dry-run=client -o yaml | kubectl apply -f -

# Trigger rolling restart after secret update
kubectl rollout restart deployment/secure-mcp -n secure-mcp
```

## Helm Chart

### Installation

```bash
# Add repository (if using remote chart)
helm repo add secure-mcp https://charts.example.com
helm repo update

# Install from local chart
helm install secure-mcp ./helm/secure-mcp \
  --namespace secure-mcp \
  --create-namespace

# Install with custom values
helm install secure-mcp ./helm/secure-mcp \
  --namespace secure-mcp \
  --create-namespace \
  -f custom-values.yaml

# Install with inline values
helm install secure-mcp ./helm/secure-mcp \
  --namespace secure-mcp \
  --create-namespace \
  --set image.tag=v1.2.0 \
  --set replicaCount=5 \
  --set postgresql.enabled=true
```

### Upgrading

```bash
# Upgrade release
helm upgrade secure-mcp ./helm/secure-mcp \
  --namespace secure-mcp \
  -f custom-values.yaml

# Upgrade with rollback on failure
helm upgrade secure-mcp ./helm/secure-mcp \
  --namespace secure-mcp \
  --atomic \
  --timeout 5m

# Rollback to previous version
helm rollback secure-mcp 1 --namespace secure-mcp

# View history
helm history secure-mcp --namespace secure-mcp
```

### Uninstallation

```bash
# Uninstall release
helm uninstall secure-mcp --namespace secure-mcp

# Delete namespace
kubectl delete namespace secure-mcp
```

## Security Considerations

### Container Security

1. **Non-root user**: Containers run as user 10001
2. **Read-only filesystem**: Enabled by default
3. **Capabilities dropped**: All capabilities are dropped
4. **Security contexts**: Enforced at pod and container level
5. **Network policies**: Zero-trust networking implemented

### Secrets Management

```bash
# Use external secrets operator
kubectl apply -f https://raw.githubusercontent.com/external-secrets/external-secrets/main/deploy/crds/bundle.yaml

# Create external secret
cat <<EOF | kubectl apply -f -
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: secure-mcp-secrets
  namespace: secure-mcp
spec:
  secretStoreRef:
    name: vault-backend
    kind: SecretStore
  target:
    name: secure-mcp-secrets
  data:
    - secretKey: DB_PASSWORD
      remoteRef:
        key: secret/data/secure-mcp
        property: db_password
EOF
```

### TLS Configuration

```bash
# Create TLS certificate
kubectl create secret tls secure-mcp-tls \
  --cert=tls.crt \
  --key=tls.key \
  -n secure-mcp

# Using cert-manager
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: secure-mcp-cert
  namespace: secure-mcp
spec:
  secretName: secure-mcp-tls
  issuerRef:
    name: letsencrypt-prod
    kind: ClusterIssuer
  dnsNames:
    - api.example.com
EOF
```

## Monitoring & Observability

### Prometheus Metrics

```bash
# Port-forward to access metrics
kubectl port-forward svc/secure-mcp-service 9090:9090 -n secure-mcp

# Check metrics
curl http://localhost:9090/metrics
```

### Grafana Dashboards

```bash
# Import dashboard
kubectl create configmap secure-mcp-dashboard \
  --from-file=dashboard.json \
  -n monitoring
```

### Logging

```bash
# View logs
kubectl logs -f deployment/secure-mcp -n secure-mcp

# View logs with timestamps
kubectl logs -f deployment/secure-mcp -n secure-mcp --timestamps

# View previous container logs
kubectl logs deployment/secure-mcp -n secure-mcp --previous

# Stream logs with stern
stern secure-mcp -n secure-mcp
```

## Troubleshooting

### Common Issues

#### Pod not starting

```bash
# Check pod status
kubectl describe pod <pod-name> -n secure-mcp

# Check events
kubectl get events -n secure-mcp --sort-by='.lastTimestamp'

# Check resource usage
kubectl top pods -n secure-mcp
```

#### Database connection issues

```bash
# Test database connectivity
kubectl run -it --rm debug \
  --image=postgres:16 \
  --restart=Never \
  -n secure-mcp \
  -- psql -h postgres-service -U mcp_user -d mcp_db
```

#### Ingress not working

```bash
# Check ingress status
kubectl describe ingress secure-mcp-ingress -n secure-mcp

# Check ingress controller logs
kubectl logs -n ingress-nginx deployment/ingress-nginx-controller

# Test with port-forward
kubectl port-forward svc/secure-mcp-service 8080:80 -n secure-mcp
```

### Performance Tuning

```bash
# Check HPA status
kubectl get hpa secure-mcp-hpa -n secure-mcp

# Check metrics
kubectl get --raw /apis/metrics.k8s.io/v1beta1/namespaces/secure-mcp/pods

# Adjust resources
kubectl set resources deployment/secure-mcp \
  --limits=cpu=2000m,memory=2Gi \
  --requests=cpu=1000m,memory=1Gi \
  -n secure-mcp
```

### Backup and Restore

```bash
# Backup namespace
kubectl get all,cm,secret,ing,netpol,pdb -n secure-mcp -o yaml > backup.yaml

# Restore from backup
kubectl apply -f backup.yaml
```

## Production Checklist

- [ ] TLS certificates configured
- [ ] Secrets stored in external vault
- [ ] Network policies enabled
- [ ] Pod security policies/standards enforced
- [ ] Resource limits and requests set
- [ ] HPA configured with appropriate metrics
- [ ] PDB configured for high availability
- [ ] Monitoring and alerting configured
- [ ] Backup strategy implemented
- [ ] Disaster recovery plan tested
- [ ] Security scanning in CI/CD pipeline
- [ ] Load testing completed
- [ ] Documentation updated

## Support

For issues and questions:
- GitHub Issues: https://github.com/enterprise/secure-mcp-server/issues
- Documentation: https://docs.example.com/secure-mcp
- Security: security@example.com