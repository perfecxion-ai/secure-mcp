import { AuthMiddleware, authenticateSocket } from '../../../src/auth/middleware';
import { JWTService } from '../../../src/auth/jwt-service';
import { MFAService } from '../../../src/auth/mfa-service';
import { MockFactory, TestDataGenerator } from '../../utils/test-helpers';
import { fixtures } from '../../utils/fixtures';

// Mock dependencies
jest.mock('../../../src/config/config', () => ({
  config: {
    session: {
      timeout: 3600000, // 1 hour
    },
  },
}));

jest.mock('../../../src/database/redis', () => ({
  redis: MockFactory.createMockRedis(),
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: MockFactory.createMockLogger(),
}));

describe('AuthMiddleware', () => {
  let authMiddleware: AuthMiddleware;
  let mockJWTService: jest.Mocked<JWTService>;
  let mockMFAService: jest.Mocked<MFAService>;
  let mockRedis: any;
  let mockLogger: any;

  beforeEach(() => {
    mockRedis = require('../../../src/database/redis').redis;
    mockLogger = require('../../../src/utils/logger').logger;

    // Mock JWT service
    mockJWTService = {
      extractTokenFromHeader: jest.fn(),
      isValidTokenFormat: jest.fn(),
      verifyAccessToken: jest.fn(),
      initialize: jest.fn(),
    } as any;

    // Mock MFA service
    mockMFAService = {
      isMFAEnabled: jest.fn(),
    } as any;

    authMiddleware = new AuthMiddleware(mockJWTService, mockMFAService);

    jest.clearAllMocks();
  });

  describe('authenticate middleware', () => {
    it('should authenticate valid JWT token', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.headers.authorization = 'Bearer valid-jwt-token';
      req.ip = '192.168.1.100';

      const mockPayload = fixtures.jwt.validPayload;
      const mockSession = fixtures.sessions.validSession;

      mockJWTService.extractTokenFromHeader.mockReturnValue('valid-jwt-token');
      mockJWTService.isValidTokenFormat.mockReturnValue(true);
      mockJWTService.verifyAccessToken.mockResolvedValue(mockPayload as any);
      mockRedis.get.mockResolvedValue(JSON.stringify(mockSession));

      await authMiddleware.authenticate(req, res, next);

      expect(req.user).toBeDefined();
      expect(req.user!.id).toBe(mockPayload.sub);
      expect(req.user!.email).toBe(mockPayload.email);
      expect(req.session).toBeDefined();
      expect(next).toHaveBeenCalledWith();
    });

    it('should reject request without authorization header', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      // No authorization header

      await authMiddleware.authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authorization header required' });
      expect(next).not.toHaveBeenCalled();
    });

    it('should reject invalid authorization header format', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.headers.authorization = 'Basic invalid-format';

      mockJWTService.extractTokenFromHeader.mockReturnValue(null);

      await authMiddleware.authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid authorization header format' });
    });

    it('should reject invalid token format', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.headers.authorization = 'Bearer invalid-token';

      mockJWTService.extractTokenFromHeader.mockReturnValue('invalid-token');
      mockJWTService.isValidTokenFormat.mockReturnValue(false);

      await authMiddleware.authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid token format' });
    });

    it('should reject expired or invalid JWT', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.headers.authorization = 'Bearer expired-jwt-token';

      mockJWTService.extractTokenFromHeader.mockReturnValue('expired-jwt-token');
      mockJWTService.isValidTokenFormat.mockReturnValue(true);
      mockJWTService.verifyAccessToken.mockRejectedValue(new Error('Token expired'));

      await authMiddleware.authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication failed' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Authentication failed',
        expect.objectContaining({
          error: 'Token expired',
        })
      );
    });

    it('should reject request with non-existent session', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.headers.authorization = 'Bearer valid-jwt-token';

      const mockPayload = fixtures.jwt.validPayload;

      mockJWTService.extractTokenFromHeader.mockReturnValue('valid-jwt-token');
      mockJWTService.isValidTokenFormat.mockReturnValue(true);
      mockJWTService.verifyAccessToken.mockResolvedValue(mockPayload as any);
      mockRedis.get.mockResolvedValue(null); // Session not found

      await authMiddleware.authenticate(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Session not found or expired' });
    });

    it('should update session activity on successful authentication', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.headers.authorization = 'Bearer valid-jwt-token';
      req.ip = '192.168.1.100';
      req.get = jest.fn().mockReturnValue('Mozilla/5.0 Test Browser');

      const mockPayload = fixtures.jwt.validPayload;
      const mockSession = fixtures.sessions.validSession;

      mockJWTService.extractTokenFromHeader.mockReturnValue('valid-jwt-token');
      mockJWTService.isValidTokenFormat.mockReturnValue(true);
      mockJWTService.verifyAccessToken.mockResolvedValue(mockPayload as any);
      mockRedis.get.mockResolvedValue(JSON.stringify(mockSession));

      await authMiddleware.authenticate(req, res, next);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `session:${mockSession.id}`,
        3600, // 1 hour in seconds
        expect.stringContaining(mockSession.userId)
      );
    });
  });

  describe('requireMFA middleware', () => {
    it('should allow requests when MFA is not enabled', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = fixtures.users.validUser as any;

      mockMFAService.isMFAEnabled.mockResolvedValue(false);

      await authMiddleware.requireMFA(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should allow requests when MFA is verified', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = { ...fixtures.users.validUser, mfaVerified: true } as any;

      mockMFAService.isMFAEnabled.mockResolvedValue(true);

      await authMiddleware.requireMFA(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject requests when MFA is required but not verified', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = { ...fixtures.users.validUser, mfaVerified: false } as any;

      mockMFAService.isMFAEnabled.mockResolvedValue(true);

      await authMiddleware.requireMFA(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({
        error: 'MFA verification required',
        mfaRequired: true,
      });
    });

    it('should reject requests without user authentication', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      // No req.user

      await authMiddleware.requireMFA(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    });
  });

  describe('requireRoles middleware', () => {
    it('should allow access with matching role', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = { ...fixtures.users.validUser, roles: ['user', 'editor'] } as any;

      const middleware = authMiddleware.requireRoles('editor');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should allow access with admin role (bypasses specific role check)', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = { ...fixtures.users.adminUser, roles: ['admin'] } as any;

      const middleware = authMiddleware.requireRoles('superuser');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject access without required role', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = { ...fixtures.users.validUser, roles: ['user'] } as any;

      const middleware = authMiddleware.requireRoles('editor');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Access denied - insufficient roles',
        expect.objectContaining({
          requiredRoles: ['editor'],
          userRoles: ['user'],
        })
      );
    });

    it('should handle multiple required roles', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = { ...fixtures.users.validUser, roles: ['user', 'editor'] } as any;

      const middleware = authMiddleware.requireRoles('editor', 'moderator');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject unauthenticated requests', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      // No req.user

      const middleware = authMiddleware.requireRoles('user');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
    });
  });

  describe('requirePermissions middleware', () => {
    it('should allow access with exact permission', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = { ...fixtures.users.validUser, permissions: ['read', 'write'] } as any;

      const middleware = authMiddleware.requirePermissions('write');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should allow access with wildcard permission', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = { ...fixtures.users.validUser, permissions: ['*'] } as any;

      const middleware = authMiddleware.requirePermissions('anything');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should allow access with prefix wildcard permission', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = { ...fixtures.users.validUser, permissions: ['admin:*'] } as any;

      const middleware = authMiddleware.requirePermissions('admin:users:create');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject access without required permission', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = { ...fixtures.users.validUser, permissions: ['read'] } as any;

      const middleware = authMiddleware.requirePermissions('write');
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Insufficient permissions' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Access denied - insufficient permissions',
        expect.objectContaining({
          requiredPermissions: ['write'],
          userPermissions: ['read'],
        })
      );
    });

    it('should handle multiple required permissions (OR logic)', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = { ...fixtures.users.validUser, permissions: ['read'] } as any;

      const middleware = authMiddleware.requirePermissions('write', 'read', 'delete');
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith(); // Should pass because user has 'read'
    });
  });

  describe('optionalAuth middleware', () => {
    it('should set user when valid token is provided', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.headers.authorization = 'Bearer valid-jwt-token';

      const mockPayload = fixtures.jwt.validPayload;
      const mockSession = fixtures.sessions.validSession;

      mockJWTService.extractTokenFromHeader.mockReturnValue('valid-jwt-token');
      mockJWTService.verifyAccessToken.mockResolvedValue(mockPayload as any);
      mockRedis.get.mockResolvedValue(JSON.stringify(mockSession));

      await authMiddleware.optionalAuth(req, res, next);

      expect(req.user).toBeDefined();
      expect(next).toHaveBeenCalledWith();
    });

    it('should continue without user when no token is provided', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      // No authorization header

      await authMiddleware.optionalAuth(req, res, next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
    });

    it('should continue without user when invalid token is provided', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.headers.authorization = 'Bearer invalid-token';

      mockJWTService.extractTokenFromHeader.mockReturnValue('invalid-token');
      mockJWTService.verifyAccessToken.mockRejectedValue(new Error('Invalid token'));

      await authMiddleware.optionalAuth(req, res, next);

      expect(req.user).toBeUndefined();
      expect(next).toHaveBeenCalledWith();
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Optional authentication failed',
        expect.objectContaining({
          error: 'Invalid token',
        })
      );
    });
  });

  describe('userRateLimit middleware', () => {
    it('should allow requests within rate limit', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = fixtures.users.validUser as any;

      mockRedis.incr.mockResolvedValue(5);
      mockRedis.expire.mockResolvedValue(1);

      const middleware = authMiddleware.userRateLimit(100, 60000);
      await middleware(req, res, next);

      expect(res.set).toHaveBeenCalledWith({
        'X-RateLimit-Limit': '100',
        'X-RateLimit-Remaining': '95',
      });
      expect(next).toHaveBeenCalledWith();
    });

    it('should reject requests exceeding rate limit', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = fixtures.users.validUser as any;

      mockRedis.incr.mockResolvedValue(101);
      mockRedis.ttl.mockResolvedValue(30);

      const middleware = authMiddleware.userRateLimit(100, 60000);
      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Too many requests',
        retryAfter: 30,
      });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Rate limit exceeded',
        expect.objectContaining({
          current: 101,
          max: 100,
        })
      );
    });

    it('should use IP address for unauthenticated requests', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.ip = '192.168.1.100';
      // No req.user

      mockRedis.incr.mockResolvedValue(5);

      const middleware = authMiddleware.userRateLimit(100, 60000);
      await middleware(req, res, next);

      expect(mockRedis.incr).toHaveBeenCalledWith('rate_limit:192.168.1.100');
      expect(next).toHaveBeenCalledWith();
    });

    it('should handle Redis errors gracefully', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.user = fixtures.users.validUser as any;

      mockRedis.incr.mockRejectedValue(new Error('Redis error'));

      const middleware = authMiddleware.userRateLimit(100, 60000);
      await middleware(req, res, next);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Rate limiting error',
        expect.objectContaining({
          error: expect.any(Error),
        })
      );
      expect(next).toHaveBeenCalledWith(); // Should continue despite error
    });
  });

  describe('checkSessionTimeout middleware', () => {
    it('should allow requests with active session', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.session = {
        ...fixtures.sessions.validSession,
        lastActivity: new Date(Date.now() - 1800000), // 30 minutes ago
      } as any;

      await authMiddleware.checkSessionTimeout(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject requests with expired session', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.session = {
        ...fixtures.sessions.validSession,
        lastActivity: new Date(Date.now() - 7200000), // 2 hours ago
      } as any;
      req.user = fixtures.users.validUser as any;

      await authMiddleware.checkSessionTimeout(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
        error: 'Session expired',
        sessionExpired: true,
      });
      expect(mockRedis.del).toHaveBeenCalledWith(`session:${req.session.id}`);
    });

    it('should continue when no session exists', async () => {
      const { req, res, next } = MockFactory.createMockExpress();
      // No req.session

      await authMiddleware.checkSessionTimeout(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });
  });

  describe('ipWhitelist middleware', () => {
    it('should allow requests from whitelisted IP', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.ip = '192.168.1.100';

      const middleware = authMiddleware.ipWhitelist(['192.168.1.100', '10.0.0.1']);
      middleware(req, res, next);

      expect(next).toHaveBeenCalledWith();
    });

    it('should reject requests from non-whitelisted IP', () => {
      const { req, res, next } = MockFactory.createMockExpress();
      req.ip = '192.168.1.200';
      req.user = fixtures.users.validUser as any;

      const middleware = authMiddleware.ipWhitelist(['192.168.1.100', '10.0.0.1']);
      middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(403);
      expect(res.json).toHaveBeenCalledWith({ error: 'Access denied from this IP address' });
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Access denied - IP not whitelisted',
        expect.objectContaining({
          clientIP: '192.168.1.200',
          allowedIPs: ['192.168.1.100', '10.0.0.1'],
        })
      );
    });
  });

  describe('session management methods', () => {
    it('should create new session', async () => {
      const userId = 'user-123';
      const ipAddress = '192.168.1.100';
      const userAgent = 'Mozilla/5.0 Test';

      const session = await authMiddleware.createSession(userId, ipAddress, userAgent);

      expect(session.userId).toBe(userId);
      expect(session.ipAddress).toBe(ipAddress);
      expect(session.userAgent).toBe(userAgent);
      expect(session.id).toBeValidUUID();

      expect(mockRedis.setex).toHaveBeenCalledWith(
        `session:${session.id}`,
        3600, // 1 hour
        expect.stringContaining(userId)
      );
      expect(mockRedis.sadd).toHaveBeenCalledWith(
        `user_sessions:${userId}`,
        session.id
      );
    });

    it('should get existing session', async () => {
      const sessionId = 'session-123';
      const sessionData = fixtures.sessions.validSession;

      mockRedis.get.mockResolvedValue(JSON.stringify(sessionData));

      const session = await authMiddleware.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session!.id).toBe(sessionData.id);
      expect(session!.userId).toBe(sessionData.userId);
    });

    it('should return null for non-existent session', async () => {
      const sessionId = 'non-existent';

      mockRedis.get.mockResolvedValue(null);

      const session = await authMiddleware.getSession(sessionId);

      expect(session).toBeNull();
    });

    it('should delete session', async () => {
      const sessionId = 'session-123';
      const sessionData = fixtures.sessions.validSession;

      mockRedis.get.mockResolvedValue(JSON.stringify(sessionData));

      await authMiddleware.deleteSession(sessionId);

      expect(mockRedis.del).toHaveBeenCalledWith(`session:${sessionId}`);
      expect(mockRedis.srem).toHaveBeenCalledWith(
        `user_sessions:${sessionData.userId}`,
        sessionId
      );
    });

    it('should delete all user sessions', async () => {
      const userId = 'user-123';
      const sessionIds = ['session-1', 'session-2', 'session-3'];

      mockRedis.smembers.mockResolvedValue(sessionIds);

      await authMiddleware.deleteAllUserSessions(userId);

      sessionIds.forEach(sessionId => {
        expect(mockRedis.del).toHaveBeenCalledWith(`session:${sessionId}`);
      });
      expect(mockRedis.del).toHaveBeenCalledWith(`user_sessions:${userId}`);
    });
  });
});

describe('authenticateSocket', () => {
  let mockSocket: any;
  let mockJWTService: any;

  beforeEach(() => {
    mockSocket = MockFactory.createMockSocket();
    mockSocket.handshake = {
      auth: { token: 'valid-jwt-token' },
      headers: {},
    };

    // Mock JWTService constructor and methods
    mockJWTService = {
      initialize: jest.fn(),
      isValidTokenFormat: jest.fn(),
      verifyAccessToken: jest.fn(),
    };

    jest.doMock('../../../src/auth/jwt-service', () => ({
      JWTService: jest.fn(() => mockJWTService),
    }));
  });

  it('should authenticate socket with valid token in auth', async () => {
    const mockPayload = fixtures.jwt.validPayload;

    mockJWTService.isValidTokenFormat.mockReturnValue(true);
    mockJWTService.verifyAccessToken.mockResolvedValue(mockPayload);

    const user = await authenticateSocket(mockSocket);

    expect(user.id).toBe(mockPayload.sub);
    expect(user.email).toBe(mockPayload.email);
  });

  it('should authenticate socket with token in headers', async () => {
    const mockPayload = fixtures.jwt.validPayload;
    mockSocket.handshake.auth = {};
    mockSocket.handshake.headers.authorization = 'Bearer valid-jwt-token';

    mockJWTService.isValidTokenFormat.mockReturnValue(true);
    mockJWTService.verifyAccessToken.mockResolvedValue(mockPayload);

    const user = await authenticateSocket(mockSocket);

    expect(user.id).toBe(mockPayload.sub);
  });

  it('should reject socket without token', async () => {
    mockSocket.handshake.auth = {};
    mockSocket.handshake.headers = {};

    await expect(authenticateSocket(mockSocket))
      .rejects.toThrow('No authentication token provided');
  });

  it('should reject socket with invalid token format', async () => {
    mockSocket.handshake.auth.token = 'invalid-token';

    mockJWTService.isValidTokenFormat.mockReturnValue(false);

    await expect(authenticateSocket(mockSocket))
      .rejects.toThrow('Invalid token format');
  });

  it('should reject socket with invalid token', async () => {
    mockJWTService.isValidTokenFormat.mockReturnValue(true);
    mockJWTService.verifyAccessToken.mockRejectedValue(new Error('Token expired'));

    await expect(authenticateSocket(mockSocket))
      .rejects.toThrow('Token expired');
  });
});