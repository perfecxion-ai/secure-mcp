import { JWTService, JWTPayload, TokenPair } from '../../../src/auth/jwt-service';
import { distributedLock } from '../../../src/auth/distributed-lock';
import { tokenBlacklist } from '../../../src/auth/token-blacklist';
import { tokenRateLimiter } from '../../../src/auth/token-rate-limiter';
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

// Mock the security modules
jest.mock('../../../src/auth/distributed-lock', () => ({
  distributedLock: {
    acquireLock: jest.fn(),
    releaseLock: jest.fn(),
  },
}));

jest.mock('../../../src/auth/token-blacklist', () => ({
  tokenBlacklist: {
    initialize: jest.fn(),
    isBlacklisted: jest.fn(),
    addToBlacklist: jest.fn(),
    blacklistAllUserTokens: jest.fn(),
    shutdown: jest.fn(),
  },
}));

jest.mock('../../../src/auth/token-rate-limiter', () => ({
  tokenRateLimiter: {
    checkValidationLimit: jest.fn(),
    checkRefreshLimit: jest.fn(),
    checkGenerationLimit: jest.fn(),
    checkRevocationLimit: jest.fn(),
    isUserBlocked: jest.fn(),
  },
}));

describe('JWT Service - Race Condition Security Tests', () => {
  let jwtService: JWTService;
  let mockRedis: any;
  let mockDistributedLock: any;
  let mockTokenBlacklist: any;
  let mockTokenRateLimiter: any;

  beforeEach(() => {
    jwtService = new JWTService();
    mockRedis = require('../../../src/database/redis').redis;
    mockDistributedLock = distributedLock;
    mockTokenBlacklist = tokenBlacklist;
    mockTokenRateLimiter = tokenRateLimiter;

    // Reset all mocks
    jest.clearAllMocks();

    // Setup default mock implementations
    mockTokenRateLimiter.checkValidationLimit.mockResolvedValue({ allowed: true, remaining: 100 });
    mockTokenRateLimiter.checkRefreshLimit.mockResolvedValue({ allowed: true, remaining: 10 });
    mockTokenRateLimiter.checkGenerationLimit.mockResolvedValue({ allowed: true, remaining: 5 });
    mockTokenRateLimiter.checkRevocationLimit.mockResolvedValue({ allowed: true, remaining: 20 });
    mockTokenRateLimiter.isUserBlocked.mockResolvedValue(false);

    mockTokenBlacklist.initialize.mockResolvedValue(undefined);
    mockTokenBlacklist.isBlacklisted.mockResolvedValue(false);
    mockTokenBlacklist.addToBlacklist.mockResolvedValue(undefined);

    mockDistributedLock.acquireLock.mockResolvedValue({
      key: 'test-lock',
      value: 'test-value',
      ttl: 5000,
      acquired: true
    });
    mockDistributedLock.releaseLock.mockResolvedValue(true);
  });

  describe('Race Condition Prevention', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should prevent concurrent refresh token attacks', async () => {
      const userPayload = TestDataGenerator.generateUser();

      // Generate initial token pair
      const originalTokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock token family data
      const familyData = {
        userId: userPayload.id,
        sessionId: 'session-123',
        createdAt: new Date().toISOString(),
        jti: jwt.decode(originalTokenPair.accessToken)?.jti
      };

      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify(familyData)) // First request - family exists
        .mockResolvedValueOnce(JSON.stringify(familyData)) // User data lookup
        .mockResolvedValueOnce(null); // Second request - family already used

      mockRedis.hgetall.mockResolvedValue({
        email: userPayload.email,
        roles: JSON.stringify(userPayload.roles),
        permissions: JSON.stringify(userPayload.permissions),
        mfaVerified: 'false',
      });

      // Simulate concurrent refresh attempts
      const refreshPromises = [
        jwtService.refreshAccessToken(originalTokenPair.refreshToken),
        jwtService.refreshAccessToken(originalTokenPair.refreshToken)
      ];

      // First should succeed, second should fail due to distributed lock
      const results = await Promise.allSettled(refreshPromises);

      // One should succeed, one should fail
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      expect(successful).toBe(1);
      expect(failed).toBe(1);

      // Verify distributed lock was acquired
      expect(mockDistributedLock.acquireLock).toHaveBeenCalledWith(
        expect.stringMatching(/token_refresh:/),
        expect.objectContaining({
          ttl: 10000,
          maxRetries: 5,
          retryDelay: 100
        })
      );

      // Verify lock was released
      expect(mockDistributedLock.releaseLock).toHaveBeenCalled();
    });

    it('should detect token replay attacks', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const originalTokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock token family with different JTI (replay attack scenario)
      const familyData = {
        userId: userPayload.id,
        sessionId: 'session-123',
        createdAt: new Date().toISOString(),
        jti: 'different-jti' // This doesn't match the refresh token JTI
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(familyData));

      // Should detect potential replay attack
      await expect(
        jwtService.refreshAccessToken(originalTokenPair.refreshToken)
      ).rejects.toThrow('Invalid refresh token - security violation detected');

      // Verify token family is invalidated
      expect(mockTokenBlacklist.addToBlacklist).toHaveBeenCalledWith(
        'different-jti',
        userPayload.id,
        expect.any(Date),
        'potential_replay_attack'
      );
    });

    it('should handle high concurrency refresh attempts gracefully', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const originalTokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock token family data
      const familyData = {
        userId: userPayload.id,
        sessionId: 'session-123',
        createdAt: new Date().toISOString(),
        jti: jwt.decode(originalTokenPair.accessToken)?.jti
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(familyData));
      mockRedis.hgetall.mockResolvedValue({
        email: userPayload.email,
        roles: JSON.stringify(userPayload.roles),
        permissions: JSON.stringify(userPayload.permissions),
        mfaVerified: 'false',
      });

      // Simulate many concurrent attempts
      const concurrentAttempts = 50;
      const refreshPromises = Array.from({ length: concurrentAttempts }, () =>
        jwtService.refreshAccessToken(originalTokenPair.refreshToken)
      );

      const results = await Promise.allSettled(refreshPromises);

      // Only one should succeed due to distributed locking
      const successful = results.filter(r => r.status === 'fulfilled').length;
      expect(successful).toBeLessThanOrEqual(1);

      // Verify distributed lock was used
      expect(mockDistributedLock.acquireLock).toHaveBeenCalled();
    });

    it('should prevent session hijacking through token validation', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock token as blacklisted (compromised)
      mockTokenBlacklist.isBlacklisted.mockResolvedValue(true);

      // Should reject blacklisted token
      await expect(
        jwtService.verifyAccessToken(tokenPair.accessToken)
      ).rejects.toThrow('Invalid or expired access token');

      // Verify blacklist check was performed
      expect(mockTokenBlacklist.isBlacklisted).toHaveBeenCalledWith(
        expect.any(String)
      );
    });

    it('should enforce rate limits to prevent brute force attacks', async () => {
      const userPayload = TestDataGenerator.generateUser();

      // Mock rate limit exceeded
      mockTokenRateLimiter.checkValidationLimit.mockResolvedValue({
        allowed: false,
        remaining: 0
      });

      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Should reject due to rate limiting
      await expect(
        jwtService.verifyAccessToken(tokenPair.accessToken)
      ).rejects.toThrow('Rate limit exceeded for token validation');

      expect(mockTokenRateLimiter.checkValidationLimit).toHaveBeenCalled();
    });

    it('should block users after security violations', async () => {
      const userPayload = TestDataGenerator.generateUser();

      // Mock user as blocked
      mockTokenRateLimiter.isUserBlocked.mockResolvedValue(true);

      // Should reject token generation for blocked user
      await expect(
        jwtService.generateTokenPair({
          userId: userPayload.id,
          email: userPayload.email,
          roles: userPayload.roles,
          permissions: userPayload.permissions,
          sessionId: 'session-123',
          mfaVerified: false,
        })
      ).rejects.toThrow('User is temporarily blocked from token operations');
    });
  });

  describe('Atomic Operations', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should handle Redis failures gracefully during token operations', async () => {
      const userPayload = TestDataGenerator.generateUser();

      // Mock Redis pipeline failure
      mockRedis.pipeline.mockReturnValue({
        setex: jest.fn().mockReturnThis(),
        sadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Redis connection failed'))
      });

      await expect(
        jwtService.generateTokenPair({
          userId: userPayload.id,
          email: userPayload.email,
          roles: userPayload.roles,
          permissions: userPayload.permissions,
          sessionId: 'session-123',
          mfaVerified: false,
        })
      ).rejects.toThrow('Redis connection failed');
    });

    it('should ensure token family consistency during refresh', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const originalTokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock family data
      const familyData = {
        userId: userPayload.id,
        sessionId: 'session-123',
        createdAt: new Date().toISOString(),
        jti: jwt.decode(originalTokenPair.accessToken)?.jti
      };

      mockRedis.get
        .mockResolvedValueOnce(JSON.stringify(familyData))
        .mockResolvedValueOnce(JSON.stringify(familyData));

      mockRedis.hgetall.mockResolvedValue({
        email: userPayload.email,
        roles: JSON.stringify(userPayload.roles),
        permissions: JSON.stringify(userPayload.permissions),
        mfaVerified: 'false',
      });

      const newTokenPair = await jwtService.refreshAccessToken(originalTokenPair.refreshToken);

      // Verify old tokens are blacklisted
      expect(mockTokenBlacklist.addToBlacklist).toHaveBeenCalledWith(
        expect.any(String),
        userPayload.id,
        expect.any(Date),
        'token_refreshed'
      );

      // Verify new token pair is generated
      expect(newTokenPair.accessToken).toBeDefined();
      expect(newTokenPair.refreshToken).toBeDefined();
      expect(newTokenPair.accessToken).not.toBe(originalTokenPair.accessToken);
    });
  });

  describe('Security Monitoring', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should log security events for monitoring', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const mockLogger = require('../../../src/utils/logger').logger;

      await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Verify security events are logged
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Token pair generated securely',
        expect.objectContaining({
          userId: userPayload.id,
          sessionId: 'session-123'
        })
      );
    });

    it('should track failed authentication attempts', async () => {
      const mockLogger = require('../../../src/utils/logger').logger;

      await expect(
        jwtService.verifyAccessToken('invalid-token')
      ).rejects.toThrow();

      // Verify failed attempts are logged
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Access token verification failed',
        expect.objectContaining({
          error: expect.any(String)
        })
      );
    });
  });

  describe('Cleanup and Resource Management', () => {
    it('should properly shutdown and cleanup resources', async () => {
      await jwtService.initialize();
      await jwtService.shutdown();

      expect(mockTokenBlacklist.shutdown).toHaveBeenCalled();
    });

    it('should handle initialization failures gracefully', async () => {
      mockTokenBlacklist.initialize.mockRejectedValue(new Error('Initialization failed'));

      await expect(jwtService.initialize()).rejects.toThrow('Initialization failed');
    });
  });
});