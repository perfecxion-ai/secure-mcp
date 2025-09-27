import { createServer } from 'http';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { config } from './config/config';
import { logger } from './utils/logger';
import { initializeDatabase } from './database/connection';
import { initializeRedis } from './database/redis';
import { initializeVault } from './security/vault';
import { setupMetrics, metricsMiddleware } from './monitoring/metrics';
import { setupTracing } from './monitoring/tracing';
import { authRouter } from './auth/routes';
import { mcpRouter } from './server/routes';
import { WebSocketManager } from './server/websocket-manager';
import { SecurityMiddleware } from './security/middleware';
import { errorHandler } from './utils/error-handler';
import { gracefulShutdown } from './utils/shutdown';
import cluster from 'cluster';
import os from 'os';

async function startServer(): Promise<void> {
  try {
    await setupTracing();

    await initializeDatabase();
    await initializeRedis();
    await initializeVault();

    const app = express();
    const server = createServer(app);
    const io = new SocketIOServer(server, {
      cors: {
        origin: config.cors.origins,
        credentials: config.cors.credentials,
      },
      transports: ['websocket'],
      pingTimeout: 60000,
      pingInterval: 25000,
    });

    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'https:'],
        },
      },
      hsts: {
        maxAge: 31536000,
        includeSubDomains: true,
        preload: true,
      },
    }));

    app.use(cors({
      origin: config.cors.origins,
      credentials: config.cors.credentials,
      maxAge: config.cors.maxAge,
    }));

    const limiter = rateLimit({
      windowMs: config.rateLimit.windowMs,
      max: config.rateLimit.maxRequests,
      message: 'Too many requests from this IP, please try again later.',
      standardHeaders: true,
      legacyHeaders: false,
      skipSuccessfulRequests: config.rateLimit.skipSuccessfulRequests,
      skipFailedRequests: config.rateLimit.skipFailedRequests,
    });

    app.use(limiter);
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    setupMetrics(app);
    app.use(metricsMiddleware);

    app.use(SecurityMiddleware.validateInput);
    app.use(SecurityMiddleware.sanitizeOutput);
    app.use(SecurityMiddleware.checkSecurityHeaders);

    app.get('/health', (req, res) => {
      res.json({
        status: 'healthy',
        version: process.env.npm_package_version,
        timestamp: new Date().toISOString(),
      });
    });

    app.get('/ready', async (req, res) => {
      try {
        const checks = await Promise.all([
          checkDatabaseConnection(),
          checkRedisConnection(),
          checkVaultConnection(),
        ]);

        if (checks.every(check => check)) {
          res.json({ status: 'ready' });
        } else {
          res.status(503).json({ status: 'not ready' });
        }
      } catch (error) {
        logger.error('Readiness check failed', { error });
        res.status(503).json({ status: 'not ready' });
      }
    });

    app.use('/api/auth', authRouter);
    app.use('/api/mcp', mcpRouter);

    const wsManager = new WebSocketManager(io);
    await wsManager.initialize();

    app.use(errorHandler);

    server.listen(config.server.port, config.server.host, () => {
      logger.info(`Server running on ${config.server.host}:${config.server.port}`);
      logger.info(`Environment: ${config.env}`);
      logger.info(`Worker PID: ${process.pid}`);
    });

    process.on('SIGTERM', () => gracefulShutdown(server));
    process.on('SIGINT', () => gracefulShutdown(server));

  } catch (error) {
    logger.error('Failed to start server', { error });
    process.exit(1);
  }
}

async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const { prisma } = await import('./database/prisma');
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

async function checkRedisConnection(): Promise<boolean> {
  try {
    const { redis } = await import('./database/redis');
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

async function checkVaultConnection(): Promise<boolean> {
  try {
    const { vault } = await import('./security/vault');
    await vault.health();
    return true;
  } catch {
    return false;
  }
}

if (config.clustering.enabled && cluster.isPrimary) {
  const numWorkers = config.clustering.workers === 'auto'
    ? os.cpus().length
    : config.clustering.workers;

  logger.info(`Starting ${numWorkers} workers`);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    logger.error(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork();
  });
} else {
  startServer().catch((error) => {
    logger.error('Server startup failed', { error });
    process.exit(1);
  });
}