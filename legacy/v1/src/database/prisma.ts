// Re-export prisma client for easier imports
export { prisma } from './connection';

// Export common database operations and utilities
export {
  initializeDatabase,
  disconnectDatabase,
  getDatabaseHealth,
  executeRawQuery,
  executeTransaction,
  bulkInsert,
  cleanupExpiredRecords,
  getDatabaseStats,
  optimizeDatabase,
} from './connection';