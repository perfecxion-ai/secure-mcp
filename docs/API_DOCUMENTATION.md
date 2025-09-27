# API Documentation

## Secure MCP Server API Reference

### Version: 1.0.0
### Base URL: `https://api.secure-mcp.enterprise.com`

## Overview

The Secure MCP Server provides both RESTful HTTP endpoints and WebSocket connections for Model Context Protocol operations. All endpoints require authentication except for health checks and public endpoints.

## Authentication

The API uses JWT-based authentication with support for multi-factor authentication (MFA) and SAML SSO.

### Authentication Flow

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant Auth
    participant MFA
    participant Database

    Client->>API: POST /auth/login
    API->>Auth: Validate credentials
    Auth->>Database: Check user
    Database-->>Auth: User data
    Auth->>MFA: Request MFA
    MFA-->>Client: MFA challenge
    Client->>API: POST /auth/verify-mfa
    API->>MFA: Validate MFA
    MFA-->>API: Valid
    API-->>Client: JWT tokens
```

### JWT Token Structure

```json
{
  "header": {
    "alg": "RS256",
    "typ": "JWT",
    "kid": "2024-01-01"
  },
  "payload": {
    "sub": "user_id",
    "email": "user@example.com",
    "roles": ["user", "admin"],
    "permissions": ["read:tools", "write:tools"],
    "iat": 1704067200,
    "exp": 1704070800,
    "jti": "unique_token_id"
  }
}
```

## API Endpoints

### Authentication

#### POST /api/auth/register
**Create new user account**

Request:
```json
{
  "email": "user@example.com",
  "password": "SecureP@ssw0rd123!",
  "name": "John Doe",
  "organization": "Enterprise Corp",
  "phone": "+1234567890"
}
```

Response (201 Created):
```json
{
  "id": "user_123",
  "email": "user@example.com",
  "name": "John Doe",
  "mfaEnabled": false,
  "createdAt": "2024-01-01T00:00:00Z"
}
```

Validation Rules:
- Email: Valid email format, unique in system
- Password: Minimum 12 characters, 1 uppercase, 1 lowercase, 1 number, 1 special character
- Phone: E.164 format for MFA

#### POST /api/auth/login
**Authenticate user and receive tokens**

Request:
```json
{
  "email": "user@example.com",
  "password": "SecureP@ssw0rd123!",
  "mfaCode": "123456"
}
```

Response (200 OK):
```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "refreshToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "tokenType": "Bearer",
  "user": {
    "id": "user_123",
    "email": "user@example.com",
    "roles": ["user"],
    "permissions": ["read:tools", "execute:tools"]
  }
}
```

Error Response (401 Unauthorized):
```json
{
  "error": "INVALID_CREDENTIALS",
  "message": "Invalid email or password",
  "timestamp": "2024-01-01T00:00:00Z",
  "requestId": "req_abc123"
}
```

#### POST /api/auth/refresh
**Refresh access token using refresh token**

Headers:
```http
Authorization: Bearer <refresh_token>
```

Response (200 OK):
```json
{
  "accessToken": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": 3600,
  "tokenType": "Bearer"
}
```

#### POST /api/auth/logout
**Invalidate user session and tokens**

Headers:
```http
Authorization: Bearer <access_token>
```

Response (200 OK):
```json
{
  "message": "Successfully logged out",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### POST /api/auth/mfa/enable
**Enable multi-factor authentication**

Request:
```json
{
  "type": "totp",
  "phoneNumber": "+1234567890"
}
```

Response (200 OK):
```json
{
  "secret": "JBSWY3DPEHPK3PXP",
  "qrCode": "data:image/png;base64,iVBORw0KGgoAAAANS...",
  "backupCodes": [
    "ABC123DEF456",
    "GHI789JKL012",
    "MNO345PQR678"
  ]
}
```

#### POST /api/auth/mfa/verify
**Verify MFA code**

Request:
```json
{
  "code": "123456",
  "type": "totp"
}
```

Response (200 OK):
```json
{
  "verified": true,
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### MCP Tools

#### GET /api/tools
**List all available MCP tools**

Headers:
```http
Authorization: Bearer <access_token>
```

Query Parameters:
- `category`: Filter by tool category (string)
- `enabled`: Filter by enabled status (boolean)
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20, max: 100)

Response (200 OK):
```json
{
  "tools": [
    {
      "id": "tool_filesystem",
      "name": "FileSystem",
      "description": "File system operations tool",
      "version": "1.0.0",
      "category": "system",
      "enabled": true,
      "schema": {
        "input": {
          "type": "object",
          "properties": {
            "operation": {
              "type": "string",
              "enum": ["read", "write", "delete", "list"]
            },
            "path": {
              "type": "string"
            }
          },
          "required": ["operation", "path"]
        }
      },
      "permissions": ["filesystem:read", "filesystem:write"],
      "rateLimit": {
        "requests": 100,
        "window": "1m"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 45,
    "pages": 3
  }
}
```

#### GET /api/tools/:id
**Get specific tool details**

Response (200 OK):
```json
{
  "id": "tool_filesystem",
  "name": "FileSystem",
  "description": "File system operations tool",
  "version": "1.0.0",
  "category": "system",
  "enabled": true,
  "schema": {
    "input": {
      "type": "object",
      "properties": {
        "operation": {
          "type": "string",
          "enum": ["read", "write", "delete", "list"]
        },
        "path": {
          "type": "string",
          "pattern": "^[a-zA-Z0-9/_-]+$"
        },
        "content": {
          "type": "string",
          "maxLength": 1048576
        }
      },
      "required": ["operation", "path"]
    },
    "output": {
      "type": "object",
      "properties": {
        "success": { "type": "boolean" },
        "data": { "type": "string" },
        "metadata": { "type": "object" }
      }
    }
  },
  "examples": [
    {
      "name": "Read file",
      "input": {
        "operation": "read",
        "path": "/home/user/document.txt"
      },
      "output": {
        "success": true,
        "data": "File contents...",
        "metadata": {
          "size": 1024,
          "modified": "2024-01-01T00:00:00Z"
        }
      }
    }
  ],
  "statistics": {
    "totalExecutions": 10234,
    "successRate": 0.987,
    "averageLatency": 45,
    "lastExecuted": "2024-01-01T00:00:00Z"
  }
}
```

#### POST /api/tools/:id/execute
**Execute a tool with parameters**

Request:
```json
{
  "parameters": {
    "operation": "read",
    "path": "/home/user/document.txt"
  },
  "context": {
    "sessionId": "session_123",
    "requestId": "req_abc123"
  },
  "options": {
    "timeout": 30000,
    "async": false
  }
}
```

Response (200 OK):
```json
{
  "executionId": "exec_789xyz",
  "toolId": "tool_filesystem",
  "status": "completed",
  "result": {
    "success": true,
    "data": "File contents here...",
    "metadata": {
      "size": 1024,
      "mimeType": "text/plain",
      "encoding": "utf-8"
    }
  },
  "metrics": {
    "startTime": "2024-01-01T00:00:00Z",
    "endTime": "2024-01-01T00:00:01Z",
    "duration": 1000,
    "memoryUsed": 2048
  }
}
```

Error Response (400 Bad Request):
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid parameters",
  "details": [
    {
      "field": "path",
      "message": "Path contains invalid characters",
      "code": "INVALID_FORMAT"
    }
  ],
  "timestamp": "2024-01-01T00:00:00Z",
  "requestId": "req_abc123"
}
```

### Contexts

#### GET /api/contexts
**List user contexts**

Query Parameters:
- `status`: Filter by status (active, archived)
- `sort`: Sort field (created, updated, name)
- `order`: Sort order (asc, desc)

Response (200 OK):
```json
{
  "contexts": [
    {
      "id": "ctx_123",
      "name": "Project Alpha",
      "description": "Development context for Project Alpha",
      "status": "active",
      "metadata": {
        "project": "alpha",
        "environment": "development"
      },
      "tools": ["tool_filesystem", "tool_database"],
      "createdAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T12:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 5
  }
}
```

#### POST /api/contexts
**Create new context**

Request:
```json
{
  "name": "Project Beta",
  "description": "Production context for Project Beta",
  "metadata": {
    "project": "beta",
    "environment": "production",
    "team": "backend"
  },
  "tools": ["tool_filesystem", "tool_monitoring"],
  "settings": {
    "maxExecutionTime": 60000,
    "retryPolicy": {
      "maxRetries": 3,
      "backoffMultiplier": 2
    }
  }
}
```

Response (201 Created):
```json
{
  "id": "ctx_456",
  "name": "Project Beta",
  "description": "Production context for Project Beta",
  "status": "active",
  "metadata": {
    "project": "beta",
    "environment": "production",
    "team": "backend"
  },
  "tools": ["tool_filesystem", "tool_monitoring"],
  "settings": {
    "maxExecutionTime": 60000,
    "retryPolicy": {
      "maxRetries": 3,
      "backoffMultiplier": 2
    }
  },
  "createdAt": "2024-01-01T00:00:00Z"
}
```

#### PUT /api/contexts/:id
**Update context**

Request:
```json
{
  "name": "Project Beta Updated",
  "tools": ["tool_filesystem", "tool_monitoring", "tool_analytics"],
  "settings": {
    "maxExecutionTime": 30000
  }
}
```

Response (200 OK):
```json
{
  "id": "ctx_456",
  "name": "Project Beta Updated",
  "tools": ["tool_filesystem", "tool_monitoring", "tool_analytics"],
  "settings": {
    "maxExecutionTime": 30000
  },
  "updatedAt": "2024-01-01T14:00:00Z"
}
```

#### DELETE /api/contexts/:id
**Delete context**

Response (204 No Content)

### Sessions

#### GET /api/sessions
**List active sessions**

Response (200 OK):
```json
{
  "sessions": [
    {
      "id": "session_123",
      "userId": "user_123",
      "contextId": "ctx_123",
      "status": "active",
      "connectionType": "websocket",
      "ipAddress": "192.168.1.100",
      "userAgent": "MCP-Client/1.0",
      "startedAt": "2024-01-01T00:00:00Z",
      "lastActivity": "2024-01-01T00:05:00Z",
      "metrics": {
        "messagesReceived": 150,
        "messagesSent": 148,
        "toolExecutions": 25,
        "errors": 2
      }
    }
  ]
}
```

#### POST /api/sessions/:id/terminate
**Terminate specific session**

Response (200 OK):
```json
{
  "message": "Session terminated successfully",
  "sessionId": "session_123",
  "timestamp": "2024-01-01T00:10:00Z"
}
```

### Admin Endpoints

#### GET /api/admin/users
**List all users (Admin only)**

Query Parameters:
- `role`: Filter by role
- `status`: Filter by status (active, suspended, deleted)
- `search`: Search by email or name

Response (200 OK):
```json
{
  "users": [
    {
      "id": "user_123",
      "email": "user@example.com",
      "name": "John Doe",
      "roles": ["user"],
      "status": "active",
      "mfaEnabled": true,
      "lastLogin": "2024-01-01T00:00:00Z",
      "createdAt": "2023-12-01T00:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 234
  }
}
```

#### PUT /api/admin/users/:id/roles
**Update user roles (Admin only)**

Request:
```json
{
  "roles": ["user", "developer"],
  "permissions": ["read:tools", "write:tools", "execute:tools"]
}
```

Response (200 OK):
```json
{
  "id": "user_123",
  "roles": ["user", "developer"],
  "permissions": ["read:tools", "write:tools", "execute:tools"],
  "updatedAt": "2024-01-01T00:00:00Z"
}
```

#### GET /api/admin/audit-logs
**Retrieve audit logs (Admin only)**

Query Parameters:
- `startDate`: ISO 8601 date string
- `endDate`: ISO 8601 date string
- `userId`: Filter by user ID
- `action`: Filter by action type
- `severity`: Filter by severity level

Response (200 OK):
```json
{
  "logs": [
    {
      "id": "log_789",
      "timestamp": "2024-01-01T00:00:00Z",
      "userId": "user_123",
      "action": "tool.execute",
      "resource": "tool_filesystem",
      "details": {
        "toolId": "tool_filesystem",
        "parameters": {
          "operation": "read",
          "path": "/sensitive/file.txt"
        }
      },
      "result": "success",
      "ipAddress": "192.168.1.100",
      "userAgent": "MCP-Client/1.0",
      "severity": "info",
      "metadata": {
        "sessionId": "session_123",
        "requestId": "req_abc123"
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 100,
    "total": 5432
  }
}
```

### Health & Monitoring

#### GET /health
**Basic health check**

Response (200 OK):
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z",
  "version": "1.0.0"
}
```

#### GET /health/detailed
**Detailed health check with component status**

Response (200 OK):
```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T00:00:00Z",
  "version": "1.0.0",
  "components": {
    "database": {
      "status": "healthy",
      "latency": 5,
      "connections": {
        "active": 10,
        "idle": 5,
        "max": 20
      }
    },
    "redis": {
      "status": "healthy",
      "latency": 2,
      "memory": {
        "used": "256MB",
        "max": "1GB",
        "percentage": 25
      }
    },
    "vault": {
      "status": "healthy",
      "sealed": false,
      "version": "1.15.0"
    }
  },
  "metrics": {
    "uptime": 864000,
    "requestsPerSecond": 150,
    "activeConnections": 45,
    "cpuUsage": 35,
    "memoryUsage": 60
  }
}
```

#### GET /ready
**Readiness probe for Kubernetes**

Response (200 OK):
```json
{
  "ready": true,
  "timestamp": "2024-01-01T00:00:00Z"
}
```

#### GET /metrics
**Prometheus metrics endpoint**

Response (200 OK):
```text
# HELP mcp_server_requests_total Total number of HTTP requests
# TYPE mcp_server_requests_total counter
mcp_server_requests_total{method="GET",endpoint="/api/tools",status="200"} 1543
mcp_server_requests_total{method="POST",endpoint="/api/tools/execute",status="200"} 892

# HELP mcp_server_request_duration_seconds Request duration in seconds
# TYPE mcp_server_request_duration_seconds histogram
mcp_server_request_duration_seconds_bucket{le="0.005"} 1234
mcp_server_request_duration_seconds_bucket{le="0.01"} 2345
mcp_server_request_duration_seconds_bucket{le="0.025"} 3456

# HELP mcp_websocket_connections_active Number of active WebSocket connections
# TYPE mcp_websocket_connections_active gauge
mcp_websocket_connections_active 45

# HELP mcp_tool_executions_total Total number of tool executions
# TYPE mcp_tool_executions_total counter
mcp_tool_executions_total{tool="filesystem",status="success"} 789
mcp_tool_executions_total{tool="filesystem",status="error"} 12
```

## WebSocket API

### Connection

```javascript
const ws = new WebSocket('wss://api.secure-mcp.enterprise.com/ws', {
  headers: {
    'Authorization': 'Bearer <access_token>',
    'X-Client-Version': '1.0.0',
    'X-Request-ID': 'req_abc123'
  }
});
```

### Message Format

All WebSocket messages follow the JSON-RPC 2.0 specification:

```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "params": {
    "category": "system"
  },
  "id": 1
}
```

### WebSocket Methods

#### tools/list
List available tools in the current context.

Request:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/list",
  "params": {
    "category": "system",
    "enabled": true
  },
  "id": 1
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "tools": [
      {
        "name": "filesystem",
        "description": "File system operations"
      }
    ]
  },
  "id": 1
}
```

#### tools/execute
Execute a tool with parameters.

Request:
```json
{
  "jsonrpc": "2.0",
  "method": "tools/execute",
  "params": {
    "tool": "filesystem",
    "arguments": {
      "operation": "read",
      "path": "/home/user/file.txt"
    }
  },
  "id": 2
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "output": "File contents...",
    "metadata": {
      "executionTime": 45,
      "bytesRead": 1024
    }
  },
  "id": 2
}
```

#### context/update
Update the current context.

Request:
```json
{
  "jsonrpc": "2.0",
  "method": "context/update",
  "params": {
    "contextId": "ctx_456",
    "metadata": {
      "environment": "staging"
    }
  },
  "id": 3
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "success": true,
    "context": {
      "id": "ctx_456",
      "metadata": {
        "environment": "staging"
      }
    }
  },
  "id": 3
}
```

#### subscribe
Subscribe to real-time events.

Request:
```json
{
  "jsonrpc": "2.0",
  "method": "subscribe",
  "params": {
    "events": ["tool.executed", "context.updated", "error"]
  },
  "id": 4
}
```

Response:
```json
{
  "jsonrpc": "2.0",
  "result": {
    "subscribed": true,
    "events": ["tool.executed", "context.updated", "error"]
  },
  "id": 4
}
```

Event notification:
```json
{
  "jsonrpc": "2.0",
  "method": "notification",
  "params": {
    "event": "tool.executed",
    "data": {
      "toolId": "filesystem",
      "executionId": "exec_123",
      "status": "success",
      "timestamp": "2024-01-01T00:00:00Z"
    }
  }
}
```

## Error Handling

### Error Response Format

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {
      "field": "Additional context"
    },
    "timestamp": "2024-01-01T00:00:00Z",
    "requestId": "req_abc123",
    "traceId": "trace_xyz789"
  }
}
```

### Error Codes

| Code | HTTP Status | Description |
|------|------------|-------------|
| UNAUTHORIZED | 401 | Authentication required or invalid credentials |
| FORBIDDEN | 403 | Insufficient permissions |
| NOT_FOUND | 404 | Resource not found |
| VALIDATION_ERROR | 400 | Request validation failed |
| RATE_LIMIT_EXCEEDED | 429 | Too many requests |
| INTERNAL_ERROR | 500 | Internal server error |
| SERVICE_UNAVAILABLE | 503 | Service temporarily unavailable |
| TIMEOUT | 504 | Request timeout |
| CONFLICT | 409 | Resource conflict |
| PRECONDITION_FAILED | 412 | Precondition not met |

### Rate Limiting

Rate limits are applied per user and per endpoint:

| Endpoint | Rate Limit | Window |
|----------|------------|--------|
| /api/auth/login | 5 | 15 minutes |
| /api/auth/register | 3 | 1 hour |
| /api/tools/execute | 100 | 1 minute |
| /api/tools/list | 1000 | 1 minute |
| WebSocket messages | 100 | 1 second |

Rate limit headers:
```http
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1704067200
Retry-After: 60
```

## SDK Examples

### JavaScript/TypeScript

```typescript
import { MCPClient } from '@secure-mcp/client';

const client = new MCPClient({
  baseURL: 'https://api.secure-mcp.enterprise.com',
  auth: {
    username: 'user@example.com',
    password: 'SecureP@ssw0rd123!'
  }
});

// Authenticate
await client.auth.login();

// List tools
const tools = await client.tools.list();

// Execute tool
const result = await client.tools.execute('filesystem', {
  operation: 'read',
  path: '/home/user/file.txt'
});

// WebSocket connection
const ws = client.websocket.connect();
ws.on('message', (msg) => console.log(msg));
```

### Python

```python
from secure_mcp import MCPClient

client = MCPClient(
    base_url='https://api.secure-mcp.enterprise.com',
    username='user@example.com',
    password='SecureP@ssw0rd123!'
)

# Authenticate
client.auth.login()

# List tools
tools = client.tools.list()

# Execute tool
result = client.tools.execute('filesystem', {
    'operation': 'read',
    'path': '/home/user/file.txt'
})

# WebSocket connection
async with client.websocket() as ws:
    async for msg in ws:
        print(msg)
```

### cURL Examples

```bash
# Login
curl -X POST https://api.secure-mcp.enterprise.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","password":"SecureP@ssw0rd123!"}'

# List tools (with auth token)
curl -X GET https://api.secure-mcp.enterprise.com/api/tools \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..."

# Execute tool
curl -X POST https://api.secure-mcp.enterprise.com/api/tools/filesystem/execute \
  -H "Authorization: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9..." \
  -H "Content-Type: application/json" \
  -d '{"parameters":{"operation":"read","path":"/home/user/file.txt"}}'
```

## Postman Collection

Import the [Postman Collection](./postman/secure-mcp-api.json) for interactive API testing with pre-configured requests and environments.

## API Versioning

The API uses semantic versioning with the version specified in the URL path:

- Current version: `/api/v1/`
- Legacy support: `/api/v0/` (deprecated, removal date: 2025-01-01)
- Beta features: `/api/v2-beta/`

Version negotiation via headers:
```http
Accept: application/vnd.secure-mcp.v1+json
```

## Webhooks

Configure webhooks to receive real-time notifications:

### Webhook Configuration

POST /api/admin/webhooks
```json
{
  "url": "https://your-server.com/webhook",
  "events": ["tool.executed", "context.updated", "error"],
  "secret": "webhook_secret_key",
  "active": true
}
```

### Webhook Payload

```json
{
  "event": "tool.executed",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "toolId": "filesystem",
    "executionId": "exec_123",
    "userId": "user_123",
    "result": "success"
  },
  "signature": "sha256=abcdef123456..."
}
```

### Signature Verification

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hash = crypto
    .createHmac('sha256', secret)
    .update(JSON.stringify(payload))
    .digest('hex');

  return `sha256=${hash}` === signature;
}
```

## Support

For API support and questions:
- Documentation: https://docs.secure-mcp.enterprise.com
- API Status: https://status.secure-mcp.enterprise.com
- Support: api-support@enterprise.com
- Security: security@enterprise.com