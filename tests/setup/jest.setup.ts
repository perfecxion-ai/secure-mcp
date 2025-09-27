import dotenv from 'dotenv';
import { TextEncoder, TextDecoder } from 'util';

// Load test environment variables
dotenv.config({ path: '.env.test' });

// Global polyfills for Node.js environment
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as any;

// Set test environment variables
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://test:test@localhost:5432/secure_mcp_test';
process.env.REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';
process.env.VAULT_URL = process.env.VAULT_URL || 'http://localhost:8200';
process.env.VAULT_TOKEN = process.env.VAULT_TOKEN || 'test-token';
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-jwt-secret-must-be-at-least-32-characters-long';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'test-session-secret-must-be-at-least-32-characters-long';

// Mock external dependencies that shouldn't run in tests
jest.mock('pino', () => ({
  __esModule: true,
  default: jest.fn(() => ({
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
  })),
}));

// Mock Vault client
jest.mock('node-vault', () => ({
  __esModule: true,
  default: jest.fn(() => ({
    read: jest.fn(),
    write: jest.fn(),
    health: jest.fn(() => Promise.resolve({ status: 'ok' })),
  })),
}));

// Mock Prisma client
jest.mock('@prisma/client', () => ({
  PrismaClient: jest.fn().mockImplementation(() => ({
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    $queryRaw: jest.fn(),
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    session: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  })),
}));

// Increase timeout for all tests
jest.setTimeout(30000);

// Suppress console logs during tests unless explicitly testing logging
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Global test utilities
global.createTestUser = () => ({
  id: 'test-user-id',
  email: 'test@example.com',
  roles: ['user'],
  permissions: ['basic'],
  mfaVerified: false,
  sessionId: 'test-session-id',
});

global.createTestSession = () => ({
  id: 'test-session-id',
  userId: 'test-user-id',
  createdAt: new Date(),
  lastActivity: new Date(),
  ipAddress: '127.0.0.1',
  userAgent: 'test-agent',
});

global.sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mock timers for consistent testing
jest.useFakeTimers({
  doNotFake: [
    'nextTick',
    'setImmediate',
    'clearImmediate',
  ],
});