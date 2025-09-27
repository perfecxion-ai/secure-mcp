import { expect } from '@jest/globals';

// Extend Jest matchers for security testing
expect.extend({
  toBeValidJWT(received: string) {
    const pass = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]*$/.test(received);

    return {
      message: () =>
        pass
          ? `Expected ${received} not to be a valid JWT format`
          : `Expected ${received} to be a valid JWT format`,
      pass,
    };
  },

  toBeSecurePassword(received: string) {
    const hasMinLength = received.length >= 8;
    const hasUpperCase = /[A-Z]/.test(received);
    const hasLowerCase = /[a-z]/.test(received);
    const hasNumbers = /\d/.test(received);
    const hasSpecialChars = /[!@#$%^&*(),.?":{}|<>]/.test(received);

    const pass = hasMinLength && hasUpperCase && hasLowerCase && hasNumbers && hasSpecialChars;

    return {
      message: () =>
        pass
          ? `Expected ${received} not to be a secure password`
          : `Expected ${received} to be a secure password (min 8 chars, uppercase, lowercase, numbers, special chars)`,
      pass,
    };
  },

  toBeValidUUID(received: string) {
    const pass = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(received);

    return {
      message: () =>
        pass
          ? `Expected ${received} not to be a valid UUID`
          : `Expected ${received} to be a valid UUID`,
      pass,
    };
  },

  toBeValidEmail(received: string) {
    const pass = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(received);

    return {
      message: () =>
        pass
          ? `Expected ${received} not to be a valid email`
          : `Expected ${received} to be a valid email`,
      pass,
    };
  },

  toHaveSecurityHeaders(received: any) {
    const requiredHeaders = [
      'x-content-type-options',
      'x-frame-options',
      'x-xss-protection',
      'referrer-policy',
      'content-security-policy',
    ];

    const missingHeaders = requiredHeaders.filter(header =>
      !received.headers || !received.headers[header]
    );

    const pass = missingHeaders.length === 0;

    return {
      message: () =>
        pass
          ? `Expected response not to have all required security headers`
          : `Expected response to have security headers: ${missingHeaders.join(', ')}`,
      pass,
    };
  },

  toHaveValidRateLimitHeaders(received: any) {
    const headers = received.headers || {};
    const hasLimitHeader = headers['x-ratelimit-limit'];
    const hasRemainingHeader = headers['x-ratelimit-remaining'];

    const pass = hasLimitHeader && hasRemainingHeader;

    return {
      message: () =>
        pass
          ? `Expected response not to have valid rate limit headers`
          : `Expected response to have X-RateLimit-Limit and X-RateLimit-Remaining headers`,
      pass,
    };
  },

  toBeWithinTimeRange(received: Date, start: Date, end: Date) {
    const pass = received >= start && received <= end;

    return {
      message: () =>
        pass
          ? `Expected ${received} not to be within ${start} and ${end}`
          : `Expected ${received} to be within ${start} and ${end}`,
      pass,
    };
  },

  toHaveBeenCalledWithSecurityContext(received: jest.Mock) {
    const calls = received.mock.calls;
    const hasSecurityContext = calls.some(call =>
      call.some(arg =>
        arg && typeof arg === 'object' &&
        ('requestId' in arg || 'userId' in arg || 'sessionId' in arg)
      )
    );

    const pass = hasSecurityContext;

    return {
      message: () =>
        pass
          ? `Expected function not to have been called with security context`
          : `Expected function to have been called with security context`,
      pass,
    };
  },

  toMatchSQLPattern(received: string) {
    const sqlPatterns = [
      /select.*from/gi,
      /insert.*into/gi,
      /update.*set/gi,
      /delete.*from/gi,
      /union.*select/gi,
      /or.*1=1/gi,
      /drop.*table/gi,
    ];

    const pass = sqlPatterns.some(pattern => pattern.test(received));

    return {
      message: () =>
        pass
          ? `Expected ${received} not to match SQL injection patterns`
          : `Expected ${received} to match SQL injection patterns`,
      pass,
    };
  },

  toMatchXSSPattern(received: string) {
    const xssPatterns = [
      /<script[\s\S]*?>[\s\S]*?<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi,
      /<iframe/gi,
      /<object/gi,
      /<embed/gi,
    ];

    const pass = xssPatterns.some(pattern => pattern.test(received));

    return {
      message: () =>
        pass
          ? `Expected ${received} not to match XSS patterns`
          : `Expected ${received} to match XSS patterns`,
      pass,
    };
  },
});

// Type definitions for custom matchers
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidJWT(): R;
      toBeSecurePassword(): R;
      toBeValidUUID(): R;
      toBeValidEmail(): R;
      toHaveSecurityHeaders(): R;
      toHaveValidRateLimitHeaders(): R;
      toBeWithinTimeRange(start: Date, end: Date): R;
      toHaveBeenCalledWithSecurityContext(): R;
      toMatchSQLPattern(): R;
      toMatchXSSPattern(): R;
    }
  }
}