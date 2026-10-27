import { AsyncLocalStorage } from 'node:async_hooks';
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { hostHeaderValidation, toNodeHandler } from '@modelcontextprotocol/node';
import { createTokenVerifier } from './identity.js';
import type { Principal } from './policy.js';
import type { SecureRuntime } from './runtime.js';

export interface HttpHandle {
  readonly server: Server;
  readonly url: string;
  close(): Promise<number>;
}

export async function serveHttp(runtime: SecureRuntime): Promise<HttpHandle> {
  const config = runtime.config.http;
  if (!config) throw new Error('HTTP configuration required');
  const identity = new AsyncLocalStorage<Principal>();
  const verify = createTokenVerifier(config);
  const resource = new URL(config.resource);
  const metadataPath = '/.well-known/oauth-protected-resource/mcp';
  const challenge = `Bearer resource_metadata="${resource.origin}${metadataPath}"`;
  const validateHost = hostHeaderValidation([resource.hostname]);
  const handler = createMcpHandler(
    () => {
      const principal = identity.getStore();
      if (!principal) throw new Error('Verified identity required');
      return runtime.createServer(principal);
    },
    {
      legacy: 'stateless',
      maxRequestBodySize: runtime.config.limits.maxInputBytes,
      maxSubscriptions: 0,
    },
  );
  let closing = false;
  let requests = 0;

  const adapter = toNodeHandler(
    {
      fetch: async (request) => {
        const path = new URL(request.url).pathname;
        if (
          (path === metadataPath || path === '/.well-known/oauth-protected-resource') &&
          request.method === 'GET'
        ) {
          return Response.json({
            resource: config.resource,
            authorization_servers: [config.issuer],
            bearer_methods_supported: ['header'],
          });
        }
        if (path === '/health' && request.method === 'GET')
          return Response.json(
            { status: closing ? 'draining' : 'ok' },
            { status: closing ? 503 : 200 },
          );
        if (path !== '/mcp' && path !== '/metrics')
          return new Response('Not found', { status: 404 });
        const authorization = request.headers.get('authorization');
        const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]{1,8192})$/i);
        let principal: Principal;
        try {
          if (!match?.[1]) throw new Error('Missing token');
          principal = await verify(match[1]);
        } catch {
          return new Response('Unauthorized', {
            status: 401,
            headers: { 'www-authenticate': challenge },
          });
        }
        if (path === '/metrics') {
          if (!principal.scopes.includes('metrics:read'))
            return new Response('Forbidden', {
              status: 403,
              headers: {
                'www-authenticate': `${challenge}, error="insufficient_scope", scope="metrics:read"`,
              },
            });
          if (request.method !== 'GET')
            return new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } });
          return new Response(runtime.metrics(), {
            headers: { 'content-type': 'text/plain; version=0.0.4' },
          });
        }
        return identity.run(principal, () => handler.fetch(request));
      },
    },
    { maxRequestBodySize: runtime.config.limits.maxInputBytes },
  );

  const server = createServer(
    {
      maxHeaderSize: 16_384,
      requestTimeout: 15_000,
      headersTimeout: 10_000,
      keepAliveTimeout: 2000,
      connectionsCheckingInterval: 1000,
    },
    (request, response) => {
      response.setHeader('cache-control', 'no-store');
      response.setHeader('x-content-type-options', 'nosniff');
      if (!validateHost(request, response)) return;
      const origin = request.headers.origin;
      if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
        response.writeHead(403).end('Forbidden origin');
        return;
      }
      if (origin !== undefined) {
        response.setHeader('access-control-allow-origin', origin);
        response.setHeader('vary', 'Origin');
        response.setHeader('access-control-expose-headers', 'WWW-Authenticate');
      }
      if (closing || requests >= runtime.config.limits.maxConcurrent * 2) {
        response.writeHead(503, { 'retry-after': '1' }).end('Unavailable');
        return;
      }
      if (request.method === 'OPTIONS' && origin !== undefined && request.url === '/mcp') {
        response
          .writeHead(204, {
            'access-control-allow-methods': 'POST, GET, DELETE',
            'access-control-allow-headers':
              'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Method',
          })
          .end();
        return;
      }
      requests++;
      const timeout = setTimeout(() => response.destroy(), runtime.config.limits.timeoutMs + 5000);
      let released = false;
      const release = () => {
        if (!released) {
          released = true;
          requests--;
          clearTimeout(timeout);
        }
      };
      response.once('close', release);
      response.once('finish', release);
      void adapter(
        {
          method: request.method ?? 'GET',
          url: request.url ?? '/',
          headers: request.headers,
          [Symbol.asyncIterator]: request[Symbol.asyncIterator].bind(request),
        },
        response,
      ).catch(() => {
        if (!response.headersSent) response.writeHead(500);
        response.end();
      });
    },
  );
  server.maxConnections = Math.max(32, runtime.config.limits.maxConcurrent * 4);
  server.maxRequestsPerSocket = 1000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing server address');
  const host = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  let shutdown: Promise<number> | undefined;
  return {
    server,
    url: `http://${host}:${address.port}/mcp`,
    close() {
      shutdown ??= (async () => {
        closing = true;
        const stopped = new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
        const remaining = await runtime.close();
        await handler.close();
        server.closeAllConnections();
        await stopped;
        return remaining;
      })();
      return shutdown;
    },
  };
}
