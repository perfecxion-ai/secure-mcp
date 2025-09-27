import { Request, Response, NextFunction } from 'express';
import { Socket } from 'socket.io';
import { JWTService, JWTPayload } from './jwt-service';
import { MFAService } from './mfa-service';
import { logger } from '../utils/logger';
import { redis } from '../database/redis';
import { config } from '../config/config';

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      session?: AuthSession;
    }
  }
}

export interface AuthenticatedUser {
  id: string;
  email: string;
  roles: string[];
  permissions: string[];
  mfaVerified: boolean;
  sessionId: string;
}

export interface AuthSession {
  id: string;
  userId: string;
  createdAt: Date;
  lastActivity: Date;
  ipAddress: string;
  userAgent: string;
}

export class AuthMiddleware {
  private jwtService: JWTService;
  private mfaService: MFAService;

  constructor(jwtService: JWTService, mfaService: MFAService) {
    this.jwtService = jwtService;
    this.mfaService = mfaService;
  }

  /**
   * Middleware to authenticate JWT tokens
   */
  public authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        res.status(401).json({ error: 'Authorization header required' });
        return;
      }

      const token = this.jwtService.extractTokenFromHeader(authHeader);
      if (!token) {
        res.status(401).json({ error: 'Invalid authorization header format' });
        return;
      }

      if (!this.jwtService.isValidTokenFormat(token)) {
        res.status(401).json({ error: 'Invalid token format' });
        return;
      }

      const payload = await this.jwtService.verifyAccessToken(token);

      // Get session information
      const session = await this.getSession(payload.sessionId);
      if (!session) {
        res.status(401).json({ error: 'Session not found or expired' });
        return;
      }

      // Update session activity
      await this.updateSessionActivity(session.id, req.ip, req.get('User-Agent') || '');

      req.user = {
        id: payload.sub,
        email: payload.email,
        roles: payload.roles,
        permissions: payload.permissions,
        mfaVerified: payload.mfaVerified,
        sessionId: payload.sessionId,
      };

      req.session = session;

      logger.debug('User authenticated', {
        userId: req.user.id,
        sessionId: req.user.sessionId,
        ip: req.ip,
      });

      next();

    } catch (error) {
      logger.warn('Authentication failed', {
        error: error.message,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
      });

      res.status(401).json({ error: 'Authentication failed' });
    }
  };

  /**
   * Middleware to require MFA verification
   */
  public requireMFA = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }

    // Check if MFA is enabled for user
    const mfaEnabled = await this.mfaService.isMFAEnabled(req.user.id);

    if (mfaEnabled && !req.user.mfaVerified) {
      res.status(403).json({
        error: 'MFA verification required',
        mfaRequired: true,
      });
      return;
    }

    next();
  };

  /**
   * Middleware to check user roles
   */
  public requireRoles = (...roles: string[]) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const hasRole = roles.some(role => req.user!.roles.includes(role) || req.user!.roles.includes('admin'));

      if (!hasRole) {
        logger.warn('Access denied - insufficient roles', {
          userId: req.user.id,
          requiredRoles: roles,
          userRoles: req.user.roles,
        });

        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }

      next();
    };
  };

  /**
   * Middleware to check user permissions
   */
  public requirePermissions = (...permissions: string[]) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      if (!req.user) {
        res.status(401).json({ error: 'Authentication required' });
        return;
      }

      const hasPermission = permissions.some(permission => {
        return req.user!.permissions.includes(permission) ||
               req.user!.permissions.includes('*') ||
               req.user!.permissions.some(p => p.endsWith('*') && permission.startsWith(p.slice(0, -1)));
      });

      if (!hasPermission) {
        logger.warn('Access denied - insufficient permissions', {
          userId: req.user.id,
          requiredPermissions: permissions,
          userPermissions: req.user.permissions,
        });

        res.status(403).json({ error: 'Insufficient permissions' });
        return;
      }

      next();
    };
  };

  /**
   * Optional authentication middleware (doesn't fail if no auth)
   */
  public optionalAuth = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        next();
        return;
      }

      const token = this.jwtService.extractTokenFromHeader(authHeader);
      if (!token) {
        next();
        return;
      }

      const payload = await this.jwtService.verifyAccessToken(token);
      const session = await this.getSession(payload.sessionId);

      if (session) {
        await this.updateSessionActivity(session.id, req.ip, req.get('User-Agent') || '');

        req.user = {
          id: payload.sub,
          email: payload.email,
          roles: payload.roles,
          permissions: payload.permissions,
          mfaVerified: payload.mfaVerified,
          sessionId: payload.sessionId,
        };

        req.session = session;
      }

    } catch (error) {
      logger.debug('Optional authentication failed', { error: error.message });
    }

    next();
  };

  /**
   * Rate limiting middleware based on user
   */
  public userRateLimit = (maxRequests: number, windowMs: number) => {
    return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      const identifier = req.user?.id || req.ip;
      const key = `rate_limit:${identifier}`;

      try {
        const current = await redis.incr(key);

        if (current === 1) {
          await redis.expire(key, Math.ceil(windowMs / 1000));
        }

        if (current > maxRequests) {
          const ttl = await redis.ttl(key);

          res.set({
            'X-RateLimit-Limit': maxRequests.toString(),
            'X-RateLimit-Remaining': '0',
            'X-RateLimit-Reset': (Date.now() + ttl * 1000).toString(),
          });

          logger.warn('Rate limit exceeded', {
            identifier,
            current,
            max: maxRequests,
            userId: req.user?.id,
          });

          res.status(429).json({
            error: 'Too many requests',
            retryAfter: ttl,
          });
          return;
        }

        res.set({
          'X-RateLimit-Limit': maxRequests.toString(),
          'X-RateLimit-Remaining': (maxRequests - current).toString(),
        });

        next();

      } catch (error) {
        logger.error('Rate limiting error', { error, identifier });
        next(); // Continue on redis errors
      }
    };
  };

  /**
   * Session timeout middleware
   */
  public checkSessionTimeout = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.session) {
      next();
      return;
    }

    const sessionAge = Date.now() - req.session.lastActivity.getTime();
    const timeout = config.session.timeout;

    if (sessionAge > timeout) {
      logger.info('Session expired', {
        sessionId: req.session.id,
        userId: req.user?.id,
        age: sessionAge,
        timeout,
      });

      // Clean up session
      await this.deleteSession(req.session.id);

      res.status(401).json({
        error: 'Session expired',
        sessionExpired: true,
      });
      return;
    }

    next();
  };

  /**
   * IP whitelist middleware
   */
  public ipWhitelist = (allowedIPs: string[]) => {
    return (req: Request, res: Response, next: NextFunction): void => {
      const clientIP = req.ip;

      if (!allowedIPs.includes(clientIP)) {
        logger.warn('Access denied - IP not whitelisted', {
          clientIP,
          allowedIPs,
          userId: req.user?.id,
        });

        res.status(403).json({ error: 'Access denied from this IP address' });
        return;
      }

      next();
    };
  };

  /**
   * Create a new session
   */
  public async createSession(userId: string, ipAddress: string, userAgent: string): Promise<AuthSession> {
    const sessionId = require('crypto').randomUUID();
    const now = new Date();

    const session: AuthSession = {
      id: sessionId,
      userId,
      createdAt: now,
      lastActivity: now,
      ipAddress,
      userAgent,
    };

    await redis.setex(`session:${sessionId}`, config.session.timeout / 1000, JSON.stringify(session));
    await redis.sadd(`user_sessions:${userId}`, sessionId);

    logger.info('Session created', { sessionId, userId, ipAddress });

    return session;
  }

  /**
   * Get session by ID
   */
  public async getSession(sessionId: string): Promise<AuthSession | null> {
    try {
      const sessionData = await redis.get(`session:${sessionId}`);
      if (!sessionData) return null;

      const session = JSON.parse(sessionData);
      return {
        ...session,
        createdAt: new Date(session.createdAt),
        lastActivity: new Date(session.lastActivity),
      };

    } catch (error) {
      logger.error('Failed to get session', { error, sessionId });
      return null;
    }
  }

  /**
   * Update session activity
   */
  public async updateSessionActivity(sessionId: string, ipAddress: string, userAgent: string): Promise<void> {
    try {
      const session = await this.getSession(sessionId);
      if (!session) return;

      session.lastActivity = new Date();
      session.ipAddress = ipAddress;
      session.userAgent = userAgent;

      await redis.setex(`session:${sessionId}`, config.session.timeout / 1000, JSON.stringify(session));

    } catch (error) {
      logger.error('Failed to update session activity', { error, sessionId });
    }
  }

  /**
   * Delete session
   */
  public async deleteSession(sessionId: string): Promise<void> {
    try {
      const session = await this.getSession(sessionId);
      if (session) {
        await redis.del(`session:${sessionId}`);
        await redis.srem(`user_sessions:${session.userId}`, sessionId);

        logger.info('Session deleted', { sessionId, userId: session.userId });
      }

    } catch (error) {
      logger.error('Failed to delete session', { error, sessionId });
    }
  }

  /**
   * Delete all sessions for a user
   */
  public async deleteAllUserSessions(userId: string): Promise<void> {
    try {
      const sessionIds = await redis.smembers(`user_sessions:${userId}`);

      for (const sessionId of sessionIds) {
        await redis.del(`session:${sessionId}`);
      }

      await redis.del(`user_sessions:${userId}`);

      logger.info('All user sessions deleted', { userId, count: sessionIds.length });

    } catch (error) {
      logger.error('Failed to delete user sessions', { error, userId });
    }
  }

  /**
   * Get all sessions for a user
   */
  public async getUserSessions(userId: string): Promise<AuthSession[]> {
    try {
      const sessionIds = await redis.smembers(`user_sessions:${userId}`);
      const sessions: AuthSession[] = [];

      for (const sessionId of sessionIds) {
        const session = await this.getSession(sessionId);
        if (session) {
          sessions.push(session);
        } else {
          // Clean up orphaned session ID
          await redis.srem(`user_sessions:${userId}`, sessionId);
        }
      }

      return sessions;

    } catch (error) {
      logger.error('Failed to get user sessions', { error, userId });
      return [];
    }
  }
}

/**
 * Socket.IO authentication middleware
 */
export const authenticateSocket = async (socket: Socket): Promise<AuthenticatedUser> => {
  const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.replace('Bearer ', '');

  if (!token) {
    throw new Error('No authentication token provided');
  }

  const jwtService = new JWTService();
  await jwtService.initialize();

  if (!jwtService.isValidTokenFormat(token)) {
    throw new Error('Invalid token format');
  }

  const payload = await jwtService.verifyAccessToken(token);

  return {
    id: payload.sub,
    email: payload.email,
    roles: payload.roles,
    permissions: payload.permissions,
    mfaVerified: payload.mfaVerified,
    sessionId: payload.sessionId,
  };
};

// Create singleton instances
export const jwtService = new JWTService();
export const mfaService = new MFAService();
export const authMiddleware = new AuthMiddleware(jwtService, mfaService);