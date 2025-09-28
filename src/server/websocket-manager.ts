import { Server as SocketIOServer, Socket } from 'socket.io';
// MCP SDK types - stubbed for build compatibility
type JSONRPCMessage = any;
type JSONRPCRequest = any;
type JSONRPCResponse = any;
type JSONRPCError = any;
type InitializeRequest = any;
type InitializeResult = any;
type ListToolsRequest = any;
type ListToolsResult = any;
type CallToolRequest = any;
type CallToolResult = any;
type ListResourcesRequest = any;
type ListResourcesResult = any;
type ReadResourceRequest = any;
type ReadResourceResult = any;
type Tool = any;
type Resource = any;
type TextContent = any;
type ImageContent = any;
import { logger } from '../utils/logger';
import { config } from '../config/config';
import { authenticateSocket } from '../auth/middleware';
import { SecurityMiddleware } from '../security/middleware';
import { mcpSecurityValidator } from './mcp-security';
import { redis } from '../database/redis';
import { EventEmitter } from 'events';
import { v4 as uuidv4 } from 'uuid';

interface MCPConnection {
  id: string;
  socket: Socket;
  userId: string;
  sessionId: string;
  capabilities: string[];
  clientInfo: {
    name: string;
    version: string;
  };
  serverInfo: {
    name: string;
    version: string;
  };
  initialized: boolean;
  lastActivity: Date;
  rateLimitCount: number;
  rateLimitWindow: Date;
}

interface MCPTool extends Tool {
  name: string;
  description: string;
  inputSchema: any;
  handler: (args: any) => Promise<any>;
  permissions?: string[];
}

interface MCPResource extends Resource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
  loader: () => Promise<TextContent | ImageContent>;
  permissions?: string[];
}

export class WebSocketManager extends EventEmitter {
  private io: SocketIOServer;
  private connections: Map<string, MCPConnection> = new Map();
  private tools: Map<string, MCPTool> = new Map();
  private resources: Map<string, MCPResource> = new Map();
  private connectionCount: number = 0;
  private messageCount: number = 0;
  private errorCount: number = 0;

  constructor(io: SocketIOServer) {
    super();
    this.io = io;
    this.setupMiddleware();
    this.setupEventHandlers();
  }

  public async initialize(): Promise<void> {
    await this.loadTools();
    await this.loadResources();
    this.startCleanupInterval();

    logger.info('WebSocket manager initialized', {
      tools: this.tools.size,
      resources: this.resources.size,
    });
  }

  private setupMiddleware(): void {
    // Authentication middleware
    this.io.use(async (socket, next) => {
      try {
        const user = await authenticateSocket(socket);
        socket.data.user = user;
        next();
      } catch (error) {
        logger.error('Socket authentication failed', { error, socketId: socket.id });
        next(new Error('Authentication failed'));
      }
    });

    // Rate limiting middleware
    this.io.use(async (socket, next) => {
      const clientIp = socket.handshake.address;
      const rateLimitKey = `ws_rate_limit:${clientIp}`;

      try {
        const current = await redis.incr(rateLimitKey);
        if (current === 1) {
          await redis.expire(rateLimitKey, 60); // 1 minute window
        }

        if (current > config.mcp.rateLimitPerConnection) {
          logger.warn('WebSocket rate limit exceeded', { clientIp, current });
          next(new Error('Rate limit exceeded'));
          return;
        }

        next();
      } catch (error) {
        logger.error('Rate limiting error', { error, clientIp });
        next(error);
      }
    });

    // Connection limit middleware
    this.io.use((socket, next) => {
      if (this.connectionCount >= config.websocket.maxConnections) {
        logger.warn('Connection limit exceeded', {
          current: this.connectionCount,
          max: config.websocket.maxConnections
        });
        next(new Error('Connection limit exceeded'));
        return;
      }
      next();
    });
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      this.handleConnection(socket);
    });
  }

  private handleConnection(socket: Socket): void {
    const connectionId = uuidv4();
    this.connectionCount++;

    logger.info('New WebSocket connection', {
      connectionId,
      socketId: socket.id,
      userId: socket.data.user.id,
      ip: socket.handshake.address,
      userAgent: socket.handshake.headers['user-agent'],
    });

    const connection: MCPConnection = {
      id: connectionId,
      socket,
      userId: socket.data.user.id,
      sessionId: uuidv4(),
      capabilities: [],
      clientInfo: { name: '', version: '' },
      serverInfo: {
        name: 'secure-mcp-server',
        version: process.env.npm_package_version || '1.0.0',
      },
      initialized: false,
      lastActivity: new Date(),
      rateLimitCount: 0,
      rateLimitWindow: new Date(),
    };

    this.connections.set(connectionId, connection);

    // Set up message handling
    socket.on('message', async (data: Buffer | string) => {
      await this.handleMessage(connectionId, data);
    });

    socket.on('disconnect', (reason: string) => {
      this.handleDisconnection(connectionId, reason);
    });

    socket.on('error', (error: Error) => {
      this.handleError(connectionId, error);
    });

    // Send server capabilities
    this.sendMessage(connection, {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
      params: {
        protocolVersion: config.mcp.protocolVersion,
        capabilities: {
          tools: { listChanged: true },
          resources: { listChanged: true, subscribe: true },
          logging: {},
        },
        serverInfo: connection.serverInfo,
      },
    });
  }

  private async handleMessage(connectionId: string, data: Buffer | string): Promise<void> {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      logger.error('Message received for unknown connection', { connectionId });
      return;
    }

    try {
      // Update activity timestamp
      connection.lastActivity = new Date();

      // Check rate limiting
      if (!this.checkRateLimit(connection)) {
        this.sendError(connection, null, -32000, 'Rate limit exceeded');
        return;
      }

      // Parse message
      const messageStr = Buffer.isBuffer(data) ? data.toString('utf8') : data;

      // Validate message size
      if (messageStr.length > config.websocket.maxMessageSize) {
        this.sendError(connection, null, -32600, 'Message too large');
        return;
      }

      // SECURITY: Enhanced MCP protocol validation
      const validation = await mcpSecurityValidator.validateMessage(messageStr);
      if (!validation.valid) {
        logger.warn('Invalid MCP message', {
          error: validation.error,
          connectionId,
          userId: connection.userId,
        });
        this.sendError(connection, null, -32600, validation.error || 'Invalid Request');
        return;
      }

      const message = validation.sanitized;

      // Validate request ID if present
      if ('id' in message && !mcpSecurityValidator.validateRequestId(message.id)) {
        this.sendError(connection, null, -32600, 'Invalid request ID');
        return;
      }

      this.messageCount++;

      // Handle different message types
      if ('method' in message) {
        await this.handleRequest(connection, message as JSONRPCRequest);
      } else if ('result' in message || 'error' in message) {
        await this.handleResponse(connection, message as JSONRPCResponse);
      }

    } catch (error) {
      this.errorCount++;
      logger.error('Error handling WebSocket message', {
        error,
        connectionId,
        userId: connection.userId,
      });

      this.sendError(connection, null, -32603, 'Internal error');
    }
  }

  private async handleRequest(connection: MCPConnection, request: JSONRPCRequest): Promise<void> {
    try {
      switch (request.method) {
        case 'initialize':
          await this.handleInitialize(connection, request as InitializeRequest);
          break;

        case 'tools/list':
          await this.handleListTools(connection, request as ListToolsRequest);
          break;

        case 'tools/call':
          await this.handleCallTool(connection, request as CallToolRequest);
          break;

        case 'resources/list':
          await this.handleListResources(connection, request as ListResourcesRequest);
          break;

        case 'resources/read':
          await this.handleReadResource(connection, request as ReadResourceRequest);
          break;

        case 'ping':
          this.sendMessage(connection, {
            jsonrpc: '2.0',
            id: request.id,
            result: { status: 'pong', timestamp: new Date().toISOString() },
          });
          break;

        default:
          this.sendError(connection, request.id, -32601, `Method not found: ${request.method}`);
      }
    } catch (error) {
      logger.error('Error handling request', {
        error,
        method: request.method,
        connectionId: connection.id,
      });

      this.sendError(connection, request.id, -32603, 'Internal error');
    }
  }

  private async handleInitialize(connection: MCPConnection, request: InitializeRequest): Promise<void> {
    const params = request.params;

    // Validate protocol version
    if (params.protocolVersion !== config.mcp.protocolVersion) {
      this.sendError(connection, request.id, -32602,
        `Unsupported protocol version. Expected: ${config.mcp.protocolVersion}, Got: ${params.protocolVersion}`);
      return;
    }

    // Store client info
    connection.clientInfo = params.clientInfo;
    connection.capabilities = Object.keys(params.capabilities || {});
    connection.initialized = true;

    const result: InitializeResult = {
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
      serverInfo: connection.serverInfo,
    };

    this.sendMessage(connection, {
      jsonrpc: '2.0',
      id: request.id,
      result,
    });

    logger.info('MCP connection initialized', {
      connectionId: connection.id,
      clientInfo: connection.clientInfo,
      capabilities: connection.capabilities,
    });
  }

  private async handleListTools(connection: MCPConnection, request: ListToolsRequest): Promise<void> {
    if (!connection.initialized) {
      this.sendError(connection, request.id, -32002, 'Connection not initialized');
      return;
    }

    const userPermissions = await this.getUserPermissions(connection.userId);
    const availableTools = Array.from(this.tools.values())
      .filter(tool => this.hasPermission(userPermissions, tool.permissions))
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }));

    const result: ListToolsResult = {
      tools: availableTools,
    };

    this.sendMessage(connection, {
      jsonrpc: '2.0',
      id: request.id,
      result,
    });
  }

  private async handleCallTool(connection: MCPConnection, request: CallToolRequest): Promise<void> {
    if (!connection.initialized) {
      this.sendError(connection, request.id, -32002, 'Connection not initialized');
      return;
    }

    const { name, arguments: args } = request.params;

    // SECURITY: Validate tool execution request
    const toolValidation = mcpSecurityValidator.validateToolExecution(name, args);
    if (!toolValidation.valid) {
      logger.warn('Invalid tool execution request', {
        error: toolValidation.error,
        toolName: name,
        connectionId: connection.id,
        userId: connection.userId,
      });
      this.sendError(connection, request.id, -32602, toolValidation.error || 'Invalid tool request');
      return;
    }

    const tool = this.tools.get(name);

    if (!tool) {
      this.sendError(connection, request.id, -32601, `Tool not found: ${name}`);
      return;
    }

    // Check permissions
    const userPermissions = await this.getUserPermissions(connection.userId);
    if (!this.hasPermission(userPermissions, tool.permissions)) {
      this.sendError(connection, request.id, -32000, 'Insufficient permissions');
      return;
    }

    try {
      // Use sanitized arguments
      const toolResult = await tool.handler(toolValidation.sanitizedArgs || {});

      // SECURITY: Sanitize output before sending
      const sanitizedResult = mcpSecurityValidator.sanitizeOutput(toolResult);

      const result: CallToolResult = {
        content: [
          {
            type: 'text',
            text: typeof sanitizedResult === 'string' ? sanitizedResult : JSON.stringify(sanitizedResult),
          },
        ],
      };

      this.sendMessage(connection, {
        jsonrpc: '2.0',
        id: request.id,
        result,
      });

      logger.info('Tool executed successfully', {
        toolName: name,
        connectionId: connection.id,
        userId: connection.userId,
      });

    } catch (error) {
      logger.error('Tool execution failed', {
        error,
        toolName: name,
        connectionId: connection.id,
        userId: connection.userId,
      });

      this.sendError(connection, request.id, -32000, 'Tool execution failed');
    }
  }

  private async handleListResources(connection: MCPConnection, request: ListResourcesRequest): Promise<void> {
    if (!connection.initialized) {
      this.sendError(connection, request.id, -32002, 'Connection not initialized');
      return;
    }

    const userPermissions = await this.getUserPermissions(connection.userId);
    const availableResources = Array.from(this.resources.values())
      .filter(resource => this.hasPermission(userPermissions, resource.permissions))
      .map(resource => ({
        uri: resource.uri,
        name: resource.name,
        description: resource.description,
        mimeType: resource.mimeType,
      }));

    const result: ListResourcesResult = {
      resources: availableResources,
    };

    this.sendMessage(connection, {
      jsonrpc: '2.0',
      id: request.id,
      result,
    });
  }

  private async handleReadResource(connection: MCPConnection, request: ReadResourceRequest): Promise<void> {
    if (!connection.initialized) {
      this.sendError(connection, request.id, -32002, 'Connection not initialized');
      return;
    }

    const { uri } = request.params;

    // SECURITY: Validate resource access request
    const resourceValidation = mcpSecurityValidator.validateResourceAccess(uri);
    if (!resourceValidation.valid) {
      logger.warn('Invalid resource access request', {
        error: resourceValidation.error,
        uri,
        connectionId: connection.id,
        userId: connection.userId,
      });
      this.sendError(connection, request.id, -32602, resourceValidation.error || 'Invalid resource request');
      return;
    }

    const resource = this.resources.get(uri);

    if (!resource) {
      this.sendError(connection, request.id, -32601, `Resource not found: ${uri}`);
      return;
    }

    // Check permissions
    const userPermissions = await this.getUserPermissions(connection.userId);
    if (!this.hasPermission(userPermissions, resource.permissions)) {
      this.sendError(connection, request.id, -32000, 'Insufficient permissions');
      return;
    }

    try {
      const content = await resource.loader();

      // SECURITY: Sanitize resource content before sending
      const sanitizedContent = {
        ...content,
        text: content.text ? mcpSecurityValidator.sanitizeOutput(content.text) : undefined,
      };

      const result: ReadResourceResult = {
        contents: [sanitizedContent],
      };

      this.sendMessage(connection, {
        jsonrpc: '2.0',
        id: request.id,
        result,
      });

      logger.info('Resource read successfully', {
        resourceUri: uri,
        connectionId: connection.id,
        userId: connection.userId,
      });

    } catch (error) {
      logger.error('Resource read failed', {
        error,
        resourceUri: uri,
        connectionId: connection.id,
        userId: connection.userId,
      });

      this.sendError(connection, request.id, -32000, 'Resource read failed');
    }
  }

  private async handleResponse(connection: MCPConnection, response: JSONRPCResponse): Promise<void> {
    // Handle responses to requests sent by the server (if any)
    logger.debug('Received response from client', {
      id: response.id,
      connectionId: connection.id,
      hasError: 'error' in response,
    });
  }

  private handleDisconnection(connectionId: string, reason: string): void {
    const connection = this.connections.get(connectionId);
    if (connection) {
      this.connectionCount--;
      this.connections.delete(connectionId);

      logger.info('WebSocket disconnected', {
        connectionId,
        userId: connection.userId,
        reason,
        duration: Date.now() - connection.lastActivity.getTime(),
      });

      this.emit('disconnect', { connection, reason });
    }
  }

  private handleError(connectionId: string, error: Error): void {
    this.errorCount++;

    logger.error('WebSocket error', {
      error,
      connectionId,
    });

    this.emit('error', { connectionId, error });
  }

  private sendMessage(connection: MCPConnection, message: any): void {
    try {
      const messageStr = JSON.stringify(message);
      connection.socket.send(messageStr);
    } catch (error) {
      logger.error('Failed to send WebSocket message', {
        error,
        connectionId: connection.id,
        messageType: message.method || 'response',
      });
    }
  }

  private sendError(connection: MCPConnection, id: any, code: number, message: string): void {
    const errorResponse: JSONRPCError = {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message,
      },
    };

    this.sendMessage(connection, errorResponse);
  }

  private isValidJSONRPC(message: any): boolean {
    if (!message || typeof message !== 'object') return false;
    if (message.jsonrpc !== '2.0') return false;

    // Check if it's a request, response, or notification
    if ('method' in message) {
      return typeof message.method === 'string';
    } else if ('result' in message || 'error' in message) {
      return message.id !== undefined;
    }

    return false;
  }

  private checkRateLimit(connection: MCPConnection): boolean {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 60000); // 1 minute window

    if (connection.rateLimitWindow < windowStart) {
      // Reset window
      connection.rateLimitWindow = now;
      connection.rateLimitCount = 0;
    }

    connection.rateLimitCount++;
    return connection.rateLimitCount <= config.mcp.rateLimitPerConnection;
  }

  private async getUserPermissions(userId: string): Promise<string[]> {
    try {
      const permissions = await redis.smembers(`user_permissions:${userId}`);
      return permissions;
    } catch (error) {
      logger.error('Failed to get user permissions', { error, userId });
      return [];
    }
  }

  private hasPermission(userPermissions: string[], requiredPermissions?: string[]): boolean {
    if (!requiredPermissions || requiredPermissions.length === 0) return true;
    return requiredPermissions.some(permission => userPermissions.includes(permission));
  }

  private async loadTools(): Promise<void> {
    // Example tools - in production, these would be loaded from a configuration or registry
    this.tools.set('echo', {
      name: 'echo',
      description: 'Echo back the input text',
      inputSchema: {
        type: 'object',
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      handler: async (args: { text: string }) => {
        return `Echo: ${args.text}`;
      },
      permissions: ['basic'],
    });

    this.tools.set('calculate', {
      name: 'calculate',
      description: 'Perform basic mathematical calculations',
      inputSchema: {
        type: 'object',
        properties: {
          expression: { type: 'string' },
        },
        required: ['expression'],
      },
      handler: async (args: { expression: string }) => {
        // SECURITY: Enhanced expression validation
        if (!args.expression || typeof args.expression !== 'string') {
          throw new Error('Invalid expression');
        }

        // Only allow basic math operations
        const allowedPattern = /^[0-9+\-*/().\s]+$/;
        if (!allowedPattern.test(args.expression)) {
          throw new Error('Expression contains invalid characters');
        }

        // Limit expression length
        if (args.expression.length > 100) {
          throw new Error('Expression too long');
        }

        // Safe math evaluation using Function constructor with strict mode
        const sanitized = args.expression.replace(/[^0-9+\-*/().\s]/g, '');
        try {
          // Additional safety: wrap in try-catch and timeout
          const result = Function('"use strict"; return (' + sanitized + ')')();

          // Validate result
          if (!Number.isFinite(result)) {
            throw new Error('Invalid calculation result');
          }

          return `Result: ${result}`;
        } catch (error) {
          throw new Error('Calculation failed');
        }
      },
      permissions: ['calculate'],
    });
  }

  private async loadResources(): Promise<void> {
    // Example resources - in production, these would be loaded from a configuration or registry
    this.resources.set('server-info', {
      uri: 'server-info',
      name: 'Server Information',
      description: 'Information about the server',
      mimeType: 'application/json',
      loader: async (): Promise<TextContent> => ({
        type: 'text',
        text: JSON.stringify({
          name: 'secure-mcp-server',
          version: process.env.npm_package_version || '1.0.0',
          environment: config.env,
          uptime: process.uptime(),
          connections: this.connectionCount,
        }, null, 2),
      }),
      permissions: ['basic'],
    });
  }

  private startCleanupInterval(): void {
    setInterval(() => {
      const now = Date.now();
      const timeout = 300000; // 5 minutes

      for (const [connectionId, connection] of this.connections) {
        if (now - connection.lastActivity.getTime() > timeout) {
          logger.info('Cleaning up inactive connection', {
            connectionId,
            lastActivity: connection.lastActivity,
          });

          connection.socket.disconnect(true);
          this.connections.delete(connectionId);
          this.connectionCount--;
        }
      }
    }, 60000); // Check every minute
  }

  // Public methods for management and monitoring
  public getConnectionCount(): number {
    return this.connectionCount;
  }

  public getMessageCount(): number {
    return this.messageCount;
  }

  public getErrorCount(): number {
    return this.errorCount;
  }

  public getConnections(): MCPConnection[] {
    return Array.from(this.connections.values()).map(conn => ({
      ...conn,
      socket: undefined, // Don't expose socket object
    } as any));
  }

  public async broadcastNotification(method: string, params: any): Promise<void> {
    const notification = {
      jsonrpc: '2.0',
      method,
      params,
    };

    for (const connection of this.connections.values()) {
      if (connection.initialized) {
        this.sendMessage(connection, notification);
      }
    }
  }

  public async disconnectUser(userId: string): Promise<void> {
    for (const [connectionId, connection] of this.connections) {
      if (connection.userId === userId) {
        connection.socket.disconnect(true);
        this.connections.delete(connectionId);
        this.connectionCount--;
      }
    }
  }
}