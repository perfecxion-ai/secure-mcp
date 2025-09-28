import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';
// import { NodeSDK } from '@opentelemetry/sdk-node';
// import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
// import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
// import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
// import { JaegerExporter } from '@opentelemetry/exporter-jaeger';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { Request, Response, NextFunction } from 'express';

const sdk: any | null = null;
let tracer: any = null;

/**
 * Initialize OpenTelemetry tracing
 */
export const setupTracing = async (): Promise<void> => {
  // Stub implementation - OpenTelemetry dependencies not installed
  logger.info('Tracing setup stubbed - OpenTelemetry dependencies not available');

  // Set up basic tracer mock
  tracer = {
    startSpan: () => ({
      setStatus: () => {},
      setAttributes: () => {},
      recordException: () => {},
      end: () => {},
    }),
    startActiveSpan: (name: string, fn: any) => {
      return fn({
        setStatus: () => {},
        setAttributes: () => {},
        recordException: () => {},
        end: () => {},
      });
    },
  };
};

/**
 * Tracing utility class
 */
export class TracingUtils {
  /**
   * Create a span with context
   */
  static createSpan(name: string, options?: {
    kind?: SpanKind;
    attributes?: Record<string, any>;
    parent?: any;
  }): any {
    if (!tracer) return null;

    const span = tracer.startSpan(name, {
      kind: options?.kind || SpanKind.INTERNAL,
      attributes: options?.attributes,
    }, options?.parent);

    return span;
  }

  /**
   * Create a child span
   */
  static createChildSpan(parentSpan: any, name: string, attributes?: Record<string, any>): any {
    if (!tracer || !parentSpan) return null;

    return tracer.startSpan(name, {
      parent: parentSpan,
      attributes,
    });
  }

  /**
   * Wrap async function with tracing
   */
  static traceAsyncFunction<T>(
    name: string,
    fn: () => Promise<T>,
    attributes?: Record<string, any>
  ): Promise<T> {
    if (!tracer) return fn();

    return tracer.startActiveSpan(name, { attributes }, async (span: any) => {
      try {
        const result = await fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Wrap sync function with tracing
   */
  static traceSyncFunction<T>(
    name: string,
    fn: () => T,
    attributes?: Record<string, any>
  ): T {
    if (!tracer) return fn();

    return tracer.startActiveSpan(name, { attributes }, (span: any) => {
      try {
        const result = fn();
        span.setStatus({ code: SpanStatusCode.OK });
        return result;
      } catch (error) {
        span.recordException(error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
        throw error;
      } finally {
        span.end();
      }
    });
  }

  /**
   * Add attributes to active span
   */
  static addAttributes(attributes: Record<string, any>): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.setAttributes(attributes);
    }
  }

  /**
   * Add event to active span
   */
  static addEvent(name: string, attributes?: Record<string, any>): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.addEvent(name, attributes);
    }
  }

  /**
   * Record exception in active span
   */
  static recordException(error: Error): void {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      activeSpan.recordException(error);
      activeSpan.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
    }
  }

  /**
   * Get trace ID from active span
   */
  static getTraceId(): string | null {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      return activeSpan.spanContext().traceId;
    }
    return null;
  }

  /**
   * Get span ID from active span
   */
  static getSpanId(): string | null {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      return activeSpan.spanContext().spanId;
    }
    return null;
  }

  /**
   * Create trace context for propagation
   */
  static getTraceContext(): any {
    return context.active();
  }

  /**
   * Run function in trace context
   */
  static runInContext<T>(ctx: any, fn: () => T): T {
    return context.with(ctx, fn);
  }
}

/**
 * Express middleware for tracing
 */
export const tracingMiddleware = (req: Request, res: Response, next: NextFunction): void => {
  if (!tracer) {
    return next();
  }

  const spanName = `${req.method} ${req.route?.path || req.path}`;

  tracer.startActiveSpan(spanName, {
    kind: SpanKind.SERVER,
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
      'http.route': req.route?.path || req.path,
      'http.user_agent': req.get('User-Agent'),
      'http.request_id': req.headers['x-request-id'],
      'user.id': req.user?.id,
    },
  }, (span: any) => {
    // Add trace ID to response headers
    const traceId = span.spanContext().traceId;
    res.set('X-Trace-Id', traceId);

    // Override res.end to capture response details
    const originalEnd = res.end;
    res.end = function(...args: any[]) {
      span.setAttributes({
        'http.status_code': res.statusCode,
        'http.response.size': res.get('content-length'),
      });

      if (res.statusCode >= 400) {
        span.setStatus({ code: SpanStatusCode.ERROR });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();
      return originalEnd.apply(this, args);
    };

    next();
  });
};

/**
 * Database tracing utilities
 */
export class DatabaseTracing {
  /**
   * Trace database query
   */
  static async traceQuery<T>(
    operation: string,
    table: string,
    query: string,
    queryFn: () => Promise<T>
  ): Promise<T> {
    return TracingUtils.traceAsyncFunction(
      `db.${operation}`,
      queryFn,
      {
        'db.operation': operation,
        'db.table': table,
        'db.statement': query.substring(0, 200), // Truncate long queries
      }
    );
  }

  /**
   * Trace Redis operation
   */
  static async traceRedisOperation<T>(
    command: string,
    key: string,
    operationFn: () => Promise<T>
  ): Promise<T> {
    return TracingUtils.traceAsyncFunction(
      `redis.${command.toLowerCase()}`,
      operationFn,
      {
        'redis.command': command,
        'redis.key': key,
      }
    );
  }
}

/**
 * MCP Protocol tracing utilities
 */
export class MCPTracing {
  /**
   * Trace MCP tool execution
   */
  static async traceToolExecution<T>(
    toolName: string,
    userId: string,
    executionFn: () => Promise<T>
  ): Promise<T> {
    return TracingUtils.traceAsyncFunction(
      `mcp.tool.${toolName}`,
      executionFn,
      {
        'mcp.tool.name': toolName,
        'mcp.user.id': userId,
        'mcp.operation': 'tool_execution',
      }
    );
  }

  /**
   * Trace MCP resource access
   */
  static async traceResourceAccess<T>(
    resourceUri: string,
    userId: string,
    accessFn: () => Promise<T>
  ): Promise<T> {
    return TracingUtils.traceAsyncFunction(
      `mcp.resource.access`,
      accessFn,
      {
        'mcp.resource.uri': resourceUri,
        'mcp.user.id': userId,
        'mcp.operation': 'resource_access',
      }
    );
  }

  /**
   * Trace WebSocket message
   */
  static traceWebSocketMessage(
    messageType: string,
    userId: string,
    messageHandler: () => void
  ): void {
    TracingUtils.traceSyncFunction(
      `mcp.websocket.${messageType}`,
      messageHandler,
      {
        'mcp.message.type': messageType,
        'mcp.user.id': userId,
        'mcp.transport': 'websocket',
      }
    );
  }
}

/**
 * Authentication tracing utilities
 */
export class AuthTracing {
  /**
   * Trace authentication attempt
   */
  static async traceAuthAttempt<T>(
    method: string,
    userId: string,
    authFn: () => Promise<T>
  ): Promise<T> {
    return TracingUtils.traceAsyncFunction(
      `auth.${method}`,
      authFn,
      {
        'auth.method': method,
        'user.id': userId,
      }
    );
  }

  /**
   * Trace MFA verification
   */
  static async traceMFAVerification<T>(
    userId: string,
    verificationFn: () => Promise<T>
  ): Promise<T> {
    return TracingUtils.traceAsyncFunction(
      'auth.mfa.verify',
      verificationFn,
      {
        'user.id': userId,
        'auth.mfa.enabled': true,
      }
    );
  }
}

/**
 * Security tracing utilities
 */
export class SecurityTracing {
  /**
   * Trace security check
   */
  static traceSecurityCheck(
    checkType: string,
    result: boolean,
    details?: Record<string, any>
  ): void {
    TracingUtils.addEvent(`security.${checkType}`, {
      'security.check.type': checkType,
      'security.check.result': result,
      ...details,
    });
  }

  /**
   * Trace security violation
   */
  static traceSecurityViolation(
    violationType: string,
    severity: string,
    details?: Record<string, any>
  ): void {
    TracingUtils.addEvent('security.violation', {
      'security.violation.type': violationType,
      'security.violation.severity': severity,
      ...details,
    });

    // Also record as exception for high/critical violations
    if (severity === 'high' || severity === 'critical') {
      const error = new Error(`Security violation: ${violationType}`);
      TracingUtils.recordException(error);
    }
  }
}

/**
 * Performance tracing utilities
 */
export class PerformanceTracing {
  private static timers: Map<string, number> = new Map();

  /**
   * Start performance timer
   */
  static startTimer(operationId: string): void {
    this.timers.set(operationId, Date.now());
    TracingUtils.addEvent('performance.timer.start', {
      'performance.operation.id': operationId,
    });
  }

  /**
   * End performance timer and record span
   */
  static endTimer(operationId: string, attributes?: Record<string, any>): number {
    const startTime = this.timers.get(operationId);
    if (!startTime) return -1;

    const duration = Date.now() - startTime;
    this.timers.delete(operationId);

    TracingUtils.addEvent('performance.timer.end', {
      'performance.operation.id': operationId,
      'performance.duration.ms': duration,
      ...attributes,
    });

    return duration;
  }

  /**
   * Record slow operation
   */
  static recordSlowOperation(operationName: string, duration: number, threshold: number): void {
    if (duration > threshold) {
      TracingUtils.addEvent('performance.slow_operation', {
        'performance.operation.name': operationName,
        'performance.duration.ms': duration,
        'performance.threshold.ms': threshold,
      });
    }
  }
}

/**
 * Cleanup tracing on shutdown
 */
export const cleanupTracing = async (): Promise<void> => {
  logger.info('Tracing cleanup stubbed - no OpenTelemetry to cleanup');
};

// Tracing classes are already exported above

// Setup cleanup on process exit
process.on('SIGTERM', async () => {
  logger.info('Cleaning up tracing on shutdown');
  await cleanupTracing();
});

process.on('SIGINT', async () => {
  logger.info('Cleaning up tracing on shutdown');
  await cleanupTracing();
});