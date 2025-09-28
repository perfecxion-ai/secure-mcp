import { redis } from '../database/redis';
import { logger } from '../utils/logger';
import * as crypto from 'crypto';

export interface DistributedLock {
  key: string;
  value: string;
  ttl: number;
  acquired: boolean;
  acquiredAt?: Date;
}

export interface LockOptions {
  ttl?: number;
  retryDelay?: number;
  maxRetries?: number;
  jitter?: boolean;
}

/**
 * Redis-based distributed lock implementation with proper timeouts and cleanup
 * Ensures atomic operations across multiple server instances
 */
export class RedisDistributedLock {
  private readonly lockPrefix = 'distributed_lock:';
  private readonly defaultTTL = 5000; // 5 seconds
  private readonly defaultRetryDelay = 50; // 50ms
  private readonly defaultMaxRetries = 10;

  /**
   * Acquire a distributed lock with automatic retry and timeout
   */
  async acquireLock(
    lockKey: string,
    options: LockOptions = {}
  ): Promise<DistributedLock | null> {
    const {
      ttl = this.defaultTTL,
      retryDelay = this.defaultRetryDelay,
      maxRetries = this.defaultMaxRetries,
      jitter = true
    } = options;

    const key = `${this.lockPrefix}${lockKey}`;
    const value = this.generateLockValue();
    let attempts = 0;

    while (attempts < maxRetries) {
      try {
        const acquired = await this.tryAcquire(key, value, ttl);

        if (acquired) {
          const lock: DistributedLock = {
            key,
            value,
            ttl,
            acquired: true,
            acquiredAt: new Date()
          };

          logger.debug('Distributed lock acquired', {
            lockKey: key,
            value,
            ttl,
            attempts: attempts + 1
          });

          return lock;
        }

        // Apply jitter to retry delay to avoid thundering herd
        const delay = jitter
          ? retryDelay + Math.random() * retryDelay
          : retryDelay;

        await this.sleep(delay);
        attempts++;

      } catch (error) {
        logger.error('Error acquiring distributed lock', {
          error: error.message,
          lockKey: key,
          attempts: attempts + 1
        });

        attempts++;
        if (attempts >= maxRetries) {
          throw new Error(`Failed to acquire lock after ${maxRetries} attempts: ${error.message}`);
        }

        await this.sleep(retryDelay);
      }
    }

    logger.warn('Failed to acquire distributed lock after max retries', {
      lockKey: key,
      maxRetries
    });

    return null;
  }

  /**
   * Release a distributed lock safely
   */
  async releaseLock(lock: DistributedLock): Promise<boolean> {
    if (!lock.acquired) {
      logger.warn('Attempted to release non-acquired lock', { lockKey: lock.key });
      return false;
    }

    try {
      // Use Lua script to ensure atomic compare-and-delete
      const script = `
        local lockKey = KEYS[1]
        local expectedValue = ARGV[1]
        local currentValue = redis.call("GET", lockKey)

        if currentValue == expectedValue then
          return redis.call("DEL", lockKey)
        else
          return 0
        end
      `;

      const result = await redis.eval(script, 1, lock.key, lock.value);
      const released = result === 1;

      if (released) {
        lock.acquired = false;
        logger.debug('Distributed lock released', {
          lockKey: lock.key,
          value: lock.value
        });
      } else {
        logger.warn('Failed to release lock - value mismatch or already expired', {
          lockKey: lock.key,
          value: lock.value
        });
      }

      return released;

    } catch (error) {
      logger.error('Error releasing distributed lock', {
        error: error.message,
        lockKey: lock.key,
        value: lock.value
      });
      return false;
    }
  }

  /**
   * Extend lock TTL if still owned
   */
  async extendLock(lock: DistributedLock, newTTL: number): Promise<boolean> {
    if (!lock.acquired) {
      return false;
    }

    try {
      const script = `
        local lockKey = KEYS[1]
        local expectedValue = ARGV[1]
        local newTTL = tonumber(ARGV[2])
        local currentValue = redis.call("GET", lockKey)

        if currentValue == expectedValue then
          return redis.call("EXPIRE", lockKey, newTTL)
        else
          return 0
        end
      `;

      const result = await redis.eval(script, 1, lock.key, lock.value, Math.floor(newTTL / 1000));
      const extended = result === 1;

      if (extended) {
        lock.ttl = newTTL;
        logger.debug('Lock TTL extended', {
          lockKey: lock.key,
          newTTL
        });
      }

      return extended;

    } catch (error) {
      logger.error('Error extending lock TTL', {
        error: error.message,
        lockKey: lock.key,
        newTTL
      });
      return false;
    }
  }

  /**
   * Check if lock is still valid and owned
   */
  async isLockValid(lock: DistributedLock): Promise<boolean> {
    if (!lock.acquired) {
      return false;
    }

    try {
      const currentValue = await redis.get(lock.key);
      return currentValue === lock.value;
    } catch (error) {
      logger.error('Error checking lock validity', {
        error: error.message,
        lockKey: lock.key
      });
      return false;
    }
  }

  /**
   * Get information about current lock holder
   */
  async getLockInfo(lockKey: string): Promise<{
    isLocked: boolean;
    ttl: number;
    value?: string;
  }> {
    const key = `${this.lockPrefix}${lockKey}`;

    try {
      const [value, ttl] = await Promise.all([
        redis.get(key),
        redis.ttl(key)
      ]);

      return {
        isLocked: value !== null,
        ttl: ttl > 0 ? ttl * 1000 : 0, // Convert to milliseconds
        value: value || undefined
      };
    } catch (error) {
      logger.error('Error getting lock info', {
        error: error.message,
        lockKey: key
      });
      return {
        isLocked: false,
        ttl: 0
      };
    }
  }

  /**
   * Force release a lock (use with caution)
   */
  async forceReleaseLock(lockKey: string): Promise<boolean> {
    const key = `${this.lockPrefix}${lockKey}`;

    try {
      const result = await redis.del(key);
      const released = result === 1;

      if (released) {
        logger.warn('Lock force-released', { lockKey: key });
      }

      return released;
    } catch (error) {
      logger.error('Error force-releasing lock', {
        error: error.message,
        lockKey: key
      });
      return false;
    }
  }

  /**
   * Cleanup expired locks (maintenance operation)
   */
  async cleanupExpiredLocks(): Promise<number> {
    try {
      const pattern = `${this.lockPrefix}*`;
      const keys = await redis.keys(pattern);

      if (keys.length === 0) {
        return 0;
      }

      // Check TTL for each key and delete expired ones
      const pipeline = redis.pipeline();
      for (const key of keys) {
        pipeline.ttl(key);
      }

      const ttlResults = await pipeline.exec();
      const expiredKeys: string[] = [];

      ttlResults?.forEach((result, index) => {
        if (result && result[1] === -1) { // TTL -1 means no expiration set
          expiredKeys.push(keys[index]);
        }
      });

      if (expiredKeys.length > 0) {
        const deletedCount = await redis.del(...expiredKeys);
        logger.info('Cleaned up expired locks', {
          cleanedCount: deletedCount,
          totalChecked: keys.length
        });
        return deletedCount;
      }

      return 0;
    } catch (error) {
      logger.error('Error cleaning up expired locks', { error: error.message });
      return 0;
    }
  }

  private async tryAcquire(key: string, value: string, ttlMs: number): Promise<boolean> {
    const ttlSeconds = Math.ceil(ttlMs / 1000);
    const result = await redis.set(key, value, 'PX', ttlMs, 'NX');
    return result === 'OK';
  }

  private generateLockValue(): string {
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    const processId = process.pid;
    return `${timestamp}-${processId}-${random}`;
  }

  private async sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Global instance for distributed locking
 */
export const distributedLock = new RedisDistributedLock();