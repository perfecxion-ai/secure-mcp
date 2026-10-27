import { Request, Response, NextFunction } from 'express';
import { logger, ErrorLogger, SecurityLogger } from './logger';
import { config } from '../config/config';

/**
 * Custom error classes
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly errorCode?: string;
  public readonly details?: any;

  constructor(
    message: string,
    statusCode: number = 500,
    isOperational: boolean = true,
    errorCode?: string,
    details?: any
  ) {
    super(message);

    Object.setPrototypeOf(this, AppError.prototype);

    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.errorCode = errorCode;
    this.details = details;

    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super(message, 400, true, 'VALIDATION_ERROR', details);
  }
}

export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication failed', details?: any) {
    super(message, 401, true, 'AUTHENTICATION_ERROR', details);
  }
}

export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions', details?: any) {
    super(message, 403, true, 'AUTHORIZATION_ERROR', details);
  }
}

export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found', details?: any) {
    super(message, 404, true, 'NOT_FOUND_ERROR', details);
  }
}

export class ConflictError extends AppError {
  constructor(message: string = 'Resource conflict', details?: any) {
    super(message, 409, true, 'CONFLICT_ERROR', details);
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message: string = 'Too many requests', details?: any) {
    super(message, 429, true, 'TOO_MANY_REQUESTS', details);
  }
}

export class InternalServerError extends AppError {
  constructor(message: string = 'Internal server error', details?: any) {
    super(message, 500, true, 'INTERNAL_SERVER_ERROR', details);
  }
}

export class BadGatewayError extends AppError {
  constructor(message: string = 'Bad gateway', details?: any) {
    super(message, 502, true, 'BAD_GATEWAY_ERROR', details);
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message: string = 'Service unavailable', details?: any) {
    super(message, 503, true, 'SERVICE_UNAVAILABLE_ERROR', details);
  }
}

export class GatewayTimeoutError extends AppError {
  constructor(message: string = 'Gateway timeout', details?: any) {
    super(message, 504, true, 'GATEWAY_TIMEOUT_ERROR', details);
  }
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
  CRITICAL = 'critical',
}

/**
 * Error categories for classification
 */
export enum ErrorCategory {
  VALIDATION = 'validation',
  AUTHENTICATION = 'authentication',
  AUTHORIZATION = 'authorization',
  RATE_LIMIT = 'rate_limit',
  EXTERNAL_SERVICE = 'external_service',
  DATABASE = 'database',
  NETWORK = 'network',
  BUSINESS_LOGIC = 'business_logic',
  SYSTEM = 'system',
  SECURITY = 'security',
  UNKNOWN = 'unknown',
}

/**
 * Error classification utility
 */
export class ErrorClassifier {
  /**
   * Classify error by type and content
   */
  static classifyError(error: Error | AppError): {
    category: ErrorCategory;
    severity: ErrorSeverity;
    isRetryable: boolean;
    isSecurityRelated: boolean;
  } {
    // Check if it's a custom AppError
    if (error instanceof AppError) {
      return this.classifyAppError(error);
    }

    // Classify by error message and type
    const errorMessage = error.message.toLowerCase();
    const errorName = error.name.toLowerCase();

    // Database errors
    if (this.isDatabaseError(error)) {
      return {
        category: ErrorCategory.DATABASE,
        severity: ErrorSeverity.HIGH,
        isRetryable: this.isRetryableDatabaseError(error),
        isSecurityRelated: false,
      };
    }

    // Network errors
    if (this.isNetworkError(error)) {
      return {
        category: ErrorCategory.NETWORK,
        severity: ErrorSeverity.MEDIUM,
        isRetryable: true,
        isSecurityRelated: false,
      };
    }

    // Security-related errors
    if (this.isSecurityError(error)) {
      return {
        category: ErrorCategory.SECURITY,
        severity: ErrorSeverity.CRITICAL,
        isRetryable: false,
        isSecurityRelated: true,
      };
    }

    // Validation errors
    if (this.isValidationError(error)) {
      return {
        category: ErrorCategory.VALIDATION,
        severity: ErrorSeverity.LOW,
        isRetryable: false,
        isSecurityRelated: false,
      };
    }

    // Default classification
    return {
      category: ErrorCategory.UNKNOWN,
      severity: ErrorSeverity.MEDIUM,
      isRetryable: false,
      isSecurityRelated: false,
    };
  }

  private static classifyAppError(error: AppError): {
    category: ErrorCategory;
    severity: ErrorSeverity;
    isRetryable: boolean;
    isSecurityRelated: boolean;
  } {
    switch (error.constructor) {
      case ValidationError:
        return {
          category: ErrorCategory.VALIDATION,
          severity: ErrorSeverity.LOW,
          isRetryable: false,
          isSecurityRelated: false,
        };

      case AuthenticationError:
        return {
          category: ErrorCategory.AUTHENTICATION,
          severity: ErrorSeverity.MEDIUM,
          isRetryable: false,
          isSecurityRelated: true,
        };

      case AuthorizationError:
        return {
          category: ErrorCategory.AUTHORIZATION,
          severity: ErrorSeverity.MEDIUM,
          isRetryable: false,
          isSecurityRelated: true,
        };

      case TooManyRequestsError:
        return {
          category: ErrorCategory.RATE_LIMIT,
          severity: ErrorSeverity.MEDIUM,
          isRetryable: true,
          isSecurityRelated: false,
        };

      case ServiceUnavailableError:
      case GatewayTimeoutError:
        return {
          category: ErrorCategory.EXTERNAL_SERVICE,
          severity: ErrorSeverity.HIGH,
          isRetryable: true,
          isSecurityRelated: false,
        };

      default:
        return {
          category: ErrorCategory.BUSINESS_LOGIC,
          severity: error.statusCode >= 500 ? ErrorSeverity.HIGH : ErrorSeverity.MEDIUM,
          isRetryable: error.statusCode >= 500,
          isSecurityRelated: false,
        };
    }
  }

  private static isDatabaseError(error: Error): boolean {
    const dbErrorPatterns = [
      /connection/i,
      /timeout/i,
      /deadlock/i,
      /duplicate key/i,
      /foreign key/i,
      /constraint/i,
      /prisma/i,
      /postgresql/i,
      /redis/i,
    ];

    return dbErrorPatterns.some(pattern =>
      pattern.test(error.message) || pattern.test(error.name)
    );
  }

  private static isNetworkError(error: Error): boolean {
    const networkErrorPatterns = [
      /ECONNREFUSED/i,
      /ENOTFOUND/i,
      /ETIMEDOUT/i,
      /ECONNRESET/i,
      /EHOSTUNREACH/i,
      /ENETUNREACH/i,
      /fetch failed/i,
      /network/i,
    ];

    return networkErrorPatterns.some(pattern =>
      pattern.test(error.message) || pattern.test(error.name)
    );
  }

  private static isSecurityError(error: Error): boolean {
    const securityErrorPatterns = [
      /authentication/i,
      /authorization/i,
      /forbidden/i,
      /unauthorized/i,
      /token/i,
      /jwt/i,
      /csrf/i,
      /xss/i,
      /injection/i,
      /malicious/i,
    ];

    return securityErrorPatterns.some(pattern =>
      pattern.test(error.message) || pattern.test(error.name)
    );
  }

  private static isValidationError(error: Error): boolean {
    const validationErrorPatterns = [
      /validation/i,
      /invalid/i,
      /required/i,
      /format/i,
      /schema/i,
      /joi/i,
      /zod/i,
    ];

    return validationErrorPatterns.some(pattern =>
      pattern.test(error.message) || pattern.test(error.name)
    );
  }

  private static isRetryableDatabaseError(error: Error): boolean {
    const retryablePatterns = [
      /connection/i,
      /timeout/i,
      /deadlock/i,
      /lock wait timeout/i,
    ];

    return retryablePatterns.some(pattern => pattern.test(error.message));
  }
}

/**
 * Error handler middleware
 */
export const errorHandler = (
  error: Error | AppError,
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Skip if response already sent
  if (res.headersSent) {
    return next(error);
  }

  // Classify the error
  const classification = ErrorClassifier.classifyError(error);

  // Determine status code
  let statusCode = 500;
  if (error instanceof AppError) {
    statusCode = error.statusCode;
  } else if (classification.category === ErrorCategory.VALIDATION) {
    statusCode = 400;
  } else if (classification.category === ErrorCategory.AUTHENTICATION) {
    statusCode = 401;
  } else if (classification.category === ErrorCategory.AUTHORIZATION) {
    statusCode = 403;
  } else if (classification.category === ErrorCategory.RATE_LIMIT) {
    statusCode = 429;
  }

  // Log the error appropriately
  const errorContext = {
    requestId: req.headers['x-request-id'] as string,
    userId: req.user?.id,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    method: req.method,
    path: req.path,
    query: req.query,
    body: sanitizeRequestBody(req.body),
    statusCode,
    classification,
  };

  // Log based on severity
  switch (classification.severity) {
    case ErrorSeverity.CRITICAL:
      logger.error('Critical error occurred', { error, ...errorContext });
      break;
    case ErrorSeverity.HIGH:
      logger.error('High severity error', { error, ...errorContext });
      break;
    case ErrorSeverity.MEDIUM:
      logger.warn('Medium severity error', { error, ...errorContext });
      break;
    case ErrorSeverity.LOW:
    default:
      logger.info('Low severity error', { error, ...errorContext });
      break;
  }

  // Log security-related errors separately
  if (classification.isSecurityRelated) {
    SecurityLogger.logViolation(
      error.message,
      classification.severity,
      {
        userId: req.user?.id,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        details: errorContext,
      }
    );
  }

  // Prepare error response
  const errorResponse: any = {
    success: false,
    error: {
      code: error instanceof AppError ? error.errorCode : 'INTERNAL_ERROR',
      message: getErrorMessage(error, statusCode),
      ...(classification.isRetryable && { retryable: true }),
      ...(req.headers['x-request-id'] && { requestId: req.headers['x-request-id'] }),
    },
  };

  // Include error details in development
  if (config.env === 'development') {
    errorResponse.error.details = error instanceof AppError ? error.details : undefined;
    errorResponse.error.stack = error.stack;
    errorResponse.error.classification = classification;
  }

  // Include rate limit information
  if (statusCode === 429) {
    res.set({
      'Retry-After': '60',
      'X-RateLimit-Reset': (Date.now() + 60000).toString(),
    });
  }

  res.status(statusCode).json(errorResponse);
};

/**
 * Async error handler wrapper
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * 404 handler
 */
export const notFoundHandler = (req: Request, res: Response, next: NextFunction): void => {
  const error = new NotFoundError(`Route ${req.method} ${req.path} not found`);
  next(error);
};

/**
 * Graceful shutdown handler
 */
export const gracefulShutdown = (server: any): void => {
  logger.info('Received shutdown signal, closing server gracefully');

  const shutdownTimeout = setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 30000); // 30 seconds timeout

  server.close((error?: Error) => {
    clearTimeout(shutdownTimeout);

    if (error) {
      logger.error('Error during server shutdown', { error });
      process.exit(1);
    } else {
      logger.info('Server closed successfully');
      process.exit(0);
    }
  });
};

/**
 * Unhandled promise rejection handler
 */
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  logger.error('Unhandled promise rejection', {
    reason,
    promise: promise.toString(),
    stack: reason?.stack,
  });

  // Exit in production to restart the process
  if (config.env === 'production') {
    process.exit(1);
  }
});

/**
 * Uncaught exception handler
 */
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception', { error });

  // Always exit on uncaught exceptions
  process.exit(1);
});

/**
 * Warning handler
 */
process.on('warning', (warning: any) => {
  logger.warn('Node.js warning', {
    name: warning.name,
    message: warning.message,
    stack: warning.stack,
  });
});

/**
 * Utility functions
 */
function getErrorMessage(error: Error | AppError, statusCode: number): string {
  // Don't expose internal error messages in production
  if (config.env === 'production' && statusCode >= 500) {
    if (error instanceof AppError && error.isOperational) {
      return error.message;
    }
    return 'Internal server error';
  }

  return error.message;
}

function sanitizeRequestBody(body: any): any {
  if (!body || typeof body !== 'object') {
    return body;
  }

  const sanitized = { ...body };
  const sensitiveFields = [
    'password',
    'token',
    'secret',
    'key',
    'auth',
    'credential',
  ];

  for (const field of sensitiveFields) {
    if (sanitized[field]) {
      sanitized[field] = '[REDACTED]';
    }
  }

  return sanitized;
}

/**
 * Error metrics collection
 */
export class ErrorMetrics {
  private static errorCounts: Map<string, number> = new Map();
  private static errorRates: Map<string, number[]> = new Map();

  /**
   * Record error occurrence
   */
  static recordError(error: Error | AppError, classification: any): void {
    const errorKey = `${classification.category}_${classification.severity}`;

    // Increment error count
    const currentCount = this.errorCounts.get(errorKey) || 0;
    this.errorCounts.set(errorKey, currentCount + 1);

    // Track error rate (last 5 minutes)
    const now = Date.now();
    const rates = this.errorRates.get(errorKey) || [];
    rates.push(now);

    // Keep only last 5 minutes
    const fiveMinutesAgo = now - 5 * 60 * 1000;
    const recentRates = rates.filter(timestamp => timestamp > fiveMinutesAgo);
    this.errorRates.set(errorKey, recentRates);
  }

  /**
   * Get error statistics
   */
  static getErrorStats(): any {
    const stats: any = {};

    // Error counts
    for (const [errorKey, count] of this.errorCounts) {
      stats[errorKey] = { count };
    }

    // Error rates
    for (const [errorKey, rates] of this.errorRates) {
      if (stats[errorKey]) {
        stats[errorKey].ratePerMinute = rates.length / 5;
      }
    }

    return stats;
  }

  /**
   * Reset error metrics
   */
  static resetMetrics(): void {
    this.errorCounts.clear();
    this.errorRates.clear();
  }
}

// Error classes are already exported above, no need to re-export