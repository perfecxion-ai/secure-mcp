import { Request, Response, NextFunction, Application } from 'express';
import promClient from 'prom-client';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import os from 'os';

// Configure Prometheus client
promClient.collectDefaultMetrics({
  gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5],
  register: promClient.register,
  prefix: 'mcp_',
} as any);

/**
 * Custom metrics definitions
 */
export class Metrics {
  // HTTP metrics
  public static httpRequestDuration = new promClient.Histogram({
    name: 'mcp_http_request_duration_seconds',
    help: 'Duration of HTTP requests in seconds',
    labelNames: ['method', 'route', 'status_code', 'user_id'],
    buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
  });

  public static httpRequestsTotal = new promClient.Counter({
    name: 'mcp_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status_code', 'user_id'],
  });

  public static httpRequestsInFlight = new promClient.Gauge({
    name: 'mcp_http_requests_in_flight',
    help: 'Current number of HTTP requests being processed',
    labelNames: ['method', 'route'],
  });

  // WebSocket metrics
  public static wsConnectionsTotal = new promClient.Gauge({
    name: 'mcp_websocket_connections_total',
    help: 'Total number of active WebSocket connections',
  });

  public static wsMessagesTotal = new promClient.Counter({
    name: 'mcp_websocket_messages_total',
    help: 'Total number of WebSocket messages',
    labelNames: ['type', 'user_id'],
  });

  public static wsMessageDuration = new promClient.Histogram({
    name: 'mcp_websocket_message_duration_seconds',
    help: 'Duration of WebSocket message processing in seconds',
    labelNames: ['type', 'user_id'],
    buckets: [0.001, 0.01, 0.1, 1, 5],
  });

  // Authentication metrics
  public static authAttemptsTotal = new promClient.Counter({
    name: 'mcp_auth_attempts_total',
    help: 'Total number of authentication attempts',
    labelNames: ['method', 'status', 'user_id'],
  });

  public static authFailuresTotal = new promClient.Counter({
    name: 'mcp_auth_failures_total',
    help: 'Total number of authentication failures',
    labelNames: ['reason', 'ip_address'],
  });

  public static activeSessionsTotal = new promClient.Gauge({
    name: 'mcp_active_sessions_total',
    help: 'Total number of active user sessions',
  });

  public static mfaAttemptsTotal = new promClient.Counter({
    name: 'mcp_mfa_attempts_total',
    help: 'Total number of MFA attempts',
    labelNames: ['status', 'method'],
  });

  // Database metrics
  public static dbConnectionsActive = new promClient.Gauge({
    name: 'mcp_db_connections_active',
    help: 'Number of active database connections',
  });

  public static dbQueryDuration = new promClient.Histogram({
    name: 'mcp_db_query_duration_seconds',
    help: 'Duration of database queries in seconds',
    labelNames: ['operation', 'table'],
    buckets: [0.001, 0.01, 0.1, 1, 5, 10],
  });

  public static dbQueriesTotal = new promClient.Counter({
    name: 'mcp_db_queries_total',
    help: 'Total number of database queries',
    labelNames: ['operation', 'table', 'status'],
  });

  public static dbConnectionErrors = new promClient.Counter({
    name: 'mcp_db_connection_errors_total',
    help: 'Total number of database connection errors',
    labelNames: ['error_type'],
  });

  // Redis metrics
  public static redisConnectionsActive = new promClient.Gauge({
    name: 'mcp_redis_connections_active',
    help: 'Number of active Redis connections',
  });

  public static redisOperationDuration = new promClient.Histogram({
    name: 'mcp_redis_operation_duration_seconds',
    help: 'Duration of Redis operations in seconds',
    labelNames: ['operation'],
    buckets: [0.001, 0.01, 0.1, 1, 5],
  });

  public static redisOperationsTotal = new promClient.Counter({
    name: 'mcp_redis_operations_total',
    help: 'Total number of Redis operations',
    labelNames: ['operation', 'status'],
  });

  // MCP Protocol metrics
  public static mcpToolExecutions = new promClient.Counter({
    name: 'mcp_tool_executions_total',
    help: 'Total number of MCP tool executions',
    labelNames: ['tool_name', 'status', 'user_id'],
  });

  public static mcpToolDuration = new promClient.Histogram({
    name: 'mcp_tool_execution_duration_seconds',
    help: 'Duration of MCP tool executions in seconds',
    labelNames: ['tool_name', 'user_id'],
    buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  });

  public static mcpResourceAccess = new promClient.Counter({
    name: 'mcp_resource_access_total',
    help: 'Total number of MCP resource accesses',
    labelNames: ['resource_uri', 'status', 'user_id'],
  });

  // Security metrics
  public static securityViolations = new promClient.Counter({
    name: 'mcp_security_violations_total',
    help: 'Total number of security violations',
    labelNames: ['type', 'severity', 'ip_address'],
  });

  public static rateLimitHits = new promClient.Counter({
    name: 'mcp_rate_limit_hits_total',
    help: 'Total number of rate limit hits',
    labelNames: ['limiter_type', 'identifier'],
  });

  public static suspiciousActivity = new promClient.Counter({
    name: 'mcp_suspicious_activity_total',
    help: 'Total number of suspicious activities detected',
    labelNames: ['type', 'ip_address'],
  });

  // Error metrics
  public static errorsTotal = new promClient.Counter({
    name: 'mcp_errors_total',
    help: 'Total number of errors',
    labelNames: ['category', 'severity', 'code'],
  });

  public static unhandledErrorsTotal = new promClient.Counter({
    name: 'mcp_unhandled_errors_total',
    help: 'Total number of unhandled errors',
    labelNames: ['type'],
  });

  // Business metrics
  public static userRegistrations = new promClient.Counter({
    name: 'mcp_user_registrations_total',
    help: 'Total number of user registrations',
  });

  public static apiUsage = new promClient.Counter({
    name: 'mcp_api_usage_total',
    help: 'Total API usage by endpoint',
    labelNames: ['endpoint', 'method', 'user_id'],
  });

  // System metrics
  public static systemMemoryUsage = new promClient.Gauge({
    name: 'mcp_system_memory_usage_bytes',
    help: 'System memory usage in bytes',
    labelNames: ['type'],
  });

  public static systemCpuUsage = new promClient.Gauge({
    name: 'mcp_system_cpu_usage_percent',
    help: 'System CPU usage percentage',
  });

  public static uptimeSeconds = new promClient.Gauge({
    name: 'mcp_uptime_seconds',
    help: 'Application uptime in seconds',
  });

  // Cache metrics
  public static cacheOperations = new promClient.Counter({
    name: 'mcp_cache_operations_total',
    help: 'Total number of cache operations',
    labelNames: ['operation', 'result'],
  });

  public static cacheHitRatio = new promClient.Gauge({
    name: 'mcp_cache_hit_ratio',
    help: 'Cache hit ratio',
  });

  /**
   * Record HTTP request metrics
   */
  static recordHttpRequest(
    method: string,
    route: string,
    statusCode: number,
    duration: number,
    userId?: string
  ): void {
    const labels = {
      method,
      route,
      status_code: statusCode.toString(),
      user_id: userId || 'anonymous',
    };

    this.httpRequestDuration.observe(labels, duration / 1000);
    this.httpRequestsTotal.inc(labels);
  }

  /**
   * Record WebSocket metrics
   */
  static recordWebSocketMessage(type: string, duration: number, userId: string): void {
    const labels = { type, user_id: userId };
    this.wsMessagesTotal.inc(labels);
    this.wsMessageDuration.observe(labels, duration / 1000);
  }

  /**
   * Record authentication metrics
   */
  static recordAuthAttempt(method: string, status: string, userId?: string): void {
    this.authAttemptsTotal.inc({
      method,
      status,
      user_id: userId || 'unknown',
    });
  }

  /**
   * Record database metrics
   */
  static recordDbQuery(operation: string, table: string, duration: number, status: string): void {
    const labels = { operation, table, status };
    this.dbQueriesTotal.inc(labels);
    this.dbQueryDuration.observe({ operation, table }, duration / 1000);
  }

  /**
   * Record MCP tool execution
   */
  static recordToolExecution(toolName: string, status: string, duration: number, userId: string): void {
    this.mcpToolExecutions.inc({
      tool_name: toolName,
      status,
      user_id: userId,
    });

    this.mcpToolDuration.observe({
      tool_name: toolName,
      user_id: userId,
    }, duration / 1000);
  }

  /**
   * Record security violation
   */
  static recordSecurityViolation(type: string, severity: string, ipAddress: string): void {
    this.securityViolations.inc({
      type,
      severity,
      ip_address: ipAddress,
    });
  }

  /**
   * Record error
   */
  static recordError(category: string, severity: string, code?: string): void {
    this.errorsTotal.inc({
      category,
      severity,
      code: code || 'unknown',
    });
  }

  /**
   * Update system metrics
   */
  static updateSystemMetrics(): void {
    const memUsage = process.memoryUsage();

    this.systemMemoryUsage.set({ type: 'rss' }, memUsage.rss);
    this.systemMemoryUsage.set({ type: 'heap_total' }, memUsage.heapTotal);
    this.systemMemoryUsage.set({ type: 'heap_used' }, memUsage.heapUsed);
    this.systemMemoryUsage.set({ type: 'external' }, memUsage.external);

    // CPU usage (simplified)
    const cpuUsage = process.cpuUsage();
    const totalUsage = cpuUsage.user + cpuUsage.system;
    this.systemCpuUsage.set(totalUsage / 1000000); // Convert to seconds

    // Uptime
    this.uptimeSeconds.set(process.uptime());
  }

  /**
   * Get all metrics as Prometheus format
   */
  static async getMetrics(): Promise<string> {
    return promClient.register.metrics();
  }

  /**
   * Clear all metrics
   */
  static clearMetrics(): void {
    promClient.register.clear();
  }

  /**
   * Get specific metric values
   */
  static async getMetricValues(metricName: string): Promise<any> {
    const metric = promClient.register.getSingleMetric(metricName);
    return metric ? await metric.get() : null;
  }
}

/**
 * Middleware to collect HTTP metrics
 */
export const metricsMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  const startTime = Date.now();

  // Track request in flight
  const route = req.route?.path || req.path;
  Metrics.httpRequestsInFlight.inc({ method: req.method, route });

  // Override end method to capture metrics
  const originalEnd = res.end;
  res.end = function(...args: any[]) {
    const duration = Date.now() - startTime;

    // Record HTTP metrics
    Metrics.recordHttpRequest(
      req.method,
      route,
      res.statusCode,
      duration,
      req.user?.id
    );

    // Decrease in-flight counter
    Metrics.httpRequestsInFlight.dec({ method: req.method, route });

    // Record API usage
    Metrics.apiUsage.inc({
      endpoint: route,
      method: req.method,
      user_id: req.user?.id || 'anonymous',
    });

    return originalEnd.apply(this, args);
  };

  next();
};

/**
 * Setup metrics collection
 */
export const setupMetrics = (app: Application): void => {
  if (!config.monitoring.enabled) {
    logger.info('Metrics collection disabled');
    return;
  }

  // Expose metrics endpoint
  app.get(config.monitoring.path, async (req: Request, res: Response) => {
    try {
      res.set('Content-Type', promClient.register.contentType);
      const metrics = await Metrics.getMetrics();
      res.send(metrics);
    } catch (error) {
      logger.error('Failed to get metrics', { error });
      res.status(500).send('Failed to get metrics');
    }
  });

  // Setup periodic system metrics collection
  setInterval(() => {
    Metrics.updateSystemMetrics();
  }, 10000); // Every 10 seconds

  // Setup cache hit ratio calculation
  let cacheHits = 0;
  let cacheMisses = 0;

  const originalCacheInc = Metrics.cacheOperations.inc.bind(Metrics.cacheOperations);
  Metrics.cacheOperations.inc = (labels: any) => {
    if (labels.result === 'hit') {
      cacheHits++;
    } else if (labels.result === 'miss') {
      cacheMisses++;
    }

    const total = cacheHits + cacheMisses;
    if (total > 0) {
      Metrics.cacheHitRatio.set(cacheHits / total);
    }

    return originalCacheInc(labels);
  };

  logger.info('Metrics collection setup completed', {
    endpoint: config.monitoring.path,
    port: config.server.port,
  });
};

/**
 * Health check metrics
 */
export class HealthMetrics {
  public static healthCheckDuration = new promClient.Histogram({
    name: 'mcp_health_check_duration_seconds',
    help: 'Duration of health checks in seconds',
    labelNames: ['check_type'],
    buckets: [0.1, 0.5, 1, 2, 5],
  });

  public static healthCheckStatus = new promClient.Gauge({
    name: 'mcp_health_check_status',
    help: 'Health check status (1 = healthy, 0 = unhealthy)',
    labelNames: ['check_type'],
  });

  public static serviceAvailability = new promClient.Gauge({
    name: 'mcp_service_availability',
    help: 'Service availability percentage over time',
    labelNames: ['service'],
  });

  /**
   * Record health check result
   */
  static recordHealthCheck(checkType: string, duration: number, isHealthy: boolean): void {
    this.healthCheckDuration.observe({ check_type: checkType }, duration / 1000);
    this.healthCheckStatus.set({ check_type: checkType }, isHealthy ? 1 : 0);
  }

  /**
   * Update service availability
   */
  static updateServiceAvailability(service: string, availability: number): void {
    this.serviceAvailability.set({ service }, availability);
  }
}

/**
 * Custom metrics for specific business logic
 */
export class BusinessMetrics {
  public static userActivityDuration = new promClient.Histogram({
    name: 'mcp_user_activity_duration_seconds',
    help: 'Duration of user activity sessions',
    labelNames: ['user_id', 'activity_type'],
    buckets: [60, 300, 900, 1800, 3600, 7200], // 1min to 2h
  });

  public static dataProcessingLatency = new promClient.Histogram({
    name: 'mcp_data_processing_latency_seconds',
    help: 'Data processing latency',
    labelNames: ['process_type'],
    buckets: [0.1, 1, 5, 10, 30, 60],
  });

  public static concurrentUsers = new promClient.Gauge({
    name: 'mcp_concurrent_users',
    help: 'Number of concurrent active users',
  });

  /**
   * Record user activity
   */
  static recordUserActivity(userId: string, activityType: string, duration: number): void {
    this.userActivityDuration.observe({
      user_id: userId,
      activity_type: activityType,
    }, duration);
  }

  /**
   * Update concurrent users count
   */
  static updateConcurrentUsers(count: number): void {
    this.concurrentUsers.set(count);
  }
}

// Export all metrics classes
// Classes are already exported above

// Setup cleanup on process exit
process.on('SIGTERM', () => {
  logger.info('Cleaning up metrics on shutdown');
  promClient.register.clear();
});

process.on('SIGINT', () => {
  logger.info('Cleaning up metrics on shutdown');
  promClient.register.clear();
});