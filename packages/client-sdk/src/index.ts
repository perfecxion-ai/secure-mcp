import { io, Socket } from 'socket.io-client';
import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'eventemitter3';

export interface MCPClientConfig {
  serverUrl: string;
  apiKey?: string;
  jwt?: string;
  timeout?: number;
  reconnectionAttempts?: number;
  debug?: boolean;
}

export interface MCPMessage {
  id: string;
  method: string;
  params?: any;
  result?: any;
  error?: any;
}

export class SecureMCPClient extends EventEmitter {
  private socket: Socket | null = null;
  private http: AxiosInstance;
  private config: MCPClientConfig;
  private messageQueue: Map<string, (response: any) => void> = new Map();
  private connected: boolean = false;

  constructor(config: MCPClientConfig) {
    super();
    this.config = {
      timeout: 30000,
      reconnectionAttempts: 5,
      debug: false,
      ...config,
    };

    // Initialize HTTP client
    this.http = axios.create({
      baseURL: this.config.serverUrl,
      timeout: this.config.timeout,
      headers: this.getAuthHeaders(),
    });
  }

  /**
   * Connect to the MCP server via WebSocket
   */
  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.socket = io(this.config.serverUrl, {
        transports: ['websocket'],
        auth: this.getAuthHeaders(),
        reconnectionAttempts: this.config.reconnectionAttempts,
      });

      this.socket.on('connect', () => {
        this.connected = true;
        this.emit('connected');
        if (this.config.debug) console.log('Connected to MCP server');
        resolve();
      });

      this.socket.on('disconnect', (reason) => {
        this.connected = false;
        this.emit('disconnected', reason);
        if (this.config.debug) console.log('Disconnected:', reason);
      });

      this.socket.on('error', (error) => {
        this.emit('error', error);
        if (this.config.debug) console.error('Socket error:', error);
        reject(error);
      });

      this.socket.on('message', (message: MCPMessage) => {
        this.handleMessage(message);
      });

      // Set connection timeout
      setTimeout(() => {
        if (!this.connected) {
          reject(new Error('Connection timeout'));
        }
      }, this.config.timeout);
    });
  }

  /**
   * Disconnect from the MCP server
   */
  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  /**
   * Send a request to the MCP server
   */
  async request(method: string, params?: any): Promise<any> {
    const id = this.generateId();
    const message: MCPMessage = { id, method, params };

    if (this.socket && this.connected) {
      return this.sendViaWebSocket(message);
    } else {
      return this.sendViaHTTP(message);
    }
  }

  /**
   * List available tools
   */
  async listTools(): Promise<any> {
    return this.request('tools/list');
  }

  /**
   * Execute a tool
   */
  async executeTool(name: string, params: any): Promise<any> {
    return this.request('tools/execute', { name, params });
  }

  /**
   * List available resources
   */
  async listResources(): Promise<any> {
    return this.request('resources/list');
  }

  /**
   * Read a resource
   */
  async readResource(uri: string): Promise<any> {
    return this.request('resources/read', { uri });
  }

  /**
   * Send a completion request
   */
  async complete(prompt: string, options?: any): Promise<any> {
    return this.request('completion', { prompt, ...options });
  }

  /**
   * Subscribe to server events
   */
  subscribe(event: string, handler: (data: any) => void): void {
    if (this.socket) {
      this.socket.on(event, handler);
    }
    this.on(event, handler);
  }

  /**
   * Unsubscribe from server events
   */
  unsubscribe(event: string, handler?: (data: any) => void): void {
    if (this.socket) {
      this.socket.off(event, handler);
    }
    this.off(event, handler);
  }

  private async sendViaWebSocket(message: MCPMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.messageQueue.delete(message.id);
        reject(new Error('Request timeout'));
      }, this.config.timeout);

      this.messageQueue.set(message.id, (response) => {
        clearTimeout(timeout);
        if (response.error) {
          reject(response.error);
        } else {
          resolve(response.result);
        }
      });

      this.socket!.emit('message', message);
    });
  }

  private async sendViaHTTP(message: MCPMessage): Promise<any> {
    const response = await this.http.post('/api/mcp', message);
    if (response.data.error) {
      throw response.data.error;
    }
    return response.data.result;
  }

  private handleMessage(message: MCPMessage): void {
    const handler = this.messageQueue.get(message.id);
    if (handler) {
      handler(message);
      this.messageQueue.delete(message.id);
    }
    this.emit('message', message);
  }

  private getAuthHeaders(): Record<string, string> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) {
      headers['X-API-Key'] = this.config.apiKey;
    }
    if (this.config.jwt) {
      headers['Authorization'] = `Bearer ${this.config.jwt}`;
    }
    return headers;
  }

  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Export types
export * from './types';

// Default export
export default SecureMCPClient;