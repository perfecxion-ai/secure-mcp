import { WebSocketManager } from '../../../src/server/websocket-manager';
import { MockFactory, TestDataGenerator } from '../../utils/test-helpers';
import { fixtures } from '../../utils/fixtures';
import { Server as SocketIOServer } from 'socket.io';
import { EventEmitter } from 'events';

// Mock dependencies
jest.mock('../../../src/config/config', () => ({
  config: {
    mcp: {
      protocolVersion: '2024-11-05',
      rateLimitPerConnection: 100,
      timeout: 30000,
    },
    websocket: {
      maxConnections: 1000,
      maxMessageSize: 1048576,
    },
  },
}));

jest.mock('../../../src/database/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    setex: jest.fn(),
    del: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
    ttl: jest.fn(),
    sadd: jest.fn(),
    srem: jest.fn(),
    smembers: jest.fn(),
    hgetall: jest.fn(),
    hget: jest.fn(),
    hset: jest.fn(),
    keys: jest.fn(),
    scard: jest.fn(),
    scan: jest.fn(),
    memory: jest.fn(),
    exists: jest.fn(),
    ping: jest.fn(() => Promise.resolve('PONG')),
    disconnect: jest.fn(() => Promise.resolve()),
    pipeline: jest.fn(() => ({
      setex: jest.fn().mockReturnThis(),
      sadd: jest.fn().mockReturnThis(),
      srem: jest.fn().mockReturnThis(),
      del: jest.fn().mockReturnThis(),
      expire: jest.fn().mockReturnThis(),
      ttl: jest.fn().mockReturnThis(),
      exec: jest.fn().mockResolvedValue([]),
    })),
  },
}));

jest.mock('../../../src/utils/logger', () => ({
  logger: {
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
  },
}));

jest.mock('../../../src/auth/middleware', () => ({
  authenticateSocket: jest.fn(),
}));

jest.mock('../../../src/security/middleware', () => ({
  SecurityMiddleware: {
    sanitizeInput: jest.fn((input) => Promise.resolve(input)),
  },
}));

jest.mock('../../../src/server/mcp-security', () => ({
  mcpSecurityValidator: {
    validateMessage: jest.fn(() => ({ valid: true, sanitized: null })),
    validateRequestId: jest.fn(() => true),
    validateToolExecution: jest.fn(() => ({ valid: true })),
    validateResourceAccess: jest.fn(() => ({ valid: true })),
  },
}));

describe('WebSocketManager', () => {
  let wsManager: WebSocketManager;
  let mockIO: any;
  let mockSocket: any;
  let mockRedis: any;
  let mockLogger: any;
  let mockAuthenticateSocket: any;
  let mockMcpSecurityValidator: any;

  beforeEach(async () => {
    // Use fake timers for tests that advance time
    jest.useFakeTimers();
    // Create mock SocketIO server
    mockIO = new EventEmitter();
    mockIO.use = jest.fn((middleware) => {
      // Simulate middleware execution
      return mockIO;
    });
    mockIO.on = jest.fn();

    // Create mock socket
    mockSocket = MockFactory.createMockSocket();
    mockSocket.data = { user: fixtures.users.validUser };

    // Setup mocks
    mockRedis = require('../../../src/database/redis').redis;
    mockLogger = require('../../../src/utils/logger').logger;
    mockAuthenticateSocket = require('../../../src/auth/middleware').authenticateSocket;
    mockMcpSecurityValidator = require('../../../src/server/mcp-security').mcpSecurityValidator;

    mockAuthenticateSocket.mockResolvedValue(fixtures.users.validUser);

    // Setup MCP security validator to return valid results with the actual message
    mockMcpSecurityValidator.validateMessage.mockImplementation((messageStr: string) => {
      try {
        const message = JSON.parse(messageStr);
        return { valid: true, sanitized: message };
      } catch {
        return { valid: false, error: 'Invalid JSON' };
      }
    });

    // Reset mocks before creating the instance to avoid clearing setup call history
    jest.clearAllMocks();

    wsManager = new WebSocketManager(mockIO as SocketIOServer);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await wsManager.initialize();

      expect(mockLogger.info).toHaveBeenCalledWith(
        'WebSocket manager initialized',
        expect.objectContaining({
          tools: expect.any(Number),
          resources: expect.any(Number),
        })
      );
    });

    it('should setup middleware in correct order', () => {
      expect(mockIO.use).toHaveBeenCalledTimes(3);

      // Verify middleware order: auth, rate limiting, connection limiting
      const middlewareCalls = mockIO.use.mock.calls;
      expect(middlewareCalls[0][0]).toBeInstanceOf(Function); // Auth middleware
      expect(middlewareCalls[1][0]).toBeInstanceOf(Function); // Rate limiting
      expect(middlewareCalls[2][0]).toBeInstanceOf(Function); // Connection limiting
    });

    it('should setup connection event handler', () => {
      expect(mockIO.on).toHaveBeenCalledWith('connection', expect.any(Function));
    });
  });

  describe('authentication middleware', () => {
    it('should authenticate valid socket connections', async () => {
      const authMiddleware = mockIO.use.mock.calls[0][0];
      const nextFn = jest.fn();

      mockAuthenticateSocket.mockResolvedValue(fixtures.users.validUser);

      await authMiddleware(mockSocket, nextFn);

      expect(mockAuthenticateSocket).toHaveBeenCalledWith(mockSocket);
      expect(mockSocket.data.user).toEqual(fixtures.users.validUser);
      expect(nextFn).toHaveBeenCalledWith();
    });

    it('should reject unauthenticated socket connections', async () => {
      const authMiddleware = mockIO.use.mock.calls[0][0];
      const nextFn = jest.fn();

      mockAuthenticateSocket.mockRejectedValue(new Error('Invalid token'));

      await authMiddleware(mockSocket, nextFn);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Socket authentication failed',
        expect.objectContaining({
          error: expect.any(Error),
          socketId: mockSocket.id,
        })
      );
      expect(nextFn).toHaveBeenCalledWith(new Error('Authentication failed'));
    });
  });

  describe('rate limiting middleware', () => {
    it('should allow connections within rate limit', async () => {
      const rateLimitMiddleware = mockIO.use.mock.calls[1][0];
      const nextFn = jest.fn();

      mockRedis.incr.mockResolvedValue(5); // Under limit

      await rateLimitMiddleware(mockSocket, nextFn);

      expect(mockRedis.incr).toHaveBeenCalledWith(
        expect.stringMatching(/^ws_rate_limit:/)
      );
      expect(nextFn).toHaveBeenCalledWith();
    });

    it('should reject connections exceeding rate limit', async () => {
      const rateLimitMiddleware = mockIO.use.mock.calls[1][0];
      const nextFn = jest.fn();

      mockRedis.incr.mockResolvedValue(101); // Exceeds limit

      await rateLimitMiddleware(mockSocket, nextFn);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'WebSocket rate limit exceeded',
        expect.objectContaining({
          clientIp: mockSocket.handshake.address,
          current: 101,
        })
      );
      expect(nextFn).toHaveBeenCalledWith(new Error('Rate limit exceeded'));
    });

    it('should handle Redis errors gracefully in rate limiting', async () => {
      const rateLimitMiddleware = mockIO.use.mock.calls[1][0];
      const nextFn = jest.fn();

      mockRedis.incr.mockRejectedValue(new Error('Redis error'));

      await rateLimitMiddleware(mockSocket, nextFn);

      expect(mockLogger.error).toHaveBeenCalledWith(
        'Rate limiting error',
        expect.objectContaining({
          error: expect.any(Error),
        })
      );
      expect(nextFn).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('connection handling', () => {
    beforeEach(async () => {
      await wsManager.initialize();

      // Simulate connection event handler setup
      const connectionHandler = mockIO.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockSocket);
    });

    it('should handle new socket connections', () => {
      expect(mockSocket.on).toHaveBeenCalledWith('message', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('disconnect', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('error', expect.any(Function));

      expect(wsManager.getConnectionCount()).toBe(1);

      expect(mockLogger.info).toHaveBeenCalledWith(
        'New WebSocket connection',
        expect.objectContaining({
          connectionId: expect.any(String),
          socketId: mockSocket.id,
          userId: fixtures.users.validUser.id,
          ip: mockSocket.handshake.address,
        })
      );
    });

    it('should send server capabilities on connection', () => {
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"method":"notifications/initialized"')
      );
    });

    it('should enforce connection limits', () => {
      const connectionLimitMiddleware = mockIO.use.mock.calls[2][0];
      const nextFn = jest.fn();

      // Simulate max connections reached
      wsManager.getConnectionCount = jest.fn().mockReturnValue(1001);

      connectionLimitMiddleware(mockSocket, nextFn);

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Connection limit exceeded',
        expect.objectContaining({
          current: 1001,
          max: 1000,
        })
      );
      expect(nextFn).toHaveBeenCalledWith(new Error('Connection limit exceeded'));
    });
  });

  describe('message handling', () => {
    let messageHandler: any;

    beforeEach(async () => {
      await wsManager.initialize();

      // Setup connection
      const connectionHandler = mockIO.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockSocket);

      // Get message handler
      messageHandler = mockSocket.on.mock.calls.find(call => call[0] === 'message')[1];
    });

    it('should handle valid MCP initialize request', async () => {
      const initRequest = fixtures.mcp.initializeRequest;

      await messageHandler(JSON.stringify(initRequest));

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"result"')
      );
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"protocolVersion":"2024-11-05"')
      );
    });

    it('should handle tools/list request', async () => {
      // First initialize
      const initRequest = fixtures.mcp.initializeRequest;
      await messageHandler(JSON.stringify(initRequest));

      jest.clearAllMocks();

      const listToolsRequest = fixtures.mcp.listToolsRequest;
      mockRedis.smembers.mockResolvedValue(['basic']); // User permissions

      await messageHandler(JSON.stringify(listToolsRequest));

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"tools"')
      );
    });

    it('should handle tools/call request', async () => {
      // First initialize
      const initRequest = fixtures.mcp.initializeRequest;
      await messageHandler(JSON.stringify(initRequest));

      jest.clearAllMocks();

      const callToolRequest = fixtures.mcp.callToolRequest;
      mockRedis.smembers.mockResolvedValue(['basic']); // User permissions

      await messageHandler(JSON.stringify(callToolRequest));

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"content"')
      );
    });

    it('should reject requests before initialization', async () => {
      const listToolsRequest = fixtures.mcp.listToolsRequest;

      await messageHandler(JSON.stringify(listToolsRequest));

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Connection not initialized')
      );
    });

    it('should reject oversized messages', async () => {
      const oversizedMessage = 'x'.repeat(1048577); // 1MB + 1 byte

      await messageHandler(oversizedMessage);

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Message too large')
      );
    });

    it('should reject malformed JSON', async () => {
      const malformedMessage = '{"invalid": json}';

      await messageHandler(malformedMessage);

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Parse error')
      );
    });

    it('should reject non-JSON-RPC messages', async () => {
      const nonJsonRpcMessage = JSON.stringify({ not: 'jsonrpc' });

      await messageHandler(nonJsonRpcMessage);

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Invalid Request')
      );
    });

    it('should handle method not found', async () => {
      // First initialize
      const initRequest = fixtures.mcp.initializeRequest;
      await messageHandler(JSON.stringify(initRequest));

      jest.clearAllMocks();

      const unknownMethodRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'unknown/method',
        params: {},
      };

      await messageHandler(JSON.stringify(unknownMethodRequest));

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Method not found: unknown/method')
      );
    });

    it('should sanitize input messages', async () => {
      const SecurityMiddleware = require('../../../src/security/middleware').SecurityMiddleware;
      const maliciousMessage = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { malicious: '<script>alert("xss")</script>' },
      });

      await messageHandler(maliciousMessage);

      expect(SecurityMiddleware.sanitizeInput).toHaveBeenCalledWith(maliciousMessage);
    });
  });

  describe('tool execution', () => {
    let messageHandler: any;

    beforeEach(async () => {
      await wsManager.initialize();

      const connectionHandler = mockIO.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockSocket);
      messageHandler = mockSocket.on.mock.calls.find(call => call[0] === 'message')[1];

      // Initialize connection
      const initRequest = fixtures.mcp.initializeRequest;
      await messageHandler(JSON.stringify(initRequest));
      jest.clearAllMocks();
    });

    it('should execute echo tool successfully', async () => {
      const callToolRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: { text: 'Hello, World!' },
        },
      };

      mockRedis.smembers.mockResolvedValue(['basic']); // User has required permission

      await messageHandler(JSON.stringify(callToolRequest));

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Echo: Hello, World!')
      );
    });

    it('should execute calculate tool successfully', async () => {
      const callToolRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'calculate',
          arguments: { expression: '2 + 2' },
        },
      };

      mockRedis.smembers.mockResolvedValue(['calculate']); // User has required permission

      await messageHandler(JSON.stringify(callToolRequest));

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Result: 4')
      );
    });

    it('should reject tool execution without permission', async () => {
      const callToolRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'echo',
          arguments: { text: 'Hello' },
        },
      };

      mockRedis.smembers.mockResolvedValue([]); // User has no permissions

      await messageHandler(JSON.stringify(callToolRequest));

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Insufficient permissions')
      );
    });

    it('should handle tool execution errors', async () => {
      const callToolRequest = {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: {
          name: 'calculate',
          arguments: { expression: 'invalid expression' },
        },
      };

      mockRedis.smembers.mockResolvedValue(['calculate']);

      await messageHandler(JSON.stringify(callToolRequest));

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Tool execution failed')
      );
    });
  });

  describe('rate limiting per connection', () => {
    let messageHandler: any;

    beforeEach(async () => {
      await wsManager.initialize();

      const connectionHandler = mockIO.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockSocket);
      messageHandler = mockSocket.on.mock.calls.find(call => call[0] === 'message')[1];
    });

    it('should enforce per-connection rate limiting', async () => {
      const message = JSON.stringify(fixtures.mcp.initializeRequest);

      // Simulate multiple rapid messages
      for (let i = 0; i < 105; i++) { // Exceeds limit of 100
        await messageHandler(message);
      }

      // Should see rate limit exceeded error
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Rate limit exceeded')
      );
    });

    it('should reset rate limit window correctly', async () => {
      const message = JSON.stringify(fixtures.mcp.initializeRequest);

      // Send messages up to limit
      for (let i = 0; i < 100; i++) {
        await messageHandler(message);
      }

      // Advance time to reset window
      jest.advanceTimersByTime(61000); // 61 seconds

      jest.clearAllMocks();

      // Should be able to send again
      await messageHandler(message);

      expect(mockSocket.send).not.toHaveBeenCalledWith(
        expect.stringContaining('Rate limit exceeded')
      );
    });
  });

  describe('connection cleanup', () => {
    let disconnectHandler: any;

    beforeEach(async () => {
      await wsManager.initialize();

      const connectionHandler = mockIO.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockSocket);
      disconnectHandler = mockSocket.on.mock.calls.find(call => call[0] === 'disconnect')[1];
    });

    it('should handle socket disconnection', () => {
      const reason = 'client disconnect';

      disconnectHandler(reason);

      expect(wsManager.getConnectionCount()).toBe(0);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'WebSocket disconnected',
        expect.objectContaining({
          reason,
          duration: expect.any(Number),
        })
      );
    });

    it('should clean up inactive connections', async () => {
      const originalConnectionCount = wsManager.getConnectionCount();

      // Advance time beyond timeout
      jest.advanceTimersByTime(301000); // 301 seconds (timeout is 300)

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
      expect(mockLogger.info).toHaveBeenCalledWith(
        'Cleaning up inactive connection',
        expect.objectContaining({
          lastActivity: expect.any(Date),
        })
      );
    });
  });

  describe('management methods', () => {
    beforeEach(async () => {
      await wsManager.initialize();
    });

    it('should return correct connection statistics', () => {
      expect(wsManager.getConnectionCount()).toBe(0);
      expect(wsManager.getMessageCount()).toBe(0);
      expect(wsManager.getErrorCount()).toBe(0);
    });

    it('should broadcast notifications to all connections', async () => {
      const connectionHandler = mockIO.on.mock.calls.find(call => call[0] === 'connection')[1];

      // Create multiple connections
      const socket1 = MockFactory.createMockSocket();
      const socket2 = MockFactory.createMockSocket();

      socket1.data = { user: fixtures.users.validUser };
      socket2.data = { user: fixtures.users.validUser };

      connectionHandler(socket1);
      connectionHandler(socket2);

      // Initialize both connections
      const initRequest = fixtures.mcp.initializeRequest;
      const messageHandler1 = socket1.on.mock.calls.find(call => call[0] === 'message')[1];
      const messageHandler2 = socket2.on.mock.calls.find(call => call[0] === 'message')[1];

      await messageHandler1(JSON.stringify(initRequest));
      await messageHandler2(JSON.stringify(initRequest));

      jest.clearAllMocks();

      // Broadcast notification
      await wsManager.broadcastNotification('test/notification', { message: 'Hello' });

      expect(socket1.send).toHaveBeenCalledWith(
        expect.stringContaining('"method":"test/notification"')
      );
      expect(socket2.send).toHaveBeenCalledWith(
        expect.stringContaining('"method":"test/notification"')
      );
    });

    it('should disconnect specific user', async () => {
      const connectionHandler = mockIO.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockSocket);

      expect(wsManager.getConnectionCount()).toBe(1);

      await wsManager.disconnectUser(fixtures.users.validUser.id);

      expect(mockSocket.disconnect).toHaveBeenCalledWith(true);
      expect(wsManager.getConnectionCount()).toBe(0);
    });
  });

  describe('error handling', () => {
    let errorHandler: any;

    beforeEach(async () => {
      await wsManager.initialize();

      const connectionHandler = mockIO.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockSocket);
      errorHandler = mockSocket.on.mock.calls.find(call => call[0] === 'error')[1];
    });

    it('should handle socket errors', () => {
      const error = new Error('Socket error');

      errorHandler(error);

      expect(wsManager.getErrorCount()).toBe(1);
      expect(mockLogger.error).toHaveBeenCalledWith(
        'WebSocket error',
        expect.objectContaining({
          error,
        })
      );
    });

    it('should handle message processing errors gracefully', async () => {
      const messageHandler = mockSocket.on.mock.calls.find(call => call[0] === 'message')[1];

      // Mock SecurityMiddleware to throw error
      const SecurityMiddleware = require('../../../src/security/middleware').SecurityMiddleware;
      SecurityMiddleware.sanitizeInput.mockRejectedValue(new Error('Sanitization failed'));

      await messageHandler('{"jsonrpc":"2.0","method":"test"}');

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Internal error')
      );
      expect(wsManager.getErrorCount()).toBe(1);
    });
  });

  describe('security features', () => {
    let messageHandler: any;

    beforeEach(async () => {
      await wsManager.initialize();

      const connectionHandler = mockIO.on.mock.calls.find(call => call[0] === 'connection')[1];
      connectionHandler(mockSocket);
      messageHandler = mockSocket.on.mock.calls.find(call => call[0] === 'message')[1];
    });

    it('should validate JSON-RPC structure', async () => {
      const invalidMessages = [
        '{"not": "jsonrpc"}',
        '{"jsonrpc": "1.0", "method": "test"}',
        '{"jsonrpc": "2.0"}', // Missing method
      ];

      for (const message of invalidMessages) {
        jest.clearAllMocks();
        await messageHandler(message);

        expect(mockSocket.send).toHaveBeenCalledWith(
          expect.stringContaining('"error"')
        );
      }
    });

    it('should handle protocol version mismatch', async () => {
      const wrongVersionRequest = {
        ...fixtures.mcp.initializeRequest,
        params: {
          ...fixtures.mcp.initializeRequest.params,
          protocolVersion: '1.0.0',
        },
      };

      await messageHandler(JSON.stringify(wrongVersionRequest));

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('Unsupported protocol version')
      );
    });

    it('should validate message format before processing', async () => {
      const messageWithInvalidId = {
        jsonrpc: '2.0',
        id: {}, // Invalid ID type
        method: 'initialize',
        params: {},
      };

      await messageHandler(JSON.stringify(messageWithInvalidId));

      expect(mockSocket.send).toHaveBeenCalledWith(
        expect.stringContaining('"error"')
      );
    });
  });
});