import { JWTService } from '../../../src/auth/jwt-service';
import { distributedLock } from '../../../src/auth/distributed-lock';
import { tokenBlacklist } from '../../../src/auth/token-blacklist';
import { tokenRateLimiter } from '../../../src/auth/token-rate-limiter';
import { MockFactory, TestDataGenerator } from '../../utils/test-helpers';

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
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    sadd: jest.fn(),
    srem: jest.fn(),
    smembers: jest.fn(),
    hgetall: jest.fn(),
    hget: jest.fn(),
    hset: jest.fn(),
    keys: jest.fn(),
    scard: jest.fn(),
    scan: jest.fn(),
    memory: jest.fn(),
    exists: jest.fn(),
    ping: jest.fn(() => Promise.resolve('PONG')),
    disconnect: jest.fn(() => Promise.resolve()),
    pipeline: jest.fn(() => ({
      setex: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      srem: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      ttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    })),
  },
}));

jest.mock('../../../src/security/vault', () => ({
  vault: {
    read: jest.fn(),
    write: jest.fn(),
    health: jest.fn(() => Promise.resolve({ status: 'ok' })),
    delete: jest.fn(),
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
    trace: jest.fn(),
    child: jest.fn(() => ({
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
    })),
  },
}));

// Mock security modules
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
    shutdown: jest.fn(),
  },
}));

jest.mock('../../../src/auth/token-rate-limiter', () => ({
  tokenRateLimiter: {
    checkValidationLimit: jest.fn(),
    checkRefreshLimit: jest.fn(),
    checkGenerationLimit: jest.fn(),
    isUserBlocked: jest.fn(),
  },
}));

describe('JWT Service - Concurrent Validation Tests', () => {
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

    // Reset mocks
    jest.clearAllMocks();

    // Setup default successful responses
    mockTokenRateLimiter.checkValidationLimit.mockResolvedValue({ allowed: true, remaining: 100 });
    mockTokenRateLimiter.checkRefreshLimit.mockResolvedValue({ allowed: true, remaining: 10 });
    mockTokenRateLimiter.checkGenerationLimit.mockResolvedValue({ allowed: true, remaining: 5 });
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

  describe('High Concurrency Token Validation', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should handle 1000+ concurrent token validations', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock successful validation responses
      mockRedis.get.mockResolvedValue('{"userId":"test","sessionId":"session-123"}');

      // Create 1000 concurrent validation requests
      const concurrentValidations = Array.from({ length: 1000 }, () =>
        jwtService.verifyAccessToken(tokenPair.accessToken)
      );

      const results = await Promise.allSettled(concurrentValidations);

      // All should succeed under normal conditions
      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      expect(successful).toBeGreaterThan(990); // Allow for some minor failures
      expect(failed).toBeLessThan(10);

      // Verify rate limiting was applied
      expect(mockTokenRateLimiter.checkValidationLimit).toHaveBeenCalledTimes(1000);
    });

    it('should throttle validation requests under rate limit', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock rate limit exceeded after 100 requests
      let callCount = 0;
      mockTokenRateLimiter.checkValidationLimit.mockImplementation(() => {
        callCount++;
        return Promise.resolve({
          allowed: callCount <= 100,
          remaining: Math.max(0, 100 - callCount)
        });
      });

      // Create 200 concurrent validation requests
      const concurrentValidations = Array.from({ length: 200 }, () =>
        jwtService.verifyAccessToken(tokenPair.accessToken)
      );

      const results = await Promise.allSettled(concurrentValidations);

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const rateLimited = results.filter(r =>
        r.status === 'rejected' &&
        r.reason.message.includes('Rate limit exceeded')
      ).length;

      expect(successful).toBeLessThanOrEqual(100);
      expect(rateLimited).toBeGreaterThan(90); // Most excess requests should be rate limited
    });

    it('should maintain performance under concurrent load', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      mockRedis.get.mockResolvedValue('{"userId":"test","sessionId":"session-123"}');

      const startTime = Date.now();

      // 500 concurrent validations
      const concurrentValidations = Array.from({ length: 500 }, () =>
        jwtService.verifyAccessToken(tokenPair.accessToken)
      );

      await Promise.allSettled(concurrentValidations);

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Should complete 500 validations in under 5 seconds
      expect(totalTime).toBeLessThan(5000);

      // Average response time should be under 50ms
      const avgResponseTime = totalTime / 500;
      expect(avgResponseTime).toBeLessThan(50);
    });
  });

  describe('Concurrent Refresh Operations', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should prevent multiple refresh operations with same token', async () => {
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
        jti: 'test-jti'
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(familyData));
      mockRedis.hgetall.mockResolvedValue({
        email: userPayload.email,
        roles: JSON.stringify(userPayload.roles),
        permissions: JSON.stringify(userPayload.permissions),
        mfaVerified: 'false',
      });

      // Simulate lock contention - first succeeds, rest fail
      let lockAcquireCount = 0;
      mockDistributedLock.acquireLock.mockImplementation(() => {
        lockAcquireCount++;
        return Promise.resolve(lockAcquireCount === 1 ? {
          key: 'test-lock',
          value: 'test-value',
          ttl: 5000,
          acquired: true
        } : null);
      });

      // 10 concurrent refresh attempts
      const concurrentRefreshes = Array.from({ length: 10 }, () =>
        jwtService.refreshAccessToken(originalTokenPair.refreshToken)
      );

      const results = await Promise.allSettled(concurrentRefreshes);

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failedDueToLock = results.filter(r =>
        r.status === 'rejected' &&
        r.reason.message.includes('Unable to acquire refresh lock')
      ).length;

      expect(successful).toBe(1);
      expect(failedDueToLock).toBe(9);
    });

    it('should handle distributed lock timeout gracefully', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const originalTokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock lock acquisition failure (timeout)
      mockDistributedLock.acquireLock.mockResolvedValue(null);

      await expect(
        jwtService.refreshAccessToken(originalTokenPair.refreshToken)
      ).rejects.toThrow('Unable to acquire refresh lock - try again later');

      expect(mockDistributedLock.acquireLock).toHaveBeenCalledWith(
        expect.stringMatching(/token_refresh:/),
        expect.objectContaining({
          ttl: 10000,
          maxRetries: 5,
          retryDelay: 100
        })
      );
    });
  });

  describe('Error Recovery and Resilience', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should recover from temporary Redis failures', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock Redis failures for first few requests, then success
      let attemptCount = 0;
      mockRedis.get.mockImplementation(() => {
        attemptCount++;
        if (attemptCount <= 3) {
          return Promise.reject(new Error('Redis connection failed'));
        }
        return Promise.resolve('{"userId":"test","sessionId":"session-123"}');
      });

      const concurrentValidations = Array.from({ length: 10 }, () =>
        jwtService.verifyAccessToken(tokenPair.accessToken)
      );

      const results = await Promise.allSettled(concurrentValidations);

      const successful = results.filter(r => r.status === 'fulfilled').length;
      const failed = results.filter(r => r.status === 'rejected').length;

      // Some should succeed after Redis recovers
      expect(successful).toBeGreaterThan(0);
      expect(failed).toBeGreaterThan(0);
    });

    it('should handle blacklist service failures gracefully', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock blacklist check failure
      mockTokenBlacklist.isBlacklisted.mockRejectedValue(new Error('Blacklist service down'));
      mockRedis.get.mockResolvedValue('{"userId":"test","sessionId":"session-123"}');

      // Should fail gracefully due to blacklist check failure
      await expect(
        jwtService.verifyAccessToken(tokenPair.accessToken)
      ).rejects.toThrow();
    });

    it('should maintain data consistency during partial failures', async () => {
      const userPayload = TestDataGenerator.generateUser();

      // Mock partial pipeline failure
      mockRedis.pipeline.mockReturnValue({
        setex: jest.fn().mockReturnThis(),
        sadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Partial pipeline failure'))
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
      ).rejects.toThrow();

      // Ensure no partial state is created
      expect(mockRedis.setex).not.toHaveBeenCalled();
    });
  });

  describe('Memory and Resource Management', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should not leak memory during high concurrency operations', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      mockRedis.get.mockResolvedValue('{"userId":"test","sessionId":"session-123"}');

      // Measure memory before
      const memBefore = process.memoryUsage().heapUsed;

      // Perform many concurrent operations
      for (let i = 0; i < 10; i++) {
        const concurrentOps = Array.from({ length: 100 }, () =>
          jwtService.verifyAccessToken(tokenPair.accessToken)
        );
        await Promise.allSettled(concurrentOps);
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      // Measure memory after
      const memAfter = process.memoryUsage().heapUsed;
      const memIncrease = memAfter - memBefore;

      // Memory increase should be reasonable (< 10MB for 1000 operations)
      expect(memIncrease).toBeLessThan(10 * 1024 * 1024);
    });

    it('should release distributed locks even on exceptions', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const originalTokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      // Mock lock acquisition success but operation failure
      mockRedis.get
        .mockResolvedValueOnce('{"userId":"test","sessionId":"session-123"}') // Family exists
        .mockRejectedValue(new Error('Redis operation failed')); // Subsequent operation fails

      await expect(
        jwtService.refreshAccessToken(originalTokenPair.refreshToken)
      ).rejects.toThrow();

      // Verify lock was still released despite the error
      expect(mockDistributedLock.releaseLock).toHaveBeenCalled();
    });
  });

  describe('Performance Benchmarks', () => {
    beforeEach(async () => {
      await jwtService.initialize();
    });

    it('should validate tokens within performance SLA', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      mockRedis.get.mockResolvedValue('{"userId":"test","sessionId":"session-123"}');

      // Measure individual validation time
      const startTime = process.hrtime.bigint();
      await jwtService.verifyAccessToken(tokenPair.accessToken);
      const endTime = process.hrtime.bigint();

      const validationTimeMs = Number(endTime - startTime) / 1000000;

      // Should complete validation in under 50ms
      expect(validationTimeMs).toBeLessThan(50);
    });

    it('should maintain throughput under sustained load', async () => {
      const userPayload = TestDataGenerator.generateUser();
      const tokenPair = await jwtService.generateTokenPair({
        userId: userPayload.id,
        email: userPayload.email,
        roles: userPayload.roles,
        permissions: userPayload.permissions,
        sessionId: 'session-123',
        mfaVerified: false,
      });

      mockRedis.get.mockResolvedValue('{"userId":"test","sessionId":"session-123"}');

      const totalOperations = 1000;
      const batchSize = 50;
      const batches = totalOperations / batchSize;

      const startTime = Date.now();

      for (let i = 0; i < batches; i++) {
        const batch = Array.from({ length: batchSize }, () =>
          jwtService.verifyAccessToken(tokenPair.accessToken)
        );
        await Promise.allSettled(batch);
      }

      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const operationsPerSecond = (totalOperations / totalTime) * 1000;

      // Should maintain at least 100 operations per second
      expect(operationsPerSecond).toBeGreaterThan(100);
    });
  });
});