import { redis } from '../database/redis';
import { logger } from '../utils/logger';

export interface RateLimitOptions {
  windowSizeMs: number;
  maxRequests: number;
  keyPrefix?: string;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: Date;
  totalHits: number;
}

export interface RateLimitConfig {
  validate: RateLimitOptions;
  refresh: RateLimitOptions;
  generate: RateLimitOptions;
  revoke: RateLimitOptions;
}

/**
 * Token operation rate limiter using sliding window algorithm
 * Prevents abuse of token validation, refresh, and generation endpoints
 */
export class TokenRateLimiter {
  private readonly defaultConfig: RateLimitConfig = {
    validate: {
      windowSizeMs: 60000, // 1 minute window
      maxRequests: 1000,   // 1000 validations per minute per user
      keyPrefix: 'rate_limit:validate'
    },
    refresh: {
      windowSizeMs: 300000, // 5 minute window
      maxRequests: 10,      // 10 refreshes per 5 minutes per user
      keyPrefix: 'rate_limit:refresh'
    },
    generate: {
      windowSizeMs: 300000, // 5 minute window
      maxRequests: 5,       // 5 generations per 5 minutes per user
      keyPrefix: 'rate_limit:generate'
    },
    revoke: {
      windowSizeMs: 60000,  // 1 minute window
      maxRequests: 20,      // 20 revocations per minute per user
      keyPrefix: 'rate_limit:revoke'
    }
  };

  constructor(private config: Partial<RateLimitConfig> = {}) {
    this.config = { ...this.defaultConfig, ...config };
  }

  /**
   * Check rate limit for token validation operations
   */
  async checkValidationLimit(userId: string): Promise<RateLimitResult> {
    return this.checkRateLimit(userId, 'validate');
  }

  /**
   * Check rate limit for token refresh operations
   */
  async checkRefreshLimit(userId: string): Promise<RateLimitResult> {
    return this.checkRateLimit(userId, 'refresh');
  }

  /**
   * Check rate limit for token generation operations
   */
  async checkGenerationLimit(userId: string): Promise<RateLimitResult> {
    return this.checkRateLimit(userId, 'generate');
  }

  /**
   * Check rate limit for token revocation operations
   */
  async checkRevocationLimit(userId: string): Promise<RateLimitResult> {
    return this.checkRateLimit(userId, 'revoke');
  }

  /**
   * Generic rate limit check using sliding window algorithm
   */
  async checkRateLimit(
    userId: string,
    operation: keyof RateLimitConfig
  ): Promise<RateLimitResult> {
    const config = this.config[operation]!;
    const key = `${config.keyPrefix}:${userId}`;
    const now = Date.now();
    const windowStart = now - config.windowSizeMs;

    try {
      // Use Lua script for atomic sliding window rate limiting
      const script = `
        local key = KEYS[1]
        local window_start = tonumber(ARGV[1])
        local current_time = tonumber(ARGV[2])
        local max_requests = tonumber(ARGV[3])
        local window_size = tonumber(ARGV[4])

        -- Remove expired entries
        redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

        -- Count current requests in window
        local current_count = redis.call('ZCARD', key)

        -- Calculate remaining requests
        local remaining = math.max(0, max_requests - current_count)

        if current_count < max_requests then
          -- Add current request
          redis.call('ZADD', key, current_time, current_time .. ':' .. math.random())

          -- Set expiration for cleanup
          redis.call('EXPIRE', key, math.ceil(window_size / 1000))

          return {1, remaining - 1, current_count + 1}
        else
          return {0, remaining, current_count}
        end
      `;

      const result = await redis.eval(
        script,
        1,
        key,
        windowStart.toString(),
        now.toString(),
        config.maxRequests.toString(),
        config.windowSizeMs.toString()
      ) as [number, number, number];

      const [allowed, remaining, totalHits] = result;

      const rateLimitResult: RateLimitResult = {
        allowed: allowed === 1,
        remaining: Math.max(0, remaining),
        resetTime: new Date(now + config.windowSizeMs),
        totalHits
      };

      if (!rateLimitResult.allowed) {
        logger.warn('Rate limit exceeded', {
          userId,
          operation,
          totalHits,
          maxRequests: config.maxRequests,
          windowSizeMs: config.windowSizeMs
        });
      }

      return rateLimitResult;

    } catch (error) {
      logger.error('Rate limit check failed', {
        error: error.message,
        userId,
        operation,
        key
      });

      // On Redis error, allow the request but log the issue
      return {
        allowed: true,
        remaining: config.maxRequests - 1,
        resetTime: new Date(now + config.windowSizeMs),
        totalHits: 1
      };
    }
  }

  /**
   * Reset rate limit for a user and operation
   */
  async resetRateLimit(
    userId: string,
    operation: keyof RateLimitConfig
  ): Promise<void> {
    const config = this.config[operation]!;
    const key = `${config.keyPrefix}:${userId}`;

    try {
      await redis.del(key);
      logger.info('Rate limit reset', { userId, operation });
    } catch (error) {
      logger.error('Failed to reset rate limit', {
        error: error.message,
        userId,
        operation
      });
      throw new Error(`Failed to reset rate limit: ${error.message}`);
    }
  }

  /**
   * Get current rate limit status for a user
   */
  async getRateLimitStatus(
    userId: string,
    operation: keyof RateLimitConfig
  ): Promise<{
    requestCount: number;
    remaining: number;
    resetTime: Date;
  }> {
    const config = this.config[operation]!;
    const key = `${config.keyPrefix}:${userId}`;
    const now = Date.now();
    const windowStart = now - config.windowSizeMs;

    try {
      // Clean expired entries and count current requests
      await redis.zremrangebyscore(key, '-inf', windowStart);
      const requestCount = await redis.zcard(key);

      return {
        requestCount,
        remaining: Math.max(0, config.maxRequests - requestCount),
        resetTime: new Date(now + config.windowSizeMs)
      };
    } catch (error) {
      logger.error('Failed to get rate limit status', {
        error: error.message,
        userId,
        operation
      });

      return {
        requestCount: 0,
        remaining: config.maxRequests,
        resetTime: new Date(now + config.windowSizeMs)
      };
    }
  }

  /**
   * Increment rate limit counter without checking limit
   * Useful for tracking successful operations
   */
  async incrementCounter(
    userId: string,
    operation: keyof RateLimitConfig
  ): Promise<void> {
    const config = this.config[operation]!;
    const key = `${config.keyPrefix}:${userId}`;
    const now = Date.now();

    try {
      const script = `
        local key = KEYS[1]
        local current_time = tonumber(ARGV[1])
        local window_size = tonumber(ARGV[2])
        local window_start = current_time - window_size

        -- Remove expired entries
        redis.call('ZREMRANGEBYSCORE', key, '-inf', window_start)

        -- Add current request
        redis.call('ZADD', key, current_time, current_time .. ':' .. math.random())

        -- Set expiration for cleanup
        redis.call('EXPIRE', key, math.ceil(window_size / 1000))

        return redis.call('ZCARD', key)
      `;

      await redis.eval(
        script,
        1,
        key,
        now.toString(),
        config.windowSizeMs.toString()
      );

    } catch (error) {
      logger.error('Failed to increment rate limit counter', {
        error: error.message,
        userId,
        operation
      });
    }
  }

  /**
   * Get rate limit statistics for monitoring
   */
  async getGlobalStats(): Promise<{
    activeUsers: Record<keyof RateLimitConfig, number>;
    totalRequests: Record<keyof RateLimitConfig, number>;
  }> {
    try {
      const stats = {
        activeUsers: {} as Record<keyof RateLimitConfig, number>,
        totalRequests: {} as Record<keyof RateLimitConfig, number>
      };

      for (const operation of Object.keys(this.config) as Array<keyof RateLimitConfig>) {
        const config = this.config[operation]!;
        const pattern = `${config.keyPrefix}:*`;
        const keys = await redis.keys(pattern);

        stats.activeUsers[operation] = keys.length;

        // Count total requests across all users
        let totalRequests = 0;
        for (const key of keys) {
          try {
            const count = await redis.zcard(key);
            totalRequests += count;
          } catch {
            // Ignore individual key errors
          }
        }
        stats.totalRequests[operation] = totalRequests;
      }

      return stats;
    } catch (error) {
      logger.error('Failed to get global rate limit stats', { error: error.message });
      return {
        activeUsers: {} as Record<keyof RateLimitConfig, number>,
        totalRequests: {} as Record<keyof RateLimitConfig, number>
      };
    }
  }

  /**
   * Cleanup expired rate limit entries
   */
  async cleanupExpiredEntries(): Promise<number> {
    try {
      let cleanedCount = 0;

      for (const operation of Object.keys(this.config) as Array<keyof RateLimitConfig>) {
        const config = this.config[operation]!;
        const pattern = `${config.keyPrefix}:*`;
        const keys = await redis.keys(pattern);

        for (const key of keys) {
          try {
            const now = Date.now();
            const windowStart = now - config.windowSizeMs;

            const removed = await redis.zremrangebyscore(key, '-inf', windowStart);
            cleanedCount += removed;

            // Remove empty keys
            const count = await redis.zcard(key);
            if (count === 0) {
              await redis.del(key);
            }
          } catch (error) {
            logger.warn('Failed to cleanup rate limit key', {
              error: error.message,
              key
            });
          }
        }
      }

      if (cleanedCount > 0) {
        logger.debug('Cleaned up expired rate limit entries', { count: cleanedCount });
      }

      return cleanedCount;
    } catch (error) {
      logger.error('Error during rate limit cleanup', { error: error.message });
      return 0;
    }
  }

  /**
   * Block a user from all token operations for a specified duration
   */
  async blockUser(
    userId: string,
    durationMs: number,
    reason: string = 'security_violation'
  ): Promise<void> {
    try {
      const blockKey = `rate_limit:blocked:${userId}`;
      const blockExpiry = Math.ceil(durationMs / 1000);

      await redis.setex(blockKey, blockExpiry, JSON.stringify({
        blockedAt: new Date().toISOString(),
        reason,
        expiresAt: new Date(Date.now() + durationMs).toISOString()
      }));

      logger.warn('User blocked from token operations', {
        userId,
        durationMs,
        reason
      });
    } catch (error) {
      logger.error('Failed to block user', {
        error: error.message,
        userId,
        durationMs,
        reason
      });
      throw new Error(`Failed to block user: ${error.message}`);
    }
  }

  /**
   * Check if a user is currently blocked
   */
  async isUserBlocked(userId: string): Promise<boolean> {
    try {
      const blockKey = `rate_limit:blocked:${userId}`;
      const blockData = await redis.get(blockKey);
      return blockData !== null;
    } catch (error) {
      logger.error('Failed to check user block status', {
        error: error.message,
        userId
      });
      // In case of error, assume user is not blocked
      return false;
    }
  }

  /**
   * Unblock a user
   */
  async unblockUser(userId: string): Promise<void> {
    try {
      const blockKey = `rate_limit:blocked:${userId}`;
      await redis.del(blockKey);

      logger.info('User unblocked', { userId });
    } catch (error) {
      logger.error('Failed to unblock user', {
        error: error.message,
        userId
      });
      throw new Error(`Failed to unblock user: ${error.message}`);
    }
  }
}

/**
 * Global rate limiter instance
 */
export const tokenRateLimiter = new TokenRateLimiter();