import { Router, Request, Response } from 'express';
import { authMiddleware } from '../auth/middleware';
import { logger } from '../utils/logger';
import { Metrics } from '../monitoring/metrics';
import { TracingUtils, MCPTracing } from '../monitoring/tracing';
import { config } from '../config/config';

export const mcpRouter = Router();

/**
 * GET /mcp/info
 * Get MCP server information
 */
mcpRouter.get('/info', (req: Request, res: Response) => {
  res.json({
    name: 'secure-mcp-server',
    version: process.env.npm_package_version || '1.0.0',
    protocolVersion: config.mcp.protocolVersion,
    capabilities: {
      tools: {
        listChanged: true,
      },
      resources: {
        listChanged: true,
        subscribe: true,
      },
      logging: {},
    },
    serverInfo: {
      name: 'secure-mcp-server',
      version: process.env.npm_package_version || '1.0.0',
    },
    limits: {
      maxTools: config.mcp.maxTools,
      maxResources: config.mcp.maxResources,
      timeout: config.mcp.timeout,
      rateLimitPerConnection: config.mcp.rateLimitPerConnection,
    },
  });
});

/**
 * GET /mcp/status
 * Get MCP server status
 */
mcpRouter.get('/status', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    // This would typically get status from WebSocket manager
    const status = {
      connections: 0, // Would get from WebSocketManager
      messages: 0,    // Would get from WebSocketManager
      errors: 0,      // Would get from WebSocketManager
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: config.env,
    };

    res.json(status);

  } catch (error) {
    logger.error('Failed to get MCP status', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to get status' });
  }
});

/**
 * GET /mcp/metrics
 * Get MCP-specific metrics (requires admin role)
 */
mcpRouter.get('/metrics', [
  authMiddleware.authenticate,
  authMiddleware.requireRoles('admin'),
], async (req: Request, res: Response) => {
  try {
    const metrics = await Metrics.getMetrics();

    res.set('Content-Type', 'text/plain');
    res.send(metrics);

    logger.info('MCP metrics accessed', { userId: req.user?.id });

  } catch (error) {
    logger.error('Failed to get MCP metrics', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Failed to get metrics' });
  }
});

export default mcpRouter;