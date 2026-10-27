import { randomUUID } from 'crypto';

// User fixtures
export const userFixtures = {
  validUser: {
    id: 'user-123',
    email: 'user@example.com',
    username: 'testuser',
    firstName: 'Test',
    lastName: 'User',
    roles: ['user'],
    permissions: ['basic', 'read'],
    mfaEnabled: false,
    mfaVerified: false,
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-01-01T00:00:00Z'),
  },

  adminUser: {
    id: 'admin-123',
    email: 'admin@example.com',
    username: 'admin',
    firstName: 'Admin',
    lastName: 'User',
    roles: ['admin', 'user'],
    permissions: ['*'],
    mfaEnabled: true,
    mfaVerified: true,
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-01-01T00:00:00Z'),
  },

  mfaUser: {
    id: 'mfa-123',
    email: 'mfa@example.com',
    username: 'mfauser',
    firstName: 'MFA',
    lastName: 'User',
    roles: ['user'],
    permissions: ['basic', 'read', 'write'],
    mfaEnabled: true,
    mfaVerified: false,
    mfaSecret: 'JBSWY3DPEHPK3PXP',
    createdAt: new Date('2023-01-01T00:00:00Z'),
    updatedAt: new Date('2023-01-01T00:00:00Z'),
  },
};

// Session fixtures
export const sessionFixtures = {
  validSession: {
    id: 'session-123',
    userId: 'user-123',
    createdAt: new Date('2023-01-01T00:00:00Z'),
    lastActivity: new Date(),
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Test Browser)',
  },

  expiredSession: {
    id: 'session-expired',
    userId: 'user-123',
    createdAt: new Date('2023-01-01T00:00:00Z'),
    lastActivity: new Date('2023-01-01T01:00:00Z'),
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Test Browser)',
  },

  suspiciousSession: {
    id: 'session-suspicious',
    userId: 'user-123',
    createdAt: new Date(),
    lastActivity: new Date(),
    ipAddress: '10.0.0.1',
    userAgent: 'sqlmap/1.0 (malicious scanner)',
  },
};

// JWT payload fixtures
export const jwtFixtures = {
  validPayload: {
    sub: 'user-123',
    email: 'user@example.com',
    roles: ['user'],
    permissions: ['basic', 'read'],
    sessionId: 'session-123',
    mfaVerified: false,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'secure-mcp-server',
    aud: 'secure-mcp-client',
    jti: randomUUID(),
  },

  expiredPayload: {
    sub: 'user-123',
    email: 'user@example.com',
    roles: ['user'],
    permissions: ['basic'],
    sessionId: 'session-123',
    mfaVerified: false,
    iat: Math.floor(Date.now() / 1000) - 3600,
    exp: Math.floor(Date.now() / 1000) - 1800,
    iss: 'secure-mcp-server',
    aud: 'secure-mcp-client',
    jti: randomUUID(),
  },

  adminPayload: {
    sub: 'admin-123',
    email: 'admin@example.com',
    roles: ['admin', 'user'],
    permissions: ['*'],
    sessionId: 'session-admin',
    mfaVerified: true,
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 3600,
    iss: 'secure-mcp-server',
    aud: 'secure-mcp-client',
    jti: randomUUID(),
  },
};

// MCP message fixtures
export const mcpFixtures = {
  initializeRequest: {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: {},
        resources: {},
      },
      clientInfo: {
        name: 'test-client',
        version: '1.0.0',
      },
    },
  },

  initializeResponse: {
    jsonrpc: '2.0',
    id: 1,
    result: {
      protocolVersion: '2024-11-05',
      capabilities: {
        tools: { listChanged: true },
        resources: { listChanged: true, subscribe: true },
        logging: {},
      },
      serverInfo: {
        name: 'secure-mcp-server',
        version: '1.0.0',
      },
    },
  },

  listToolsRequest: {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/list',
    params: {},
  },

  listToolsResponse: {
    jsonrpc: '2.0',
    id: 2,
    result: {
      tools: [
        {
          name: 'echo',
          description: 'Echo back the input text',
          inputSchema: {
            type: 'object',
            properties: {
              text: { type: 'string' },
            },
            required: ['text'],
          },
        },
      ],
    },
  },

  callToolRequest: {
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: {
      name: 'echo',
      arguments: {
        text: 'Hello, World!',
      },
    },
  },

  callToolResponse: {
    jsonrpc: '2.0',
    id: 3,
    result: {
      content: [
        {
          type: 'text',
          text: 'Echo: Hello, World!',
        },
      ],
    },
  },

  errorResponse: {
    jsonrpc: '2.0',
    id: null,
    error: {
      code: -32600,
      message: 'Invalid Request',
    },
  },
};

// Security test fixtures
export const securityFixtures = {
  maliciousInputs: {
    sqlInjection: [
      "'; DROP TABLE users; --",
      "' OR '1'='1",
      "1' UNION SELECT * FROM sensitive_data --",
      "'; EXEC xp_cmdshell('dir'); --",
    ],

    xssPayloads: [
      '<script>alert("XSS")</script>',
      '<img src=x onerror=alert("XSS")>',
      'javascript:alert("XSS")',
      '<svg onload=alert("XSS")>',
      '<iframe src="javascript:alert(XSS)">',
    ],

    commandInjection: [
      '; rm -rf /',
      '| cat /etc/passwd',
      '&& shutdown -h now',
      '`whoami`',
      '$(<script>alert(1)</script>)',
    ],

    pathTraversal: [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\config\\sam',
      '....//....//....//etc/passwd',
      '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    ],

    noSqlInjection: [
      '{"$where": "this.password.match(/.*/)"}',
      '{"$ne": null}',
      '{"$regex": ".*"}',
      '{"$gt": ""}',
      '{"$or": [{"password": {"$regex": ".*"}}, {"username": "admin"}]}',
    ],

    headerInjection: [
      'Value\r\nX-Injected-Header: malicious',
      'Value\nSet-Cookie: evil=true',
      'Value\r\n\r\n<script>alert("XSS")</script>',
    ],
  },

  validSecurityHeaders: {
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'x-xss-protection': '1; mode=block',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'content-security-policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline';",
    'strict-transport-security': 'max-age=31536000; includeSubDomains; preload',
  },

  suspiciousUserAgents: [
    'sqlmap/1.0',
    'Nikto/2.1.6',
    'DirBuster-1.0-RC1',
    'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1; .NET CLR 1.1.4322) Burp',
    'OWASP ZAP 2.10.0',
  ],

  maliciousIPs: [
    '192.168.1.666', // Invalid IP format
    '10.0.0.1', // Common internal IP that might be suspicious
    '169.254.1.1', // Link-local address
    '127.0.0.2', // Suspicious localhost variation
  ],
};

// Performance test fixtures
export const performanceFixtures = {
  loadTestConfig: {
    concurrent: 100,
    duration: 30000, // 30 seconds
    rampUp: 5000, // 5 seconds
    errorThreshold: 0.01, // 1% error rate
  },

  stressTestConfig: {
    concurrent: 500,
    duration: 60000, // 1 minute
    rampUp: 10000, // 10 seconds
    errorThreshold: 0.05, // 5% error rate
  },

  spikeTestConfig: {
    baseLoad: 10,
    spikeLoad: 1000,
    spikeDuration: 5000, // 5 seconds
    totalDuration: 60000, // 1 minute
  },

  performanceThresholds: {
    responseTime: {
      p50: 100, // 50th percentile < 100ms
      p95: 500, // 95th percentile < 500ms
      p99: 1000, // 99th percentile < 1s
    },
    throughput: {
      minimum: 1000, // At least 1000 requests/second
    },
    errorRate: {
      maximum: 0.01, // Max 1% error rate
    },
  },
};

// Database fixtures
export const databaseFixtures = {
  users: [
    userFixtures.validUser,
    userFixtures.adminUser,
    userFixtures.mfaUser,
  ],

  sessions: [
    sessionFixtures.validSession,
    sessionFixtures.expiredSession,
    sessionFixtures.suspiciousSession,
  ],

  auditLogs: [
    {
      id: 'audit-1',
      userId: 'user-123',
      action: 'LOGIN',
      resource: 'auth',
      details: { ip: '192.168.1.100' },
      timestamp: new Date('2023-01-01T00:00:00Z'),
    },
    {
      id: 'audit-2',
      userId: 'admin-123',
      action: 'CREATE_USER',
      resource: 'user',
      details: { targetUserId: 'user-123' },
      timestamp: new Date('2023-01-01T00:05:00Z'),
    },
  ],
};

// WebSocket fixtures
export const websocketFixtures = {
  connectionInfo: {
    id: 'conn-123',
    userId: 'user-123',
    sessionId: 'session-123',
    ipAddress: '192.168.1.100',
    userAgent: 'Mozilla/5.0 (Test Browser)',
    connectedAt: new Date(),
  },

  handshakeData: {
    address: '192.168.1.100',
    headers: {
      'user-agent': 'Mozilla/5.0 (Test Browser)',
      'authorization': 'Bearer valid-jwt-token',
    },
    auth: {
      token: 'valid-jwt-token',
    },
  },

  messages: {
    ping: {
      jsonrpc: '2.0',
      method: 'ping',
      id: 'ping-1',
    },

    pong: {
      jsonrpc: '2.0',
      id: 'ping-1',
      result: {
        status: 'pong',
        timestamp: new Date().toISOString(),
      },
    },
  },
};

// Configuration fixtures
export const configFixtures = {
  testConfig: {
    env: 'test',
    server: {
      port: 3001,
      host: '127.0.0.1',
    },
    database: {
      url: 'postgresql://test:test@localhost:5432/secure_mcp_test',
      ssl: false,
      pool: { min: 1, max: 5 },
      timeout: 5000,
    },
    redis: {
      url: 'redis://localhost:6379/1',
      db: 1,
      connectTimeout: 5000,
      commandTimeout: 2000,
    },
    jwt: {
      secret: 'test-jwt-secret-must-be-at-least-32-characters-long',
      accessExpiresIn: '15m',
      refreshExpiresIn: '7d',
      issuer: 'secure-mcp-server',
      audience: 'secure-mcp-client',
    },
    security: {
      forceHttps: false,
      hstsMaxAge: 31536000,
      frameOptions: 'DENY',
    },
  },

  productionConfig: {
    env: 'production',
    server: {
      port: 443,
      host: '0.0.0.0',
    },
    security: {
      forceHttps: true,
      hstsMaxAge: 31536000,
      frameOptions: 'DENY',
    },
  },
};

// Export all fixtures
export const fixtures = {
  users: userFixtures,
  sessions: sessionFixtures,
  jwt: jwtFixtures,
  mcp: mcpFixtures,
  security: securityFixtures,
  performance: performanceFixtures,
  database: databaseFixtures,
  websocket: websocketFixtures,
  config: configFixtures,
};