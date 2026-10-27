# Secure MCP Client SDK

<div align="center">

```
██████╗ ███████╗██████╗ ███████╗███████╗ ██████╗██╗  ██╗██╗ ██████╗ ███╗   ██╗
██╔══██╗██╔════╝██╔══██╗██╔════╝██╔════╝██╔════╝╚██╗██╔╝██║██╔═══██╗████╗  ██║
██████╔╝█████╗  ██████╔╝█████╗  █████╗  ██║      ╚███╔╝ ██║██║   ██║██╔██╗ ██║
██╔═══╝ ██╔══╝  ██╔══██╗██╔══╝  ██╔══╝  ██║      ██╔██╗ ██║██║   ██║██║╚██╗██║
██║     ███████╗██║  ██║██║     ███████╗╚██████╗██╔╝ ██╗██║╚██████╔╝██║ ╚████║
╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝     ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝ ╚═════╝ ╚═╝  ╚═══╝
                                    .ai
```

  <p><strong>Developed by the perfecXion.ai Team</strong></p>
  <p>
    <a href="https://perfecxion.ai">Website</a> •
    <a href="https://github.com/perfecxion-ai/secure-mcp">GitHub</a> •
    <a href="https://www.npmjs.com/package/@perfecxion/secure-mcp-client">NPM</a>
  </p>
</div>

---

Official client SDK for the Secure MCP Server by **perfecXion.ai**.

## Installation

```bash
npm install @perfecxion/secure-mcp-client
```

## Quick Start

```typescript
import { SecureMCPClient } from '@perfecxion/secure-mcp-client';

// Initialize client
const client = new SecureMCPClient({
  serverUrl: 'https://mcp.example.com',
  apiKey: 'your-api-key',
  debug: true
});

// Connect via WebSocket
await client.connect();

// List available tools
const tools = await client.listTools();
console.log('Available tools:', tools);

// Execute a tool
const result = await client.executeTool('search', {
  query: 'machine learning papers'
});

// Subscribe to events
client.subscribe('notification', (data) => {
  console.log('Notification:', data);
});

// Disconnect when done
client.disconnect();
```

## Features

- ✅ WebSocket and HTTP transport
- ✅ Automatic reconnection
- ✅ JWT and API key authentication
- ✅ Event subscription
- ✅ TypeScript support
- ✅ Promise-based API
- ✅ Request queuing

## API Reference

### Constructor

```typescript
new SecureMCPClient(config: MCPClientConfig)
```

**Config Options:**
- `serverUrl`: MCP server URL (required)
- `apiKey`: API key for authentication
- `jwt`: JWT token for authentication
- `timeout`: Request timeout in ms (default: 30000)
- `reconnectionAttempts`: Max reconnection attempts (default: 5)
- `debug`: Enable debug logging (default: false)

### Methods

#### connect()
Connect to the MCP server via WebSocket.

```typescript
await client.connect();
```

#### disconnect()
Disconnect from the MCP server.

```typescript
client.disconnect();
```

#### request(method, params)
Send a generic request to the MCP server.

```typescript
const response = await client.request('custom/method', { data: 'value' });
```

#### listTools()
Get list of available tools.

```typescript
const tools = await client.listTools();
```

#### executeTool(name, params)
Execute a specific tool.

```typescript
const result = await client.executeTool('search', { query: 'test' });
```

#### listResources()
Get list of available resources.

```typescript
const resources = await client.listResources();
```

#### readResource(uri)
Read a specific resource.

```typescript
const content = await client.readResource('file:///path/to/resource');
```

#### complete(prompt, options)
Send a completion request.

```typescript
const response = await client.complete('Generate a summary of...', {
  temperature: 0.7,
  maxTokens: 1000
});
```

#### subscribe(event, handler)
Subscribe to server events.

```typescript
client.subscribe('update', (data) => {
  console.log('Update received:', data);
});
```

## Events

- `connected`: Fired when connected to server
- `disconnected`: Fired when disconnected from server
- `error`: Fired on connection or request error
- `message`: Fired for all incoming messages

## Authentication

### API Key

```typescript
const client = new SecureMCPClient({
  serverUrl: 'https://mcp.example.com',
  apiKey: 'your-api-key'
});
```

### JWT Token

```typescript
const client = new SecureMCPClient({
  serverUrl: 'https://mcp.example.com',
  jwt: 'your-jwt-token'
});
```

## Error Handling

```typescript
try {
  await client.connect();
  const result = await client.executeTool('tool', {});
} catch (error) {
  console.error('MCP Error:', error.message);
}
```

## License

Apache-2.0

---

<div align="center">
  <p><strong>Built with ❤️ by the perfecXion.ai Team</strong></p>
  <p>© 2024 perfecXion.ai - Enterprise AI Solutions</p>
</div>