import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { connect } from 'node:net';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { serveHttp } from '../src/http.js';
import { fixture } from './helpers.js';
import type { AuditSink } from '../src/audit.js';

async function setup(t: TestContext, audit?: AuditSink) {
  const keys = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'admission' };
  const jwks = createServer((_request, response) =>
    response.setHeader('content-type', 'application/json').end(JSON.stringify({ keys: [jwk] })),
  );
  await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    jwks.close();
    jwks.closeAllConnections();
  });
  const address = jwks.address();
  assert.ok(address && typeof address !== 'string');
  const issuer = `http://127.0.0.1:${address.port}`;
  const resource = 'http://127.0.0.1:3000/mcp';
  const { runtime, events } = await fixture(t, {
    ...(audit ? { audit } : {}),
    config: {
      transport: 'http',
      limits: { maxConcurrent: 2 },
      http: { port: 0, issuer, resource, jwksUrl: issuer + '/jwks', algorithms: ['ES256'] },
    },
  });
  const handle = await serveHttp(runtime);
  t.after(() => handle.close());
  const token = await new SignJWT({ scope: 'policy:read metrics:read' })
    .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'admission' })
    .setSubject('admission-canary')
    .setIssuer(issuer)
    .setAudience(resource)
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(keys.privateKey);
  const headers = {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    'mcp-protocol-version': '2025-11-25',
  };
  const body = JSON.stringify({
    jsonrpc: '2.0',
    id: 1,
    method: 'tools/call',
    params: { name: 'policy_status', arguments: {} },
  });
  return { runtime, events, handle, headers, body };
}

test(
  'missing credentials are rejected from headers without waiting for a body',
  { timeout: 15_000 },
  async (t) => {
    const { handle, runtime, events } = await setup(t);
    const url = new URL(handle.url);
    const status = await new Promise<number>((resolve, reject) => {
      const socket = connect(Number(url.port), '127.0.0.1');
      t.after(() => socket.destroy());
      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error('No header-time rejection'));
      });
      socket.once('error', reject);
      socket.once('data', (chunk) => {
        resolve(Number(chunk.toString().match(/^HTTP\/1\.1 (\d{3})/)?.[1]));
        socket.destroy();
      });
      socket.once('connect', () =>
        socket.write(
          'POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Type: application/json\r\nContent-Length: 5000\r\n\r\n{',
        ),
      );
    });
    assert.equal(status, 401);
    assert.equal(runtime.audit.healthy, true);
    assert.equal(events.length, 0, 'pre-auth rejection does not consume durable audit capacity');
  },
);

test(
  'request targets cannot change route or reach the adapter as absolute URLs',
  { timeout: 15_000 },
  async (t) => {
    const { handle, events, headers, body } = await setup(t);
    const raw = (path: string) =>
      new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(handle.url, { method: 'POST', path, headers }, (response) => {
          response.resume();
          response.once('end', () => resolve(response.statusCode));
        });
        request.setTimeout(5000, () => request.destroy(new Error('target response timeout')));
        request.on('error', reject);
        request.end(body);
      });
    for (const target of [
      'http://127.0.0.1:3000/mcp',
      'http://evil.example/mcp',
      '/./mcp',
      '/a/../mcp',
      '/%2e/mcp',
      '/\\mcp',
      '//other/mcp',
      '/mcp#fragment',
    ])
      assert.equal(await raw(target), 400, target);
    assert.equal(events.filter((e) => e.kind === 'tool').length, 0);
    assert.equal(await raw('/mcp?label=\\query'), 200);
    assert.ok(events.some((e) => e.kind === 'http' && e.endpoint === 'mcp'));
  },
);

test(
  'HTTP rejects JSON-RPC batches before dispatch and preserves healthy audit',
  { timeout: 15_000 },
  async (t) => {
    const { handle, runtime, events, headers, body } = await setup(t);
    for (const protocol of ['2025-11-25', '2026-07-28']) {
      for (const size of [2, 128]) {
        const response = await fetch(handle.url, {
          method: 'POST',
          headers: { ...headers, 'mcp-protocol-version': protocol },
          body: '[' + Array(size).fill(body).join(',') + ']',
        });
        assert.equal(response.status, 400);
        await response.text();
      }
    }
    assert.equal(runtime.audit.healthy, true);
    assert.equal(events.filter((e) => e.kind === 'tool').length, 0);
  },
);

test(
  'unauthenticated traffic cannot consume durable audit or tool capacity',
  { timeout: 15_000 },
  async (t) => {
    const { handle, runtime, events, headers, body } = await setup(t);
    for (let wave = 0; wave < 8; wave++) {
      const results = await Promise.all(
        Array.from({ length: 16 }, () =>
          fetch(handle.url, { method: 'POST', body: '{}' }).then(async (response) => {
            await response.text();
            return response.status;
          }),
        ),
      );
      assert.ok(results.every((status) => status === 401));
    }
    assert.equal(events.length, 0);
    assert.deepEqual(runtime.audit.state, { pending: 0, failures: 0, dropped: 0 });
    const allowed = await fetch(handle.url, { method: 'POST', headers, body });
    assert.equal(allowed.status, 200);
    await allowed.text();
    const metrics = await fetch(new URL('/metrics', handle.url), { headers });
    assert.equal(metrics.status, 200);
    assert.match(
      await metrics.text(),
      /secure_mcp_http_rejections_total\{reason="unauthorized"\} 128\n/,
    );
    assert.equal(runtime.audit.healthy, true);
  },
);

test(
  'audit failure before response headers returns 503 and remains fail closed',
  { timeout: 15_000 },
  async (t) => {
    const { handle, runtime, headers, body } = await setup(t, (event) => {
      if (event.kind === 'http' && event.outcome === 'response')
        throw new Error('private-sink-canary');
    });
    const failed = await fetch(handle.url, { method: 'POST', headers, body });
    assert.equal(failed.status, 503);
    assert.equal(await failed.text(), 'Unavailable');
    assert.equal(runtime.audit.healthy, false);
    assert.equal((await fetch(new URL('/health', handle.url))).status, 503);
    const next = await fetch(handle.url, { method: 'POST', headers, body });
    assert.equal(next.status, 503);
    assert.equal(await next.text(), 'Unavailable');
  },
);
