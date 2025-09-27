import { jest } from '@jest/globals';

// Clean up after each test
afterEach(async () => {
  // Clear all mocks
  jest.clearAllMocks();

  // Reset modules
  jest.resetModules();

  // Clear any timers
  jest.clearAllTimers();

  // Clean up any test data or connections
  await cleanupTestResources();
});

// Clean up after all tests
afterAll(async () => {
  // Final cleanup
  await cleanupTestResources();

  // Use real timers for cleanup
  jest.useRealTimers();
});

async function cleanupTestResources(): Promise<void> {
  // Clean up Redis connections if any test created them
  try {
    const redis = require('../../src/database/redis');
    if (redis.redis && typeof redis.redis.disconnect === 'function') {
      await redis.redis.disconnect();
    }
  } catch (error) {
    // Ignore cleanup errors in tests
  }

  // Clean up database connections if any test created them
  try {
    const db = require('../../src/database/connection');
    if (db.prisma && typeof db.prisma.$disconnect === 'function') {
      await db.prisma.$disconnect();
    }
  } catch (error) {
    // Ignore cleanup errors in tests
  }

  // Clean up any other test resources
  try {
    // Close any open file descriptors
    if (global.gc) {
      global.gc();
    }
  } catch (error) {
    // Ignore cleanup errors in tests
  }
}