import { PrismaClient } from '@prisma/client';
import { config } from '../config/config';
import { logger } from '../utils/logger';

// Prisma client instance
let prisma: PrismaClient;

/**
 * Initialize database connection
 */
export const initializeDatabase = async (): Promise<void> => {
  try {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: config.database.url,
        },
      },
      log: [
        {
          emit: 'event',
          level: 'query',
        },
        {
          emit: 'event',
          level: 'error',
        },
        {
          emit: 'event',
          level: 'info',
        },
        {
          emit: 'event',
          level: 'warn',
        },
      ],
    });

    // Set up event listeners for logging
    prisma.$on('query', (e) => {
      if (config.env === 'development') {
        logger.debug('Database query', {
          query: e.query,
          params: e.params,
          duration: e.duration,
        });
      }
    });

    prisma.$on('error', (e) => {
      logger.error('Database error', {
        target: e.target,
        message: e.message,
      });
    });

    prisma.$on('info', (e) => {
      logger.info('Database info', {
        target: e.target,
        message: e.message,
      });
    });

    prisma.$on('warn', (e) => {
      logger.warn('Database warning', {
        target: e.target,
        message: e.message,
      });
    });

    // Test connection
    await prisma.$connect();

    // Run a simple query to verify connection
    await prisma.$queryRaw`SELECT 1`;

    logger.info('Database connected successfully', {
      provider: 'postgresql',
      ssl: config.database.ssl,
      pool: {
        min: config.database.pool.min,
        max: config.database.pool.max,
      },
    });

  } catch (error) {
    logger.error('Failed to connect to database', { error });
    throw new Error(`Database connection failed: ${error.message}`);
  }
};

/**
 * Gracefully disconnect from database
 */
export const disconnectDatabase = async (): Promise<void> => {
  try {
    if (prisma) {
      await prisma.$disconnect();
      logger.info('Database disconnected successfully');
    }
  } catch (error) {
    logger.error('Error disconnecting from database', { error });
  }
};

/**
 * Get database health status
 */
export const getDatabaseHealth = async (): Promise<{
  status: 'healthy' | 'unhealthy';
  latency: number;
  error?: string;
}> => {
  try {
    const startTime = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const endTime = Date.now();

    return {
      status: 'healthy',
      latency: endTime - startTime,
    };
  } catch (error) {
    logger.error('Database health check failed', { error });
    return {
      status: 'unhealthy',
      latency: -1,
      error: error.message,
    };
  }
};

/**
 * Execute raw SQL query with error handling
 */
export const executeRawQuery = async (query: string, params?: any[]): Promise<any> => {
  try {
    logger.debug('Executing raw query', { query, params });
    return await prisma.$queryRawUnsafe(query, ...(params || []));
  } catch (error) {
    logger.error('Raw query execution failed', { error, query, params });
    throw error;
  }
};

/**
 * Execute transaction with retry logic
 */
export const executeTransaction = async <T>(
  operations: (tx: PrismaClient) => Promise<T>,
  maxRetries: number = 3
): Promise<T> => {
  let lastError: Error;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await prisma.$transaction(operations, {
        timeout: config.database.timeout,
        maxWait: 5000,
        isolationLevel: 'ReadCommitted',
      });
    } catch (error) {
      lastError = error;

      // Check if this is a retryable error
      if (isRetryableError(error) && attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff
        logger.warn(`Transaction failed, retrying in ${delay}ms`, {
          attempt,
          maxRetries,
          error: error.message,
        });

        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }

      logger.error('Transaction failed after all retries', {
        attempt,
        maxRetries,
        error,
      });
      throw error;
    }
  }

  throw lastError!;
};

/**
 * Check if error is retryable
 */
const isRetryableError = (error: any): boolean => {
  const retryableErrors = [
    'P2034', // Transaction failed due to a write conflict or deadlock
    'P2028', // Transaction API error
    'Connection',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
  ];

  const errorString = error.toString();
  return retryableErrors.some(pattern => errorString.includes(pattern));
};

/**
 * Bulk insert with conflict resolution
 */
export const bulkInsert = async (
  table: string,
  data: any[],
  conflictStrategy: 'ignore' | 'update' | 'error' = 'ignore'
): Promise<{ inserted: number; updated: number; errors: number }> => {
  if (data.length === 0) {
    return { inserted: 0, updated: 0, errors: 0 };
  }

  const batchSize = 1000;
  let inserted = 0;
  let updated = 0;
  let errors = 0;

  try {
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);

      try {
        await executeTransaction(async (tx) => {
          for (const item of batch) {
            try {
              const result = await (tx as any)[table].upsert({
                where: { id: item.id },
                create: item,
                update: conflictStrategy === 'update' ? item : {},
              });

              if (result.createdAt === result.updatedAt) {
                inserted++;
              } else {
                updated++;
              }
            } catch (itemError) {
              errors++;
              if (conflictStrategy === 'error') {
                throw itemError;
              }
              logger.warn('Bulk insert item error', { error: itemError, item });
            }
          }
        });
      } catch (batchError) {
        logger.error('Bulk insert batch error', { error: batchError, batchSize: batch.length });
        errors += batch.length;

        if (conflictStrategy === 'error') {
          throw batchError;
        }
      }
    }

    logger.info('Bulk insert completed', {
      table,
      total: data.length,
      inserted,
      updated,
      errors,
    });

    return { inserted, updated, errors };

  } catch (error) {
    logger.error('Bulk insert failed', { error, table, dataLength: data.length });
    throw error;
  }
};

/**
 * Database cleanup utilities
 */
export const cleanupExpiredRecords = async (): Promise<void> => {
  try {
    const cleanupTasks = [
      // Clean up expired sessions
      prisma.$executeRaw`DELETE FROM sessions WHERE expires_at < NOW()`,

      // Clean up expired tokens
      prisma.$executeRaw`DELETE FROM tokens WHERE expires_at < NOW()`,

      // Clean up old logs (older than 30 days)
      prisma.$executeRaw`DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '30 days'`,

      // Clean up old metrics (older than 7 days)
      prisma.$executeRaw`DELETE FROM metrics WHERE created_at < NOW() - INTERVAL '7 days'`,
    ];

    await Promise.allSettled(cleanupTasks);

    logger.info('Database cleanup completed');
  } catch (error) {
    logger.error('Database cleanup failed', { error });
  }
};

/**
 * Get database statistics
 */
export const getDatabaseStats = async (): Promise<any> => {
  try {
    const stats = await prisma.$queryRaw`
      SELECT
        schemaname,
        tablename,
        attname,
        n_distinct,
        correlation
      FROM pg_stats
      WHERE schemaname = 'public'
      ORDER BY tablename, attname
    `;

    const tableStats = await prisma.$queryRaw`
      SELECT
        schemaname,
        tablename,
        n_tup_ins as inserts,
        n_tup_upd as updates,
        n_tup_del as deletes,
        n_live_tup as live_tuples,
        n_dead_tup as dead_tuples
      FROM pg_stat_user_tables
      WHERE schemaname = 'public'
      ORDER BY tablename
    `;

    return {
      columnStats: stats,
      tableStats,
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Failed to get database stats', { error });
    return null;
  }
};

/**
 * Optimize database performance
 */
export const optimizeDatabase = async (): Promise<void> => {
  try {
    // Analyze tables for better query planning
    await prisma.$executeRaw`ANALYZE`;

    // Update table statistics
    const tables = await prisma.$queryRaw`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `;

    for (const table of tables as any[]) {
      await prisma.$executeRaw`VACUUM ANALYZE ${table.tablename}`;
    }

    logger.info('Database optimization completed');
  } catch (error) {
    logger.error('Database optimization failed', { error });
  }
};

// Export the prisma instance
export { prisma };

// Set up cleanup interval
if (config.env === 'production') {
  setInterval(() => {
    cleanupExpiredRecords().catch(error =>
      logger.error('Scheduled cleanup failed', { error })
    );
  }, 24 * 60 * 60 * 1000); // Run daily
}

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, closing database connection');
  await disconnectDatabase();
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, closing database connection');
  await disconnectDatabase();
});