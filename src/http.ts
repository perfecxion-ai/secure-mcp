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

// Accept origin-form without normalization that could change the selected route.
// The same path is used by the audit label and by the SDK adapter.
function requestPath(target: string, origin: string): string | undefined {
  if (!target.startsWith('/') || target.startsWith('//') || /[\x00-\x20\x7f#]/.test(target))
    return undefined;
  const path = target.split('?')[0]!;
  if (path.includes('\\') || /%(?![a-f0-9]{2})/i.test(path)) return undefined;
  try {
    const parsed = new URL(target, origin);
    return parsed.origin === origin && parsed.pathname === path ? path : undefined;
  } catch {
    return undefined;
  }
}

export async function serveHttp(runtime: SecureRuntime): Promise<HttpHandle> {
  const config = runtime.config.http;
  if (!config) throw new Error('HTTP configuration required');
  const identity = new AsyncLocalStorage<Principal>();
  const traces = new AsyncLocalStorage<{ event: AuditEvent; start: number; terminal: string }>();
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
  let authenticating = 0;
  let requests = 0;
  const terminals = new Set<Promise<void>>();
  // Legacy response preparation can overlap a tool write and its cancellation
  // outcome. Retain admission until all scoped writes and the terminal settle.
  const requestCapacity = Math.min(
    runtime.config.limits.maxConcurrent * 2,
    Math.floor(runtime.config.audit.maxPending / 3),
  );
  const counters = {
    bad_target: 0,
    host_denied: 0,
    origin_denied: 0,
    unauthorized: 0,
    authentication_busy: 0,
    busy: 0,
    not_found: 0,
    shutting_down: 0,
    audit_unavailable: 0,
  };
  const count = (reason: keyof typeof counters) => {
    counters[reason] = Math.min(Number.MAX_SAFE_INTEGER, counters[reason] + 1);
  };
  const admissionMetrics = () =>
    '# TYPE secure_mcp_http_rejections_total counter\n' +
    Object.entries(counters)
      .map(([reason, value]) => `secure_mcp_http_rejections_total{reason="${reason}"} ${value}\n`)
      .join('');

  const adapter = toNodeHandler(
    {
      fetch: async (request) => {
        const trace = traces.getStore()!;
        try {
          const principal = identity.getStore()!;
          let response: Response;
          if (trace.event.endpoint === 'metrics') {
            response = !principal.scopes.includes('metrics:read')
              ? new Response('Forbidden', {
                  status: 403,
                  headers: {
                    'www-authenticate': `${challenge}, error="insufficient_scope", scope="metrics:read"`,
                  },
                })
              : request.method !== 'GET'
                ? new Response('Method not allowed', { status: 405, headers: { allow: 'GET' } })
                : new Response(runtime.metrics() + admissionMetrics(), {
                    headers: { 'content-type': 'text/plain; version=0.0.4' },
                  });
          } else {
            // Both supported MCP revisions require single messages. Reject batches
            // before SDK dispatch, where they could fan out beyond request admission.
            const batch = request.method === 'POST' && /^\s*\[/.test(await request.clone().text());
            response = batch
              ? Response.json(
                  {
                    jsonrpc: '2.0',
                    id: null,
                    error: { code: -32600, message: 'Batch requests are not supported' },
                  },
                  { status: 400 },
                )
              : await handler.fetch(request);
          }
          await runtime.audit.write({
            ...trace.event,
            time: new Date().toISOString(),
            outcome: 'response',
            status: response.status,
            durationMs: Math.round(performance.now() - trace.start),
          });
          return response;
        } catch {
          trace.terminal = runtime.audit.healthy ? 'internal' : 'audit_unavailable';
          // toNodeHandler converts thrown fetch errors to 500. Return the intended
          // status here when headers have not been sent. A failure after an SSE
          // response starts can only fail its protocol stream, not change its 200.
          return new Response(runtime.audit.healthy ? 'Internal error' : 'Unavailable', {
            status: runtime.audit.healthy ? 500 : 503,
            headers: runtime.audit.healthy ? {} : { 'retry-after': '1' },
          });
        }
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
      const reject = (
        reason: keyof typeof counters,
        status: number,
        message: string,
        headers: Record<string, string> = {},
      ) => {
        count(reason);
        response.writeHead(status, { connection: 'close', ...headers }).end(message);
      };
      const path = requestPath(request.url ?? '', resource.origin);
      if (path === undefined) {
        reject('bad_target', 400, 'Invalid request target');
        return;
      }
      // Closing rejected connections avoids retaining an unconsumed slow body.
      response.setHeader('connection', 'close');
      if (!validateHost(request, response)) {
        count('host_denied');
        return;
      }
      response.removeHeader('connection');
      const origin = request.headers.origin;
      if (origin !== undefined && !config.allowedOrigins.includes(origin)) {
        reject('origin_denied', 403, 'Forbidden origin');
        return;
      }
      if (origin !== undefined) {
        response.setHeader('access-control-allow-origin', origin);
        response.setHeader('vary', 'Origin');
        response.setHeader('access-control-expose-headers', 'WWW-Authenticate');
      }
      if (path === '/health' && request.method === 'GET') {
        response
          .writeHead(closing || !runtime.audit.healthy ? 503 : 200, {
            'content-type': 'application/json',
          })
          .end(
            JSON.stringify({
              status: closing ? 'draining' : runtime.audit.healthy ? 'ok' : 'audit_unavailable',
            }),
          );
        return;
      }
      if (closing) {
        reject('shutting_down', 503, 'Unavailable', { 'retry-after': '1' });
        return;
      }
      if (
        (path === metadataPath || path === '/.well-known/oauth-protected-resource') &&
        request.method === 'GET'
      ) {
        response.writeHead(200, { 'content-type': 'application/json' }).end(
          JSON.stringify({
            resource: config.resource,
            authorization_servers: [config.issuer],
            bearer_methods_supported: ['header'],
          }),
        );
        return;
      }
      if (request.method === 'OPTIONS' && origin !== undefined && path === '/mcp') {
        response
          .writeHead(204, {
            'access-control-allow-methods': 'POST, GET, DELETE',
            'access-control-allow-headers':
              'Authorization, Content-Type, Accept, MCP-Protocol-Version, MCP-Method',
          })
          .end();
        return;
      }
      if (path !== '/mcp' && path !== '/metrics') {
        reject('not_found', 404, 'Not found');
        return;
      }
      const match = request.headers.authorization?.match(/^Bearer ([A-Za-z0-9._~-]{1,8192})$/i);
      if (!match?.[1]) {
        reject('unauthorized', 401, 'Unauthorized', { 'www-authenticate': challenge });
        return;
      }
      if (authenticating >= runtime.config.limits.maxConcurrent) {
        reject('authentication_busy', 503, 'Unavailable', { 'retry-after': '1' });
        return;
      }
      authenticating++;
      void (async () => {
        let principal: Principal;
        try {
          principal = await verify(match[1]!);
        } catch {
          if (!response.destroyed)
            reject('unauthorized', 401, 'Unauthorized', { 'www-authenticate': challenge });
          return;
        } finally {
          authenticating--;
        }
        if (response.destroyed) return;
        if (closing || !runtime.audit.healthy || requests >= requestCapacity) {
          reject(
            closing ? 'shutting_down' : !runtime.audit.healthy ? 'audit_unavailable' : 'busy',
            503,
            'Unavailable',
            { 'retry-after': '1' },
          );
          return;
        }
        requests++;
        const method: AuditEvent['method'] = ['GET', 'POST', 'DELETE', 'OPTIONS'].includes(
          request.method ?? '',
        )
          ? (request.method as AuditEvent['method'])
          : 'other';
        const trace = {
          event: {
            schema: 1,
            time: new Date().toISOString(),
            ...auditContext(principal, 'unknown', randomUUID()),
            kind: 'http',
            endpoint: path === '/mcp' ? 'mcp' : 'metrics',
            method,
            outcome: 'received',
            durationMs: 0,
          } as AuditEvent,
          start: performance.now(),
          terminal: 'completed',
        };
        const timeout = setTimeout(() => {
          trace.terminal = 'request_timeout';
          response.destroy();
        }, runtime.config.limits.timeoutMs + 5000);
        const closed = new Promise<void>((resolve) => response.once('close', resolve));
        response.once('close', () => {
          clearTimeout(timeout);
          if (!response.writableFinished && trace.terminal === 'completed')
            trace.terminal = 'disconnected';
        });
        const scope = runtime.audit.scope();
        const delivery = scope.run(() =>
          identity.run(principal, () =>
            traces.run(trace, async () => {
              try {
                await runtime.audit.write(trace.event);
                if (response.destroyed) return;
                await adapter(
                  {
                    method: request.method ?? 'GET',
                    url: request.url ?? '/',
                    headers: request.headers,
                    [Symbol.asyncIterator]: request[Symbol.asyncIterator].bind(request),
                  },
                  response,
                );
              } catch {
                trace.terminal = runtime.audit.healthy ? 'internal' : 'audit_unavailable';
                if (!response.headersSent)
                  response.writeHead(runtime.audit.healthy ? 500 : 503, {
                    connection: 'close',
                    'retry-after': '1',
                  });
                response.end('Unavailable');
              }
            }),
          ),
        );
        const terminal = (async () => {
          await closed;
          await delivery.catch(() => {});
          await scope.settle();
          await runtime.audit.write({
            ...trace.event,
            time: new Date().toISOString(),
            outcome: trace.terminal,
            status: response.statusCode,
            durationMs: Math.round(performance.now() - trace.start),
          });
        })()
          .catch(() => {})
          .finally(() => {
            requests--;
            terminals.delete(terminal);
          });
        terminals.add(terminal);
        await delivery;
      })().catch(() => {
        if (!response.headersSent) response.writeHead(500, { connection: 'close' });
        response.end('Internal error');
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
        // Stop tool work first, then settle HTTP terminal records before closing the
        // durable sink. ExecutionController.close is idempotent across both owners.
        await runtime.execution.close(runtime.config.limits.shutdownMs);
        await handler.close();
        server.closeAllConnections();
        await stopped;
        await Promise.allSettled([...terminals]);
        return runtime.close();
      })();
      return shutdown;
    },
  };
}
