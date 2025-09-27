import pino from 'pino';
import { config } from '../config/config';

// Create logger configuration
const loggerConfig: pino.LoggerOptions = {
  level: config.logging.level,
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: 'message',
  errorKey: 'error',
  formatters: {
    level: (label: string) => {
      return { level: label.toUpperCase() };
    },
    bindings: (bindings) => {
      return {
        pid: bindings.pid,
        hostname: bindings.hostname,
        service: 'secure-mcp-server',
        version: process.env.npm_package_version || '1.0.0',
        environment: config.env,
      };
    },
  },
  serializers: {
    // Custom serializers for sensitive data
    req: (req: any) => {
      return {
        id: req.id,
        method: req.method,
        url: req.url,
        headers: sanitizeHeaders(req.headers),
        ip: req.ip,
        userAgent: req.headers?.['user-agent'],
        ...(req.user && { userId: req.user.id }),
      };
    },
    res: (res: any) => {
      return {
        statusCode: res.statusCode,
        headers: sanitizeHeaders(res.getHeaders()),
      };
    },
    error: (error: Error) => {
      return {
        type: error.constructor.name,
        message: error.message,
        stack: error.stack,
        ...(error as any).cause && { cause: (error as any).cause },
      };
    },
    user: (user: any) => {
      return {
        id: user.id,
        email: user.email ? maskEmail(user.email) : undefined,
        roles: user.roles,
      };
    },
  },
  redact: config.logging.redactSensitive ? {
    paths: [
      'password',
      'token',
      'secret',
      'key',
      'authorization',
      'cookie',
      'x-api-key',
      'x-auth-token',
      'accessToken',
      'refreshToken',
      'req.headers.authorization',
      'req.headers.cookie',
      'req.headers["x-api-key"]',
      'req.headers["x-auth-token"]',
    ],
    censor: '[REDACTED]',
  } : undefined,
};

// Configure transport based on environment
let transport: pino.TransportSingleOptions | pino.TransportMultiOptions | undefined;

if (config.env === 'development' || config.logging.format === 'pretty') {
  transport = {
    target: 'pino-pretty',
    options: {
      colorize: true,
      translateTime: 'yyyy-mm-dd HH:MM:ss.l',
      ignore: 'pid,hostname',
      messageFormat: '{service}[{pid}] {msg}',
      errorLikeObjectKeys: ['err', 'error'],
    },
  };
} else if (config.env === 'production') {
  // In production, you might want to use structured logging
  // and send logs to external systems
  transport = {
    targets: [
      {
        target: 'pino/file',
        level: 'info',
        options: {
          destination: '/var/log/secure-mcp/app.log',
          mkdir: true,
        },
      },
      {
        target: 'pino/file',
        level: 'error',
        options: {
          destination: '/var/log/secure-mcp/error.log',
          mkdir: true,
        },
      },
      // Example: Send structured logs to external service
      // {
      //   target: '@logtail/pino',
      //   options: {
      //     sourceToken: process.env.LOGTAIL_TOKEN,
      //   },
      // },
    ],
  };
}

// Create the logger instance
export const logger = pino(loggerConfig, transport);

/**
 * Security-focused logging utilities
 */
export class SecurityLogger {
  /**
   * Log authentication events
   */
  static logAuth(event: 'login' | 'logout' | 'mfa' | 'failed_login' | 'password_reset', data: {
    userId?: string;
    email?: string;
    ip?: string;
    userAgent?: string;
    reason?: string;
    [key: string]: any;
  }): void {
    const logData = {
      type: 'auth_event',
      event,
      ...data,
      timestamp: new Date().toISOString(),
    };

    switch (event) {
      case 'failed_login':
        logger.warn('Authentication failed', logData);
        break;
      case 'login':
      case 'mfa':
        logger.info('Authentication successful', logData);
        break;
      case 'logout':
        logger.info('User logged out', logData);
        break;
      case 'password_reset':
        logger.info('Password reset', logData);
        break;
      default:
        logger.info('Authentication event', logData);
    }
  }

  /**
   * Log access control events
   */
  static logAccess(event: 'granted' | 'denied', data: {
    userId?: string;
    resource: string;
    action: string;
    ip?: string;
    reason?: string;
    [key: string]: any;
  }): void {
    const logData = {
      type: 'access_event',
      event,
      ...data,
      timestamp: new Date().toISOString(),
    };

    if (event === 'denied') {
      logger.warn('Access denied', logData);
    } else {
      logger.info('Access granted', logData);
    }
  }

  /**
   * Log security violations
   */
  static logViolation(violation: string, severity: 'low' | 'medium' | 'high' | 'critical', data: {
    userId?: string;
    ip?: string;
    userAgent?: string;
    details?: any;
    [key: string]: any;
  }): void {
    const logData = {
      type: 'security_violation',
      violation,
      severity,
      ...data,
      timestamp: new Date().toISOString(),
    };

    switch (severity) {
      case 'critical':
        logger.error('Critical security violation', logData);
        break;
      case 'high':
        logger.error('High severity security violation', logData);
        break;
      case 'medium':
        logger.warn('Medium severity security violation', logData);
        break;
      case 'low':
      default:
        logger.info('Security violation', logData);
        break;
    }
  }

  /**
   * Log admin actions
   */
  static logAdmin(action: string, data: {
    adminUserId: string;
    targetUserId?: string;
    resource?: string;
    changes?: any;
    ip?: string;
    [key: string]: any;
  }): void {
    const logData = {
      type: 'admin_action',
      action,
      ...data,
      timestamp: new Date().toISOString(),
    };

    logger.info('Admin action', logData);
  }

  /**
   * Log API usage
   */
  static logApiUsage(data: {
    userId?: string;
    endpoint: string;
    method: string;
    statusCode: number;
    duration: number;
    ip?: string;
    userAgent?: string;
    [key: string]: any;
  }): void {
    const logData = {
      type: 'api_usage',
      ...data,
      timestamp: new Date().toISOString(),
    };

    if (data.statusCode >= 400) {
      logger.warn('API error', logData);
    } else {
      logger.info('API request', logData);
    }
  }

  /**
   * Log data access events (for compliance)
   */
  static logDataAccess(event: 'read' | 'write' | 'delete' | 'export', data: {
    userId: string;
    dataType: string;
    recordId?: string;
    recordCount?: number;
    ip?: string;
    reason?: string;
    [key: string]: any;
  }): void {
    const logData = {
      type: 'data_access',
      event,
      ...data,
      timestamp: new Date().toISOString(),
    };

    logger.info('Data access', logData);
  }
}

/**
 * Performance logging utilities
 */
export class PerformanceLogger {
  private static timers: Map<string, number> = new Map();

  /**
   * Start timing an operation
   */
  static startTimer(operationId: string): void {
    this.timers.set(operationId, Date.now());
  }

  /**
   * End timing and log the duration
   */
  static endTimer(operationId: string, metadata?: any): number {
    const startTime = this.timers.get(operationId);
    if (!startTime) {
      logger.warn('Timer not found', { operationId });
      return -1;
    }

    const duration = Date.now() - startTime;
    this.timers.delete(operationId);

    logger.info('Performance metric', {
      type: 'performance',
      operation: operationId,
      duration,
      ...metadata,
    });

    return duration;
  }

  /**
   * Log database query performance
   */
  static logQuery(query: string, duration: number, metadata?: any): void {
    logger.debug('Database query performance', {
      type: 'db_performance',
      query: query.substring(0, 100) + (query.length > 100 ? '...' : ''),
      duration,
      ...metadata,
    });

    // Log slow queries as warnings
    if (duration > 1000) {
      logger.warn('Slow database query detected', {
        type: 'slow_query',
        query: query.substring(0, 200),
        duration,
        ...metadata,
      });
    }
  }

  /**
   * Log memory usage
   */
  static logMemoryUsage(): void {
    const memUsage = process.memoryUsage();

    logger.info('Memory usage', {
      type: 'memory_usage',
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
    });

    // Alert if memory usage is high
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    if (heapUsedMB > 500) {
      logger.warn('High memory usage detected', {
        type: 'high_memory',
        heapUsedMB,
      });
    }
  }
}

/**
 * Utility functions for log sanitization
 */
function sanitizeHeaders(headers: any): any {
  if (!headers) return headers;

  const sanitized = { ...headers };
  const sensitiveHeaders = [
    'authorization',
    'cookie',
    'x-api-key',
    'x-auth-token',
    'x-access-token',
    'x-refresh-token',
  ];

  for (const header of sensitiveHeaders) {
    if (sanitized[header]) {
      sanitized[header] = '[REDACTED]';
    }
  }

  return sanitized;
}

function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (!domain) return '[INVALID_EMAIL]';

  const maskedLocal = local.length > 3
    ? local.substring(0, 2) + '*'.repeat(local.length - 2)
    : '*'.repeat(local.length);

  return `${maskedLocal}@${domain}`;
}

/**
 * Structured error logging
 */
export class ErrorLogger {
  /**
   * Log application errors
   */
  static logError(error: Error, context?: {
    userId?: string;
    requestId?: string;
    operation?: string;
    [key: string]: any;
  }): void {
    logger.error('Application error', {
      type: 'app_error',
      error,
      ...context,
    });
  }

  /**
   * Log validation errors
   */
  static logValidationError(errors: any[], context?: {
    userId?: string;
    requestId?: string;
    endpoint?: string;
    [key: string]: any;
  }): void {
    logger.warn('Validation error', {
      type: 'validation_error',
      errors,
      ...context,
    });
  }

  /**
   * Log external service errors
   */
  static logExternalError(service: string, error: Error, context?: {
    endpoint?: string;
    requestId?: string;
    [key: string]: any;
  }): void {
    logger.error('External service error', {
      type: 'external_error',
      service,
      error,
      ...context,
    });
  }

  /**
   * Log rate limiting events
   */
  static logRateLimit(identifier: string, limit: number, context?: {
    userId?: string;
    ip?: string;
    [key: string]: any;
  }): void {
    logger.warn('Rate limit exceeded', {
      type: 'rate_limit',
      identifier,
      limit,
      ...context,
    });
  }
}

/**
 * Correlation ID utilities for request tracing
 */
export class CorrelationLogger {
  private static correlationIds: Map<string, string> = new Map();

  /**
   * Set correlation ID for current context
   */
  static setCorrelationId(requestId: string, correlationId: string): void {
    this.correlationIds.set(requestId, correlationId);
  }

  /**
   * Get correlation ID for current context
   */
  static getCorrelationId(requestId: string): string | undefined {
    return this.correlationIds.get(requestId);
  }

  /**
   * Create child logger with correlation ID
   */
  static createChildLogger(requestId: string, additional?: any): pino.Logger {
    const correlationId = this.getCorrelationId(requestId) || requestId;

    return logger.child({
      correlationId,
      requestId,
      ...additional,
    });
  }

  /**
   * Clean up correlation IDs (should be called at request end)
   */
  static cleanup(requestId: string): void {
    this.correlationIds.delete(requestId);
  }
}

// Set up periodic memory usage logging in production
if (config.env === 'production') {
  setInterval(() => {
    PerformanceLogger.logMemoryUsage();
  }, 60000); // Every minute
}

// Export convenience functions
export const logAuth = SecurityLogger.logAuth;
export const logAccess = SecurityLogger.logAccess;
export const logViolation = SecurityLogger.logViolation;
export const logAdmin = SecurityLogger.logAdmin;
export const logApiUsage = SecurityLogger.logApiUsage;
export const logDataAccess = SecurityLogger.logDataAccess;
export const logError = ErrorLogger.logError;
export const logValidationError = ErrorLogger.logValidationError;
export const logExternalError = ErrorLogger.logExternalError;
export const logRateLimit = ErrorLogger.logRateLimit;

// Default export
export default logger;