/**
 * MCP Protocol Security Module
 * Implements comprehensive security for MCP message handling
 * Addresses CVE-2024-SMCP-005: MCP Protocol Security Vulnerabilities
 */

import { z } from 'zod';
import * as DOMPurify from 'isomorphic-dompurify';
import { createHash, randomBytes } from 'crypto';
import { logger } from '../utils/logger';

// JSON-RPC 2.0 Schema Definitions
const JSONRPCVersionSchema = z.literal('2.0');

const JSONRPCRequestSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  method: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_/.-]+$/),
  params: z.any().optional(),
  id: z.union([z.string(), z.number(), z.null()]).optional(),
});

const JSONRPCResponseSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  result: z.any().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    data: z.any().optional(),
  }).optional(),
  id: z.union([z.string(), z.number(), z.null()]),
}).refine(data => Boolean(data.result) !== Boolean(data.error), {
  message: 'Response must have either result or error, but not both',
});

// MCP Method Schemas
const InitializeRequestSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  method: z.literal('initialize'),
  params: z.object({
    protocolVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
    capabilities: z.record(z.any()).optional(),
    clientInfo: z.object({
      name: z.string().max(100),
      version: z.string().max(50),
    }),
  }),
  id: z.union([z.string(), z.number()]),
});

const ToolCallRequestSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  method: z.literal('tools/call'),
  params: z.object({
    name: z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/),
    arguments: z.record(z.any()).optional(),
  }),
  id: z.union([z.string(), z.number()]),
});

const ResourceReadRequestSchema = z.object({
  jsonrpc: JSONRPCVersionSchema,
  method: z.literal('resources/read'),
  params: z.object({
    uri: z.string().min(1).max(500).regex(/^[a-zA-Z0-9:/_.-]+$/),
  }),
  id: z.union([z.string(), z.number()]),
});

// Command allowlist with strict validation
const ALLOWED_COMMANDS = new Map<string, z.ZodSchema>([
  ['initialize', InitializeRequestSchema],
  ['tools/list', JSONRPCRequestSchema],
  ['tools/call', ToolCallRequestSchema],
  ['resources/list', JSONRPCRequestSchema],
  ['resources/read', ResourceReadRequestSchema],
  ['ping', JSONRPCRequestSchema],
]);

// Tool execution sandbox configuration
const ALLOWED_TOOL_OPERATIONS = new Set([
  'echo',
  'calculate',
  'query',
  'format',
  'validate',
  'transform',
]);

// Resource access control
const RESOURCE_ACCESS_PATTERNS = [
  /^server-info$/,
  /^config\/[a-zA-Z0-9_-]+$/,
  /^data\/[a-zA-Z0-9_/-]+\.json$/,
  /^templates\/[a-zA-Z0-9_/-]+\.txt$/,
];

export class MCPSecurityValidator {
  private requestCache: Map<string, { hash: string; timestamp: number }> = new Map();
  private readonly CACHE_TTL = 60000; // 1 minute
  private readonly MAX_CACHE_SIZE = 1000;

  /**
   * Validate and sanitize incoming MCP message
   */
  public async validateMessage(message: string): Promise<{
    valid: boolean;
    sanitized?: any;
    error?: string;
  }> {
    try {
      // Check message size (max 1MB)
      if (message.length > 1048576) {
        return { valid: false, error: 'Message too large' };
      }

      // Check for duplicate requests (replay attack protection)
      const messageHash = this.hashMessage(message);
      if (this.isDuplicateRequest(messageHash)) {
        logger.warn('Duplicate request detected', { hash: messageHash });
        return { valid: false, error: 'Duplicate request' };
      }

      // Parse JSON
      let parsed: any;
      try {
        parsed = JSON.parse(message);
      } catch (e) {
        return { valid: false, error: 'Invalid JSON' };
      }

      // Validate JSON-RPC structure
      const rpcValidation = this.validateJSONRPC(parsed);
      if (!rpcValidation.success) {
        return { valid: false, error: rpcValidation.error };
      }

      // Validate method-specific schema
      if ('method' in parsed) {
        const methodValidation = this.validateMethod(parsed);
        if (!methodValidation.success) {
          return { valid: false, error: methodValidation.error };
        }
      }

      // Sanitize input data
      const sanitized = this.sanitizeData(parsed);

      // Store request hash for replay protection
      this.storeRequestHash(messageHash);

      return { valid: true, sanitized };
    } catch (error) {
      logger.error('Message validation error', { error });
      return { valid: false, error: 'Validation error' };
    }
  }

  /**
   * Validate command execution request
   */
  public validateCommand(command: string, args: any): {
    valid: boolean;
    error?: string;
  } {
    // Check if command is in allowlist
    if (!ALLOWED_COMMANDS.has(command)) {
      return { valid: false, error: `Command not allowed: ${command}` };
    }

    // Validate command arguments
    if (args && typeof args === 'object') {
      // Check for dangerous properties
      const dangerousProps = ['__proto__', 'constructor', 'prototype'];
      for (const prop of dangerousProps) {
        if (prop in args) {
          return { valid: false, error: 'Dangerous property detected' };
        }
      }

      // Deep validation of nested objects
      const validateNested = (obj: any, depth = 0): boolean => {
        if (depth > 10) return false; // Max nesting depth

        for (const [key, value] of Object.entries(obj)) {
          if (typeof key !== 'string' || key.length > 100) return false;

          if (value && typeof value === 'object') {
            if (!validateNested(value, depth + 1)) return false;
          }
        }
        return true;
      };

      if (!validateNested(args)) {
        return { valid: false, error: 'Invalid argument structure' };
      }
    }

    return { valid: true };
  }

  /**
   * Validate tool execution request
   */
  public validateToolExecution(toolName: string, args: any): {
    valid: boolean;
    sanitizedArgs?: any;
    error?: string;
  } {
    // Check if tool is allowed
    if (!ALLOWED_TOOL_OPERATIONS.has(toolName)) {
      return { valid: false, error: `Tool not allowed: ${toolName}` };
    }

    // Sanitize tool arguments
    const sanitizedArgs = this.sanitizeToolArgs(args);

    // Validate specific tool constraints
    switch (toolName) {
      case 'calculate':
        // Only allow basic math operations
        if (typeof sanitizedArgs.expression === 'string') {
          const allowedChars = /^[0-9+\-*/().\s]+$/;
          if (!allowedChars.test(sanitizedArgs.expression)) {
            return { valid: false, error: 'Invalid calculation expression' };
          }
        }
        break;

      case 'query':
        // Validate query parameters
        if (sanitizedArgs.query && sanitizedArgs.query.length > 1000) {
          return { valid: false, error: 'Query too long' };
        }
        break;
    }

    return { valid: true, sanitizedArgs };
  }

  /**
   * Validate resource access request
   */
  public validateResourceAccess(uri: string): {
    valid: boolean;
    error?: string;
  } {
    // Check URI length
    if (uri.length > 500) {
      return { valid: false, error: 'URI too long' };
    }

    // Check for path traversal attempts
    if (uri.includes('../') || uri.includes('..\\')) {
      return { valid: false, error: 'Path traversal detected' };
    }

    // Check against allowed patterns
    const isAllowed = RESOURCE_ACCESS_PATTERNS.some(pattern => pattern.test(uri));
    if (!isAllowed) {
      return { valid: false, error: `Resource access denied: ${uri}` };
    }

    return { valid: true };
  }

  /**
   * Sanitize output data before sending
   */
  public sanitizeOutput(data: any): any {
    if (typeof data === 'string') {
      // Remove sensitive patterns
      return data
        .replace(/password[\s]*=[\s]*['"][^'"]+['"]/gi, 'password=***')
        .replace(/token[\s]*=[\s]*['"][^'"]+['"]/gi, 'token=***')
        .replace(/api[_-]?key[\s]*=[\s]*['"][^'"]+['"]/gi, 'api_key=***')
        .replace(/secret[\s]*=[\s]*['"][^'"]+['"]/gi, 'secret=***');
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeOutput(item));
    }

    if (data && typeof data === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(data)) {
        // Skip sensitive keys
        if (/password|token|secret|key|auth/i.test(key)) {
          sanitized[key] = '***';
        } else {
          sanitized[key] = this.sanitizeOutput(value);
        }
      }
      return sanitized;
    }

    return data;
  }

  private validateJSONRPC(message: any): { success: boolean; error?: string } {
    try {
      if ('method' in message) {
        JSONRPCRequestSchema.parse(message);
      } else if ('result' in message || 'error' in message) {
        JSONRPCResponseSchema.parse(message);
      } else {
        return { success: false, error: 'Invalid JSON-RPC message type' };
      }
      return { success: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { success: false, error: error.errors[0].message };
      }
      return { success: false, error: 'JSON-RPC validation failed' };
    }
  }

  private validateMethod(request: any): { success: boolean; error?: string } {
    const schema = ALLOWED_COMMANDS.get(request.method);
    if (!schema) {
      return { success: false, error: `Method not allowed: ${request.method}` };
    }

    try {
      schema.parse(request);
      return { success: true };
    } catch (error) {
      if (error instanceof z.ZodError) {
        return { success: false, error: error.errors[0].message };
      }
      return { success: false, error: 'Method validation failed' };
    }
  }

  private sanitizeData(data: any): any {
    if (typeof data === 'string') {
      return DOMPurify.sanitize(data, {
        ALLOWED_TAGS: [],
        ALLOWED_ATTR: [],
        USE_PROFILES: { html: false }
      });
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeData(item));
    }

    if (data && typeof data === 'object') {
      const sanitized: any = {};
      for (const [key, value] of Object.entries(data)) {
        // Skip dangerous keys
        if (!['__proto__', 'constructor', 'prototype'].includes(key)) {
          sanitized[key] = this.sanitizeData(value);
        }
      }
      return sanitized;
    }

    return data;
  }

  private sanitizeToolArgs(args: any): any {
    if (!args || typeof args !== 'object') return {};

    const sanitized: any = {};
    for (const [key, value] of Object.entries(args)) {
      // Only allow alphanumeric keys
      if (/^[a-zA-Z0-9_]+$/.test(key) && key.length <= 50) {
        if (typeof value === 'string') {
          // Sanitize string values
          sanitized[key] = DOMPurify.sanitize(value, {
            ALLOWED_TAGS: [],
            ALLOWED_ATTR: [],
            USE_PROFILES: { html: false }
          }).substring(0, 1000); // Limit string length
        } else if (typeof value === 'number' || typeof value === 'boolean') {
          sanitized[key] = value;
        } else if (Array.isArray(value)) {
          sanitized[key] = value.slice(0, 100); // Limit array size
        }
      }
    }
    return sanitized;
  }

  private hashMessage(message: string): string {
    return createHash('sha256').update(message).digest('hex');
  }

  private isDuplicateRequest(hash: string): boolean {
    const cached = this.requestCache.get(hash);
    if (!cached) return false;

    const now = Date.now();
    if (now - cached.timestamp < this.CACHE_TTL) {
      return true;
    }

    // Clean up expired entry
    this.requestCache.delete(hash);
    return false;
  }

  private storeRequestHash(hash: string): void {
    // Clean up old entries if cache is too large
    if (this.requestCache.size >= this.MAX_CACHE_SIZE) {
      const now = Date.now();
      for (const [key, value] of this.requestCache.entries()) {
        if (now - value.timestamp > this.CACHE_TTL) {
          this.requestCache.delete(key);
        }
      }

      // If still too large, remove oldest entries
      if (this.requestCache.size >= this.MAX_CACHE_SIZE) {
        const entries = Array.from(this.requestCache.entries())
          .sort((a, b) => a[1].timestamp - b[1].timestamp);

        for (let i = 0; i < entries.length / 2; i++) {
          this.requestCache.delete(entries[i][0]);
        }
      }
    }

    this.requestCache.set(hash, {
      hash,
      timestamp: Date.now(),
    });
  }

  /**
   * Generate secure request ID
   */
  public generateRequestId(): string {
    return randomBytes(16).toString('hex');
  }

  /**
   * Validate request ID format
   */
  public validateRequestId(id: any): boolean {
    if (typeof id === 'string') {
      return /^[a-zA-Z0-9-_]+$/.test(id) && id.length <= 100;
    }
    if (typeof id === 'number') {
      return Number.isFinite(id) && id > 0 && id < Number.MAX_SAFE_INTEGER;
    }
    return id === null;
  }
}

// Export singleton instance
export const mcpSecurityValidator = new MCPSecurityValidator();