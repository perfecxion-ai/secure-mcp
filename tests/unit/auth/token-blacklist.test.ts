import { TokenBlacklistManager, BlacklistEntry } from '../../../src/auth/token-blacklist';
import { MockFactory } from '../../utils/test-helpers';

// Mock dependencies
jest.mock('../../../src/database/redis', () => ({
  redis: MockFactory.createMockRedis(),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: MockFactory.createMockLogger(),
}));

describe('TokenBlacklistManager', () => {
  let blacklistManager: TokenBlacklistManager;
  let mockRedis: any;

  beforeEach(() => {
    blacklistManager = new TokenBlacklistManager({
      cleanupInterval: 100, // Fast cleanup for testing
      batchSize: 10
    });
    mockRedis = require('../../../src/database/redis').redis;

    // Reset mocks
    jest.clearAllMocks();
  });

  afterEach(async () => {
    await blacklistManager.shutdown();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await blacklistManager.initialize();
      // No specific assertions needed - should not throw
    });
  });

  describe('token blacklisting', () => {
    beforeEach(async () => {
      await blacklistManager.initialize();
    });

    it('should add token to blacklist with TTL', async () => {
      const jti = 'test-jti-123';
      const userId = 'user-456';
      const expiresAt = new Date(Date.now() + 60000); // 1 minute from now
      const reason = 'security_violation';

      mockRedis.pipeline.mockReturnValue({
        setex: jest.fn().mockReturnThis(),
        sadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      });

      await blacklistManager.addToBlacklist(jti, userId, expiresAt, reason);

      const pipeline = mockRedis.pipeline();
      expect(pipeline.setex).toHaveBeenCalledWith(
        `token_blacklist:${jti}`,
        expect.any(Number),
        expect.stringContaining(jti)
      );
      expect(pipeline.sadd).toHaveBeenCalledWith(
        `user_blacklist:${userId}`,
        jti
      );
    });

    it('should skip blacklisting for already expired tokens', async () => {
      const jti = 'expired-jti';
      const userId = 'user-456';
      const expiresAt = new Date(Date.now() - 60000); // 1 minute ago
      const reason = 'expired';

      await blacklistManager.addToBlacklist(jti, userId, expiresAt, reason);

      // Should not call Redis operations for expired tokens
      expect(mockRedis.pipeline).not.toHaveBeenCalled();
    });

    it('should check if token is blacklisted', async () => {
      const jti = 'blacklisted-jti';

      mockRedis.get.mockResolvedValue('blacklist-entry-data');

      const isBlacklisted = await blacklistManager.isBlacklisted(jti);

      expect(isBlacklisted).toBe(true);
      expect(mockRedis.get).toHaveBeenCalledWith(`token_blacklist:${jti}`);
    });

    it('should return false for non-blacklisted tokens', async () => {
      const jti = 'valid-jti';

      mockRedis.get.mockResolvedValue(null);

      const isBlacklisted = await blacklistManager.isBlacklisted(jti);

      expect(isBlacklisted).toBe(false);
    });

    it('should fail secure on Redis errors', async () => {
      const jti = 'error-jti';

      mockRedis.get.mockRejectedValue(new Error('Redis connection failed'));

      const isBlacklisted = await blacklistManager.isBlacklisted(jti);

      // Should assume blacklisted on error for security
      expect(isBlacklisted).toBe(true);
    });

    it('should retrieve blacklist entry details', async () => {
      const jti = 'detailed-jti';
      const mockEntry: BlacklistEntry = {
        jti,
        userId: 'user-123',
        reason: 'manual_revocation',
        expiresAt: new Date(),
        blacklistedAt: new Date()
      };

      mockRedis.get.mockResolvedValue(JSON.stringify(mockEntry));

      const entry = await blacklistManager.getBlacklistEntry(jti);

      expect(entry).toEqual(mockEntry);
    });

    it('should remove token from blacklist', async () => {
      const jti = 'remove-jti';
      const userId = 'user-123';

      mockRedis.pipeline.mockReturnValue({
        del: jest.fn().mockReturnThis(),
        srem: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([])
      });

      await blacklistManager.removeFromBlacklist(jti, userId);

      const pipeline = mockRedis.pipeline();
      expect(pipeline.del).toHaveBeenCalledWith(`token_blacklist:${jti}`);
      expect(pipeline.srem).toHaveBeenCalledWith(`user_blacklist:${userId}`, jti);
    });
  });

  describe('user-level operations', () => {
    beforeEach(async () => {
      await blacklistManager.initialize();
    });

    it('should check if user has blacklisted tokens', async () => {
      const userId = 'user-with-blacklisted-tokens';

      mockRedis.scard.mockResolvedValue(3);

      const hasBlacklisted = await blacklistManager.hasBlacklistedTokens(userId);

      expect(hasBlacklisted).toBe(true);
      expect(mockRedis.scard).toHaveBeenCalledWith(`user_blacklist:${userId}`);
    });

    it('should get all blacklisted tokens for user', async () => {
      const userId = 'user-123';
      const blacklistedTokens = ['jti1', 'jti2', 'jti3'];

      mockRedis.smembers.mockResolvedValue(blacklistedTokens);

      const tokens = await blacklistManager.getUserBlacklistedTokens(userId);

      expect(tokens).toEqual(blacklistedTokens);
    });

    it('should blacklist all user tokens', async () => {
      const userId = 'bulk-blacklist-user';
      const mockTokenKeys = ['active_token:jti1', 'active_token:jti2'];

      mockRedis.keys.mockResolvedValue(mockTokenKeys);
      mockRedis.get.mockResolvedValue('token-data');

      const count = await blacklistManager.blacklistAllUserTokens(userId, 'user_logout');

      expect(count).toBe(mockTokenKeys.length);
      expect(mockRedis.keys).toHaveBeenCalledWith('active_token:*');
    });
  });

  describe('statistics and monitoring', () => {
    beforeEach(async () => {
      await blacklistManager.initialize();
    });

    it('should provide blacklist statistics', async () => {
      const blacklistKeys = ['token_blacklist:jti1', 'token_blacklist:jti2'];
      const userBlacklistKeys = ['user_blacklist:user1', 'user_blacklist:user2'];

      mockRedis.keys
        .mockResolvedValueOnce(blacklistKeys)
        .mockResolvedValueOnce(userBlacklistKeys);

      mockRedis.memory.mockResolvedValue(1024);

      const stats = await blacklistManager.getBlacklistStats();

      expect(stats.totalBlacklisted).toBe(blacklistKeys.length);
      expect(stats.userBlacklists).toBe(userBlacklistKeys.length);
      expect(stats.memoryUsage).toBeGreaterThan(0);
    });

    it('should handle errors in statistics gracefully', async () => {
      mockRedis.keys.mockRejectedValue(new Error('Redis error'));

      const stats = await blacklistManager.getBlacklistStats();

      expect(stats.totalBlacklisted).toBe(0);
      expect(stats.userBlacklists).toBe(0);
      expect(stats.memoryUsage).toBe(0);
    });
  });

  describe('cleanup operations', () => {
    beforeEach(async () => {
      await blacklistManager.initialize();
    });

    it('should cleanup expired blacklist entries', async () => {
      const mockKeys = ['token_blacklist:jti1', 'token_blacklist:jti2'];

      mockRedis.scan.mockResolvedValue(['0', mockKeys]);
      mockRedis.pipeline.mockReturnValue({
        ttl: jest.fn().mockReturnThis(),
        exec: jest.fn().mockResolvedValue([
          [null, -1], // Expired
          [null, 3600] // Valid
        ])
      });
      mockRedis.del.mockResolvedValue(1);

      const cleanedCount = await blacklistManager.cleanupExpiredTokens();

      expect(cleanedCount).toBe(1);
      expect(mockRedis.del).toHaveBeenCalledWith('token_blacklist:jti1');
    });

    it('should perform periodic cleanup', async () => {
      jest.useFakeTimers();

      const cleanupSpy = jest.spyOn(blacklistManager, 'cleanupExpiredTokens');
      cleanupSpy.mockResolvedValue(0);

      await blacklistManager.initialize();

      // Fast forward time to trigger cleanup
      jest.advanceTimersByTime(200);

      expect(cleanupSpy).toHaveBeenCalled();

      jest.useRealTimers();
    });
  });

  describe('error handling', () => {
    beforeEach(async () => {
      await blacklistManager.initialize();
    });

    it('should handle Redis pipeline failures gracefully', async () => {
      const jti = 'failing-jti';
      const userId = 'user-123';
      const expiresAt = new Date(Date.now() + 60000);

      mockRedis.pipeline.mockReturnValue({
        setex: jest.fn().mockReturnThis(),
        sadd: jest.fn().mockReturnThis(),
        expire: jest.fn().mockReturnThis(),
        exec: jest.fn().mockRejectedValue(new Error('Pipeline failed'))
      });

      await expect(
        blacklistManager.addToBlacklist(jti, userId, expiresAt, 'test')
      ).rejects.toThrow('Failed to blacklist token');
    });

    it('should handle scan errors during cleanup', async () => {
      mockRedis.scan.mockRejectedValue(new Error('Scan failed'));

      const cleanedCount = await blacklistManager.cleanupExpiredTokens();

      expect(cleanedCount).toBe(0);
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      const cleanupSpy = jest.spyOn(blacklistManager, 'cleanupExpiredTokens');
      cleanupSpy.mockResolvedValue(5);

      await blacklistManager.initialize();
      await blacklistManager.shutdown();

      // Should perform final cleanup
      expect(cleanupSpy).toHaveBeenCalled();
    });
  });
});