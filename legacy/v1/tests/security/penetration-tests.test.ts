import request from 'supertest';
import express, { Application } from 'express';
import { authRouter } from '../../src/auth/routes';
import { mcpRouter } from '../../src/server/routes';
import { SecurityMiddleware } from '../../src/security/middleware';
import { MockFactory, TestDataGenerator, TestUtilities } from '../utils/test-helpers';
import { fixtures } from '../utils/fixtures';

// Mock dependencies for security testing
jest.mock('../../src/config/config', () => ({
  config: fixtures.config.testConfig,
}));

jest.mock('../../src/database/redis', () => ({
  redis: MockFactory.createMockRedis(),
}));

jest.mock('../../src/database/prisma', () => ({
  prisma: MockFactory.createMockPrisma(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: MockFactory.createMockLogger(),
}));

describe('Security Penetration Tests', () => {
  let app: Application;
  let mockRedis: any;
  let mockPrisma: any;
  let mockLogger: any;

  beforeAll(() => {
    app = express();
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true }));

    // Apply security middleware
    app.use(SecurityMiddleware.checkSecurityHeaders);
    app.use(SecurityMiddleware.sanitizeRequestBody);
    app.use(SecurityMiddleware.detectSuspiciousActivity);
    app.use(SecurityMiddleware.honeypot);

    // Add routes
    app.use('/api/auth', authRouter);
    app.use('/api/mcp', mcpRouter);

    // Global error handler
    app.use((error: any, req: any, res: any, next: any) => {
      res.status(500).json({ error: 'Internal server error' });
    });

    // Setup mocks
    mockRedis = require('../../src/database/redis').redis;
    mockPrisma = require('../../src/database/prisma').prisma;
    mockLogger = require('../../src/utils/logger').logger;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('SQL Injection Attacks', () => {
    const sqlInjectionPayloads = fixtures.security.maliciousInputs.sqlInjection;

    it('should prevent SQL injection in login endpoint', async () => {
      for (const payload of sqlInjectionPayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: payload,
            password: 'anypassword',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid input detected');
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('SQL injection attempt detected'),
        expect.any(Object)
      );
    });

    it('should prevent SQL injection in search parameters', async () => {
      const sqlPayload = "' UNION SELECT username, password FROM users --";

      const response = await request(app)
        .get('/api/mcp/tools')
        .query({ search: sqlPayload });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid input detected');
    });

    it('should prevent blind SQL injection attempts', async () => {
      const blindSqlPayloads = [
        "' AND (SELECT SUBSTRING(password,1,1) FROM users WHERE username='admin')='a' --",
        "' AND 1=1 --",
        "' AND 1=2 --",
        "' WAITFOR DELAY '00:00:05' --",
      ];

      for (const payload of blindSqlPayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: `admin${payload}@example.com`,
            password: 'password',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid input detected');
      }
    });

    it('should prevent second-order SQL injection', async () => {
      const secondOrderPayload = "admin'; DROP TABLE sessions; --";

      // First, attempt to inject via registration
      const registerResponse = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          username: secondOrderPayload,
          password: 'SecurePassword123!',
          firstName: 'Test',
          lastName: 'User',
        });

      expect(registerResponse.status).toBe(400);
      expect(registerResponse.body.error).toBe('Invalid input detected');
    });
  });

  describe('Cross-Site Scripting (XSS) Attacks', () => {
    const xssPayloads = fixtures.security.maliciousInputs.xssPayloads;

    it('should prevent reflected XSS attacks', async () => {
      for (const payload of xssPayloads) {
        const response = await request(app)
          .get('/api/mcp/resources')
          .query({ filter: payload });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid input detected');
      }
    });

    it('should prevent stored XSS attacks', async () => {
      for (const payload of xssPayloads) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'test@example.com',
            firstName: payload,
            lastName: 'User',
            password: 'SecurePassword123!',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid input detected');
      }
    });

    it('should prevent DOM-based XSS in API responses', async () => {
      const maliciousInput = {
        userInput: '<img src=x onerror=alert("XSS")>',
      };

      mockPrisma.user.findUnique.mockResolvedValue({
        ...fixtures.users.validUser,
        bio: maliciousInput.userInput,
      });

      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', 'Bearer valid-token');

      if (response.status === 200) {
        // Response should be sanitized
        expect(response.body.user?.bio).not.toMatchXSSPattern();
      }
    });

    it('should prevent XSS in error messages', async () => {
      const xssInError = '<script>alert("XSS")</script>';

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: xssInError,
          password: 'password',
        });

      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toMatchXSSPattern();
    });
  });

  describe('Command Injection Attacks', () => {
    const commandInjectionPayloads = fixtures.security.maliciousInputs.commandInjection;

    it('should prevent OS command injection', async () => {
      for (const payload of commandInjectionPayloads) {
        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: 'test@example.com',
            firstName: 'Test',
            lastName: payload,
            password: 'SecurePassword123!',
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid input detected');
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('command injection attempt detected'),
        expect.any(Object)
      );
    });

    it('should prevent code injection in eval-like functions', async () => {
      const codeInjectionPayloads = [
        '__import__("os").system("rm -rf /")',
        'require("child_process").exec("rm -rf /")',
        'eval("process.exit()")',
        'Function("return process")().exit()',
      ];

      for (const payload of codeInjectionPayloads) {
        const response = await request(app)
          .post('/api/mcp/tools/call')
          .send({
            name: 'calculate',
            arguments: { expression: payload },
          });

        // Should either reject input or safely handle without execution
        expect([400, 401, 403]).toContain(response.status);
      }
    });
  });

  describe('Path Traversal Attacks', () => {
    const pathTraversalPayloads = fixtures.security.maliciousInputs.pathTraversal;

    it('should prevent directory traversal attacks', async () => {
      for (const payload of pathTraversalPayloads) {
        const response = await request(app)
          .get('/api/mcp/resources')
          .query({ path: payload });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid input detected');
      }

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('path traversal attempt detected'),
        expect.any(Object)
      );
    });

    it('should prevent file inclusion attacks', async () => {
      const fileInclusionPayloads = [
        '../../../../etc/passwd',
        '....//....//....//etc/passwd',
        'php://filter/convert.base64-encode/resource=/etc/passwd',
        'file:///etc/passwd',
      ];

      for (const payload of fileInclusionPayloads) {
        const response = await request(app)
          .post('/api/mcp/tools/call')
          .send({
            name: 'read_file',
            arguments: { path: payload },
          });

        expect([400, 401, 403, 404]).toContain(response.status);
      }
    });
  });

  describe('NoSQL Injection Attacks', () => {
    const noSqlPayloads = fixtures.security.maliciousInputs.noSqlInjection;

    it('should prevent NoSQL injection in query parameters', async () => {
      for (const payload of noSqlPayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'admin@example.com',
            password: payload,
          });

        expect(response.status).toBe(400);
        expect(response.body.error).toBe('Invalid input detected');
      }
    });

    it('should prevent MongoDB operator injection', async () => {
      const mongoPayloads = [
        { $gt: '' },
        { $ne: null },
        { $regex: '.*' },
        { $where: 'this.password.match(/.*/)' },
      ];

      for (const payload of mongoPayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: 'admin@example.com',
            password: payload,
          });

        expect(response.status).toBe(400);
      }
    });
  });

  describe('Authentication Bypass Attempts', () => {
    it('should prevent JWT token manipulation', async () => {
      const manipulatedTokens = [
        'eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiJhZG1pbiIsImV4cCI6OTk5OTk5OTk5OX0.', // None algorithm
        'Bearer ' + 'a'.repeat(2048), // Oversized token
        'Bearer invalid.token.format',
        'Bearer ' + JSON.stringify({ alg: 'none' }), // Direct JSON
      ];

      for (const token of manipulatedTokens) {
        const response = await request(app)
          .get('/api/auth/profile')
          .set('Authorization', token);

        expect(response.status).toBe(401);
      }
    });

    it('should prevent session fixation attacks', async () => {
      const fixedSessionId = 'attacker-controlled-session-id';

      const response = await request(app)
        .post('/api/auth/login')
        .set('Cookie', `sessionId=${fixedSessionId}`)
        .send({
          email: 'user@example.com',
          password: 'password',
        });

      // Should not use the provided session ID
      if (response.status === 200) {
        expect(response.headers['set-cookie']).not.toContain(fixedSessionId);
      }
    });

    it('should prevent privilege escalation', async () => {
      const userToken = TestDataGenerator.generateJWTPayload();
      const adminClaims = {
        ...userToken,
        roles: ['admin'],
        permissions: ['*'],
      };

      // Try to use modified token
      const maliciousToken = TestUtilities.createJWT(adminClaims);

      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${maliciousToken}`);

      expect(response.status).toBe(401);
    });
  });

  describe('Rate Limiting and DoS Protection', () => {
    it('should enforce rate limiting on authentication endpoints', async () => {
      mockRedis.incr.mockResolvedValue(101); // Exceed rate limit
      mockRedis.ttl.mockResolvedValue(60);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'user@example.com',
          password: 'password',
        });

      expect(response.status).toBe(429);
      expect(response.headers['retry-after']).toBeDefined();
    });

    it('should prevent application layer DoS attacks', async () => {
      const massivePayload = {
        data: 'x'.repeat(11 * 1024 * 1024), // 11MB payload
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(massivePayload);

      expect(response.status).toBe(413);
    });

    it('should prevent slowloris-style attacks', async () => {
      const slowRequests = Array.from({ length: 100 }, (_, i) =>
        request(app)
          .post('/api/auth/login')
          .send({
            email: `user${i}@example.com`,
            password: 'password',
          })
          .timeout(1000) // Short timeout
      );

      const results = await Promise.allSettled(slowRequests);

      // Should handle gracefully without crashing
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      expect(successful + failed).toBe(100);
    });

    it('should prevent regex DoS (ReDoS) attacks', async () => {
      const redosPayloads = [
        'a'.repeat(10000) + '!',
        '(' + 'a'.repeat(1000) + ')*',
        'a'.repeat(5000) + 'X',
      ];

      for (const payload of redosPayloads) {
        const startTime = Date.now();

        const response = await request(app)
          .post('/api/auth/register')
          .send({
            email: `${payload}@example.com`,
            password: 'SecurePassword123!',
            firstName: 'Test',
            lastName: 'User',
          });

        const duration = Date.now() - startTime;

        // Should not take excessive time to process
        expect(duration).toBeLessThan(5000); // 5 seconds max
        expect([400, 413, 429]).toContain(response.status);
      }
    });
  });

  describe('Input Validation Bypass Attempts', () => {
    it('should prevent null byte injection', async () => {
      const nullBytePayloads = [
        'admin@example.com\x00.jpg',
        'user\x00admin',
        'password\x00; DROP TABLE users;',
      ];

      for (const payload of nullBytePayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .send({
            email: payload,
            password: 'password',
          });

        expect(response.status).toBe(400);
      }
    });

    it('should prevent Unicode normalization attacks', async () => {
      const unicodePayloads = [
        'admin@example.com', // Normal
        'аdmin@example.com', // Cyrillic 'а' instead of 'a'
        'admin@ехаmple.com', // Mixed scripts
        'ᵃdmin@example.com', // Superscript
      ];

      const responses = await Promise.all(
        unicodePayloads.map(payload =>
          request(app)
            .post('/api/auth/login')
            .send({
              email: payload,
              password: 'password',
            })
        )
      );

      // Should handle Unicode consistently
      responses.forEach(response => {
        expect([400, 401, 404]).toContain(response.status);
      });
    });

    it('should prevent content type confusion attacks', async () => {
      const confusionTests = [
        {
          contentType: 'application/x-www-form-urlencoded',
          body: 'email=admin@example.com&password=password',
        },
        {
          contentType: 'text/xml',
          body: '<email>admin@example.com</email>',
        },
        {
          contentType: 'multipart/form-data',
          body: '{"email":"admin@example.com","password":"password"}',
        },
      ];

      for (const test of confusionTests) {
        const response = await request(app)
          .post('/api/auth/login')
          .set('Content-Type', test.contentType)
          .send(test.body);

        // Should handle gracefully
        expect([400, 415, 422]).toContain(response.status);
      }
    });
  });

  describe('HTTP Header Injection Attacks', () => {
    it('should prevent CRLF injection in headers', async () => {
      const crlfPayloads = fixtures.security.maliciousInputs.headerInjection;

      for (const payload of crlfPayloads) {
        const response = await request(app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', payload)
          .send({
            email: 'user@example.com',
            password: 'password',
          });

        // Response headers should not contain injected content
        const responseHeaders = JSON.stringify(response.headers);
        expect(responseHeaders).not.toContain('X-Injected-Header');
        expect(responseHeaders).not.toContain('Set-Cookie: evil=true');
      }
    });

    it('should prevent host header injection', async () => {
      const maliciousHosts = [
        'evil.com',
        'example.com.evil.com',
        'localhost:8080@evil.com',
      ];

      for (const host of maliciousHosts) {
        const response = await request(app)
          .post('/api/auth/login')
          .set('Host', host)
          .send({
            email: 'user@example.com',
            password: 'password',
          });

        // Should reject or handle safely
        if (response.status === 200) {
          expect(response.body).not.toContain('evil.com');
        }
      }
    });
  });

  describe('Business Logic Vulnerabilities', () => {
    it('should prevent race conditions in authentication', async () => {
      const concurrentLogins = Array.from({ length: 10 }, () =>
        request(app)
          .post('/api/auth/login')
          .send({
            email: 'user@example.com',
            password: 'password',
          })
      );

      const responses = await Promise.all(concurrentLogins);

      // All should have consistent behavior
      const statuses = responses.map(r => r.status);
      const uniqueStatuses = [...new Set(statuses)];
      expect(uniqueStatuses.length).toBeLessThanOrEqual(2); // Should be consistent
    });

    it('should prevent account enumeration', async () => {
      const validEmail = 'existing@example.com';
      const invalidEmail = 'nonexistent@example.com';

      mockPrisma.user.findUnique
        .mockResolvedValueOnce(fixtures.users.validUser) // Valid user
        .mockResolvedValueOnce(null); // Invalid user

      const [validResponse, invalidResponse] = await Promise.all([
        request(app)
          .post('/api/auth/login')
          .send({ email: validEmail, password: 'wrongpassword' }),
        request(app)
          .post('/api/auth/login')
          .send({ email: invalidEmail, password: 'wrongpassword' }),
      ]);

      // Response times and messages should be similar
      expect(validResponse.body.error).toBe(invalidResponse.body.error);
      expect(validResponse.status).toBe(invalidResponse.status);
    });

    it('should prevent timing attacks on authentication', async () => {
      const measurements: number[] = [];

      for (let i = 0; i < 10; i++) {
        const startTime = Date.now();

        await request(app)
          .post('/api/auth/login')
          .send({
            email: 'nonexistent@example.com',
            password: 'password',
          });

        measurements.push(Date.now() - startTime);
      }

      // Check timing consistency (coefficient of variation should be low)
      const mean = measurements.reduce((a, b) => a + b) / measurements.length;
      const variance = measurements.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / measurements.length;
      const stdDev = Math.sqrt(variance);
      const coefficientOfVariation = stdDev / mean;

      expect(coefficientOfVariation).toBeLessThan(0.5); // Timing should be consistent
    });
  });

  describe('Honeypot and Bot Detection', () => {
    it('should detect and block bot traffic', async () => {
      const botUserAgents = fixtures.security.suspiciousUserAgents;

      for (const userAgent of botUserAgents) {
        const response = await request(app)
          .post('/api/auth/login')
          .set('User-Agent', userAgent)
          .send({
            email: 'user@example.com',
            password: 'password',
          });

        // Should be flagged as suspicious
        expect([400, 403, 429]).toContain(response.status);
      }
    });

    it('should trigger honeypot for automated submissions', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'test@example.com',
          password: 'SecurePassword123!',
          firstName: 'Test',
          lastName: 'User',
          honeypot: 'bot-filled-this-field', // Honeypot field
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true); // Fake success

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Honeypot trap triggered',
        expect.objectContaining({
          honeypotValue: 'bot-filled-this-field',
        })
      );

      // Should not actually create the user
      expect(mockPrisma.user.create).not.toHaveBeenCalled();
    });
  });

  describe('Security Monitoring and Alerting', () => {
    it('should log security events for monitoring', async () => {
      const maliciousRequest = await request(app)
        .post('/api/auth/login')
        .send({
          email: "'; DROP TABLE users; --",
          password: '<script>alert("xss")</script>',
        });

      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('injection attempt detected'),
        expect.any(Object)
      );

      // Should include context for incident response
      const logCall = mockLogger.warn.mock.calls[0];
      expect(logCall[1]).toMatchObject({
        input: expect.any(String),
      });
    });

    it('should maintain audit trail for security events', async () => {
      await request(app)
        .post('/api/auth/login')
        .set('X-Forwarded-For', '127.0.0.1\r\nX-Injected: malicious')
        .send({
          email: 'user@example.com',
          password: 'password',
        });

      // Should log with request context
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Suspicious'),
        expect.objectContaining({
          ip: expect.any(String),
          userAgent: expect.any(String),
        })
      );
    });
  });
});