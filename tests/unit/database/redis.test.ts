import { redis, initializeRedis } from '../../../src/database/redis';
import { MockFactory } from '../../utils/test-helpers';
import { fixtures } from '../../utils/fixtures';
import Redis from 'ioredis';

// Mock dependencies
jest.mock('ioredis');
jest.mock('../../../src/config/config', () => ({
  config: {
    redis: fixtures.config.testConfig.redis,
    env: 'test',
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: MockFactory.createMockLogger(),
}));

describe('Redis Database Connection', () => {
  let mockRedisInstance: jest.Mocked<Redis>;
  let mockLogger: any;

  beforeEach(() => {
    mockLogger = require('../../../src/utils/logger').logger;

    // Create mock Redis instance
    mockRedisInstance = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      ping: jest.fn().mockResolvedValue('PONG'),
      get: jest.fn(),
      set: jest.fn(),
      del: jest.fn(),
      exists: jest.fn(),
      expire: jest.fn(),
      ttl: jest.fn(),
      incr: jest.fn(),
      setex: jest.fn(),
      sadd: jest.fn(),
      srem: jest.fn(),
      smembers: jest.fn(),
      hget: jest.fn(),
      hset: jest.fn(),
      hgetall: jest.fn(),
      keys: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      removeListener: jest.fn(),
      status: 'ready',
    } as any;

    (Redis as jest.MockedClass<typeof Redis>).mockImplementation(() => mockRedisInstance);

    jest.clearAllMocks();
  });

  describe('Redis initialization', () => {
    it('should initialize Redis connection successfully', async () => {
      await initializeRedis();

      expect(Redis).toHaveBeenCalledWith(
        expect.objectContaining({
          host: expect.any(String),
          port: expect.any(Number),
          db: expect.any(Number),
          connectTimeout: expect.any(Number),
          commandTimeout: expect.any(Number),
          retryDelayOnFailure: expect.any(Number),
          maxRetriesPerRequest: 3,
        })
      );

      expect(mockRedisInstance.on).toHaveBeenCalledWith('connect', expect.any(Function));
      expect(mockRedisInstance.on).toHaveBeenCalledWith('error', expect.any(Function));
      expect(mockRedisInstance.on).toHaveBeenCalledWith('reconnecting', expect.any(Function));
    });

    it('should handle connection success events', async () => {
      await initializeRedis();

      // Simulate connection event
      const connectHandler = mockRedisInstance.on.mock.calls.find(
        call => call[0] === 'connect'
      )?.[1];

      if (connectHandler) {
        connectHandler();
      }

      expect(mockLogger.info).toHaveBeenCalledWith('Redis connected successfully');
    });

    it('should handle connection error events', async () => {
      await initializeRedis();

      // Simulate error event
      const errorHandler = mockRedisInstance.on.mock.calls.find(
        call => call[0] === 'error'
      )?.[1];

      const testError = new Error('Connection failed');
      if (errorHandler) {
        errorHandler(testError);
      }

      expect(mockLogger.error).toHaveBeenCalledWith('Redis connection error:', testError);
    });

    it('should handle reconnection events', async () => {
      await initializeRedis();

      // Simulate reconnecting event
      const reconnectingHandler = mockRedisInstance.on.mock.calls.find(
        call => call[0] === 'reconnecting'
      )?.[1];

      if (reconnectingHandler) {
        reconnectingHandler();
      }

      expect(mockLogger.info).toHaveBeenCalledWith('Redis reconnecting...');
    });

    it('should handle initialization failures gracefully', async () => {
      const initError = new Error('Redis initialization failed');
      (Redis as jest.MockedClass<typeof Redis>).mockImplementation(() => {
        throw initError;
      });

      await expect(initializeRedis()).rejects.toThrow('Redis initialization failed');
      expect(mockLogger.error).toHaveBeenCalledWith('Failed to initialize Redis:', initError);
    });
  });

  describe('Redis operations', () => {
    beforeEach(async () => {
      await initializeRedis();
    });

    describe('string operations', () => {
      it('should perform GET operations', async () => {
        const testKey = 'test:key';
        const testValue = 'test-value';

        mockRedisInstance.get.mockResolvedValue(testValue);

        const result = await redis.get(testKey);

        expect(result).toBe(testValue);
        expect(mockRedisInstance.get).toHaveBeenCalledWith(testKey);
      });

      it('should perform SET operations', async () => {
        const testKey = 'test:key';
        const testValue = 'test-value';

        mockRedisInstance.set.mockResolvedValue('OK');

        const result = await redis.set(testKey, testValue);

        expect(result).toBe('OK');
        expect(mockRedisInstance.set).toHaveBeenCalledWith(testKey, testValue);
      });

      it('should perform SETEX operations with expiration', async () => {
        const testKey = 'test:key';
        const testValue = 'test-value';
        const ttlSeconds = 3600;

        mockRedisInstance.setex.mockResolvedValue('OK');

        const result = await redis.setex(testKey, ttlSeconds, testValue);

        expect(result).toBe('OK');
        expect(mockRedisInstance.setex).toHaveBeenCalledWith(testKey, ttlSeconds, testValue);
      });

      it('should handle DEL operations', async () => {
        const testKeys = ['key1', 'key2', 'key3'];

        mockRedisInstance.del.mockResolvedValue(testKeys.length);

        const result = await redis.del(...testKeys);

        expect(result).toBe(testKeys.length);
        expect(mockRedisInstance.del).toHaveBeenCalledWith(...testKeys);
      });

      it('should handle EXISTS operations', async () => {
        const testKey = 'test:key';

        mockRedisInstance.exists.mockResolvedValue(1);

        const result = await redis.exists(testKey);

        expect(result).toBe(1);
        expect(mockRedisInstance.exists).toHaveBeenCalledWith(testKey);
      });
    });

    describe('expiration operations', () => {
      it('should set key expiration with EXPIRE', async () => {
        const testKey = 'test:key';
        const ttlSeconds = 3600;

        mockRedisInstance.expire.mockResolvedValue(1);

        const result = await redis.expire(testKey, ttlSeconds);

        expect(result).toBe(1);
        expect(mockRedisInstance.expire).toHaveBeenCalledWith(testKey, ttlSeconds);
      });

      it('should get TTL for keys', async () => {
        const testKey = 'test:key';
        const ttlSeconds = 1800;

        mockRedisInstance.ttl.mockResolvedValue(ttlSeconds);

        const result = await redis.ttl(testKey);

        expect(result).toBe(ttlSeconds);
        expect(mockRedisInstance.ttl).toHaveBeenCalledWith(testKey);
      });
    });

    describe('numeric operations', () => {
      it('should increment values with INCR', async () => {
        const testKey = 'counter:key';
        const newValue = 5;

        mockRedisInstance.incr.mockResolvedValue(newValue);

        const result = await redis.incr(testKey);

        expect(result).toBe(newValue);
        expect(mockRedisInstance.incr).toHaveBeenCalledWith(testKey);
      });
    });

    describe('set operations', () => {
      it('should add members to sets with SADD', async () => {
        const testKey = 'test:set';
        const members = ['member1', 'member2', 'member3'];

        mockRedisInstance.sadd.mockResolvedValue(members.length);

        const result = await redis.sadd(testKey, ...members);

        expect(result).toBe(members.length);
        expect(mockRedisInstance.sadd).toHaveBeenCalledWith(testKey, ...members);
      });

      it('should remove members from sets with SREM', async () => {
        const testKey = 'test:set';
        const members = ['member1', 'member2'];

        mockRedisInstance.srem.mockResolvedValue(members.length);

        const result = await redis.srem(testKey, ...members);

        expect(result).toBe(members.length);
        expect(mockRedisInstance.srem).toHaveBeenCalledWith(testKey, ...members);
      });

      it('should get all set members with SMEMBERS', async () => {
        const testKey = 'test:set';
        const members = ['member1', 'member2', 'member3'];

        mockRedisInstance.smembers.mockResolvedValue(members);

        const result = await redis.smembers(testKey);

        expect(result).toEqual(members);
        expect(mockRedisInstance.smembers).toHaveBeenCalledWith(testKey);
      });
    });

    describe('hash operations', () => {
      it('should get hash field values with HGET', async () => {
        const testKey = 'test:hash';
        const field = 'field1';
        const value = 'value1';

        mockRedisInstance.hget.mockResolvedValue(value);

        const result = await redis.hget(testKey, field);

        expect(result).toBe(value);
        expect(mockRedisInstance.hget).toHaveBeenCalledWith(testKey, field);
      });

      it('should set hash field values with HSET', async () => {
        const testKey = 'test:hash';
        const field = 'field1';
        const value = 'value1';

        mockRedisInstance.hset.mockResolvedValue(1);

        const result = await redis.hset(testKey, field, value);

        expect(result).toBe(1);
        expect(mockRedisInstance.hset).toHaveBeenCalledWith(testKey, field, value);
      });

      it('should get all hash fields with HGETALL', async () => {
        const testKey = 'test:hash';
        const hashData = { field1: 'value1', field2: 'value2' };

        mockRedisInstance.hgetall.mockResolvedValue(hashData);

        const result = await redis.hgetall(testKey);

        expect(result).toEqual(hashData);
        expect(mockRedisInstance.hgetall).toHaveBeenCalledWith(testKey);
      });
    });

    describe('key pattern operations', () => {
      it('should find keys matching patterns with KEYS', async () => {
        const pattern = 'session:*';
        const matchingKeys = ['session:123', 'session:456', 'session:789'];

        mockRedisInstance.keys.mockResolvedValue(matchingKeys);

        const result = await redis.keys(pattern);

        expect(result).toEqual(matchingKeys);
        expect(mockRedisInstance.keys).toHaveBeenCalledWith(pattern);
      });
    });

    describe('utility operations', () => {
      it('should ping Redis server', async () => {
        mockRedisInstance.ping.mockResolvedValue('PONG');

        const result = await redis.ping();

        expect(result).toBe('PONG');
        expect(mockRedisInstance.ping).toHaveBeenCalled();
      });
    });
  });

  describe('Error handling', () => {
    beforeEach(async () => {
      await initializeRedis();
    });

    it('should handle Redis operation errors gracefully', async () => {
      const testError = new Error('Redis operation failed');
      mockRedisInstance.get.mockRejectedValue(testError);

      await expect(redis.get('test:key')).rejects.toThrow('Redis operation failed');
    });

    it('should handle connection timeouts', async () => {
      const timeoutError = new Error('Connection timeout');
      timeoutError.name = 'TimeoutError';

      mockRedisInstance.ping.mockRejectedValue(timeoutError);

      await expect(redis.ping()).rejects.toThrow('Connection timeout');
    });

    it('should handle network errors during operations', async () => {
      const networkError = new Error('Network unreachable');
      networkError.name = 'NetworkError';

      mockRedisInstance.set.mockRejectedValue(networkError);

      await expect(redis.set('test:key', 'value')).rejects.toThrow('Network unreachable');
    });
  });

  describe('Connection lifecycle', () => {
    it('should handle graceful disconnection', async () => {
      await initializeRedis();

      mockRedisInstance.disconnect.mockResolvedValue(undefined);

      await expect(redis.disconnect()).resolves.not.toThrow();
      expect(mockRedisInstance.disconnect).toHaveBeenCalled();
    });

    it('should handle connection status checks', async () => {
      await initializeRedis();

      expect(redis.status).toBe('ready');
    });
  });

  describe('Performance considerations', () => {
    beforeEach(async () => {
      await initializeRedis();
    });

    it('should handle concurrent operations efficiently', async () => {
      const concurrentOperations = Array.from({ length: 100 }, (_, i) => {
        mockRedisInstance.get.mockResolvedValue(`value-${i}`);
        return redis.get(`key-${i}`);
      });

      const results = await Promise.all(concurrentOperations);

      expect(results).toHaveLength(100);
      expect(results.every((result, i) => result === `value-${i}`)).toBe(true);
      expect(mockRedisInstance.get).toHaveBeenCalledTimes(100);
    });

    it('should handle large batch operations', async () => {
      const largeKeySet = Array.from({ length: 1000 }, (_, i) => `key-${i}`);

      mockRedisInstance.del.mockResolvedValue(largeKeySet.length);

      const result = await redis.del(...largeKeySet);

      expect(result).toBe(largeKeySet.length);
      expect(mockRedisInstance.del).toHaveBeenCalledWith(...largeKeySet);
    });
  });

  describe('Data type handling', () => {
    beforeEach(async () => {
      await initializeRedis();
    });

    it('should handle JSON serialization for complex objects', async () => {
      const testKey = 'test:json';
      const complexObject = {
        id: 123,
        name: 'Test Object',
        metadata: {
          created: new Date().toISOString(),
          tags: ['test', 'object'],
        },
        enabled: true,
      };

      const serialized = JSON.stringify(complexObject);
      mockRedisInstance.set.mockResolvedValue('OK');
      mockRedisInstance.get.mockResolvedValue(serialized);

      // Store complex object
      await redis.set(testKey, serialized);
      expect(mockRedisInstance.set).toHaveBeenCalledWith(testKey, serialized);

      // Retrieve and deserialize
      const retrieved = await redis.get(testKey);
      const deserialized = JSON.parse(retrieved!);

      expect(deserialized).toEqual(complexObject);
    });

    it('should handle binary data appropriately', async () => {
      const testKey = 'test:binary';
      const binaryData = Buffer.from('binary test data', 'utf8').toString('base64');

      mockRedisInstance.set.mockResolvedValue('OK');
      mockRedisInstance.get.mockResolvedValue(binaryData);

      await redis.set(testKey, binaryData);
      const result = await redis.get(testKey);

      expect(result).toBe(binaryData);
      expect(Buffer.from(result!, 'base64').toString('utf8')).toBe('binary test data');
    });
  });

  describe('Memory management', () => {
    beforeEach(async () => {
      await initializeRedis();
    });

    it('should handle memory-efficient operations for large datasets', async () => {
      // Simulate large dataset operations
      const largeDataOperations = Array.from({ length: 50 }, (_, i) => {
        const largeValue = 'x'.repeat(1024 * 10); // 10KB per value
        mockRedisInstance.setex.mockResolvedValue('OK');
        return redis.setex(`large:key:${i}`, 3600, largeValue);
      });

      const results = await Promise.all(largeDataOperations);

      expect(results.every(result => result === 'OK')).toBe(true);
      expect(mockRedisInstance.setex).toHaveBeenCalledTimes(50);
    });
  });
});