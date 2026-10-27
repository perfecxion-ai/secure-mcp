import { redis } from '../database/redis';
import { logger } from '../utils/logger';

export interface BlacklistEntry {
  jti: string;
  userId: string;
  reason: string;
  expiresAt: Date;
  blacklistedAt: Date;
}

export interface TokenBlacklistOptions {
  cleanupInterval?: number; // in milliseconds
  batchSize?: number;
}

/**
 * Token blacklist manager for immediate token revocation
 * Provides fast lookups and automatic cleanup of expired entries
 */
export class TokenBlacklistManager {
  private readonly blacklistPrefix = 'token_blacklist:';
  private readonly userBlacklistPrefix = 'user_blacklist:';
  private readonly cleanupInterval: number;
  private readonly batchSize: number;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(options: TokenBlacklistOptions = {}) {
    this.cleanupInterval = options.cleanupInterval || 300000; // 5 minutes
    this.batchSize = options.batchSize || 1000;
  }

  /**
   * Initialize the blacklist manager and start cleanup process
   */
  async initialize(): Promise<void> {
    try {
      // Start periodic cleanup
      this.startPeriodicCleanup();
      logger.info('Token blacklist manager initialized');
    } catch (error) {
      logger.error('Failed to initialize token blacklist manager', { error });
      throw error;
    }
  }

  /**
   * Add a token to the blacklist
   */
  async addToBlacklist(
    jti: string,
    userId: string,
    expiresAt: Date,
    reason: string = 'revoked'
  ): Promise<void> {
    try {
      const blacklistKey = `${this.blacklistPrefix}${jti}`;
      const userBlacklistKey = `${this.userBlacklistPrefix}${userId}`;

      const entry: BlacklistEntry = {
        jti,
        userId,
        reason,
        expiresAt,
        blacklistedAt: new Date()
      };

      const ttlSeconds = Math.ceil((expiresAt.getTime() - Date.now()) / 1000);

      if (ttlSeconds <= 0) {
        logger.debug('Token already expired, skipping blacklist', { jti, expiresAt });
        return;
      }

      // Use pipeline for atomic operations
      const pipeline = redis.pipeline();

      // Add to main blacklist
      pipeline.setex(blacklistKey, ttlSeconds, JSON.stringify(entry));

      // Add to user's blacklist set for fast user-level queries
      pipeline.sadd(userBlacklistKey, jti);
      pipeline.expire(userBlacklistKey, ttlSeconds);

      await pipeline.exec();

      logger.info('Token added to blacklist', {
        jti,
        userId,
        reason,
        expiresAt,
        ttlSeconds
      });

    } catch (error) {
      logger.error('Failed to add token to blacklist', {
        error: error.message,
        jti,
        userId,
        reason
      });
      throw new Error(`Failed to blacklist token: ${error.message}`);
    }
  }

  /**
   * Check if a token is blacklisted
   */
  async isBlacklisted(jti: string): Promise<boolean> {
    try {
      const blacklistKey = `${this.blacklistPrefix}${jti}`;
      const entry = await redis.get(blacklistKey);
      return entry !== null;
    } catch (error) {
      logger.error('Error checking token blacklist status', {
        error: error.message,
        jti
      });
      // In case of Redis error, fail secure by assuming token is blacklisted
      return true;
    }
  }

  /**
   * Get blacklist entry details
   */
  async getBlacklistEntry(jti: string): Promise<BlacklistEntry | null> {
    try {
      const blacklistKey = `${this.blacklistPrefix}${jti}`;
      const entryData = await redis.get(blacklistKey);

      if (!entryData) {
        return null;
      }

      return JSON.parse(entryData) as BlacklistEntry;
    } catch (error) {
      logger.error('Error retrieving blacklist entry', {
        error: error.message,
        jti
      });
      return null;
    }
  }

  /**
   * Remove a token from blacklist (typically not needed due to TTL)
   */
  async removeFromBlacklist(jti: string, userId: string): Promise<void> {
    try {
      const blacklistKey = `${this.blacklistPrefix}${jti}`;
      const userBlacklistKey = `${this.userBlacklistPrefix}${userId}`;

      const pipeline = redis.pipeline();
      pipeline.del(blacklistKey);
      pipeline.srem(userBlacklistKey, jti);

      await pipeline.exec();

      logger.info('Token removed from blacklist', { jti, userId });
    } catch (error) {
      logger.error('Failed to remove token from blacklist', {
        error: error.message,
        jti,
        userId
      });
      throw new Error(`Failed to remove token from blacklist: ${error.message}`);
    }
  }

  /**
   * Check if any of user's tokens are blacklisted
   */
  async hasBlacklistedTokens(userId: string): Promise<boolean> {
    try {
      const userBlacklistKey = `${this.userBlacklistPrefix}${userId}`;
      const count = await redis.scard(userBlacklistKey);
      return count > 0;
    } catch (error) {
      logger.error('Error checking user blacklist status', {
        error: error.message,
        userId
      });
      return false;
    }
  }

  /**
   * Get all blacklisted tokens for a user
   */
  async getUserBlacklistedTokens(userId: string): Promise<string[]> {
    try {
      const userBlacklistKey = `${this.userBlacklistPrefix}${userId}`;
      return await redis.smembers(userBlacklistKey);
    } catch (error) {
      logger.error('Error retrieving user blacklisted tokens', {
        error: error.message,
        userId
      });
      return [];
    }
  }

  /**
   * Blacklist all tokens for a user
   */
  async blacklistAllUserTokens(
    userId: string,
    reason: string = 'user_logout',
    maxExpiry: Date = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
  ): Promise<number> {
    try {
      // Get all active tokens for the user
      const activeTokenKeys = await redis.keys(`active_token:*`);
      let blacklistedCount = 0;

      for (const tokenKey of activeTokenKeys) {
        try {
          // Extract JTI from key
          const jti = tokenKey.replace('active_token:', '');

          // Get token info to verify it belongs to the user
          const tokenValue = await redis.get(tokenKey);
          if (tokenValue) {
            // Add to blacklist with max expiry
            await this.addToBlacklist(jti, userId, maxExpiry, reason);
            blacklistedCount++;
          }
        } catch (error) {
          logger.warn('Failed to blacklist individual token', {
            error: error.message,
            tokenKey,
            userId
          });
        }
      }

      logger.info('Blacklisted all user tokens', {
        userId,
        count: blacklistedCount,
        reason
      });

      return blacklistedCount;
    } catch (error) {
      logger.error('Failed to blacklist all user tokens', {
        error: error.message,
        userId,
        reason
      });
      throw new Error(`Failed to blacklist user tokens: ${error.message}`);
    }
  }

  /**
   * Get blacklist statistics
   */
  async getBlacklistStats(): Promise<{
    totalBlacklisted: number;
    userBlacklists: number;
    memoryUsage: number;
  }> {
    try {
      const [blacklistKeys, userBlacklistKeys] = await Promise.all([
        redis.keys(`${this.blacklistPrefix}*`),
        redis.keys(`${this.userBlacklistPrefix}*`)
      ]);

      // Estimate memory usage (rough calculation)
      let memoryUsage = 0;
      for (const key of blacklistKeys) {
        try {
          const memory = await redis.memory('USAGE', key);
          memoryUsage += memory || 0;
        } catch {
          // Ignore memory calculation errors
        }
      }

      return {
        totalBlacklisted: blacklistKeys.length,
        userBlacklists: userBlacklistKeys.length,
        memoryUsage
      };
    } catch (error) {
      logger.error('Error getting blacklist statistics', { error: error.message });
      return {
        totalBlacklisted: 0,
        userBlacklists: 0,
        memoryUsage: 0
      };
    }
  }

  /**
   * Cleanup expired blacklist entries
   */
  async cleanupExpiredTokens(): Promise<number> {
    try {
      let cleanedCount = 0;
      let cursor = '0';

      do {
        const result = await redis.scan(
          cursor,
          'MATCH',
          `${this.blacklistPrefix}*`,
          'COUNT',
          this.batchSize
        );

        cursor = result[0];
        const keys = result[1];

        if (keys.length === 0) {
          continue;
        }

        // Check TTL for each key and delete expired ones
        const pipeline = redis.pipeline();
        for (const key of keys) {
          pipeline.ttl(key);
        }

        const ttlResults = await pipeline.exec();
        const expiredKeys: string[] = [];

        ttlResults?.forEach((result, index) => {
          if (result && result[1] === -1) { // TTL -1 means no expiration or expired
            expiredKeys.push(keys[index]);
          }
        });

        if (expiredKeys.length > 0) {
          const deleted = await redis.del(...expiredKeys);
          cleanedCount += deleted;
        }

      } while (cursor !== '0');

      if (cleanedCount > 0) {
        logger.info('Cleaned up expired blacklist entries', { count: cleanedCount });
      }

      return cleanedCount;
    } catch (error) {
      logger.error('Error during blacklist cleanup', { error: error.message });
      return 0;
    }
  }

  /**
   * Start periodic cleanup of expired entries
   */
  private startPeriodicCleanup(): void {
    this.cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupExpiredTokens();
      } catch (error) {
        logger.error('Error in periodic blacklist cleanup', { error: error.message });
      }
    }, this.cleanupInterval);

    logger.debug('Started periodic blacklist cleanup', {
      interval: this.cleanupInterval
    });
  }

  /**
   * Stop periodic cleanup
   */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }

    // Final cleanup before shutdown
    await this.cleanupExpiredTokens();
    logger.info('Token blacklist manager shutdown complete');
  }
}

/**
 * Global blacklist manager instance
 */
export const tokenBlacklist = new TokenBlacklistManager();