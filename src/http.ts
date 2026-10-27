import { randomUUID } from 'node:crypto';
import { auditContext } from './audit.js';
import type { AuditEvent } from './audit.js';
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
  const traces = new AsyncLocalStorage<{ event: AuditEvent; start: number }>();
  const verify = createTokenVerifier(config);
  const resource = new URL(config.resource);
  const metadataPath = '/.well-known/oauth-protected-resource/mcp';
  const challenge = `Bearer resource_metadata="${resource.origin}${metadataPath}"`;
  const validateHost = hostHeaderValidation([resource.hostname]);
  const handler = createMcpHandler(
    () => {
      const principal = identity.getStore();
      if (!principal) throw new Error('Verified identity required');
      return runtime.createServer(principal, traces.getStore()?.event.requestId);
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
        const response = await route(request);
        const trace = traces.getStore();
        if (trace)
          await runtime.audit.write({
            ...trace.event,
            time: new Date().toISOString(),
            outcome: 'response',
            status: response.status,
            durationMs: Math.round(performance.now() - trace.start),
          });
        return response;
      },
    },
    { maxRequestBodySize: runtime.config.limits.maxInputBytes },
  );

  const route = async (request: Request): Promise<Response> => {
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
        { status: closing ? 'draining' : runtime.audit.healthy ? 'ok' : 'audit_unavailable' },
        { status: closing || !runtime.audit.healthy ? 503 : 200 },
      );
    if (path !== '/mcp' && path !== '/metrics') return new Response('Not found', { status: 404 });
    const authorization = request.headers.get('authorization');
    const match = authorization?.match(/^Bearer ([A-Za-z0-9._~-]{1,8192})$/i);
    let principal: Principal;
    try {
      if (!match?.[1]) throw new Error('Missing token');
      principal = await verify(match[1]);
      const trace = traces.getStore();
      if (trace) trace.event = { ...trace.event, actor: auditContext(principal, 'unknown').actor };
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
  };

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
      const path = (request.url ?? '').split('?')[0];
      const endpoint: AuditEvent['endpoint'] =
        path === '/mcp'
          ? 'mcp'
          : path === '/metrics'
            ? 'metrics'
            : path === '/health'
              ? 'health'
              : path?.startsWith('/.well-known/oauth-protected-resource')
                ? 'metadata'
                : 'other';
      const method: AuditEvent['method'] = ['GET', 'POST', 'DELETE', 'OPTIONS'].includes(
        request.method ?? '',
      )
        ? (request.method as AuditEvent['method'])
        : 'other';
      const trace = {
        event: {
          schema: 1,
          time: new Date().toISOString(),
          requestId: randomUUID(),
          actor: 'anonymous',
          tool: 'unknown',
          kind: 'http',
          endpoint,
          method,
          outcome: 'received',
          durationMs: 0,
        } as AuditEvent,
        start: performance.now(),
      };
      let terminal = 'completed';
      response.once('close', () => {
        if (!response.writableFinished && terminal === 'completed') terminal = 'disconnected';
        void runtime.audit
          .write({
            ...trace.event,
            time: new Date().toISOString(),
            outcome: terminal,
            status: response.statusCode,
            durationMs: Math.round(performance.now() - trace.start),
          })
          .catch(() => {});
      });
      void traces.run(trace, async () => {
        try {
          await runtime.audit.write(trace.event);
        } catch {
          terminal = 'audit_unavailable';
          response.writeHead(503).end('Unavailable');
          return;
        }
        if (response.destroyed) return;
        if (!validateHost(request, response)) {
          terminal = 'host_denied';
          return;
        }
        const origin = request.headers.origin;
        if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
          terminal = 'origin_denied';
          response.writeHead(403).end('Forbidden origin');
          return;
        }
        if (origin !== undefined) {
          response.setHeader('access-control-allow-origin', origin);
          response.setHeader('vary', 'Origin');
          response.setHeader('access-control-expose-headers', 'WWW-Authenticate');
        }
        if (closing || requests >= runtime.config.limits.maxConcurrent * 2) {
          terminal = closing ? 'shutting_down' : 'busy';
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
        const timeout = setTimeout(() => {
          terminal = 'request_timeout';
          response.destroy();
        }, runtime.config.limits.timeoutMs + 5000);
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
          terminal = runtime.audit.healthy ? 'internal' : 'audit_unavailable';
          if (!response.headersSent) response.writeHead(runtime.audit.healthy ? 500 : 503);
          response.end();
        });
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
        return remaining + (await runtime.audit.close());
      })();
      return shutdown;
    },
  };
}
