import { JWTService, JWTPayload, TokenPair } from '../../../src/auth/jwt-service';
import { MockFactory, TestDataGenerator } from '../../utils/test-helpers';
import { fixtures } from '../../utils/fixtures';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

// Mock dependencies
jest.mock('../../../src/config/config', () => ({
  config: {
    env: 'test',
    jwt: {
      secret: 'test-jwt-secret-must-be-at-least-32-characters-long',
      accessExpiresIn: '15m',
      refreshExpiresIn: '7d',
      issuer: 'secure-mcp-server',
      audience: 'secure-mcp-client',
    },
  },
}));

jest.mock('../../../src/database/redis', () => ({
  redis: MockFactory.createMockRedis(),
}));

jest.mock('../../../src/security/vault', () => ({
  vault: MockFactory.createMockVault(),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: MockFactory.createMockLogger(),
}));

describe('JWTService', () => {
  let jwtService: JWTService;
  let mockRedis: any;
  let mockVault: any;

  beforeEach(() => {
    jwtService = new JWTService();
    mockRedis = require('../../../src/database/redis').redis;
    mockVault = require('../../../src/security/vault').vault;

    // Reset mocks
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully in development environment', async () => {
      await jwtService.initialize();

      expect(mockVault.read).not.toHaveBeenCalled();
    });

    it('should load secrets from Vault in production environment', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      const mockSecrets = {
        data: {
          access_secret: 'vault-access-secret-must-be-at-least-32-chars',
          refresh_secret: 'vault-refresh-secret-must-be-at-least-32-chars',
        },
      };

      mockVault.read.mockResolvedValue(mockSecrets);

      await jwtService.initialize();

      expect(mockVault.read).toHaveBeenCalledWith('auth/jwt');

      process.env.NODE_ENV = originalEnv;
    });

    it('should handle Vault errors gracefully', async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';

      mockVault.read.mockRejectedValue(new Error('Vault unavailable'));

      await expect(jwtService.initialize()).rejects.toThrow('Vault unavailable');

      process.env.NODE_ENV = originalEnv;
    });
  });

  describe('token generation', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should generate valid token pair', async () => {
      const userPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        roles: ['user'],
        permissions: ['basic'],
        sessionId: 'session-123',
        mfaVerified: false,
      };

      const tokenPair: TokenPair = await jwtService.generateTokenPair(userPayload);

      expect(tokenPair.accessToken).toBeValidJWT();
      expect(tokenPair.refreshToken).toBeValidJWT();
      expect(tokenPair.expiresIn).toBeGreaterThan(0);
      expect(tokenPair.refreshExpiresIn).toBeGreaterThan(tokenPair.expiresIn);

      // Verify Redis calls for token family and active token storage
      expect(mockRedis.setex).toHaveBeenCalledTimes(2);
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^token_family:/),
        expect.any(Number),
        expect.stringContaining('user-123')
      );
      expect(mockRedis.setex).toHaveBeenCalledWith(
        expect.stringMatching(/^active_token:/),
        expect.any(Number),
        'valid'
      );
    });

    it('should generate tokens with unique JTIs', async () => {
      const userPayload = TestDataGenerator.generateUser();

      const tokenPair1 = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-1',
        mfaVerified: false,
      });

      const tokenPair2 = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-2',
        mfaVerified: false,
      });

      const payload1 = jwt.decode(tokenPair1.accessToken) as JWTPayload;
      const payload2 = jwt.decode(tokenPair2.accessToken) as JWTPayload;

      expect(payload1.jti).not.toBe(payload2.jti);
      expect(payload1.sessionId).not.toBe(payload2.sessionId);
    });

    it('should include all required claims in access token', async () => {
      const userPayload = {
        userId: 'user-123',
        email: 'test@example.com',
        roles: ['user', 'admin'],
        permissions: ['read', 'write', 'admin'],
        sessionId: 'session-123',
        mfaVerified: true,
      };

      const tokenPair = await jwtService.generateTokenPair(userPayload);
      const payload = jwt.decode(tokenPair.accessToken) as JWTPayload;

      expect(payload.sub).toBe('user-123');
      expect(payload.email).toBe('test@example.com');
      expect(payload.roles).toEqual(['user', 'admin']);
      expect(payload.permissions).toEqual(['read', 'write', 'admin']);
      expect(payload.sessionId).toBe('session-123');
      expect(payload.mfaVerified).toBe(true);
      expect(payload.iss).toBe('secure-mcp-server');
      expect(payload.aud).toBe('secure-mcp-client');
      expect(payload.jti).toBeDefined();
      expect(payload.iat).toBeDefined();
      expect(payload.exp).toBeDefined();
    });
  });

  describe('token verification', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should verify valid access token', async () => {
      const userPayload = TestDataGenerator.generateJWTPayload();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.sub,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: userPayload.sessionId,
        mfaVerified: userPayload.mfaVerified,
      });

      mockRedis.get.mockResolvedValue('valid');

      const payload = await jwtService.verifyAccessToken(tokenPair.accessToken);

      expect(payload.sub).toBe(userPayload.sub);
      expect(payload.email).toBe(userPayload.email);
      expect(mockRedis.get).toHaveBeenCalledWith(expect.stringMatching(/^active_token:/));
    });

    it('should reject revoked access token', async () => {
      const userPayload = TestDataGenerator.generateJWTPayload();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.sub,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: userPayload.sessionId,
        mfaVerified: userPayload.mfaVerified,
      });

      mockRedis.get.mockResolvedValue(null); // Token not found = revoked

      await expect(jwtService.verifyAccessToken(tokenPair.accessToken))
        .rejects.toThrow('Invalid or expired access token');
    });

    it('should reject expired access token', async () => {
      const expiredPayload = {
        ...TestDataGenerator.generateJWTPayload(),
        exp: Math.floor(Date.now() / 1000) - 3600, // Expired 1 hour ago
      };

      const expiredToken = jwt.sign(expiredPayload, 'test-jwt-secret-must-be-at-least-32-characters-long');

      await expect(jwtService.verifyAccessToken(expiredToken))
        .rejects.toThrow('Invalid or expired access token');
    });

    it('should reject token with invalid signature', async () => {
      const payload = TestDataGenerator.generateJWTPayload();
      const invalidToken = jwt.sign(payload, 'wrong-secret');

      await expect(jwtService.verifyAccessToken(invalidToken))
        .rejects.toThrow('Invalid or expired access token');
    });

    it('should reject token with wrong issuer', async () => {
      const payload = {
        ...TestDataGenerator.generateJWTPayload(),
        iss: 'wrong-issuer',
      };
      const token = jwt.sign(payload, 'test-jwt-secret-must-be-at-least-32-characters-long');

      await expect(jwtService.verifyAccessToken(token))
        .rejects.toThrow('Invalid or expired access token');
    });

    it('should reject token with wrong audience', async () => {
      const payload = {
        ...TestDataGenerator.generateJWTPayload(),
        aud: 'wrong-audience',
      };
      const token = jwt.sign(payload, 'test-jwt-secret-must-be-at-least-32-characters-long');

      await expect(jwtService.verifyAccessToken(token))
        .rejects.toThrow('Invalid or expired access token');
    });
  });

  describe('refresh token verification', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should verify valid refresh token', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock token family exists
      mockRedis.get.mockResolvedValue(JSON.stringify({
        userId: userPayload.id,
        sessionId: 'session-123',
        createdAt: new Date().toISOString(),
      }));

      const payload = await jwtService.verifyRefreshToken(tokenPair.refreshToken);

      expect(payload.sub).toBe(userPayload.id);
      expect(payload.sessionId).toBe('session-123');
    });

    it('should reject refresh token with non-existent token family', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      mockRedis.get.mockResolvedValue(null); // Token family not found

      await expect(jwtService.verifyRefreshToken(tokenPair.refreshToken))
        .rejects.toThrow('Invalid or expired refresh token');
    });
  });

  describe('token refresh', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should refresh access token using valid refresh token', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const originalTokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock token family and user data
      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify({
          userId: userPayload.id,
          sessionId: 'session-123',
          createdAt: new Date().toISOString(),
        }))
        .mockResolvedValueOnce(JSON.stringify({
          email: userPayload.email,
          roles: JSON.stringify(userPayload.roles),
          permissions: JSON.stringify(userPayload.permissions),
          mfaVerified: 'false',
        }));

      const newTokenPair = await jwtService.refreshAccessToken(originalTokenPair.refreshToken);

      expect(newTokenPair.accessToken).toBeValidJWT();
      expect(newTokenPair.refreshToken).toBeValidJWT();
      expect(newTokenPair.accessToken).not.toBe(originalTokenPair.accessToken);

      // Verify old refresh token JTI is deleted
      expect(mockRedis.del).toHaveBeenCalledWith(expect.stringMatching(/^active_token:/));
    });

    it('should handle refresh token with missing user data', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify({
          userId: userPayload.id,
          sessionId: 'session-123',
          createdAt: new Date().toISOString(),
        }))
        .mockResolvedValueOnce('{}'); // Empty user data

      const newTokenPair = await jwtService.refreshAccessToken(tokenPair.refreshToken);

      expect(newTokenPair.accessToken).toBeValidJWT();

      // Should use default values for missing user data
      const payload = jwt.decode(newTokenPair.accessToken) as JWTPayload;
      expect(payload.email).toBe('');
      expect(payload.roles).toEqual([]);
      expect(payload.permissions).toEqual([]);
      expect(payload.mfaVerified).toBe(false);
    });
  });

  describe('token revocation', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should revoke token by JTI', async () => {
      const jti = crypto.randomUUID();

      await jwtService.revokeToken(jti);

      expect(mockRedis.del).toHaveBeenCalledWith(`active_token:${jti}`);
    });

    it('should revoke all tokens for a session', async () => {
      const sessionId = 'session-123';
      const mockTokenKeys = [
        'active_token:jti1',
        'active_token:jti2',
        'active_token:jti3',
      ];
      const mockFamilyKeys = [
        'token_family:family1',
        'token_family:family2',
      ];

      mockRedis.keys
        .mockResolvedValueOnce(mockTokenKeys)
        .mockResolvedValueOnce(mockFamilyKeys);

      mockRedis.get
        .mockResolvedValue('valid') // For token keys
        .mockResolvedValueOnce(JSON.stringify({ sessionId }))
        .mockResolvedValueOnce(JSON.stringify({ sessionId: 'other-session' }));

      await jwtService.revokeSession(sessionId);

      expect(mockRedis.keys).toHaveBeenCalledWith('active_token:*');
      expect(mockRedis.keys).toHaveBeenCalledWith('token_family:*');
      expect(mockRedis.del).toHaveBeenCalledTimes(4); // 3 tokens + 1 matching family
    });

    it('should revoke all tokens for a user', async () => {
      const userId = 'user-123';
      const mockFamilyKeys = [
        'token_family:family1',
        'token_family:family2',
        'token_family:family3',
      ];
      const mockTokenKeys = [
        'active_token:jti1',
        'active_token:jti2',
      ];

      mockRedis.keys
        .mockResolvedValueOnce(mockFamilyKeys)
        .mockResolvedValueOnce(mockTokenKeys);

      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify({ userId }))
        .mockResolvedValueOnce(JSON.stringify({ userId: 'other-user' }))
        .mockResolvedValueOnce(JSON.stringify({ userId }));

      await jwtService.revokeAllUserTokens(userId);

      expect(mockRedis.del).toHaveBeenCalledTimes(4); // 2 matching families + 2 tokens
    });
  });

  describe('token utility methods', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should extract token from valid Authorization header', () => {
      const authHeader = 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
      const token = jwtService.extractTokenFromHeader(authHeader);

      expect(token).toBe('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    });

    it('should return null for invalid Authorization header format', () => {
      expect(jwtService.extractTokenFromHeader('InvalidHeader')).toBeNull();
      expect(jwtService.extractTokenFromHeader('Basic dXNlcjpwYXNz')).toBeNull();
      expect(jwtService.extractTokenFromHeader('')).toBeNull();
    });

    it('should validate JWT token format', () => {
      const validToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
      const invalidTokens = [
        'invalid-token',
        'one.two', // Missing third part
        'one.two.three.four', // Too many parts
        '', // Empty string
      ];

      expect(jwtService.isValidTokenFormat(validToken)).toBe(true);
      invalidTokens.forEach(token => {
        expect(jwtService.isValidTokenFormat(token)).toBe(false);
      });
    });

    it('should get token expiry time', () => {
      const payload = {
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      };
      const token = jwt.sign(payload, 'secret');
      const expiry = jwtService.getTokenExpiry(token);

      expect(expiry).toBeInstanceOf(Date);
      expect(expiry!.getTime()).toBeCloseTo(payload.exp * 1000, -3); // Within 1 second
    });

    it('should return null for token without expiry', () => {
      const payload = { sub: 'user' }; // No exp claim
      const token = jwt.sign(payload, 'secret');
      const expiry = jwtService.getTokenExpiry(token);

      expect(expiry).toBeNull();
    });

    it('should check if token is expired', () => {
      const expiredPayload = {
        exp: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
      };
      const validPayload = {
        exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour from now
      };

      const expiredToken = jwt.sign(expiredPayload, 'secret');
      const validToken = jwt.sign(validPayload, 'secret');

      expect(jwtService.isTokenExpired(expiredToken)).toBe(true);
      expect(jwtService.isTokenExpired(validToken)).toBe(false);
    });

    it('should consider malformed token as expired', () => {
      expect(jwtService.isTokenExpired('invalid-token')).toBe(true);
      expect(jwtService.isTokenExpired('')).toBe(true);
    });
  });

  describe('security considerations', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should generate cryptographically secure JTIs', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPairs = await Promise.all(
        Array.from({ length: 10 }, () =>
          jwtService.generateTokenPair({
            userId: userPayload.id,
            email: userPayload.email,
            roles: userPayload.roles,
            permissions: userPayload.permissions,
            sessionId: 'session-123',
            mfaVerified: false,
          })
        )
      );

      const jtis = tokenPairs.map(pair => {
        const payload = jwt.decode(pair.accessToken) as JWTPayload;
        return payload.jti;
      });

      // All JTIs should be unique
      const uniqueJtis = new Set(jtis);
      expect(uniqueJtis.size).toBe(jtis.length);

      // All JTIs should be valid UUIDs
      jtis.forEach(jti => {
        expect(jti).toBeValidUUID();
      });
    });

    it('should handle Redis failures gracefully during token operations', async () => {
      const userPayload = TestDataGenerator.generateUser();

      mockRedis.setex.mockRejectedValue(new Error('Redis connection failed'));

      await expect(jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      })).rejects.toThrow('Redis connection failed');
    });

    it('should not expose sensitive information in error messages', async () => {
      const malformedToken = 'definitely.not.jwt';

      try {
        await jwtService.verifyAccessToken(malformedToken);
        fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toBe('Invalid or expired access token');
        expect(error.message).not.toContain(malformedToken);
        expect(error.message).not.toContain('secret');
      }
    });

    it('should properly clean up expired tokens during operations', async () => {
      const sessionId = 'session-123';

      // Mock scenario where some tokens are already expired in Redis
      mockRedis.keys.mockResolvedValue([
        'token_family:expired-family',
        'token_family:valid-family',
      ]);

      mockRedis.get
        .mockResolvedValueOnce(null) // Expired family returns null
        .mockResolvedValueOnce(JSON.stringify({ sessionId })); // Valid family

      await jwtService.revokeSession(sessionId);

      // Should handle null values gracefully
      expect(mockRedis.del).toHaveBeenCalledWith('token_family:valid-family');
    });
  });
});