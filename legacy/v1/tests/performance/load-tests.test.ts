import request from 'supertest';
import express, { Application } from 'express';
import { authRouter } from '../../src/auth/routes';
import { mcpRouter } from '../../src/server/routes';
import { MockFactory, TestDataGenerator, PerformanceTestHelpers } from '../utils/test-helpers';
import { fixtures } from '../utils/fixtures';
import { JWTService } from '../../src/auth/jwt-service';

// Mock dependencies for performance testing
jest.mock('../../src/config/config', () => ({
  config: fixtures.config.testConfig,
}));

jest.mock('../../src/database/redis', () => ({
  redis: MockFactory.createMockRedis(),
}));

jest.mock('../../src/database/prisma', () => ({
  prisma: MockFactory.createMockPrisma(),
}));

jest.mock('../../src/utils/logger', () => ({
  logger: MockFactory.createMockLogger(),
}));

describe('Performance Load Tests', () => {
  let app: Application;
  let mockRedis: any;
  let mockPrisma: any;
  let jwtService: JWTService;
  let validToken: string;

  beforeAll(async () => {
    // Setup Express app
    app = express();
    app.use(express.json());
    app.use('/api/auth', authRouter);
    app.use('/api/mcp', mcpRouter);

    // Initialize JWT service
    jwtService = new JWTService();
    await jwtService.initialize();

    // Generate valid token for authenticated tests
    const tokenPair = await jwtService.generateTokenPair({
      userId: fixtures.users.validUser.id,
      email: fixtures.users.validUser.email,
      roles: fixtures.users.validUser.roles,
      permissions: fixtures.users.validUser.permissions,
      sessionId: 'load-test-session',
      mfaVerified: false,
    });
    validToken = tokenPair.accessToken;

    // Setup mocks
    mockRedis = require('../../src/database/redis').redis;
    mockPrisma = require('../../src/database/prisma').prisma;

    // Configure successful responses for load testing
    mockRedis.get.mockResolvedValue('valid');
    mockRedis.setex.mockResolvedValue('OK');
    mockRedis.incr.mockResolvedValue(1); // Under rate limit
    mockPrisma.user.findUnique.mockResolvedValue(fixtures.users.validUser);
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  describe('Authentication Endpoint Load Tests', () => {
    it('should handle concurrent login requests under normal load', async () => {
      const loginPayload = {
        email: 'user@example.com',
        password: 'SecurePassword123!',
      };

      const config = fixtures.performance.loadTestConfig;

      const operation = async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send(loginPayload);

        expect(response.status).toBeLessThan(500);
        return response;
      };

      const results = await PerformanceTestHelpers.stressTest(operation, {
        concurrent: config.concurrent,
        duration: config.duration,
        errorThreshold: config.errorThreshold,
      });

      // Performance assertions
      expect(results.totalRequests).toBeGreaterThan(0);
      expect(results.failed / results.totalRequests).toBeLessThanOrEqual(config.errorThreshold);
      expect(results.averageResponseTime).toBeLessThan(fixtures.performance.performanceThresholds.responseTime.p50);

      console.log('Login Load Test Results:', {
        totalRequests: results.totalRequests,
        successful: results.successful,
        failed: results.failed,
        errorRate: `${((results.failed / results.totalRequests) * 100).toFixed(2)}%`,
        averageResponseTime: `${results.averageResponseTime.toFixed(2)}ms`,
        maxResponseTime: `${results.maxResponseTime}ms`,
      });
    });

    it('should handle high-frequency token refresh requests', async () => {
      const refreshPayload = {
        refreshToken: 'valid-refresh-token',
      };

      // Mock successful refresh
      mockRedis.get
        .mockResolvedValue(JSON.stringify({
          userId: fixtures.users.validUser.id,
          sessionId: 'session-123',
          createdAt: new Date().toISOString(),
        }))
        .mockResolvedValue(JSON.stringify({
          email: fixtures.users.validUser.email,
          roles: JSON.stringify(fixtures.users.validUser.roles),
          permissions: JSON.stringify(fixtures.users.validUser.permissions),
          mfaVerified: 'false',
        }));

      const operation = async () => {
        const response = await request(app)
          .post('/api/auth/refresh')
          .send(refreshPayload);

        return response;
      };

      const results = await PerformanceTestHelpers.stressTest(operation, {
        concurrent: 50,
        duration: 10000, // 10 seconds
        errorThreshold: 0.02,
      });

      expect(results.averageResponseTime).toBeLessThan(200); // Token refresh should be fast
      expect(results.failed / results.totalRequests).toBeLessThanOrEqual(0.02);
    });

    it('should maintain performance under authentication failures', async () => {
      const invalidLoginPayload = {
        email: 'user@example.com',
        password: 'WrongPassword123!',
      };

      // Mock authentication failure
      jest.doMock('argon2', () => ({
        verify: jest.fn().mockResolvedValue(false),
      }));

      const operation = async () => {
        const response = await request(app)
          .post('/api/auth/login')
          .send(invalidLoginPayload);

        expect(response.status).toBe(401);
        return response;
      };

      const results = await PerformanceTestHelpers.stressTest(operation, {
        concurrent: 25,
        duration: 5000,
      });

      // Failed authentications should still be processed efficiently
      expect(results.averageResponseTime).toBeLessThan(500);
      expect(results.successful).toBe(results.totalRequests); // All should return 401 successfully
    });
  });

  describe('API Endpoint Performance Tests', () => {
    it('should handle concurrent profile requests efficiently', async () => {
      const operation = async () => {
        const response = await request(app)
          .get('/api/auth/profile')
          .set('Authorization', `Bearer ${validToken}`);

        expect([200, 401]).toContain(response.status);
        return response;
      };

      const { result, duration } = await PerformanceTestHelpers.measureExecutionTime(
        () => PerformanceTestHelpers.stressTest(operation, {
          concurrent: 100,
          duration: 15000,
          errorThreshold: 0.01,
        })
      );

      expect(result.averageResponseTime).toBeLessThan(100);
      expect(duration).toBeLessThan(16000); // Should complete within expected timeframe

      console.log('Profile API Performance:', {
        requestsPerSecond: Math.round(result.totalRequests / (duration / 1000)),
        averageResponseTime: `${result.averageResponseTime.toFixed(2)}ms`,
        p95ResponseTime: `${result.maxResponseTime}ms`,
      });
    });

    it('should handle mixed workload scenarios', async () => {
      const operations = [
        // Login requests (30%)
        ...Array(3).fill(async () => {
          return request(app)
            .post('/api/auth/login')
            .send({
              email: `user${Math.random()}@example.com`,
              password: 'SecurePassword123!',
            });
        }),

        // Profile requests (50%)
        ...Array(5).fill(async () => {
          return request(app)
            .get('/api/auth/profile')
            .set('Authorization', `Bearer ${validToken}`);
        }),

        // Refresh requests (20%)
        ...Array(2).fill(async () => {
          return request(app)
            .post('/api/auth/refresh')
            .send({ refreshToken: 'valid-refresh-token' });
        }),
      ];

      const operation = async () => {
        const randomOp = operations[Math.floor(Math.random() * operations.length)];
        return randomOp();
      };

      const results = await PerformanceTestHelpers.stressTest(operation, {
        concurrent: 75,
        duration: 20000,
        errorThreshold: 0.05,
      });

      expect(results.averageResponseTime).toBeLessThan(300);
      expect(results.failed / results.totalRequests).toBeLessThanOrEqual(0.05);

      console.log('Mixed Workload Results:', {
        totalRequests: results.totalRequests,
        throughput: `${Math.round(results.totalRequests / 20)} req/sec`,
        errorRate: `${((results.failed / results.totalRequests) * 100).toFixed(2)}%`,
      });
    });
  });

  describe('Memory and Resource Usage Tests', () => {
    it('should not leak memory under sustained load', async () => {
      const initialMemory = process.memoryUsage();

      const operation = async () => {
        return request(app)
          .get('/api/auth/profile')
          .set('Authorization', `Bearer ${validToken}`);
      };

      const { result, memoryDelta } = await PerformanceTestHelpers.measureMemoryUsage(
        () => PerformanceTestHelpers.stressTest(operation, {
          concurrent: 50,
          duration: 10000,
        })
      );

      const finalMemory = process.memoryUsage();
      const heapGrowth = finalMemory.heapUsed - initialMemory.heapUsed;
      const heapGrowthPerRequest = heapGrowth / result.totalRequests;

      // Memory growth should be reasonable
      expect(heapGrowthPerRequest).toBeLessThan(1024 * 10); // Less than 10KB per request
      expect(heapGrowth).toBeLessThan(1024 * 1024 * 50); // Less than 50MB total growth

      console.log('Memory Usage:', {
        totalRequests: result.totalRequests,
        heapGrowth: `${Math.round(heapGrowth / 1024)}KB`,
        heapGrowthPerRequest: `${Math.round(heapGrowthPerRequest)}B`,
      });

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }
    });

    it('should handle large request payloads efficiently', async () => {
      const largePayload = {
        email: 'user@example.com',
        password: 'SecurePassword123!',
        metadata: 'x'.repeat(1024 * 100), // 100KB of data
      };

      const operation = async () => {
        return request(app)
          .post('/api/auth/login')
          .send(largePayload);
      };

      const { result, duration } = await PerformanceTestHelpers.measureExecutionTime(
        () => Promise.all(Array(10).fill(null).map(operation))
      );

      const averageTime = duration / 10;

      // Large payloads should still be processed reasonably quickly
      expect(averageTime).toBeLessThan(1000); // Less than 1 second per large request
      expect(result.every(r => r.status < 500)).toBe(true); // No server errors
    });
  });

  describe('Rate Limiting Performance Tests', () => {
    it('should efficiently enforce rate limits under high load', async () => {
      // Configure rate limit to be hit quickly
      mockRedis.incr.mockImplementation((key) => {
        const count = Math.floor(Math.random() * 150) + 1; // Random between 1-150
        return Promise.resolve(count);
      });

      const operation = async () => {
        return request(app)
          .post('/api/auth/login')
          .send({
            email: 'user@example.com',
            password: 'SecurePassword123!',
          });
      };

      const results = await PerformanceTestHelpers.stressTest(operation, {
        concurrent: 100,
        duration: 5000,
        errorThreshold: 0.5, // Higher threshold since rate limiting is expected
      });

      // Rate limiting should not significantly impact performance
      expect(results.averageResponseTime).toBeLessThan(200);

      const rateLimitedResponses = results.errors.filter(
        error => error.message.includes('429')
      ).length;

      console.log('Rate Limiting Performance:', {
        totalRequests: results.totalRequests,
        rateLimitedRequests: rateLimitedResponses,
        rateLimitPercentage: `${((rateLimitedResponses / results.totalRequests) * 100).toFixed(2)}%`,
      });
    });

    it('should handle rate limit recovery efficiently', async () => {
      let requestCount = 0;

      mockRedis.incr.mockImplementation(() => {
        requestCount++;
        // Simulate rate limit recovery
        return Promise.resolve(requestCount > 50 ? 1 : 101);
      });

      mockRedis.ttl.mockResolvedValue(1); // Short TTL for quick recovery

      const operation = async () => {
        return request(app)
          .post('/api/auth/login')
          .send({
            email: 'user@example.com',
            password: 'SecurePassword123!',
          });
      };

      const results = await PerformanceTestHelpers.stressTest(operation, {
        concurrent: 20,
        duration: 10000,
        errorThreshold: 0.6,
      });

      // Should recover from rate limiting
      expect(results.successful).toBeGreaterThan(results.failed);
    });
  });

  describe('Database Connection Performance', () => {
    it('should handle database connection pooling under load', async () => {
      const operation = async () => {
        mockPrisma.user.findUnique.mockResolvedValue(fixtures.users.validUser);

        const response = await request(app)
          .get('/api/auth/profile')
          .set('Authorization', `Bearer ${validToken}`);

        expect(mockPrisma.user.findUnique).toHaveBeenCalled();
        return response;
      };

      const results = await PerformanceTestHelpers.stressTest(operation, {
        concurrent: 50,
        duration: 8000,
        errorThreshold: 0.02,
      });

      // Database operations should be efficient
      expect(results.averageResponseTime).toBeLessThan(150);
      expect(results.failed / results.totalRequests).toBeLessThanOrEqual(0.02);

      // Should not overwhelm the mock database
      expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(results.totalRequests);
    });

    it('should handle Redis operations under concurrent load', async () => {
      let redisOperations = 0;

      mockRedis.get.mockImplementation(() => {
        redisOperations++;
        return Promise.resolve('valid');
      });

      const operation = async () => {
        return request(app)
          .get('/api/auth/profile')
          .set('Authorization', `Bearer ${validToken}`);
      };

      const results = await PerformanceTestHelpers.stressTest(operation, {
        concurrent: 75,
        duration: 6000,
        errorThreshold: 0.01,
      });

      expect(results.averageResponseTime).toBeLessThan(100);
      expect(redisOperations).toBeGreaterThan(0);
      expect(redisOperations).toBeLessThanOrEqual(results.totalRequests * 2); // Allow for multiple Redis calls per request

      console.log('Redis Performance:', {
        totalRedisOps: redisOperations,
        opsPerRequest: (redisOperations / results.totalRequests).toFixed(2),
      });
    });
  });

  describe('Error Handling Performance', () => {
    it('should handle error scenarios efficiently', async () => {
      // Force various error conditions
      const errorOperations = [
        async () => {
          mockPrisma.user.findUnique.mockRejectedValueOnce(new Error('DB Error'));
          return request(app).get('/api/auth/profile').set('Authorization', `Bearer ${validToken}`);
        },
        async () => {
          return request(app).get('/api/auth/profile').set('Authorization', 'Bearer invalid-token');
        },
        async () => {
          return request(app).post('/api/auth/login').send({ email: 'invalid', password: 'short' });
        },
      ];

      const operation = async () => {
        const randomErrorOp = errorOperations[Math.floor(Math.random() * errorOperations.length)];
        return randomErrorOp();
      };

      const results = await PerformanceTestHelpers.stressTest(operation, {
        concurrent: 30,
        duration: 5000,
        errorThreshold: 1.0, // All requests expected to error
      });

      // Error handling should still be fast
      expect(results.averageResponseTime).toBeLessThan(300);
      expect(results.totalRequests).toBeGreaterThan(0);

      console.log('Error Handling Performance:', {
        totalRequests: results.totalRequests,
        averageErrorResponseTime: `${results.averageResponseTime.toFixed(2)}ms`,
      });
    });
  });

  describe('Stress Test Scenarios', () => {
    it('should survive extreme concurrent load', async () => {
      const extremeConfig = fixtures.performance.stressTestConfig;

      const operation = async () => {
        return request(app)
          .post('/api/auth/login')
          .send({
            email: `user${Math.random()}@example.com`,
            password: 'SecurePassword123!',
          });
      };

      const results = await PerformanceTestHelpers.stressTest(operation, {
        concurrent: extremeConfig.concurrent,
        duration: extremeConfig.duration,
        errorThreshold: extremeConfig.errorThreshold,
      });

      // Should handle extreme load gracefully
      expect(results.failed / results.totalRequests).toBeLessThanOrEqual(extremeConfig.errorThreshold);
      expect(results.averageResponseTime).toBeLessThan(2000); // Still reasonable response times

      console.log('Stress Test Results:', {
        totalRequests: results.totalRequests,
        successful: results.successful,
        failed: results.failed,
        errorRate: `${((results.failed / results.totalRequests) * 100).toFixed(2)}%`,
        averageResponseTime: `${results.averageResponseTime.toFixed(2)}ms`,
        maxResponseTime: `${results.maxResponseTime}ms`,
        requestsPerSecond: Math.round(results.totalRequests / (extremeConfig.duration / 1000)),
      });
    });

    it('should handle spike load patterns', async () => {
      const spikeConfig = fixtures.performance.spikeTestConfig;

      // Simulate spike pattern: low load -> high load -> low load
      const phases = [
        { concurrent: spikeConfig.baseLoad, duration: 5000 },
        { concurrent: spikeConfig.spikeLoad, duration: spikeConfig.spikeDuration },
        { concurrent: spikeConfig.baseLoad, duration: 5000 },
      ];

      const operation = async () => {
        return request(app)
          .get('/api/auth/profile')
          .set('Authorization', `Bearer ${validToken}`);
      };

      const phaseResults = [];

      for (const phase of phases) {
        const result = await PerformanceTestHelpers.stressTest(operation, {
          concurrent: phase.concurrent,
          duration: phase.duration,
          errorThreshold: 0.1,
        });
        phaseResults.push(result);
      }

      // Should handle spike gracefully
      const spikePhase = phaseResults[1];
      expect(spikePhase.failed / spikePhase.totalRequests).toBeLessThanOrEqual(0.1);
      expect(spikePhase.averageResponseTime).toBeLessThan(1000);

      console.log('Spike Test Results:', {
        basePhase: {
          requests: phaseResults[0].totalRequests,
          avgTime: `${phaseResults[0].averageResponseTime.toFixed(2)}ms`,
        },
        spikePhase: {
          requests: spikePhase.totalRequests,
          avgTime: `${spikePhase.averageResponseTime.toFixed(2)}ms`,
          errorRate: `${((spikePhase.failed / spikePhase.totalRequests) * 100).toFixed(2)}%`,
        },
        recoveryPhase: {
          requests: phaseResults[2].totalRequests,
          avgTime: `${phaseResults[2].averageResponseTime.toFixed(2)}ms`,
        },
      });
    });
  });

  describe('Performance Regression Tests', () => {
    it('should maintain baseline performance metrics', async () => {
      const baselineMetrics = {
        loginResponseTime: 150, // ms
        profileResponseTime: 100, // ms
        throughput: 100, // requests/second minimum
      };

      // Test login performance
      const loginOp = async () => {
        return request(app)
          .post('/api/auth/login')
          .send({
            email: 'user@example.com',
            password: 'SecurePassword123!',
          });
      };

      const loginResults = await PerformanceTestHelpers.stressTest(loginOp, {
        concurrent: 20,
        duration: 5000,
      });

      // Test profile performance
      const profileOp = async () => {
        return request(app)
          .get('/api/auth/profile')
          .set('Authorization', `Bearer ${validToken}`);
      };

      const profileResults = await PerformanceTestHelpers.stressTest(profileOp, {
        concurrent: 30,
        duration: 5000,
      });

      // Assert against baselines
      expect(loginResults.averageResponseTime).toBeLessThanOrEqual(baselineMetrics.loginResponseTime);
      expect(profileResults.averageResponseTime).toBeLessThanOrEqual(baselineMetrics.profileResponseTime);

      const totalThroughput = (loginResults.totalRequests + profileResults.totalRequests) / 10; // 10 seconds total
      expect(totalThroughput).toBeGreaterThanOrEqual(baselineMetrics.throughput);

      console.log('Baseline Performance Check:', {
        loginAvgTime: `${loginResults.averageResponseTime.toFixed(2)}ms`,
        profileAvgTime: `${profileResults.averageResponseTime.toFixed(2)}ms`,
        totalThroughput: `${totalThroughput.toFixed(2)} req/sec`,
        passed: {
          login: loginResults.averageResponseTime <= baselineMetrics.loginResponseTime,
          profile: profileResults.averageResponseTime <= baselineMetrics.profileResponseTime,
          throughput: totalThroughput >= baselineMetrics.throughput,
        },
      });
    });
  });
});