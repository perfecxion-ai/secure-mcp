import { randomBytes, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';
import { Socket } from 'socket.io';
import { EventEmitter } from 'events';

// Test data generators
export class TestDataGenerator {
  static generateUser(overrides: Partial<any> = {}) {
    return {
      id: randomUUID(),
      email: `test${Date.now()}@example.com`,
      username: `testuser${Date.now()}`,
      firstName: 'Test',
      lastName: 'User',
      roles: ['user'],
      permissions: ['basic'],
      mfaEnabled: false,
      mfaVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...overrides,
    };
  }

  static generateSession(overrides: Partial<any> = {}) {
    return {
      id: randomUUID(),
      userId: randomUUID(),
      createdAt: new Date(),
      lastActivity: new Date(),
      ipAddress: '127.0.0.1',
      userAgent: 'Test Agent',
      ...overrides,
    };
  }

  static generateJWTPayload(overrides: Partial<any> = {}) {
    return {
      sub: randomUUID(),
      email: 'test@example.com',
      roles: ['user'],
      permissions: ['basic'],
      sessionId: randomUUID(),
      mfaVerified: false,
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 3600,
      iss: 'secure-mcp-server',
      aud: 'secure-mcp-client',
      jti: randomUUID(),
      ...overrides,
    };
  }

  static generateMCPMessage(overrides: Partial<any> = {}) {
    return {
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'test/method',
      params: {},
      ...overrides,
    };
  }

  static generateSecurePassword(): string {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
    let password = '';

    // Ensure at least one of each required character type
    password += 'A'; // uppercase
    password += 'a'; // lowercase
    password += '1'; // number
    password += '!'; // special char

    // Fill the rest randomly
    for (let i = 4; i < 12; i++) {
      password += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return password.split('').sort(() => Math.random() - 0.5).join('');
  }

  static generateMaliciousPayload(type: 'sql' | 'xss' | 'command' | 'nosql' | 'path'): string {
    const payloads = {
      sql: "'; DROP TABLE users; --",
      xss: '<script>alert("XSS")</script>',
      command: '; rm -rf /',
      nosql: '{"$where": "this.password.match(/.*/)"}',
      path: '../../../etc/passwd',
    };
    return payloads[type];
  }

  static generateRateLimitRequests(count: number): Array<() => Promise<any>> {
    return Array.from({ length: count }, (_, i) => async () => ({
      id: i,
      timestamp: new Date(),
    }));
  }
}

// Mock factories
export class MockFactory {
  static createMockRedis() {
    const data = new Map<string, string>();
    const sets = new Map<string, Set<string>>();
    const expiries = new Map<string, number>();

    return {
      get: jest.fn((key: string) => Promise.resolve(data.get(key) || null)),
      set: jest.fn((key: string, value: string) => {
        data.set(key, value);
        return Promise.resolve('OK');
      }),
      setex: jest.fn((key: string, seconds: number, value: string) => {
        data.set(key, value);
        expiries.set(key, Date.now() + seconds * 1000);
        return Promise.resolve('OK');
      }),
      del: jest.fn((...keys: string[]) => {
        let count = 0;
        keys.forEach(key => {
          if (data.delete(key)) count++;
          sets.delete(key);
          expiries.delete(key);
        });
        return Promise.resolve(count);
      }),
      incr: jest.fn((key: string) => {
        const current = parseInt(data.get(key) || '0', 10);
        const newValue = current + 1;
        data.set(key, newValue.toString());
        return Promise.resolve(newValue);
      }),
      expire: jest.fn((key: string, seconds: number) => {
        if (data.has(key)) {
          expiries.set(key, Date.now() + seconds * 1000);
          return Promise.resolve(1);
        }
        return Promise.resolve(0);
      }),
      ttl: jest.fn((key: string) => {
        const expiry = expiries.get(key);
        if (!expiry) return Promise.resolve(-1);
        const remaining = Math.ceil((expiry - Date.now()) / 1000);
        return Promise.resolve(Math.max(0, remaining));
      }),
      sadd: jest.fn((key: string, ...members: string[]) => {
        if (!sets.has(key)) sets.set(key, new Set());
        const set = sets.get(key)!;
        let added = 0;
        members.forEach(member => {
          if (!set.has(member)) {
            set.add(member);
            added++;
          }
        });
        return Promise.resolve(added);
      }),
      srem: jest.fn((key: string, ...members: string[]) => {
        const set = sets.get(key);
        if (!set) return Promise.resolve(0);
        let removed = 0;
        members.forEach(member => {
          if (set.delete(member)) removed++;
        });
        return Promise.resolve(removed);
      }),
      smembers: jest.fn((key: string) => {
        const set = sets.get(key);
        return Promise.resolve(set ? Array.from(set) : []);
      }),
      hgetall: jest.fn((key: string) => {
        const value = data.get(key);
        try {
          return Promise.resolve(value ? JSON.parse(value) : {});
        } catch {
          return Promise.resolve({});
        }
      }),
      keys: jest.fn((pattern: string) => {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        const matchingKeys = Array.from(data.keys()).filter(key => regex.test(key));
        return Promise.resolve(matchingKeys);
      }),
      ping: jest.fn(() => Promise.resolve('PONG')),
      disconnect: jest.fn(() => Promise.resolve()),
    };
  }

  static createMockPrisma() {
    return {
      $connect: jest.fn(() => Promise.resolve()),
      $disconnect: jest.fn(() => Promise.resolve()),
      $queryRaw: jest.fn(() => Promise.resolve([{ result: 1 }])),
      user: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(() => Promise.resolve([])),
        update: jest.fn(),
        delete: jest.fn(),
        upsert: jest.fn(),
        count: jest.fn(() => Promise.resolve(0)),
      },
      session: {
        create: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(() => Promise.resolve([])),
        update: jest.fn(),
        delete: jest.fn(),
        deleteMany: jest.fn(() => Promise.resolve({ count: 0 })),
      },
      auditLog: {
        create: jest.fn(),
        findMany: jest.fn(() => Promise.resolve([])),
      },
    };
  }

  static createMockVault() {
    const secrets = new Map<string, any>();

    return {
      read: jest.fn((path: string) => {
        const secret = secrets.get(path);
        return Promise.resolve(secret ? { data: secret } : null);
      }),
      write: jest.fn((path: string, data: any) => {
        secrets.set(path, data);
        return Promise.resolve();
      }),
      health: jest.fn(() => Promise.resolve({ status: 'ok' })),
      delete: jest.fn((path: string) => {
        secrets.delete(path);
        return Promise.resolve();
      }),
    };
  }

  static createMockSocket(): Partial<Socket> {
    const socket = new EventEmitter() as any;

    socket.id = randomUUID();
    socket.data = {};
    socket.handshake = {
      address: '127.0.0.1',
      headers: {
        'user-agent': 'test-agent',
      },
      auth: {},
    };
    socket.send = jest.fn();
    socket.emit = jest.fn();
    socket.disconnect = jest.fn();
    socket.join = jest.fn();
    socket.leave = jest.fn();
    socket.rooms = new Set();
    socket.on = jest.fn();
    socket.off = jest.fn();
    socket.once = jest.fn();

    return socket;
  }

  static createMockLogger() {
    return {
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      debug: jest.fn(),
      trace: jest.fn(),
      child: jest.fn(() => MockFactory.createMockLogger()),
    };
  }

  static createMockExpress() {
    const req: any = {
      headers: {},
      body: {},
      query: {},
      params: {},
      ip: '127.0.0.1',
      path: '/test',
      method: 'GET',
      get: jest.fn((header: string) => req.headers[header.toLowerCase()]),
      user: null,
      session: null,
      securityContext: null,
      securityFlags: null,
    };

    const res: any = {
      status: jest.fn(() => res),
      json: jest.fn(() => res),
      send: jest.fn(() => res),
      set: jest.fn(() => res),
      cookie: jest.fn(() => res),
      clearCookie: jest.fn(() => res),
      redirect: jest.fn(() => res),
      end: jest.fn(() => res),
      headers: {},
    };

    const next = jest.fn();

    return { req, res, next };
  }
}

// Test utilities
export class TestUtilities {
  static async waitFor(condition: () => boolean | Promise<boolean>, timeout = 5000): Promise<void> {
    const start = Date.now();

    while (Date.now() - start < timeout) {
      const result = await Promise.resolve(condition());
      if (result) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    throw new Error(`Condition not met within ${timeout}ms`);
  }

  static createJWT(payload: any, secret = 'test-secret'): string {
    return jwt.sign(payload, secret);
  }

  static async simulateNetworkDelay(ms = 100): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
  }

  static generateRandomBytes(length: number): Buffer {
    return randomBytes(length);
  }

  static createBatchRequests<T>(count: number, generator: (index: number) => T): T[] {
    return Array.from({ length: count }, (_, i) => generator(i));
  }

  static async executeInParallel<T>(
    tasks: (() => Promise<T>)[],
    maxConcurrency = 10
  ): Promise<T[]> {
    const results: T[] = [];
    const executing: Promise<void>[] = [];

    for (let i = 0; i < tasks.length; i++) {
      const task = tasks[i];
      const promise = task().then(result => {
        results[i] = result;
      });

      executing.push(promise);

      if (executing.length >= maxConcurrency) {
        await Promise.race(executing);
        const completed = executing.findIndex(p => p === promise);
        if (completed !== -1) {
          executing.splice(completed, 1);
        }
      }
    }

    await Promise.all(executing);
    return results;
  }

  static createSecurityTestCases() {
    return {
      sqlInjection: [
        "'; DROP TABLE users; --",
        "' OR '1'='1",
        "1'; EXEC xp_cmdshell('dir'); --",
        "' UNION SELECT * FROM users --",
      ],
      xss: [
        '<script>alert("XSS")</script>',
        '<img src=x onerror=alert("XSS")>',
        'javascript:alert("XSS")',
        '<svg onload=alert("XSS")>',
      ],
      commandInjection: [
        '; rm -rf /',
        '| cat /etc/passwd',
        '&& shutdown -h now',
        '`whoami`',
      ],
      pathTraversal: [
        '../../../etc/passwd',
        '..\\..\\..\\windows\\system32\\config\\sam',
        '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
      ],
      noSqlInjection: [
        '{"$where": "this.password.match(/.*/)"}',
        '{"$ne": null}',
        '{"$regex": ".*"}',
        '{"$gt": ""}',
      ],
    };
  }
}

// Performance test helpers
export class PerformanceTestHelpers {
  static async measureExecutionTime<T>(fn: () => Promise<T>): Promise<{ result: T; duration: number }> {
    const start = process.hrtime.bigint();
    const result = await fn();
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000; // Convert to milliseconds

    return { result, duration };
  }

  static async measureMemoryUsage<T>(fn: () => Promise<T>): Promise<{ result: T; memoryDelta: number }> {
    if (global.gc) global.gc(); // Force garbage collection

    const memBefore = process.memoryUsage();
    const result = await fn();

    if (global.gc) global.gc(); // Force garbage collection
    const memAfter = process.memoryUsage();

    const memoryDelta = memAfter.heapUsed - memBefore.heapUsed;

    return { result, memoryDelta };
  }

  static async stressTest<T>(
    operation: () => Promise<T>,
    options: {
      concurrent: number;
      duration: number;
      errorThreshold?: number;
    }
  ): Promise<{
    totalRequests: number;
    successful: number;
    failed: number;
    averageResponseTime: number;
    maxResponseTime: number;
    minResponseTime: number;
    errors: Error[];
  }> {
    const { concurrent, duration, errorThreshold = 0.1 } = options;
    const startTime = Date.now();
    const endTime = startTime + duration;

    let totalRequests = 0;
    let successful = 0;
    let failed = 0;
    const responseTimes: number[] = [];
    const errors: Error[] = [];

    const workers = Array.from({ length: concurrent }, async () => {
      while (Date.now() < endTime) {
        totalRequests++;
        const requestStart = Date.now();

        try {
          await operation();
          successful++;
          responseTimes.push(Date.now() - requestStart);
        } catch (error) {
          failed++;
          errors.push(error as Error);
        }
      }
    });

    await Promise.all(workers);

    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    const maxResponseTime = responseTimes.length > 0 ? Math.max(...responseTimes) : 0;
    const minResponseTime = responseTimes.length > 0 ? Math.min(...responseTimes) : 0;

    const errorRate = failed / totalRequests;
    if (errorRate > errorThreshold) {
      throw new Error(`Error rate ${errorRate} exceeded threshold ${errorThreshold}`);
    }

    return {
      totalRequests,
      successful,
      failed,
      averageResponseTime,
      maxResponseTime,
      minResponseTime,
      errors,
    };
  }
}