import { PrismaClient, Prisma } from '@prisma/client';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { z } from 'zod';
import * as DOMPurify from 'isomorphic-dompurify';

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
      // Enhanced security configuration for development
      errorFormat: config.env === 'development' ? 'pretty' : 'minimal',
    });

    // Set up event listeners for logging with security monitoring
    (prisma as any).$on('query', (e: any) => {
      // Log queries in development mode
      if (config.env === 'development') {
        logger.debug('Database query', {
          query: e.query,
          params: e.params,
          duration: e.duration,
        });
      }

      // Security monitoring for production
      if (config.env === 'production') {
        // Detect potential SQL injection patterns
        const suspiciousPatterns = [
          /UNION\s+SELECT/i,
          /DROP\s+TABLE/i,
          /INSERT\s+INTO.*VALUES.*\(/i,
          /DELETE\s+FROM.*WHERE.*OR.*=/i,
          /UPDATE.*SET.*WHERE.*OR.*=/i,
          /--/,
          /\/\*/,
          /\*\//,
          /'.*OR.*'/i,
          /".*OR.*"/i,
        ];

        const hasSuspiciousPattern = suspiciousPatterns.some(pattern =>
          pattern.test(e.query)
        );

        if (hasSuspiciousPattern) {
          logger.warn('Suspicious query pattern detected', {
            query: e.query.substring(0, 200),
            duration: e.duration,
            timestamp: new Date().toISOString(),
          });
        }

        // Log slow queries (> 1 second)
        if (e.duration > 1000) {
          logger.warn('Slow query detected', {
            query: e.query.substring(0, 200),
            duration: e.duration,
            timestamp: new Date().toISOString(),
          });
        }
      }
    });

    (prisma as any).$on('error', (e: any) => {
      logger.error('Database error', {
        target: e.target,
        message: e.message,
      });
    });

    (prisma as any).$on('info', (e: any) => {
      logger.info('Database info', {
        target: e.target,
        message: e.message,
      });
    });

    (prisma as any).$on('warn', (e: any) => {
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

// SQL Query allowlist for dynamic queries
const ALLOWED_QUERY_PATTERNS = [
  /^SELECT 1$/,
  /^SELECT schemaname, tablename, attname, n_distinct, correlation FROM pg_stats WHERE schemaname = \$1 ORDER BY tablename, attname$/,
  /^SELECT schemaname, tablename, n_tup_ins as inserts, n_tup_upd as updates, n_tup_del as deletes, n_live_tup as live_tuples, n_dead_tup as dead_tuples FROM pg_stat_user_tables WHERE schemaname = \$1 ORDER BY tablename$/,
  /^DELETE FROM sessions WHERE expires_at < NOW\(\)$/,
  /^DELETE FROM tokens WHERE expires_at < NOW\(\)$/,
  /^DELETE FROM audit_logs WHERE created_at < NOW\(\) - INTERVAL '30 days'$/,
  /^DELETE FROM metrics WHERE created_at < NOW\(\) - INTERVAL '7 days'$/,
  /^ANALYZE$/,
  /^SELECT tablename FROM pg_tables WHERE schemaname = \$1$/,
  /^VACUUM ANALYZE "[a-zA-Z_][a-zA-Z0-9_]*"$/
];

// Input validation schemas
const QueryParamsSchema = z.array(z.union([
  z.string().max(1000),
  z.number(),
  z.boolean(),
  z.date(),
  z.null()
]));

const TableNameSchema = z.string()
  .regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/, 'Invalid table name format')
  .max(63); // PostgreSQL limit

/**
 * Validate and sanitize SQL query parameters
 */
const validateQueryParams = (params: any[]): any[] => {
  const validatedParams = QueryParamsSchema.parse(params);

  return validatedParams.map(param => {
    if (typeof param === 'string') {
      // Sanitize string parameters to prevent injection
      return DOMPurify.sanitize(param, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
        USE_PROFILES: { html: false }
      });
    }
    return param;
  });
};

/**
 * Check if query matches allowlisted patterns
 */
const isQueryAllowed = (query: string): boolean => {
  const normalizedQuery = query.trim().replace(/\s+/g, ' ');
  return ALLOWED_QUERY_PATTERNS.some(pattern => pattern.test(normalizedQuery));
};

/**
 * Execute parameterized SQL query with strict validation
 * SECURITY: Replaced $queryRawUnsafe with parameterized queries
 */
export const executeRawQuery = async (query: string, params: any[] = []): Promise<any> => {
  try {
    // Validate query against allowlist
    if (!isQueryAllowed(query)) {
      const error = new Error('Query not in allowlist');
      logger.error('Unauthorized query attempted', {
        query: query.substring(0, 100),
        error
      });
      throw error;
    }

    // Validate and sanitize parameters
    const sanitizedParams = validateQueryParams(params);

    logger.debug('Executing parameterized query', {
      query: query.substring(0, 100),
      paramCount: sanitizedParams.length
    });

    // Use parameterized query instead of unsafe raw query
    return await prisma.$queryRaw(Prisma.sql([query], ...sanitizedParams));
  } catch (error) {
    logger.error('Parameterized query execution failed', {
      error,
      query: query.substring(0, 100),
      paramCount: params.length
    });
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
 * Bulk insert with conflict resolution and SQL injection prevention
 * SECURITY: Added table name validation and parameterized operations
 */
export const bulkInsert = async (
  table: string,
  data: any[],
  conflictStrategy: 'ignore' | 'update' | 'error' = 'ignore'
): Promise<{ inserted: number; updated: number; errors: number }> => {
  if (data.length === 0) {
    return { inserted: 0, updated: 0, errors: 0 };
  }

  // Validate table name to prevent SQL injection
  const validatedTableName = TableNameSchema.parse(table);

  // Verify table exists in our schema
  const allowedTables = ['users', 'sessions', 'tokens', 'audit_logs', 'metrics', 'mfa_secrets'];
  if (!allowedTables.includes(validatedTableName)) {
    throw new Error(`Table '${validatedTableName}' not in allowed list`);
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
              // Validate and sanitize item data
              const sanitizedItem = Object.fromEntries(
                Object.entries(item).map(([key, value]) => [
                  key,
                  typeof value === 'string' ? DOMPurify.sanitize(value, {
                    ALLOWED_TAGS: [],
                    ALLOWED_ATTR: [],
                    USE_PROFILES: { html: false }
                  }) : value
                ])
              );

              // Use type-safe prisma operations instead of dynamic table access
              const result = await (tx as any)[validatedTableName].upsert({
                where: { id: sanitizedItem.id },
                create: sanitizedItem,
                update: conflictStrategy === 'update' ? sanitizedItem : {},
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
              logger.warn('Bulk insert item error', {
                error: itemError,
                table: validatedTableName
              });
            }
          }
        });
      } catch (batchError) {
        logger.error('Bulk insert batch error', {
          error: batchError,
          table: validatedTableName,
          batchSize: batch.length
        });
        errors += batch.length;

        if (conflictStrategy === 'error') {
          throw batchError;
        }
      }
    }

    logger.info('Bulk insert completed', {
      table: validatedTableName,
      total: data.length,
      inserted,
      updated,
      errors,
    });

    return { inserted, updated, errors };

  } catch (error) {
    logger.error('Bulk insert failed', {
      error,
      table: validatedTableName,
      dataLength: data.length
    });
    throw error;
  }
};

/**
 * Database cleanup utilities with parameterized queries
 * SECURITY: Using template literals with Prisma.sql for safe parameterization
 */
export const cleanupExpiredRecords = async (): Promise<void> => {
  try {
    const cleanupTasks = [
      // Clean up expired sessions - using parameterized query
      prisma.$executeRaw`DELETE FROM sessions WHERE expires_at < NOW()`,

      // Clean up expired tokens - using parameterized query
      prisma.$executeRaw`DELETE FROM tokens WHERE expires_at < NOW()`,

      // Clean up old logs (older than 30 days) - using parameterized query
      prisma.$executeRaw`DELETE FROM audit_logs WHERE created_at < NOW() - INTERVAL '30 days'`,

      // Clean up old metrics (older than 7 days) - using parameterized query
      prisma.$executeRaw`DELETE FROM metrics WHERE created_at < NOW() - INTERVAL '7 days'`,
    ];

    const results = await Promise.allSettled(cleanupTasks);

    // Log results for audit trail
    results.forEach((result, index) => {
      const taskNames = ['sessions', 'tokens', 'audit_logs', 'metrics'];
      if (result.status === 'fulfilled') {
        logger.info(`Cleanup task completed: ${taskNames[index]}`);
      } else {
        logger.error(`Cleanup task failed: ${taskNames[index]}`, { error: result.reason });
      }
    });

    logger.info('Database cleanup completed');
  } catch (error) {
    logger.error('Database cleanup failed', { error });
  }
};

/**
 * Get database statistics with parameterized queries
 * SECURITY: Using parameterized queries with schema validation
 */
export const getDatabaseStats = async (): Promise<any> => {
  try {
    const schemaName = 'public';

    // Validate schema name
    const validatedSchema = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).parse(schemaName);

    const stats = await prisma.$queryRaw`
      SELECT
        schemaname,
        tablename,
        attname,
        n_distinct,
        correlation
      FROM pg_stats
      WHERE schemaname = ${validatedSchema}
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
      WHERE schemaname = ${validatedSchema}
      ORDER BY tablename
    `;

    logger.info('Database statistics retrieved', {
      columnStatsCount: (stats as any[]).length,
      tableStatsCount: (tableStats as any[]).length
    });

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
 * Optimize database performance with safe operations
 * SECURITY: Using parameterized queries and table name validation
 */
export const optimizeDatabase = async (): Promise<void> => {
  try {
    // Analyze tables for better query planning
    await prisma.$executeRaw`ANALYZE`;

    const schemaName = 'public';
    const validatedSchema = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]*$/).parse(schemaName);

    // Get table list with parameterized query
    const tables = await prisma.$queryRaw`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = ${validatedSchema}
    ` as { tablename: string }[];

    // Validate and optimize each table
    for (const table of tables) {
      try {
        // Validate table name to prevent injection
        const validatedTableName = TableNameSchema.parse(table.tablename);

        // Use Prisma.sql for safe dynamic table name interpolation
        await prisma.$executeRaw`VACUUM ANALYZE ${Prisma.raw(`"${validatedTableName}"`)}}`;

        logger.debug('Table optimized', { table: validatedTableName });
      } catch (tableError) {
        logger.warn('Failed to optimize table', {
          table: table.tablename,
          error: tableError
        });
      }
    }

    logger.info('Database optimization completed', {
      tablesProcessed: tables.length
    });
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