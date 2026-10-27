import request from 'supertest';
import express, { Application } from 'express';
import { authRouter } from '../../../src/auth/routes';
import { JWTService } from '../../../src/auth/jwt-service';
import { MFAService } from '../../../src/auth/mfa-service';
import { MockFactory, TestDataGenerator } from '../../utils/test-helpers';
import { fixtures } from '../../utils/fixtures';

// Mock dependencies
jest.mock('../../../src/config/config', () => ({
  config: fixtures.config.testConfig,
}));

jest.mock('../../../src/database/redis', () => ({
  redis: MockFactory.createMockRedis(),
}));

jest.mock('../../../src/database/prisma', () => ({
  prisma: MockFactory.createMockPrisma(),
}));

jest.mock('../../../src/security/vault', () => ({
  vault: MockFactory.createMockVault(),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: MockFactory.createMockLogger(),
}));

describe('Authentication API Endpoints', () => {
  let app: Application;
  let mockRedis: any;
  let mockPrisma: any;
  let mockVault: any;
  let jwtService: JWTService;

  beforeAll(async () => {
    // Setup Express app with auth routes
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);

    // Initialize services
    jwtService = new JWTService();
    await jwtService.initialize();

    // Setup mocks
    mockRedis = require('../../../src/database/redis').redis;
    mockPrisma = require('../../../src/database/prisma').prisma;
    mockVault = require('../../../src/security/vault').vault;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('POST /api/auth/login', () => {
    it('should successfully login with valid credentials', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'SecurePassword123!',
      };

      const mockUser = {
        ...fixtures.users.validUser,
        password: '$argon2id$v=19$m=65536,t=3,p=4$hashedPassword', // Mock hashed password
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.sadd.mockResolvedValue(1);

      // Mock password verification
      jest.doMock('argon2', () => ({
        verify: jest.fn().mockResolvedValue(true),
      }));

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        user: {
          id: mockUser.id,
          email: mockUser.email,
          roles: mockUser.roles,
        },
        tokens: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          expiresIn: expect.any(Number),
        },
      });

      expect(response.body.tokens.accessToken).toBeValidJWT();
      expect(response.body.tokens.refreshToken).toBeValidJWT();
    });

    it('should require valid email format', async () => {
      const loginData = {
        email: 'invalid-email',
        password: 'SecurePassword123!',
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(400);

      expect(response.body.error).toBe('Input validation failed');
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'email',
            message: expect.stringContaining('valid email'),
          }),
        ])
      );
    });

    it('should require password with minimum strength', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'weak',
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(400);

      expect(response.body.error).toBe('Input validation failed');
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'password',
            message: expect.stringContaining('minimum'),
          }),
        ])
      );
    });

    it('should reject login with non-existent user', async () => {
      const loginData = {
        email: 'nonexistent@example.com',
        password: 'SecurePassword123!',
      };

      mockPrisma.user.findUnique.mockResolvedValue(null);

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.error).toBe('Invalid credentials');
    });

    it('should reject login with incorrect password', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'WrongPassword123!',
      };

      const mockUser = fixtures.users.validUser;
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      jest.doMock('argon2', () => ({
        verify: jest.fn().mockResolvedValue(false),
      }));

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(401);

      expect(response.body.error).toBe('Invalid credentials');
    });

    it('should handle MFA challenge for MFA-enabled users', async () => {
      const loginData = {
        email: 'mfa@example.com',
        password: 'SecurePassword123!',
      };

      const mockUser = {
        ...fixtures.users.mfaUser,
        password: '$argon2id$v=19$m=65536,t=3,p=4$hashedPassword',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      jest.doMock('argon2', () => ({
        verify: jest.fn().mockResolvedValue(true),
      }));

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(200);

      expect(response.body).toMatchObject({
        success: false,
        mfaRequired: true,
        sessionId: expect.any(String),
        message: 'MFA verification required',
      });
    });

    it('should handle account lockout after multiple failed attempts', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'WrongPassword123!',
      };

      const mockUser = {
        ...fixtures.users.validUser,
        loginAttempts: 5,
        lockedUntil: new Date(Date.now() + 3600000), // Locked for 1 hour
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(423);

      expect(response.body.error).toBe('Account temporarily locked');
      expect(response.body.lockedUntil).toBeDefined();
    });

    it('should sanitize malicious input attempts', async () => {
      const maliciousLogin = {
        email: "admin@example.com'; DROP TABLE users; --",
        password: '<script>alert("xss")</script>',
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(maliciousLogin)
        .expect(400);

      expect(response.body.error).toBe('Invalid input detected');
    });

    it('should implement rate limiting', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'SecurePassword123!',
      };

      // Configure Redis to simulate rate limit exceeded
      mockRedis.incr.mockResolvedValue(101); // Exceeds limit
      mockRedis.ttl.mockResolvedValue(60);

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(429);

      expect(response.body.error).toBe('Too many requests');
      expect(response.headers['retry-after']).toBeDefined();
      expect(response.headers['x-ratelimit-limit']).toBeDefined();
    });
  });

  describe('POST /api/auth/mfa/verify', () => {
    it('should verify valid MFA token and complete login', async () => {
      const verifyData = {
        sessionId: 'mfa-session-123',
        token: '123456',
      };

      const mockSession = {
        id: 'mfa-session-123',
        userId: fixtures.users.mfaUser.id,
        mfaRequired: true,
        createdAt: new Date(),
      };

      const mockUser = fixtures.users.mfaUser;

      mockRedis.get.mockResolvedValue(JSON.stringify(mockSession));
      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockRedis.setex.mockResolvedValue('OK');

      // Mock TOTP verification
      jest.doMock('otplib', () => ({
        authenticator: {
          verify: jest.fn().mockReturnValue(true),
        },
      }));

      const response = await request(app)
        .post('/api/auth/mfa/verify')
        .send(verifyData)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        user: {
          id: mockUser.id,
          email: mockUser.email,
          mfaVerified: true,
        },
        tokens: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
        },
      });
    });

    it('should reject invalid MFA token', async () => {
      const verifyData = {
        sessionId: 'mfa-session-123',
        token: '999999',
      };

      const mockSession = {
        id: 'mfa-session-123',
        userId: fixtures.users.mfaUser.id,
        mfaRequired: true,
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(mockSession));
      mockPrisma.user.findUnique.mockResolvedValue(fixtures.users.mfaUser);

      jest.doMock('otplib', () => ({
        authenticator: {
          verify: jest.fn().mockReturnValue(false),
        },
      }));

      const response = await request(app)
        .post('/api/auth/mfa/verify')
        .send(verifyData)
        .expect(401);

      expect(response.body.error).toBe('Invalid MFA token');
    });

    it('should reject expired MFA session', async () => {
      const verifyData = {
        sessionId: 'expired-session-123',
        token: '123456',
      };

      mockRedis.get.mockResolvedValue(null); // Session expired

      const response = await request(app)
        .post('/api/auth/mfa/verify')
        .send(verifyData)
        .expect(401);

      expect(response.body.error).toBe('MFA session expired');
    });
  });

  describe('POST /api/auth/register', () => {
    it('should successfully register new user', async () => {
      const registerData = {
        email: 'newuser@example.com',
        password: 'SecurePassword123!',
        firstName: 'New',
        lastName: 'User',
      };

      mockPrisma.user.findUnique.mockResolvedValue(null); // User doesn't exist
      mockPrisma.user.create.mockResolvedValue({
        ...fixtures.users.validUser,
        ...registerData,
        id: 'new-user-id',
      });

      const response = await request(app)
        .post('/api/auth/register')
        .send(registerData)
        .expect(201);

      expect(response.body).toMatchObject({
        success: true,
        user: {
          id: 'new-user-id',
          email: registerData.email,
          firstName: registerData.firstName,
          lastName: registerData.lastName,
        },
        message: 'Registration successful',
      });

      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          email: registerData.email,
          password: expect.any(String), // Should be hashed
          firstName: registerData.firstName,
          lastName: registerData.lastName,
        }),
      });
    });

    it('should reject registration with existing email', async () => {
      const registerData = {
        email: 'existing@example.com',
        password: 'SecurePassword123!',
        firstName: 'Existing',
        lastName: 'User',
      };

      mockPrisma.user.findUnique.mockResolvedValue(fixtures.users.validUser);

      const response = await request(app)
        .post('/api/auth/register')
        .send(registerData)
        .expect(409);

      expect(response.body.error).toBe('Email already registered');
    });

    it('should validate password strength requirements', async () => {
      const registerData = {
        email: 'newuser@example.com',
        password: 'weakpass',
        firstName: 'New',
        lastName: 'User',
      };

      const response = await request(app)
        .post('/api/auth/register')
        .send(registerData)
        .expect(400);

      expect(response.body.error).toBe('Input validation failed');
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'password',
          }),
        ])
      );
    });
  });

  describe('POST /api/auth/refresh', () => {
    it('should refresh access token with valid refresh token', async () => {
      const refreshData = {
        refreshToken: 'valid-refresh-token',
      };

      // Mock refresh token verification and new token generation
      const mockRefreshPayload = {
        sub: fixtures.users.validUser.id,
        sessionId: 'session-123',
        tokenFamily: 'family-123',
        jti: 'refresh-jti',
      };

      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify({ // Token family
          userId: fixtures.users.validUser.id,
          sessionId: 'session-123',
          createdAt: new Date().toISOString(),
        }))
        .mockResolvedValueOnce(JSON.stringify({ // User data
          email: fixtures.users.validUser.email,
          roles: JSON.stringify(fixtures.users.validUser.roles),
          permissions: JSON.stringify(fixtures.users.validUser.permissions),
          mfaVerified: 'false',
        }));

      const response = await request(app)
        .post('/api/auth/refresh')
        .send(refreshData)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        tokens: {
          accessToken: expect.any(String),
          refreshToken: expect.any(String),
          expiresIn: expect.any(Number),
        },
      });

      expect(response.body.tokens.accessToken).toBeValidJWT();
    });

    it('should reject invalid refresh token', async () => {
      const refreshData = {
        refreshToken: 'invalid-refresh-token',
      };

      const response = await request(app)
        .post('/api/auth/refresh')
        .send(refreshData)
        .expect(401);

      expect(response.body.error).toBe('Invalid refresh token');
    });

    it('should reject refresh token from revoked family', async () => {
      const refreshData = {
        refreshToken: 'revoked-family-token',
      };

      mockRedis.get.mockResolvedValue(null); // Token family not found

      const response = await request(app)
        .post('/api/auth/refresh')
        .send(refreshData)
        .expect(401);

      expect(response.body.error).toBe('Invalid refresh token');
    });
  });

  describe('POST /api/auth/logout', () => {
    it('should successfully logout authenticated user', async () => {
      const mockUser = fixtures.users.validUser;
      const validToken = await jwtService.generateTokenPair({
        userId: mockUser.id,
        email: mockUser.email,
        roles: mockUser.roles,
        permissions: mockUser.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      mockRedis.get.mockResolvedValue('valid'); // Token is active
      mockRedis.del.mockResolvedValue(1);

      const response = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${validToken.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        message: 'Logout successful',
      });

      expect(mockRedis.del).toHaveBeenCalledWith(
        expect.stringMatching(/^active_token:/)
      );
    });

    it('should require authentication for logout', async () => {
      const response = await request(app)
        .post('/api/auth/logout')
        .expect(401);

      expect(response.body.error).toBe('Authorization header required');
    });
  });

  describe('GET /api/auth/profile', () => {
    it('should return authenticated user profile', async () => {
      const mockUser = fixtures.users.validUser;
      const validToken = await jwtService.generateTokenPair({
        userId: mockUser.id,
        email: mockUser.email,
        roles: mockUser.roles,
        permissions: mockUser.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      const mockSession = fixtures.sessions.validSession;

      mockRedis.get
        .mockResolvedValueOnce('valid') // Token is active
        .mockResolvedValueOnce(JSON.stringify(mockSession)); // Session data

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);

      const response = await request(app)
        .get('/api/auth/profile')
        .set('Authorization', `Bearer ${validToken.accessToken}`)
        .expect(200);

      expect(response.body).toMatchObject({
        success: true,
        user: {
          id: mockUser.id,
          email: mockUser.email,
          firstName: mockUser.firstName,
          lastName: mockUser.lastName,
          roles: mockUser.roles,
          permissions: mockUser.permissions,
        },
      });

      // Should not include sensitive data
      expect(response.body.user.password).toBeUndefined();
      expect(response.body.user.mfaSecret).toBeUndefined();
    });

    it('should require authentication', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .expect(401);

      expect(response.body.error).toBe('Authorization header required');
    });
  });

  describe('Security Headers', () => {
    it('should include security headers in all responses', async () => {
      const response = await request(app)
        .get('/api/auth/profile')
        .expect(401);

      expect(response).toHaveSecurityHeaders();
    });

    it('should include rate limiting headers', async () => {
      mockRedis.incr.mockResolvedValue(5);
      mockRedis.expire.mockResolvedValue(1);

      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'user@example.com',
          password: 'SecurePassword123!',
        });

      expect(response).toHaveValidRateLimitHeaders();
    });
  });

  describe('Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'SecurePassword123!',
      };

      mockPrisma.user.findUnique.mockRejectedValue(new Error('Database connection failed'));

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
      expect(response.body.details).toBeUndefined(); // Should not expose internal details
    });

    it('should handle Redis connection errors gracefully', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'SecurePassword123!',
      };

      const mockUser = {
        ...fixtures.users.validUser,
        password: '$argon2id$v=19$m=65536,t=3,p=4$hashedPassword',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockRedis.setex.mockRejectedValue(new Error('Redis connection failed'));

      jest.doMock('argon2', () => ({
        verify: jest.fn().mockResolvedValue(true),
      }));

      const response = await request(app)
        .post('/api/auth/login')
        .send(loginData)
        .expect(500);

      expect(response.body.error).toBe('Internal server error');
    });
  });

  describe('Input Validation', () => {
    it('should validate all required fields', async () => {
      const incompleteData = {
        email: 'user@example.com',
        // Missing password
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(incompleteData)
        .expect(400);

      expect(response.body.error).toBe('Input validation failed');
      expect(response.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'password',
            message: expect.stringContaining('required'),
          }),
        ])
      );
    });

    it('should reject requests with invalid data types', async () => {
      const invalidData = {
        email: 123, // Should be string
        password: true, // Should be string
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(invalidData)
        .expect(400);

      expect(response.body.error).toBe('Input validation failed');
    });

    it('should enforce field length limits', async () => {
      const oversizedData = {
        email: 'a'.repeat(300) + '@example.com', // Too long
        password: 'SecurePassword123!',
      };

      const response = await request(app)
        .post('/api/auth/login')
        .send(oversizedData)
        .expect(400);

      expect(response.body.error).toBe('Input validation failed');
    });
  });

  describe('Concurrent Request Handling', () => {
    it('should handle concurrent login requests safely', async () => {
      const loginData = {
        email: 'user@example.com',
        password: 'SecurePassword123!',
      };

      const mockUser = {
        ...fixtures.users.validUser,
        password: '$argon2id$v=19$m=65536,t=3,p=4$hashedPassword',
      };

      mockPrisma.user.findUnique.mockResolvedValue(mockUser);
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.sadd.mockResolvedValue(1);

      jest.doMock('argon2', () => ({
        verify: jest.fn().mockResolvedValue(true),
      }));

      // Simulate concurrent requests
      const requests = Array.from({ length: 5 }, () =>
        request(app)
          .post('/api/auth/login')
          .send(loginData)
      );

      const responses = await Promise.all(requests);

      // All should succeed
      responses.forEach(response => {
        expect(response.status).toBe(200);
        expect(response.body.success).toBe(true);
        expect(response.body.tokens.accessToken).toBeValidJWT();
      });
    });
  });
});