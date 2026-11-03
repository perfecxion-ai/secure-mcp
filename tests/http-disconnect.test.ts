import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setImmediate } from 'node:timers/promises';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { AuditEvent } from '../src/audit.js';
import { serveHttp } from '../src/http.js';
import { fixture } from './helpers.js';

function deferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function bounded(promise: Promise<unknown>, stage: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${stage}`)), 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

for (const mode of [{ pin: '2026-07-28' }, 'legacy'] as const)
  for (const hold of ['all-records', 'admission-only'] as const)
    test(
      `HTTP disconnect retains audit admission (${typeof mode === 'string' ? mode : mode.pin}, ${hold})`,
      { timeout: 15_000 },
      async (t) => {
        const keys = await generateKeyPair('ES256');
        const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'disconnect' };
        const jwks = createServer((_request, response) =>
          response
            .setHeader('content-type', 'application/json')
            .end(JSON.stringify({ keys: [jwk] })),
        );
        await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
        t.after(() => {
          jwks.close();
          jwks.closeAllConnections();
        });
        const address = jwks.address();
        assert.ok(address && typeof address !== 'string');
        const issuer = `http://127.0.0.1:${address.port}`;
        const resource = 'http://127.0.0.1/mcp';
        const admitted = deferred();
        const cancelled = deferred();
        const terminal = deferred();
        const acknowledgement = deferred();
        const events: AuditEvent[] = [];
        const exchanges = new Map<string, ReturnType<typeof deferred>>();
        let blocked = false;
        let requestId: string | undefined;
        t.after(() => acknowledgement.resolve());
        const { runtime } = await fixture(t, {
          config: {
            transport: 'http',
            allowedTools: ['policy_status'],
            limits: { maxConcurrent: 1, timeoutMs: 5000 },
            audit: { maxPending: 3, timeoutMs: 5000 },
            http: { port: 0, issuer, resource, jwksUrl: issuer + '/jwks', algorithms: ['ES256'] },
          },
          audit: async (event) => {
            events.push(event);
            if (event.kind === 'http' && event.outcome === 'received')
              exchanges.set(event.requestId, deferred());
            if (
              event.kind === 'http' &&
              (event.outcome === 'completed' || event.outcome === 'disconnected')
            )
              exchanges.get(event.requestId)?.resolve();
            if (!blocked && event.kind === 'tool' && event.outcome === 'allowed') {
              blocked = true;
              requestId = event.requestId;
              admitted.resolve();
            }
            if (event.requestId === requestId && event.outcome === 'cancelled') cancelled.resolve();
            if (event.requestId === requestId && event.outcome === 'disconnected')
              terminal.resolve();
            if (
              blocked &&
              (hold === 'all-records' || (event.kind === 'tool' && event.outcome === 'allowed'))
            )
              await acknowledgement.promise;
          },
        });
        const handle = await serveHttp(runtime);
        t.after(() => handle.close());
        const finishExchanges = async () => {
          await bounded(
            Promise.all([...exchanges.values()].map((exchange) => exchange.promise)),
            'request terminal audit',
          );
          // The sink callback precedes the dispatcher's final admission release.
          await setImmediate();
        };
        const token = await new SignJWT({ scope: 'policy:read metrics:read' })
          .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'disconnect' })
          .setSubject('disconnect-fixture')
          .setIssuer(issuer)
          .setAudience(resource)
          .setIssuedAt()
          .setExpirationTime('5m')
          .sign(keys.privateKey);
        const disconnect = new AbortController();
        let initializing = true;
        let setupQueue = Promise.resolve();
        const client = new Client(
          { name: 'disconnect-audit-test', version: '1' },
          { versionNegotiation: { mode } },
        );
        t.after(() => client.close());
        await assert.doesNotReject(
          client.connect(
            new StreamableHTTPClientTransport(new URL(handle.url), {
              requestInit: { headers: { authorization: `Bearer ${token}` } },
              fetch: (input, init) => {
                const send = async () => {
                  const response = await fetch(input, {
                    ...init,
                    signal: AbortSignal.any([
                      disconnect.signal,
                      ...(init?.signal ? [init.signal] : []),
                    ]),
                  });
                  if (initializing) await finishExchanges();
                  return response;
                };
                if (!initializing) return send();
                // Legacy setup also probes standalone SSE in the background.
                // Serialize setup through terminal ACKs in this one-slot fixture.
                const response = setupQueue.then(send);
                setupQueue = response.then(
                  () => undefined,
                  () => undefined,
                );
                return response;
              },
            }),
          ),
          'client initialization',
        );
        await finishExchanges();
        await assert.doesNotReject(client.listTools(), 'initial discovery');
        await setupQueue;
        await finishExchanges();
        initializing = false;
        const call = client
          .callTool({ name: 'policy_status', arguments: {} })
          .catch(() => undefined);
        try {
          await bounded(admitted.promise, 'tool admission');
          // Cut the HTTP exchange itself, including legacy streaming, rather than
          // relying on protocol cancellation notifications on a separate request.
          disconnect.abort();
          await bounded(cancelled.promise, 'cancellation audit');
          await setImmediate();
          assert.equal(runtime.audit.healthy, true);
          assert.equal(runtime.audit.state.failures, 0);
          assert.equal(runtime.audit.state.dropped, 0);
          assert.ok(runtime.audit.state.pending <= 3);
          assert.ok(
            !events.some(
              (event) => event.requestId === requestId && event.outcome === 'disconnected',
            ),
            'terminal audit must wait for the original audit acknowledgement',
          );
          const busy = await fetch(new URL('/metrics', handle.url), {
            headers: { authorization: `Bearer ${token}` },
          });
          assert.equal(busy.status, 503, 'disconnected work must retain its admission slot');
          assert.equal(busy.headers.get('retry-after'), '1');
          await busy.text();
        } finally {
          acknowledgement.resolve();
        }
        await bounded(terminal.promise, 'terminal audit');
        await setImmediate();
        await bounded(call, 'disconnected client');
        const response = await fetch(handle.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
            'mcp-protocol-version': '2025-11-25',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'policy_status', arguments: {} },
          }),
        });
        assert.equal(response.status, 200);
        assert.match(await response.text(), /policy_status/);
        await finishExchanges();
        assert.equal(runtime.audit.healthy, true);
        assert.deepEqual(runtime.audit.state, { pending: 0, failures: 0, dropped: 0 });
      },
    );
