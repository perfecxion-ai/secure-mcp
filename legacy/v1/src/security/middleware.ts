import { Request, Response, NextFunction } from 'express';
import { validationResult, ValidationError } from 'express-validator';
import DOMPurify from 'isomorphic-dompurify';
import { logger } from '../utils/logger';
import { config } from '../config/config';
import crypto from 'crypto';

export interface SecurityContext {
  requestId: string;
  userId?: string;
  sessionId?: string;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
}

export class SecurityMiddleware {
  /**
   * Input validation middleware
   */
  public static validateInput = (req: Request, res: Response, next: NextFunction): void => {
    const errors = validationResult(req);

    if (!errors.isEmpty()) {
      const validationErrors = errors.array().map((error: ValidationError) => ({
        field: 'param' in error ? error.param : error.type,
        message: error.msg,
        value: 'value' in error ? error.value : undefined,
      }));

      logger.warn('Input validation failed', {
        requestId: req.headers['x-request-id'],
        errors: validationErrors,
        ip: req.ip,
        path: req.path,
      });

      res.status(400).json({
        error: 'Input validation failed',
        details: validationErrors,
      });
      return;
    }

    next();
  };

  /**
   * Sanitize input data to prevent XSS and injection attacks
   */
  public static sanitizeInput = async (input: any): Promise<any> => {
    if (typeof input === 'string') {
      // Remove null bytes
      let sanitized = input.replace(/\x00/g, '');

      // HTML/XSS sanitization
      sanitized = DOMPurify.sanitize(sanitized, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
        KEEP_CONTENT: true,
      });

      // SQL injection prevention (basic patterns)
      const sqlPatterns = [
        /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|EXEC|EXECUTE|UNION|SCRIPT)\b)/gi,
        /(--|\*\/|\/\*)/g,
        /('|(\\')|(;))/g,
      ];

      for (const pattern of sqlPatterns) {
        if (pattern.test(sanitized)) {
          logger.warn('Potential SQL injection attempt detected', {
            input: sanitized.substring(0, 100),
          });
          throw new Error('Invalid input detected');
        }
      }

      // NoSQL injection prevention
      const nosqlPatterns = [
        /\$where/gi,
        /\$ne/gi,
        /\$gt/gi,
        /\$lt/gi,
        /\$regex/gi,
        /\$or/gi,
        /\$and/gi,
        /javascript:/gi,
      ];

      for (const pattern of nosqlPatterns) {
        if (pattern.test(sanitized)) {
          logger.warn('Potential NoSQL injection attempt detected', {
            input: sanitized.substring(0, 100),
          });
          throw new Error('Invalid input detected');
        }
      }

      // Command injection prevention
      const commandPatterns = [
        /(\||&&|;|\$\(|\`)/g,
        /(rm\s|del\s|format\s|shutdown\s)/gi,
        /(nc\s|netcat\s|telnet\s|ssh\s)/gi,
        /(wget\s|curl\s|ping\s)/gi,
      ];

      for (const pattern of commandPatterns) {
        if (pattern.test(sanitized)) {
          logger.warn('Potential command injection attempt detected', {
            input: sanitized.substring(0, 100),
          });
          throw new Error('Invalid input detected');
        }
      }

      // Path traversal prevention
      if (sanitized.includes('../') || sanitized.includes('..\\')) {
        logger.warn('Potential path traversal attempt detected', {
          input: sanitized.substring(0, 100),
        });
        throw new Error('Invalid input detected');
      }

      return sanitized;
    }

    if (Array.isArray(input)) {
      return Promise.all(input.map(item => this.sanitizeInput(item)));
    }

    if (input && typeof input === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(input)) {
        sanitized[key] = await this.sanitizeInput(value);
      }
      return sanitized;
    }

    return input;
  };

  /**
   * Middleware to sanitize request body
   */
  public static sanitizeRequestBody = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      if (req.body && Object.keys(req.body).length > 0) {
        req.body = await SecurityMiddleware.sanitizeInput(req.body);
      }

      if (req.query && Object.keys(req.query).length > 0) {
        req.query = await SecurityMiddleware.sanitizeInput(req.query);
      }

      next();
    } catch (error) {
      logger.warn('Input sanitization failed', {
        error: error.message,
        ip: req.ip,
        path: req.path,
        requestId: req.headers['x-request-id'],
      });

      res.status(400).json({
        error: 'Invalid input detected',
      });
    }
  };

  /**
   * Sanitize output data
   */
  public static sanitizeOutput = (req: Request, res: Response, next: NextFunction): void => {
    const originalJson = res.json;

    res.json = function(data: any) {
      if (data && typeof data === 'object') {
        data = SecurityMiddleware.sanitizeOutputData(data);
      }

      return originalJson.call(this, data);
    };

    next();
  };

  /**
   * Recursively sanitize output data
   */
  private static sanitizeOutputData(data: any): any {
    if (typeof data === 'string') {
      return DOMPurify.sanitize(data, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br'],
        ALLOWED_ATTR: [],
      });
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeOutputData(item));
    }

    if (data && typeof data === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(data)) {
        // Don't sanitize certain fields that need to remain as-is
        if (['password', 'token', 'secret', 'key'].some(field => key.toLowerCase().includes(field))) {
          continue; // Skip sensitive fields
        }
        sanitized[key] = this.sanitizeOutputData(value);
      }
      return sanitized;
    }

    return data;
  }

  /**
   * Check security headers and set security context
   */
  public static checkSecurityHeaders = (req: Request, res: Response, next: NextFunction): void => {
    // Generate request ID if not present
    if (!req.headers['x-request-id']) {
      req.headers['x-request-id'] = crypto.randomUUID();
    }

    // Check for suspicious headers
    const suspiciousHeaders = [
      'x-forwarded-for',
      'x-real-ip',
      'x-cluster-client-ip',
      'x-forwarded',
      'forwarded-for',
      'forwarded',
    ];

    for (const header of suspiciousHeaders) {
      const value = req.headers[header] as string;
      if (value && SecurityMiddleware.containsSuspiciousContent(value)) {
        logger.warn('Suspicious header content detected', {
          header,
          value: value.substring(0, 100),
          ip: req.ip,
          requestId: req.headers['x-request-id'],
        });
      }
    }

    // Create security context
    const securityContext: SecurityContext = {
      requestId: req.headers['x-request-id'] as string,
      userId: req.user?.id,
      sessionId: req.user?.sessionId,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent') || '',
      timestamp: new Date(),
    };

    // Store context in request
    req.securityContext = securityContext;

    // Set security headers on response
    res.set({
      'X-Request-ID': securityContext.requestId,
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': config.security.frameOptions,
      'X-XSS-Protection': '1; mode=block',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
    });

    if (config.security.forceHttps) {
      res.set('Strict-Transport-Security', `max-age=${config.security.hstsMaxAge}; includeSubDomains; preload`);
    }

    next();
  };

  /**
   * CSRF protection middleware
   */
  public static csrfProtection = (req: Request, res: Response, next: NextFunction): void => {
    // Skip CSRF for safe methods
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      next();
      return;
    }

    // Skip CSRF for API endpoints with proper bearer token
    if (req.headers.authorization?.startsWith('Bearer ')) {
      next();
      return;
    }

    const token = req.headers['x-csrf-token'] || req.body._token;
    const sessionToken = req.session?.csrfToken;

    if (!token || !sessionToken || token !== sessionToken) {
      logger.warn('CSRF token validation failed', {
        hasToken: !!token,
        hasSessionToken: !!sessionToken,
        tokensMatch: token === sessionToken,
        ip: req.ip,
        requestId: req.headers['x-request-id'],
      });

      res.status(403).json({
        error: 'Invalid CSRF token',
      });
      return;
    }

    next();
  };

  /**
   * Rate limiting based on IP and user
   */
  public static rateLimitByIPAndUser = (maxRequests: number, windowMs: number) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const redis = require('../database/redis').redis;
      const identifier = req.user?.id || req.ip;
      const key = `rate_limit_security:${identifier}`;

      try {
        const current = await redis.incr(key);

        if (current === 1) {
          await redis.expire(key, Math.ceil(windowMs / 1000));
        }

        if (current > maxRequests) {
          const ttl = await redis.ttl(key);

          logger.warn('Security rate limit exceeded', {
            identifier,
            current,
            max: maxRequests,
            ip: req.ip,
            requestId: req.headers['x-request-id'],
          });

          res.set({
            'Retry-After': ttl.toString(),
            'X-RateLimit-Limit': maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': (Date.now() + ttl * 1000).toString(),
          });

          res.status(429).json({
            error: 'Too many security violations',
            retryAfter: ttl,
          });
          return;
        }

        next();

      } catch (error) {
        logger.error('Security rate limiting error', { error });
        next(); // Continue on redis errors
      }
    };
  };

  /**
   * Request size limiter
   */
  public static limitRequestSize = (maxSize: number) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      const contentLength = parseInt(req.headers['content-length'] || '0', 10);

      if (contentLength > maxSize) {
        logger.warn('Request size limit exceeded', {
          contentLength,
          maxSize,
          ip: req.ip,
          requestId: req.headers['x-request-id'],
        });

        res.status(413).json({
          error: 'Request entity too large',
          maxSize,
          receivedSize: contentLength,
        });
        return;
      }

      next();
    };
  };

  /**
   * Detect suspicious patterns in requests
   */
  public static detectSuspiciousActivity = (req: Request, res: Response, next: NextFunction): void => {
    const suspicious = [
      // Check URL for suspicious patterns
      SecurityMiddleware.containsSuspiciousContent(req.url),
      // Check User-Agent for suspicious patterns
      SecurityMiddleware.containsSuspiciousContent(req.get('User-Agent') || ''),
      // Check for too many special characters in path
      (req.path.match(/[<>'"&;]/g) || []).length > 3,
      // Check for encoded characters that might be malicious
      /%[0-9a-f]{2}/gi.test(req.url) && decodeURIComponent(req.url) !== req.url,
    ];

    const suspiciousCount = suspicious.filter(Boolean).length;

    if (suspiciousCount >= 2) {
      logger.warn('Suspicious activity detected', {
        url: req.url.substring(0, 100),
        userAgent: req.get('User-Agent')?.substring(0, 100),
        ip: req.ip,
        suspiciousCount,
        requestId: req.headers['x-request-id'],
      });

      // Don't block immediately, but log for monitoring
      req.securityFlags = req.securityFlags || {};
      req.securityFlags.suspicious = true;
    }

    next();
  };

  /**
   * Honeypot middleware to detect bots
   */
  public static honeypot = (req: Request, res: Response, next: NextFunction): void => {
    // Check for honeypot field in form submissions
    if (req.body && req.body.honeypot && req.body.honeypot.trim() !== '') {
      logger.warn('Honeypot trap triggered', {
        honeypotValue: req.body.honeypot,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        requestId: req.headers['x-request-id'],
      });

      // Return success but don't process
      res.status(200).json({ success: true });
      return;
    }

    // Remove honeypot field from body
    if (req.body && req.body.honeypot !== undefined) {
      delete req.body.honeypot;
    }

    next();
  };

  /**
   * Check for suspicious content in strings
   */
  private static containsSuspiciousContent(content: string): boolean {
    if (!content) return false;

    const patterns = [
      // Script injection patterns
      /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,

      // SQL injection patterns
      /(union\s+select|select\s+\*|insert\s+into|delete\s+from|drop\s+table)/gi,
      /(\'\s*or\s*\'|\'\s*and\s*\'|--|\*\/|\/\*)/gi,

      // Command injection patterns
      /(\||&&|;|\$\(|\`|>\s*\/|<\s*\/)/g,

      // Path traversal
      /\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e%5c/gi,

      // Common attack patterns
      /(\b(eval|exec|system|shell_exec|passthru|base64_decode)\b)/gi,
      /(\/etc\/passwd|\/etc\/shadow|web\.config|\.htaccess)/gi,

      // Suspicious user agents
      /(sqlmap|nmap|nikto|dirb|dirbuster|burp|owasp|zap)/gi,
    ];

    return patterns.some(pattern => pattern.test(content));
  }

  /**
   * Log security events
   */
  public static logSecurityEvent = (
    eventType: string,
    severity: 'low' | 'medium' | 'high' | 'critical',
    details: any,
    req?: Request
  ): void => {
    const logData = {
      type: 'security_event',
      eventType,
      severity,
      details,
      timestamp: new Date().toISOString(),
      ...(req && {
        requestId: req.headers['x-request-id'],
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        userId: req.user?.id,
        sessionId: req.user?.sessionId,
        path: req.path,
        method: req.method,
      }),
    };

    switch (severity) {
      case 'critical':
        logger.error('Critical security event', logData);
        break;
      case 'high':
        logger.error('High severity security event', logData);
        break;
      case 'medium':
        logger.warn('Medium severity security event', logData);
        break;
      case 'low':
      default:
        logger.info('Security event', logData);
        break;
    }
  };
}

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      securityContext?: SecurityContext;
      securityFlags?: Record<string, any>;
    }
  }
}