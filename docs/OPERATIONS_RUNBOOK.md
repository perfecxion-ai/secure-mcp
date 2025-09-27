# Operations Runbook

## Secure MCP Server - Production Operations Guide

### Table of Contents

1. [System Overview](#system-overview)
2. [Daily Operations](#daily-operations)
3. [Monitoring and Alerting](#monitoring-and-alerting)
4. [Health Checks](#health-checks)
5. [Performance Monitoring](#performance-monitoring)
6. [Log Management](#log-management)
7. [Backup and Recovery](#backup-and-recovery)
8. [Scaling Operations](#scaling-operations)
9. [Maintenance Procedures](#maintenance-procedures)
10. [Troubleshooting Guide](#troubleshooting-guide)
11. [Emergency Procedures](#emergency-procedures)
12. [Disaster Recovery](#disaster-recovery)

## System Overview

### Architecture Components

```
┌─────────────────────────────────────────────────────────────┐
│                     Production Environment                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Region 1   │  │   Region 2   │  │   Region 3   │      │
│  │              │  │              │  │              │      │
│  │  ├─ 3x App   │  │  ├─ 3x App   │  │  ├─ 3x App   │      │
│  │  ├─ 1x DB    │  │  ├─ 1x DB    │  │  ├─ 1x DB    │      │
│  │  └─ 1x Cache │  │  └─ 1x Cache │  │  └─ 1x Cache │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│                                                               │
│  ┌───────────────────────────────────────────────────┐      │
│  │              Global Services                       │      │
│  │  ├─ Load Balancer (Multi-Region)                  │      │
│  │  ├─ CDN (CloudFlare)                              │      │
│  │  ├─ WAF (AWS WAF)                                 │      │
│  │  └─ DNS (Route53)                                 │      │
│  └───────────────────────────────────────────────────┘      │
│                                                               │
│  ┌───────────────────────────────────────────────────┐      │
│  │              Monitoring & Operations               │      │
│  │  ├─ Prometheus + Grafana                          │      │
│  │  ├─ ELK Stack                                     │      │
│  │  ├─ PagerDuty                                     │      │
│  │  └─ Datadog                                       │      │
│  └───────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### Service Dependencies

| Service | Depends On | Critical | Recovery Time |
|---------|-----------|----------|---------------|
| MCP API Server | PostgreSQL, Redis, Vault | Yes | < 5 min |
| WebSocket Server | Redis, API Server | Yes | < 5 min |
| PostgreSQL Primary | None | Yes | < 10 min |
| PostgreSQL Replica | Primary DB | No | < 30 min |
| Redis Cache | None | Yes | < 5 min |
| Vault | None | Yes | < 5 min |
| Monitoring | None | No | < 1 hour |

## Daily Operations

### Morning Checklist (9:00 AM)

```bash
#!/bin/bash
# Daily operations check script

echo "=== MCP Server Daily Operations Check ==="
echo "Date: $(date)"
echo ""

# 1. Check cluster health
echo "1. Checking Kubernetes cluster health..."
kubectl get nodes -o wide
kubectl get pods -n mcp-production | grep -v Running

# 2. Check database status
echo "2. Checking database status..."
kubectl exec -n mcp-production postgres-0 -- pg_isready
kubectl exec -n mcp-production postgres-0 -- psql -U mcp_user -d mcp_production -c "SELECT count(*) FROM pg_stat_activity;"

# 3. Check Redis status
echo "3. Checking Redis status..."
kubectl exec -n mcp-production redis-0 -- redis-cli ping
kubectl exec -n mcp-production redis-0 -- redis-cli info stats | grep instantaneous_ops_per_sec

# 4. Check Vault status
echo "4. Checking Vault status..."
kubectl exec -n mcp-production vault-0 -- vault status

# 5. Check application metrics
echo "5. Checking application metrics..."
curl -s http://prometheus:9090/api/v1/query?query=up | jq '.data.result[] | select(.metric.job=="mcp-server")'

# 6. Check error rates
echo "6. Checking error rates (last 1h)..."
curl -s http://prometheus:9090/api/v1/query?query=rate(mcp_server_errors_total[1h]) | jq '.data.result'

# 7. Check disk usage
echo "7. Checking disk usage..."
kubectl exec -n mcp-production postgres-0 -- df -h
kubectl top nodes

# 8. Check certificate expiration
echo "8. Checking certificate expiration..."
echo | openssl s_client -connect api.secure-mcp.enterprise.com:443 2>/dev/null | openssl x509 -noout -dates

# 9. Review overnight alerts
echo "9. Recent alerts (last 12h)..."
curl -s http://prometheus:9090/api/v1/alerts | jq '.data.alerts[] | {labels: .labels, state: .state}'

echo ""
echo "=== Daily check complete ==="
```

### Health Status Dashboard

```typescript
// Health check aggregator
class HealthMonitor {
  async getSystemHealth(): Promise<SystemHealth> {
    const checks = await Promise.allSettled([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkVault(),
      this.checkAPI(),
      this.checkWebSocket(),
      this.checkDiskSpace(),
      this.checkMemory(),
      this.checkCPU()
    ]);

    const health: SystemHealth = {
      timestamp: new Date().toISOString(),
      status: 'healthy',
      components: {},
      metrics: {}
    };

    checks.forEach((check, index) => {
      const component = this.componentNames[index];
      if (check.status === 'fulfilled') {
        health.components[component] = check.value;
        if (check.value.status !== 'healthy') {
          health.status = 'degraded';
        }
      } else {
        health.components[component] = {
          status: 'unhealthy',
          error: check.reason
        };
        health.status = 'unhealthy';
      }
    });

    return health;
  }

  private async checkDatabase(): Promise<ComponentHealth> {
    const start = Date.now();
    try {
      const result = await db.query('SELECT 1');
      const connections = await db.query('SELECT count(*) FROM pg_stat_activity');
      const replicationLag = await this.getReplicationLag();

      return {
        status: replicationLag < 1000 ? 'healthy' : 'degraded',
        latency: Date.now() - start,
        metadata: {
          activeConnections: connections.rows[0].count,
          replicationLag: replicationLag,
          version: await this.getDatabaseVersion()
        }
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        latency: Date.now() - start,
        error: error.message
      };
    }
  }
}
```

## Monitoring and Alerting

### Key Metrics to Monitor

| Metric | Description | Normal Range | Alert Threshold | Action |
|--------|-------------|--------------|-----------------|--------|
| API Response Time (P95) | 95th percentile response time | < 200ms | > 500ms | Scale horizontally |
| API Error Rate | Percentage of 5xx errors | < 0.1% | > 1% | Check logs, rollback if needed |
| WebSocket Connections | Active WebSocket connections | 0-10,000 | > 9,000 | Scale WebSocket servers |
| Database CPU | PostgreSQL CPU usage | < 60% | > 80% | Scale vertically or optimize queries |
| Database Connections | Active database connections | < 80 | > 90 | Increase pool size |
| Redis Memory | Redis memory usage | < 70% | > 85% | Increase memory or evict keys |
| Disk Usage | Filesystem usage | < 70% | > 85% | Clean logs, increase storage |
| Memory Usage | Container memory usage | < 70% | > 85% | Scale horizontally |
| CPU Usage | Container CPU usage | < 60% | > 80% | Scale horizontally |
| Request Rate | Requests per second | Variable | > 10,000 | Enable rate limiting |

### Prometheus Alert Rules

```yaml
# prometheus-alerts.yml
groups:
  - name: mcp-server-alerts
    interval: 30s
    rules:
      # High Error Rate
      - alert: HighErrorRate
        expr: rate(mcp_server_errors_total[5m]) > 0.01
        for: 5m
        labels:
          severity: critical
          team: backend
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }} for {{ $labels.instance }}"

      # High Response Time
      - alert: HighResponseTime
        expr: histogram_quantile(0.95, rate(mcp_server_request_duration_seconds_bucket[5m])) > 0.5
        for: 5m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "High response time"
          description: "P95 response time is {{ $value }}s"

      # Database Connection Pool Exhaustion
      - alert: DatabaseConnectionPoolExhaustion
        expr: mcp_database_connections_active / mcp_database_connections_max > 0.9
        for: 2m
        labels:
          severity: critical
          team: database
        annotations:
          summary: "Database connection pool nearly exhausted"
          description: "{{ $value | humanizePercentage }} of connections in use"

      # Redis Memory High
      - alert: RedisMemoryHigh
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.85
        for: 5m
        labels:
          severity: warning
          team: backend
        annotations:
          summary: "Redis memory usage high"
          description: "Redis memory at {{ $value | humanizePercentage }}"

      # Pod Restart
      - alert: PodRestartingTooOften
        expr: rate(kube_pod_container_status_restarts_total[15m]) > 0
        for: 5m
        labels:
          severity: warning
          team: devops
        annotations:
          summary: "Pod restarting frequently"
          description: "Pod {{ $labels.pod }} has restarted {{ $value }} times"

      # Certificate Expiry
      - alert: CertificateExpiringSoon
        expr: probe_ssl_earliest_cert_expiry - time() < 86400 * 7
        for: 1h
        labels:
          severity: warning
          team: security
        annotations:
          summary: "SSL certificate expiring soon"
          description: "Certificate expires in {{ $value | humanizeDuration }}"

      # Disk Space Low
      - alert: DiskSpaceLow
        expr: node_filesystem_avail_bytes / node_filesystem_size_bytes < 0.15
        for: 5m
        labels:
          severity: warning
          team: devops
        annotations:
          summary: "Low disk space"
          description: "Only {{ $value | humanizePercentage }} disk space available on {{ $labels.mountpoint }}"

      # Service Down
      - alert: ServiceDown
        expr: up{job="mcp-server"} == 0
        for: 1m
        labels:
          severity: critical
          team: oncall
        annotations:
          summary: "Service is down"
          description: "{{ $labels.instance }} has been down for more than 1 minute"
```

### Grafana Dashboard Configuration

```json
{
  "dashboard": {
    "title": "MCP Server Operations",
    "panels": [
      {
        "title": "Request Rate",
        "targets": [
          {
            "expr": "rate(mcp_server_requests_total[5m])",
            "legendFormat": "{{ method }} {{ endpoint }}"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Response Time (P50, P95, P99)",
        "targets": [
          {
            "expr": "histogram_quantile(0.5, rate(mcp_server_request_duration_seconds_bucket[5m]))",
            "legendFormat": "P50"
          },
          {
            "expr": "histogram_quantile(0.95, rate(mcp_server_request_duration_seconds_bucket[5m]))",
            "legendFormat": "P95"
          },
          {
            "expr": "histogram_quantile(0.99, rate(mcp_server_request_duration_seconds_bucket[5m]))",
            "legendFormat": "P99"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Error Rate",
        "targets": [
          {
            "expr": "rate(mcp_server_errors_total[5m])",
            "legendFormat": "{{ status_code }}"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Active Connections",
        "targets": [
          {
            "expr": "mcp_websocket_connections_active",
            "legendFormat": "WebSocket"
          },
          {
            "expr": "mcp_database_connections_active",
            "legendFormat": "Database"
          },
          {
            "expr": "mcp_redis_connections_active",
            "legendFormat": "Redis"
          }
        ],
        "type": "graph"
      },
      {
        "title": "Resource Usage",
        "targets": [
          {
            "expr": "container_cpu_usage_seconds_total",
            "legendFormat": "CPU {{ pod }}"
          },
          {
            "expr": "container_memory_usage_bytes",
            "legendFormat": "Memory {{ pod }}"
          }
        ],
        "type": "graph"
      }
    ]
  }
}
```

## Health Checks

### Application Health Endpoints

```typescript
// Health check implementation
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    version: process.env.APP_VERSION,
    uptime: process.uptime()
  });
});

app.get('/health/live', async (req, res) => {
  // Liveness probe - checks if app is running
  res.status(200).json({ status: 'alive' });
});

app.get('/health/ready', async (req, res) => {
  // Readiness probe - checks if app can serve traffic
  try {
    await Promise.all([
      db.query('SELECT 1'),
      redis.ping(),
      vault.status()
    ]);
    res.status(200).json({ ready: true });
  } catch (error) {
    res.status(503).json({ ready: false, error: error.message });
  }
});

app.get('/health/detailed', async (req, res) => {
  const health = await healthMonitor.getSystemHealth();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(health);
});
```

### Automated Health Monitoring

```bash
#!/bin/bash
# Health monitoring script

ENDPOINTS=(
  "https://api.secure-mcp.enterprise.com/health"
  "https://api.secure-mcp.enterprise.com/health/ready"
  "https://api-us-west.secure-mcp.enterprise.com/health"
  "https://api-eu.secure-mcp.enterprise.com/health"
)

for endpoint in "${ENDPOINTS[@]}"; do
  response=$(curl -s -o /dev/null -w "%{http_code}" $endpoint)

  if [ $response -ne 200 ]; then
    echo "ALERT: $endpoint returned $response"
    # Send alert to PagerDuty
    curl -X POST https://events.pagerduty.com/v2/enqueue \
      -H "Content-Type: application/json" \
      -d "{
        \"routing_key\": \"${PAGERDUTY_KEY}\",
        \"event_action\": \"trigger\",
        \"payload\": {
          \"summary\": \"Health check failed for $endpoint\",
          \"severity\": \"error\",
          \"source\": \"health-monitor\"
        }
      }"
  else
    echo "OK: $endpoint is healthy"
  fi
done
```

## Performance Monitoring

### Performance Metrics Collection

```typescript
// Performance monitoring
class PerformanceMonitor {
  private metrics = {
    requestDuration: new Histogram({
      name: 'mcp_request_duration_seconds',
      help: 'Request duration in seconds',
      labelNames: ['method', 'endpoint', 'status'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5]
    }),

    activeRequests: new Gauge({
      name: 'mcp_active_requests',
      help: 'Number of active requests',
      labelNames: ['method']
    }),

    requestSize: new Histogram({
      name: 'mcp_request_size_bytes',
      help: 'Request size in bytes',
      labelNames: ['method', 'endpoint'],
      buckets: [100, 1000, 10000, 100000, 1000000]
    }),

    responseSize: new Histogram({
      name: 'mcp_response_size_bytes',
      help: 'Response size in bytes',
      labelNames: ['method', 'endpoint'],
      buckets: [100, 1000, 10000, 100000, 1000000]
    }),

    databaseQueryDuration: new Histogram({
      name: 'mcp_database_query_duration_seconds',
      help: 'Database query duration',
      labelNames: ['operation'],
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1]
    })
  };

  trackRequest(req: Request, res: Response, duration: number) {
    const labels = {
      method: req.method,
      endpoint: req.route?.path || 'unknown',
      status: res.statusCode
    };

    this.metrics.requestDuration.observe(labels, duration);
    this.metrics.requestSize.observe(
      { method: req.method, endpoint: req.route?.path },
      parseInt(req.get('content-length') || '0')
    );
  }

  async generatePerformanceReport(): Promise<PerformanceReport> {
    const metrics = await register.metrics();

    return {
      timestamp: new Date().toISOString(),
      summary: {
        avgResponseTime: await this.getAverageResponseTime(),
        p95ResponseTime: await this.getP95ResponseTime(),
        requestsPerSecond: await this.getRequestRate(),
        errorRate: await this.getErrorRate(),
        activeConnections: await this.getActiveConnections()
      },
      detailed: metrics
    };
  }
}
```

### Performance Optimization Procedures

```bash
# Query performance analysis
kubectl exec -n mcp-production postgres-0 -- psql -U mcp_user -d mcp_production << EOF
-- Slow query analysis
SELECT
  query,
  calls,
  mean_exec_time,
  total_exec_time,
  stddev_exec_time
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 10;

-- Index usage
SELECT
  schemaname,
  tablename,
  indexname,
  idx_scan,
  idx_tup_read,
  idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_scan;

-- Table bloat
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  n_live_tup,
  n_dead_tup,
  round(n_dead_tup::float/n_live_tup::float * 100) AS dead_percentage
FROM pg_stat_user_tables
WHERE n_live_tup > 0
ORDER BY n_dead_tup DESC;
EOF
```

## Log Management

### Log Collection Architecture

```yaml
# Fluentd configuration
<source>
  @type tail
  path /var/log/containers/mcp-*.log
  pos_file /var/log/fluentd-mcp.pos
  tag kubernetes.mcp.*
  <parse>
    @type json
    time_format %Y-%m-%dT%H:%M:%S.%NZ
  </parse>
</source>

<filter kubernetes.mcp.**>
  @type record_transformer
  <record>
    hostname ${hostname}
    environment production
    application mcp-server
    cluster ${ENV["CLUSTER_NAME"]}
    region ${ENV["AWS_REGION"]}
  </record>
</filter>

<filter kubernetes.mcp.**>
  @type grep
  <exclude>
    key log_level
    pattern /debug/
  </exclude>
</filter>

<match kubernetes.mcp.**>
  @type elasticsearch
  host elasticsearch.monitoring.svc.cluster.local
  port 9200
  index_name mcp-logs
  type_name _doc
  logstash_format true
  logstash_prefix mcp
  <buffer>
    @type file
    path /var/log/fluentd-buffers/mcp.buffer
    flush_interval 10s
    flush_at_shutdown true
  </buffer>
</match>
```

### Log Analysis Queries

```json
// Elasticsearch queries for log analysis

// Error rate over time
{
  "query": {
    "bool": {
      "must": [
        { "term": { "application": "mcp-server" } },
        { "term": { "level": "error" } },
        { "range": { "@timestamp": { "gte": "now-1h" } } }
      ]
    }
  },
  "aggs": {
    "errors_over_time": {
      "date_histogram": {
        "field": "@timestamp",
        "fixed_interval": "1m"
      }
    }
  }
}

// Top error messages
{
  "query": {
    "bool": {
      "must": [
        { "term": { "level": "error" } },
        { "range": { "@timestamp": { "gte": "now-24h" } } }
      ]
    }
  },
  "aggs": {
    "top_errors": {
      "terms": {
        "field": "error.message.keyword",
        "size": 10
      }
    }
  }
}

// Slow queries
{
  "query": {
    "bool": {
      "must": [
        { "exists": { "field": "query_duration_ms" } },
        { "range": { "query_duration_ms": { "gte": 1000 } } }
      ]
    }
  },
  "sort": [
    { "query_duration_ms": { "order": "desc" } }
  ]
}
```

### Log Retention Policy

| Log Type | Retention Period | Storage Location | Compression | Archive |
|----------|-----------------|------------------|-------------|---------|
| Application Logs | 30 days | Elasticsearch | gzip | S3 Glacier |
| Access Logs | 90 days | S3 | gzip | S3 Glacier |
| Audit Logs | 7 years | S3 + Glacier | gzip + encryption | Glacier Deep Archive |
| Security Logs | 1 year | S3 | gzip + encryption | Glacier |
| Performance Logs | 7 days | Elasticsearch | gzip | None |
| Debug Logs | 24 hours | Local | None | None |

## Backup and Recovery

### Backup Strategy

```bash
#!/bin/bash
# Comprehensive backup script

BACKUP_DIR="/backup/$(date +%Y%m%d)"
S3_BUCKET="s3://mcp-backups"

# Create backup directory
mkdir -p $BACKUP_DIR

# 1. Database backup
echo "Backing up PostgreSQL..."
kubectl exec -n mcp-production postgres-0 -- \
  pg_dump -U mcp_user -d mcp_production -F c -Z 9 > $BACKUP_DIR/postgres.dump

# 2. Redis backup
echo "Backing up Redis..."
kubectl exec -n mcp-production redis-0 -- \
  redis-cli BGSAVE

kubectl cp mcp-production/redis-0:/data/dump.rdb $BACKUP_DIR/redis.rdb

# 3. Vault backup
echo "Backing up Vault..."
kubectl exec -n mcp-production vault-0 -- \
  vault operator raft snapshot save /tmp/vault-snapshot.snap

kubectl cp mcp-production/vault-0:/tmp/vault-snapshot.snap $BACKUP_DIR/vault.snap

# 4. Configuration backup
echo "Backing up configurations..."
kubectl get configmaps -n mcp-production -o yaml > $BACKUP_DIR/configmaps.yaml
kubectl get secrets -n mcp-production -o yaml > $BACKUP_DIR/secrets.yaml

# 5. Calculate checksums
find $BACKUP_DIR -type f -exec sha256sum {} \; > $BACKUP_DIR/checksums.txt

# 6. Upload to S3
aws s3 sync $BACKUP_DIR $S3_BUCKET/$(date +%Y%m%d)/ \
  --storage-class STANDARD_IA \
  --encryption AES256

# 7. Verify backup
aws s3 ls $S3_BUCKET/$(date +%Y%m%d)/
```

### Recovery Procedures

#### Database Recovery

```bash
#!/bin/bash
# PostgreSQL recovery procedure

BACKUP_DATE=$1
RECOVERY_POINT=$2

# 1. Stop application servers
kubectl scale deployment mcp-server -n mcp-production --replicas=0

# 2. Download backup
aws s3 cp s3://mcp-backups/$BACKUP_DATE/postgres.dump /tmp/

# 3. Create recovery database
kubectl exec -n mcp-production postgres-0 -- \
  createdb -U mcp_user mcp_recovery

# 4. Restore backup
kubectl cp /tmp/postgres.dump mcp-production/postgres-0:/tmp/
kubectl exec -n mcp-production postgres-0 -- \
  pg_restore -U mcp_user -d mcp_recovery /tmp/postgres.dump

# 5. Verify data integrity
kubectl exec -n mcp-production postgres-0 -- \
  psql -U mcp_user -d mcp_recovery -c "SELECT count(*) FROM users;"

# 6. Switch to recovery database
kubectl exec -n mcp-production postgres-0 -- \
  psql -U postgres -c "ALTER DATABASE mcp_production RENAME TO mcp_backup;"
kubectl exec -n mcp-production postgres-0 -- \
  psql -U postgres -c "ALTER DATABASE mcp_recovery RENAME TO mcp_production;"

# 7. Start application servers
kubectl scale deployment mcp-server -n mcp-production --replicas=3

# 8. Verify application functionality
curl https://api.secure-mcp.enterprise.com/health
```

#### Point-in-Time Recovery

```sql
-- PostgreSQL PITR configuration
-- postgresql.conf
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://mcp-wal-archive/%f'
restore_command = 'aws s3 cp s3://mcp-wal-archive/%f %p'

-- Recovery to specific time
-- recovery.conf
recovery_target_time = '2024-01-15 14:30:00'
recovery_target_action = 'promote'
recovery_target_timeline = 'latest'
```

## Scaling Operations

### Horizontal Scaling

```bash
# Manual scaling
kubectl scale deployment mcp-server -n mcp-production --replicas=5

# Check scaling status
kubectl get hpa -n mcp-production

# Update autoscaling limits
kubectl patch hpa mcp-hpa -n mcp-production \
  -p '{"spec":{"maxReplicas":15}}'
```

### Vertical Scaling

```yaml
# Update resource limits
apiVersion: v1
kind: PatchDeployment
metadata:
  name: mcp-server-resources
spec:
  containers:
  - name: mcp-server
    resources:
      requests:
        memory: "1Gi"
        cpu: "500m"
      limits:
        memory: "4Gi"
        cpu: "2000m"
```

```bash
# Apply resource changes
kubectl patch deployment mcp-server -n mcp-production --patch-file=resources.yaml

# Rolling restart
kubectl rollout restart deployment/mcp-server -n mcp-production
kubectl rollout status deployment/mcp-server -n mcp-production
```

### Database Scaling

```bash
# Scale read replicas
kubectl scale statefulset postgres-replicas -n mcp-production --replicas=3

# Upgrade database instance (AWS RDS)
aws rds modify-db-instance \
  --db-instance-identifier mcp-postgres \
  --db-instance-class db.r6g.2xlarge \
  --apply-immediately

# Add connection pooling
kubectl apply -f - <<EOF
apiVersion: v1
kind: ConfigMap
metadata:
  name: pgbouncer-config
  namespace: mcp-production
data:
  pgbouncer.ini: |
    [databases]
    mcp_production = host=postgres-service port=5432 dbname=mcp_production

    [pgbouncer]
    pool_mode = transaction
    max_client_conn = 1000
    default_pool_size = 25
    reserve_pool_size = 5
EOF
```

## Maintenance Procedures

### Scheduled Maintenance

```bash
#!/bin/bash
# Maintenance mode script

enable_maintenance() {
  # 1. Enable maintenance page
  kubectl apply -f maintenance-ingress.yaml

  # 2. Drain traffic from nodes
  for node in $(kubectl get nodes -o name); do
    kubectl drain $node --ignore-daemonsets --delete-emptydir-data
  done

  # 3. Scale down non-critical services
  kubectl scale deployment monitoring -n mcp-production --replicas=0

  # 4. Create maintenance notification
  curl -X POST https://status.secure-mcp.enterprise.com/api/v1/incidents \
    -H "Content-Type: application/json" \
    -d '{
      "title": "Scheduled Maintenance",
      "description": "System maintenance in progress",
      "status": "in_progress",
      "affected_components": ["API", "WebSocket"]
    }'
}

disable_maintenance() {
  # 1. Uncordon nodes
  for node in $(kubectl get nodes -o name); do
    kubectl uncordon $node
  done

  # 2. Remove maintenance page
  kubectl delete -f maintenance-ingress.yaml

  # 3. Scale up services
  kubectl scale deployment monitoring -n mcp-production --replicas=1

  # 4. Update status page
  curl -X PATCH https://status.secure-mcp.enterprise.com/api/v1/incidents/latest \
    -H "Content-Type: application/json" \
    -d '{"status": "resolved"}'
}
```

### Database Maintenance

```sql
-- Maintenance procedures
-- Run during maintenance window

-- 1. Update statistics
ANALYZE;

-- 2. Reindex tables
REINDEX DATABASE mcp_production;

-- 3. Vacuum tables
VACUUM (VERBOSE, ANALYZE);

-- 4. Clear old audit logs
DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '90 days';

-- 5. Reset sequences if needed
SELECT setval(pg_get_serial_sequence('users', 'id'), MAX(id)) FROM users;

-- 6. Check for table bloat
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size,
  pg_size_pretty(pg_relation_size(schemaname||'.'||tablename)) AS table_size
FROM pg_stat_user_tables
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

## Troubleshooting Guide

### Common Issues and Solutions

#### 1. High Memory Usage

```bash
# Diagnose memory usage
kubectl top pods -n mcp-production

# Get memory dump
kubectl exec -n mcp-production <pod-name> -- \
  kill -USR1 1

# Analyze heap dump
kubectl cp mcp-production/<pod-name>:/tmp/heapdump.hprof ./
java -jar jhat.jar heapdump.hprof

# Temporary fix - increase memory limit
kubectl set resources deployment mcp-server \
  -n mcp-production \
  --limits=memory=4Gi

# Permanent fix - optimize code and restart
kubectl rollout restart deployment/mcp-server -n mcp-production
```

#### 2. Database Connection Issues

```bash
# Check connection pool
kubectl exec -n mcp-production <pod-name> -- \
  psql -U mcp_user -d mcp_production -c \
  "SELECT count(*), state FROM pg_stat_activity GROUP BY state;"

# Kill idle connections
kubectl exec -n mcp-production postgres-0 -- \
  psql -U postgres -d mcp_production -c \
  "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE state = 'idle' AND state_change < now() - interval '10 minutes';"

# Increase connection limit
kubectl exec -n mcp-production postgres-0 -- \
  psql -U postgres -c "ALTER SYSTEM SET max_connections = 200;"
kubectl exec -n mcp-production postgres-0 -- \
  psql -U postgres -c "SELECT pg_reload_conf();"
```

#### 3. Slow API Response

```typescript
// Performance debugging
class PerformanceDebugger {
  async analyzeSlowRequest(requestId: string) {
    const traces = await this.getTraces(requestId);

    const analysis = {
      totalDuration: traces.duration,
      breakdown: {
        database: this.sumSpans(traces, 'database'),
        redis: this.sumSpans(traces, 'redis'),
        external: this.sumSpans(traces, 'http'),
        processing: this.sumSpans(traces, 'processing')
      },
      slowestQueries: this.getSlowQueries(traces),
      recommendations: []
    };

    if (analysis.breakdown.database > analysis.totalDuration * 0.5) {
      analysis.recommendations.push('Optimize database queries');
      analysis.recommendations.push('Add database indexes');
    }

    if (analysis.breakdown.redis > 100) {
      analysis.recommendations.push('Check Redis performance');
      analysis.recommendations.push('Consider Redis cluster');
    }

    return analysis;
  }
}
```

#### 4. WebSocket Disconnections

```bash
# Check WebSocket connections
kubectl logs -n mcp-production deployment/mcp-server | grep -i websocket

# Monitor connection stability
watch -n 1 'kubectl exec -n mcp-production <pod> -- ss -tan | grep :3000 | wc -l'

# Increase timeout values
kubectl set env deployment/mcp-server \
  -n mcp-production \
  WS_HEARTBEAT_INTERVAL=30000 \
  WS_HEARTBEAT_TIMEOUT=60000
```

### Debug Commands

```bash
# System diagnostics
kubectl get events -n mcp-production --sort-by='.lastTimestamp'
kubectl describe pod <pod-name> -n mcp-production
kubectl logs <pod-name> -n mcp-production --tail=100 -f

# Network diagnostics
kubectl exec -n mcp-production <pod> -- nslookup postgres-service
kubectl exec -n mcp-production <pod> -- ping -c 3 redis-service
kubectl exec -n mcp-production <pod> -- curl -v http://localhost:3000/health

# Resource diagnostics
kubectl top nodes
kubectl top pods -n mcp-production
kubectl describe limitranges -n mcp-production
kubectl describe resourcequotas -n mcp-production
```

## Emergency Procedures

### Incident Response Flowchart

```
┌─────────────────────────────────┐
│    Incident Detected             │
└────────────┬────────────────────┘
             │
      ┌──────▼──────┐
      │  Severity?  │
      └──────┬──────┘
             │
    ┌────────┼────────┐
    │        │        │
┌───▼──┐ ┌──▼──┐ ┌──▼───┐
│ P1   │ │ P2  │ │ P3   │
└───┬──┘ └──┬──┘ └──┬───┘
    │       │        │
    │   ┌───▼────────▼───┐
    │   │ Create Incident │
    │   │     Ticket      │
    │   └────────┬────────┘
    │            │
┌───▼────────────▼───┐
│  Page On-Call      │
│    Engineer        │
└────────┬───────────┘
         │
┌────────▼───────────┐
│  Begin Mitigation  │
└────────┬───────────┘
         │
┌────────▼───────────┐
│  Communicate       │
│    Status          │
└────────┬───────────┘
         │
┌────────▼───────────┐
│  Resolution        │
└────────┬───────────┘
         │
┌────────▼───────────┐
│  Post-Mortem       │
└────────────────────┘
```

### Emergency Contacts

| Role | Name | Phone | Email | Escalation |
|------|------|-------|-------|------------|
| On-Call Engineer | Rotation | PagerDuty | oncall@enterprise.com | Immediate |
| Team Lead | John Smith | +1-555-0001 | john.smith@enterprise.com | 5 min |
| Engineering Manager | Jane Doe | +1-555-0002 | jane.doe@enterprise.com | 15 min |
| VP Engineering | Bob Johnson | +1-555-0003 | bob.johnson@enterprise.com | 30 min |
| CTO | Alice Williams | +1-555-0004 | alice.williams@enterprise.com | 1 hour |

### Emergency Rollback

```bash
#!/bin/bash
# Emergency rollback procedure

PREVIOUS_VERSION=$1

# 1. Stop current deployment
kubectl scale deployment mcp-server -n mcp-production --replicas=0

# 2. Rollback to previous version
kubectl set image deployment/mcp-server \
  -n mcp-production \
  mcp-server=secure-mcp-server:$PREVIOUS_VERSION

# 3. Start with previous version
kubectl scale deployment mcp-server -n mcp-production --replicas=3

# 4. Verify rollback
kubectl rollout status deployment/mcp-server -n mcp-production
curl https://api.secure-mcp.enterprise.com/health

# 5. If database migration needed
kubectl exec -n mcp-production postgres-0 -- \
  psql -U mcp_user -d mcp_production < /rollback/migration-rollback.sql
```

### Circuit Breaker Activation

```typescript
// Circuit breaker implementation
class CircuitBreaker {
  private state: 'closed' | 'open' | 'half-open' = 'closed';
  private failures = 0;
  private successCount = 0;
  private nextAttempt: Date;

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (new Date() < this.nextAttempt) {
        throw new Error('Circuit breaker is open');
      }
      this.state = 'half-open';
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    if (this.state === 'half-open') {
      this.successCount++;
      if (this.successCount >= 5) {
        this.state = 'closed';
        this.successCount = 0;
      }
    }
  }

  private onFailure() {
    this.failures++;
    this.successCount = 0;
    if (this.failures >= 5) {
      this.state = 'open';
      this.nextAttempt = new Date(Date.now() + 60000); // 1 minute
      logger.error('Circuit breaker opened', {
        failures: this.failures,
        nextAttempt: this.nextAttempt
      });
    }
  }
}
```

## Disaster Recovery

### RTO and RPO Targets

| System Component | RTO | RPO | Backup Frequency | Priority |
|-----------------|-----|-----|------------------|----------|
| API Servers | 5 min | 0 min | N/A (stateless) | Critical |
| PostgreSQL Primary | 15 min | 5 min | Continuous WAL | Critical |
| PostgreSQL Replica | 30 min | 5 min | Continuous | High |
| Redis Cache | 5 min | 1 hour | Hourly | Medium |
| Vault | 10 min | 5 min | Every 5 min | Critical |
| Monitoring | 1 hour | 1 day | Daily | Low |

### Disaster Recovery Procedures

```bash
#!/bin/bash
# Full disaster recovery procedure

# 1. Assess damage
./scripts/dr-assessment.sh

# 2. Activate DR site
aws route53 change-resource-record-sets \
  --hosted-zone-id Z123456 \
  --change-batch file://dr-dns-failover.json

# 3. Restore data
./scripts/restore-from-backup.sh latest

# 4. Verify services
./scripts/health-check-all.sh

# 5. Update status page
curl -X POST https://status.secure-mcp.enterprise.com/api/incidents \
  -d '{"title": "Service Recovery in Progress", "status": "investigating"}'

# 6. Monitor recovery
watch -n 10 './scripts/recovery-status.sh'
```

### Regional Failover

```yaml
# Route53 health check and failover configuration
HealthCheck:
  Type: HTTPS
  ResourcePath: /health
  FullyQualifiedDomainName: api-us-east.secure-mcp.enterprise.com
  Port: 443
  RequestInterval: 30
  FailureThreshold: 3

RecordSet:
  Name: api.secure-mcp.enterprise.com
  Type: A
  SetIdentifier: us-east-1
  Weight: 100
  AliasTarget:
    HostedZoneId: Z123456
    DNSName: api-us-east.secure-mcp.enterprise.com
  HealthCheckId: !Ref HealthCheck
  Failover: PRIMARY

RecordSetDR:
  Name: api.secure-mcp.enterprise.com
  Type: A
  SetIdentifier: us-west-2
  Weight: 0
  AliasTarget:
    HostedZoneId: Z789012
    DNSName: api-us-west.secure-mcp.enterprise.com
  Failover: SECONDARY
```

## Runbook Automation

### Automated Remediation

```python
# Automated remediation script
import kubernetes
import time
import logging

class AutoRemediation:
    def __init__(self):
        self.k8s = kubernetes.client.ApiClient()
        self.v1 = kubernetes.client.CoreV1Api()
        self.apps_v1 = kubernetes.client.AppsV1Api()

    def remediate_high_memory(self, pod_name, namespace):
        """Restart pod with high memory usage"""
        logging.info(f"Restarting pod {pod_name} due to high memory")

        # Delete pod (will be recreated by deployment)
        self.v1.delete_namespaced_pod(
            name=pod_name,
            namespace=namespace,
            grace_period_seconds=30
        )

        # Wait for new pod
        time.sleep(10)

        # Verify new pod is running
        pods = self.v1.list_namespaced_pod(namespace=namespace)
        for pod in pods.items:
            if pod.metadata.labels.get('app') == 'mcp-server':
                if pod.status.phase == 'Running':
                    logging.info(f"New pod {pod.metadata.name} is running")
                    return True

        return False

    def remediate_database_connections(self):
        """Clear idle database connections"""
        logging.info("Clearing idle database connections")

        # Execute cleanup query
        result = self.execute_in_pod(
            'postgres-0',
            'mcp-production',
            """psql -U postgres -d mcp_production -c "
            SELECT pg_terminate_backend(pid)
            FROM pg_stat_activity
            WHERE state = 'idle'
            AND state_change < now() - interval '5 minutes';"
            """
        )

        logging.info(f"Cleared {result} idle connections")
        return result

    def scale_for_load(self, current_rps):
        """Auto-scale based on request rate"""
        if current_rps > 5000:
            replicas = min(10, current_rps // 500)
            logging.info(f"Scaling to {replicas} replicas for {current_rps} RPS")

            self.apps_v1.patch_namespaced_deployment_scale(
                name='mcp-server',
                namespace='mcp-production',
                body={'spec': {'replicas': replicas}}
            )
```

## Documentation and Training

### Runbook Updates

- Review and update quarterly
- Document all incidents and resolutions
- Maintain version control for all scripts
- Regular drills and training sessions

### Training Schedule

| Training | Frequency | Audience | Duration |
|----------|-----------|----------|----------|
| Incident Response | Quarterly | All engineers | 2 hours |
| Disaster Recovery Drill | Bi-annually | Ops team | 4 hours |
| Monitoring Tools | Monthly | New hires | 1 hour |
| Security Procedures | Quarterly | All staff | 1 hour |
| Performance Tuning | Bi-annually | Senior engineers | 3 hours |

### Knowledge Base

- Internal Wiki: https://wiki.enterprise.com/mcp-operations
- Runbook Repository: https://github.com/enterprise/mcp-runbooks
- Incident History: https://incidents.enterprise.com/mcp
- Training Videos: https://training.enterprise.com/mcp-ops

## Appendix

### Useful Commands Reference

```bash
# Quick reference card
alias k='kubectl'
alias kp='kubectl -n mcp-production'
alias klog='kubectl logs -n mcp-production'
alias kexec='kubectl exec -n mcp-production -it'
alias kget='kubectl get -n mcp-production'
alias kdesc='kubectl describe -n mcp-production'

# Common operations
kp get pods -o wide
kp top pods
klog deployment/mcp-server --tail=100 -f
kexec postgres-0 -- psql -U mcp_user -d mcp_production
kp rollout restart deployment/mcp-server
kp scale deployment/mcp-server --replicas=5
```

### Monitoring URLs

- Grafana: https://grafana.secure-mcp.enterprise.com
- Prometheus: https://prometheus.secure-mcp.enterprise.com
- Kibana: https://kibana.secure-mcp.enterprise.com
- Jaeger: https://jaeger.secure-mcp.enterprise.com
- Status Page: https://status.secure-mcp.enterprise.com

### Support Contacts

- DevOps Team: devops@enterprise.com
- DBA Team: dba@enterprise.com
- Security Team: security@enterprise.com
- Network Team: network@enterprise.com
- Vendor Support: support@vendor.com