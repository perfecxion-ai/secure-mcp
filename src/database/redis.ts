import Redis from 'ioredis';
import { config } from '../config/config';
import { logger } from '../utils/logger';

// Redis client instances
let redis: Redis;
let redisSubscriber: Redis;
let redisPublisher: Redis;

/**
 * Initialize Redis connections
 */
export const initializeRedis = async (): Promise<void> => {
  try {
    // Main Redis client
    redis = new Redis(config.redis.url, {
      password: config.redis.password,
      db: config.redis.db,
      connectTimeout: config.redis.connectTimeout,
      commandTimeout: config.redis.commandTimeout,
      retryDelayOnFailure: config.redis.retryDelayOnFailure,
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      keepAlive: 30000,
      keyPrefix: 'mcp:',
      enableOfflineQueue: false,
      maxLoadingTimeout: 5000,
      enableReadyCheck: true,
    });

    // Subscriber client (separate connection for pub/sub)
    redisSubscriber = new Redis(config.redis.url, {
      password: config.redis.password,
      db: config.redis.db,
      connectTimeout: config.redis.connectTimeout,
      lazyConnect: true,
      enableOfflineQueue: false,
      keyPrefix: 'mcp:',
    });

    // Publisher client (separate connection for pub/sub)
    redisPublisher = new Redis(config.redis.url, {
      password: config.redis.password,
      db: config.redis.db,
      connectTimeout: config.redis.connectTimeout,
      lazyConnect: true,
      enableOfflineQueue: false,
      keyPrefix: 'mcp:',
    });

    // Set up event listeners for main client
    redis.on('connect', () => {
      logger.info('Redis connected');
    });

    redis.on('ready', () => {
      logger.info('Redis ready for commands');
    });

    redis.on('error', (error) => {
      logger.error('Redis error', { error });
    });

    redis.on('close', () => {
      logger.warn('Redis connection closed');
    });

    redis.on('reconnecting', (delay) => {
      logger.info('Redis reconnecting', { delay });
    });

    redis.on('end', () => {
      logger.warn('Redis connection ended');
    });

    // Set up retry strategy
    redis.on('retryDelayOnFailure', (error, delay) => {
      logger.warn('Redis retry delay', { error: error.message, delay });
      return Math.min(delay * 2, config.redis.maxRetryDelay);
    });

    // Connect all clients
    await Promise.all([
      redis.connect(),
      redisSubscriber.connect(),
      redisPublisher.connect(),
    ]);

    // Test connection with a simple command
    await redis.ping();

    logger.info('Redis initialized successfully', {
      url: config.redis.url.replace(/\/\/.*@/, '//***@'), // Hide credentials in logs
      db: config.redis.db,
      connectTimeout: config.redis.connectTimeout,
    });

    // Set up health monitoring
    setupRedisHealthCheck();

  } catch (error) {
    logger.error('Failed to initialize Redis', { error });
    throw new Error(`Redis initialization failed: ${error.message}`);
  }
};

/**
 * Gracefully disconnect Redis connections
 */
export const disconnectRedis = async (): Promise<void> => {
  try {
    await Promise.all([
      redis?.quit(),
      redisSubscriber?.quit(),
      redisPublisher?.quit(),
    ]);

    logger.info('Redis connections closed successfully');
  } catch (error) {
    logger.error('Error closing Redis connections', { error });
  }
};

/**
 * Get Redis health status
 */
export const getRedisHealth = async (): Promise<{
  status: 'healthy' | 'unhealthy';
  latency: number;
  memory: any;
  connections: number;
  error?: string;
}> => {
  try {
    const startTime = Date.now();
    await redis.ping();
    const endTime = Date.now();

    // Get memory info
    const memoryInfo = await redis.memory('USAGE', 'test-key');

    // Get connection info
    const info = await redis.info('clients');
    const connections = parseInt(info.split('\r\n')
      .find(line => line.startsWith('connected_clients:'))
      ?.split(':')[1] || '0', 10);

    return {
      status: 'healthy',
      latency: endTime - startTime,
      memory: memoryInfo,
      connections,
    };
  } catch (error) {
    logger.error('Redis health check failed', { error });
    return {
      status: 'unhealthy',
      latency: -1,
      memory: null,
      connections: -1,
      error: error.message,
    };
  }
};

/**
 * Redis cache wrapper with automatic serialization
 */
export class RedisCache {
  private static defaultTTL = 3600; // 1 hour

  /**
   * Set a key-value pair with optional TTL
   */
  static async set(key: string, value: any, ttl: number = this.defaultTTL): Promise<void> {
    try {
      const serialized = typeof value === 'string' ? value : JSON.stringify(value);
      await redis.setex(key, ttl, serialized);
    } catch (error) {
      logger.error('Redis set error', { error, key });
      throw error;
    }
  }

  /**
   * Get a value by key with automatic deserialization
   */
  static async get<T = any>(key: string): Promise<T | null> {
    try {
      const value = await redis.get(key);
      if (value === null) return null;

      try {
        return JSON.parse(value);
      } catch {
        return value as T;
      }
    } catch (error) {
      logger.error('Redis get error', { error, key });
      throw error;
    }
  }

  /**
   * Delete a key
   */
  static async del(key: string): Promise<number> {
    try {
      return await redis.del(key);
    } catch (error) {
      logger.error('Redis del error', { error, key });
      throw error;
    }
  }

  /**
   * Check if key exists
   */
  static async exists(key: string): Promise<boolean> {
    try {
      const result = await redis.exists(key);
      return result === 1;
    } catch (error) {
      logger.error('Redis exists error', { error, key });
      throw error;
    }
  }

  /**
   * Set with expiration time
   */
  static async expire(key: string, ttl: number): Promise<boolean> {
    try {
      const result = await redis.expire(key, ttl);
      return result === 1;
    } catch (error) {
      logger.error('Redis expire error', { error, key, ttl });
      throw error;
    }
  }

  /**
   * Get remaining TTL
   */
  static async ttl(key: string): Promise<number> {
    try {
      return await redis.ttl(key);
    } catch (error) {
      logger.error('Redis ttl error', { error, key });
      throw error;
    }
  }

  /**
   * Increment counter
   */
  static async incr(key: string, ttl?: number): Promise<number> {
    try {
      const result = await redis.incr(key);
      if (ttl && result === 1) {
        await redis.expire(key, ttl);
      }
      return result;
    } catch (error) {
      logger.error('Redis incr error', { error, key });
      throw error;
    }
  }

  /**
   * Decrement counter
   */
  static async decr(key: string): Promise<number> {
    try {
      return await redis.decr(key);
    } catch (error) {
      logger.error('Redis decr error', { error, key });
      throw error;
    }
  }

  /**
   * Get multiple keys
   */
  static async mget<T = any>(keys: string[]): Promise<(T | null)[]> {
    try {
      const values = await redis.mget(...keys);
      return values.map(value => {
        if (value === null) return null;
        try {
          return JSON.parse(value);
        } catch {
          return value as T;
        }
      });
    } catch (error) {
      logger.error('Redis mget error', { error, keys });
      throw error;
    }
  }

  /**
   * Set multiple key-value pairs
   */
  static async mset(keyValues: Record<string, any>, ttl?: number): Promise<void> {
    try {
      const pipeline = redis.pipeline();

      Object.entries(keyValues).forEach(([key, value]) => {
        const serialized = typeof value === 'string' ? value : JSON.stringify(value);
        if (ttl) {
          pipeline.setex(key, ttl, serialized);
        } else {
          pipeline.set(key, serialized);
        }
      });

      await pipeline.exec();
    } catch (error) {
      logger.error('Redis mset error', { error, keyCount: Object.keys(keyValues).length });
      throw error;
    }
  }

  /**
   * Get keys by pattern
   */
  static async keys(pattern: string): Promise<string[]> {
    try {
      return await redis.keys(pattern);
    } catch (error) {
      logger.error('Redis keys error', { error, pattern });
      throw error;
    }
  }

  /**
   * Scan keys by pattern (memory efficient)
   */
  static async scan(pattern: string, count: number = 100): Promise<string[]> {
    try {
      const keys: string[] = [];
      const stream = redis.scanStream({
        match: pattern,
        count,
      });

      return new Promise((resolve, reject) => {
        stream.on('data', (batch: string[]) => {
          keys.push(...batch);
        });

        stream.on('end', () => {
          resolve(keys);
        });

        stream.on('error', (error) => {
          reject(error);
        });
      });
    } catch (error) {
      logger.error('Redis scan error', { error, pattern });
      throw error;
    }
  }
}

/**
 * Redis pub/sub utilities
 */
export class RedisPubSub {
  /**
   * Publish message to channel
   */
  static async publish(channel: string, message: any): Promise<number> {
    try {
      const serialized = typeof message === 'string' ? message : JSON.stringify(message);
      return await redisPublisher.publish(channel, serialized);
    } catch (error) {
      logger.error('Redis publish error', { error, channel });
      throw error;
    }
  }

  /**
   * Subscribe to channel
   */
  static async subscribe(channel: string, callback: (message: any) => void): Promise<void> {
    try {
      await redisSubscriber.subscribe(channel);

      redisSubscriber.on('message', (receivedChannel: string, message: string) => {
        if (receivedChannel === channel) {
          try {
            const parsed = JSON.parse(message);
            callback(parsed);
          } catch {
            callback(message);
          }
        }
      });
    } catch (error) {
      logger.error('Redis subscribe error', { error, channel });
      throw error;
    }
  }

  /**
   * Unsubscribe from channel
   */
  static async unsubscribe(channel: string): Promise<void> {
    try {
      await redisSubscriber.unsubscribe(channel);
    } catch (error) {
      logger.error('Redis unsubscribe error', { error, channel });
      throw error;
    }
  }

  /**
   * Pattern subscribe
   */
  static async psubscribe(pattern: string, callback: (channel: string, message: any) => void): Promise<void> {
    try {
      await redisSubscriber.psubscribe(pattern);

      redisSubscriber.on('pmessage', (receivedPattern: string, channel: string, message: string) => {
        if (receivedPattern === pattern) {
          try {
            const parsed = JSON.parse(message);
            callback(channel, parsed);
          } catch {
            callback(channel, message);
          }
        }
      });
    } catch (error) {
      logger.error('Redis psubscribe error', { error, pattern });
      throw error;
    }
  }
}

/**
 * Redis distributed lock implementation
 */
export class RedisLock {
  private key: string;
  private value: string;
  private ttl: number;

  constructor(key: string, ttl: number = 30) {
    this.key = `lock:${key}`;
    this.value = `${Date.now()}-${Math.random()}`;
    this.ttl = ttl;
  }

  /**
   * Acquire lock
   */
  async acquire(): Promise<boolean> {
    try {
      const result = await redis.set(this.key, this.value, 'EX', this.ttl, 'NX');
      return result === 'OK';
    } catch (error) {
      logger.error('Redis lock acquire error', { error, key: this.key });
      return false;
    }
  }

  /**
   * Release lock
   */
  async release(): Promise<boolean> {
    try {
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("DEL", KEYS[1])
        else
          return 0
        end
      `;

      const result = await redis.eval(script, 1, this.key, this.value);
      return result === 1;
    } catch (error) {
      logger.error('Redis lock release error', { error, key: this.key });
      return false;
    }
  }

  /**
   * Extend lock TTL
   */
  async extend(newTtl: number = this.ttl): Promise<boolean> {
    try {
      const script = `
        if redis.call("GET", KEYS[1]) == ARGV[1] then
          return redis.call("EXPIRE", KEYS[1], ARGV[2])
        else
          return 0
        end
      `;

      const result = await redis.eval(script, 1, this.key, this.value, newTtl);
      return result === 1;
    } catch (error) {
      logger.error('Redis lock extend error', { error, key: this.key });
      return false;
    }
  }
}

/**
 * Setup Redis health check monitoring
 */
const setupRedisHealthCheck = (): void => {
  setInterval(async () => {
    try {
      const health = await getRedisHealth();
      if (health.status === 'unhealthy') {
        logger.error('Redis health check failed', health);
      } else if (health.latency > 1000) {
        logger.warn('Redis high latency detected', { latency: health.latency });
      }
    } catch (error) {
      logger.error('Redis health check error', { error });
    }
  }, 30000); // Check every 30 seconds
};

// Export Redis clients
export { redis, redisSubscriber, redisPublisher, RedisCache, RedisPubSub, RedisLock };

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, closing Redis connections');
  await disconnectRedis();
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, closing Redis connections');
  await disconnectRedis();
});