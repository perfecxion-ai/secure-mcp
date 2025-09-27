import { Server } from 'http';
import { logger } from './logger';
import { disconnectDatabase } from '../database/connection';
import { disconnectRedis } from '../database/redis';

/**
 * Graceful shutdown handler
 */
export const gracefulShutdown = (server: Server): void => {
  logger.info('Received shutdown signal, initiating graceful shutdown');

  const shutdownTimeout = setTimeout(() => {
    logger.error('Forced shutdown due to timeout');
    process.exit(1);
  }, 30000); // 30 seconds timeout

  // Stop accepting new connections
  server.close(async (error?: Error) => {
    clearTimeout(shutdownTimeout);

    if (error) {
      logger.error('Error during server shutdown', { error });
    } else {
      logger.info('HTTP server closed');
    }

    try {
      // Close database connections
      logger.info('Closing database connections');
      await disconnectDatabase();

      // Close Redis connections
      logger.info('Closing Redis connections');
      await disconnectRedis();

      logger.info('Graceful shutdown completed successfully');
      process.exit(error ? 1 : 0);

    } catch (shutdownError) {
      logger.error('Error during graceful shutdown', { error: shutdownError });
      process.exit(1);
    }
  });
};