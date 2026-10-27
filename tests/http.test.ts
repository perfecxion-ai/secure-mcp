import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { serveHttp } from '../src/http.js';
import { fixture, text } from './helpers.js';

test('HTTP resource server and official SDK integration', { timeout: 30_000 }, async (t) => {
  const keys = await generateKeyPair('ES256');
  const jwk = {
    ...(await exportJWK(keys.publicKey)),
    kid: 'fixture-key',
    alg: 'ES256',
    use: 'sig',
  };
  const keyServer = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [jwk] }));
  });
  await new Promise<void>((resolve) => keyServer.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        keyServer.close(() => resolve());
        keyServer.closeAllConnections();
      }),
  );
  const keyAddress = keyServer.address();
  assert.ok(keyAddress && typeof keyAddress !== 'string');
  const issuer = `http://127.0.0.1:${keyAddress.port}`;
  const resource = 'http://127.0.0.1:3000/mcp';
  const { runtime, events } = await fixture(t, {
    config: {
      transport: 'http',
      http: {
        port: 0,
        resource,
        issuer,
        jwksUrl: issuer + '/jwks',
        algorithms: ['ES256'],
        allowedOrigins: ['https://trusted.example'],
      },
    },
  });
  const handle = await serveHttp(runtime);
  t.after(() => handle.close());
  const base = new URL(handle.url).origin;
  const now = Math.floor(Date.now() / 1000);
  const token = (overrides: JWTPayload = {}, header: Record<string, string> = {}) =>
    new SignJWT({
      sub: 'alice',
      iss: issuer,
      aud: resource,
      iat: now,
      exp: now + 300,
      scope: 'documents:read policy:read',
      ...overrides,
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: jwk.kid, ...header })
      .sign(keys.privateKey);
  const good = await token();

  await t.test(
    'metadata and authentication challenge use configured canonical resource',
    async () => {
      const response = await fetch(handle.url, { method: 'POST' });
      assert.equal(response.status, 401);
      assert.match(response.headers.get('www-authenticate')!, /oauth-protected-resource\/mcp/);
      const metadata = (await fetch(base + '/.well-known/oauth-protected-resource/mcp').then((r) =>
        r.json(),
      )) as { resource: string; authorization_servers: string[] };
      assert.equal(metadata.resource, resource);
      assert.deepEqual(metadata.authorization_servers, [issuer]);
      assert.equal((await fetch(base + '/health')).status, 200);
    },
  );

  for (const mode of ['modern', 'legacy'] as const)
    await t.test(`SDK round trip with ${mode} protocol`, async (sub) => {
      const client = new Client(
        { name: 'independent-http-client', version: '1.0.0' },
        { versionNegotiation: { mode: mode === 'modern' ? { pin: '2026-07-28' } : 'legacy' } },
      );
      sub.after(() => client.close());
      await client.connect(
        new StreamableHTTPClientTransport(new URL(handle.url), {
          requestInit: { headers: { authorization: `Bearer ${good}` } },
        }),
      );
      assert.equal(
        client.getNegotiatedProtocolVersion(),
        mode === 'modern' ? '2026-07-28' : '2025-11-25',
      );
      assert.equal((await client.listTools()).tools.length, 2);
      assert.equal(
        text(await client.callTool({ name: 'documents_read', arguments: { path: 'note.txt' } })),
        'Approved document <script>unaltered</script>',
      );
      assert.equal(
        (await client.callTool({ name: 'documents_read', arguments: { path: '../secret' } }))
          .isError,
        true,
      );
    });

  await t.test(
    'principal isolation: token scopes control both listing and direct calls',
    async (sub) => {
      const bob = await token({ sub: 'bob', scope: 'policy:read' });
      const client = new Client(
        { name: 'bob-client', version: '1.0.0' },
        { versionNegotiation: { mode: { pin: '2026-07-28' } } },
      );
      sub.after(() => client.close());
      await client.connect(
        new StreamableHTTPClientTransport(new URL(handle.url), {
          requestInit: { headers: { authorization: `Bearer ${bob}` } },
        }),
      );
      assert.deepEqual(
        (await client.listTools()).tools.map((t) => t.name),
        ['policy_status'],
      );
      await assert.rejects(
        client.callTool({ name: 'documents_read', arguments: { path: 'note.txt' } }),
      );
      assert.equal(
        (await client.callTool({ name: 'policy_status', arguments: {} })).isError,
        undefined,
      );
    },
  );

  await t.test(
    'reject wrong issuer, audience, expiry, token type, future issuance and excessive lifetime',
    async () => {
      const invalid = [
        await token({ iss: 'https://attacker.example' }),
        await token({ aud: 'https://another.example/mcp' }),
        await token({ exp: now - 1 }),
        await token({ iat: now + 60 }),
        await token({ exp: now + 3600 }),
        await token({}, { typ: 'JWT' }),
        await token({ sub: '' }),
        await token({ scope: 'bad\nscope' }),
        good.slice(0, -8) + 'AAAAAAAA',
      ];
      for (const value of invalid) {
        const response = await fetch(handle.url, {
          method: 'POST',
          headers: { authorization: `Bearer ${value}` },
        });
        assert.equal(response.status, 401);
        assert.equal(await response.text(), 'Unauthorized');
      }
    },
  );

  await t.test(
    'DNS rebinding and cross-origin requests are rejected before authentication',
    async () => {
      // Fetch rewrites Host. Use a real HTTP request so the hostile header reaches the server.
      const hostStatus = await new Promise<number | undefined>((resolve, reject) => {
        const request = httpRequest(
          handle.url,
          { method: 'POST', headers: { host: 'attacker.example' } },
          (response) => {
            response.resume();
            resolve(response.statusCode);
          },
        );
        request.on('error', reject);
        request.end();
      });
      assert.equal(hostStatus, 403);
      for (const headers of [
        { origin: 'https://evil.example' },
        { origin: 'null' },
        { origin: 'https://trusted.example:444' },
      ]) {
        assert.equal((await fetch(handle.url, { method: 'POST', headers })).status, 403);
      }
      const response = await fetch(handle.url, {
        method: 'OPTIONS',
        headers: { origin: 'https://trusted.example' },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), 'https://trusted.example');
    },
  );

  await t.test('malformed and oversized bodies fail safely', async () => {
    const headers = {
      authorization: `Bearer ${good}`,
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
    };
    assert.equal((await fetch(handle.url, { method: 'POST', headers, body: '{' })).status, 400);
    assert.equal(
      (await fetch(handle.url, { method: 'POST', headers, body: 'x'.repeat(70_000) })).status,
      413,
    );
  });

  await t.test(
    'request ID zero and identical requests from separate calls remain valid',
    async () => {
      const headers = {
        authorization: `Bearer ${good}`,
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };
      const body = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'tools/list', params: {} });
      for (let attempt = 0; attempt < 2; attempt++) {
        const response = await fetch(handle.url, { method: 'POST', headers, body });
        assert.equal(response.status, 200);
        const raw = await response.text();
        const data = raw.startsWith('event:')
          ? raw
              .split('\n')
              .find((line) => line.startsWith('data:'))
              ?.slice(5)
          : raw;
        assert.ok(data);
        const rpc = JSON.parse(data) as {
          id: number;
          result?: { tools: unknown[] };
          error?: unknown;
        };
        assert.equal(rpc.id, 0);
        assert.equal(rpc.error, undefined);
        assert.equal(rpc.result?.tools.length, 2);
      }
    },
  );

  await t.test('metrics require a verified token with metrics scope', async () => {
    assert.equal((await fetch(base + '/metrics')).status, 401);
    assert.equal(
      (await fetch(base + '/metrics', { headers: { authorization: `Bearer ${good}` } })).status,
      403,
    );
    const response = await fetch(base + '/metrics', {
      headers: { authorization: `Bearer ${await token({ scope: 'metrics:read' })}` },
    });
    assert.equal(response.status, 200);
    const metrics = await response.text();
    assert.match(metrics, /secure_mcp_calls_total/);
    assert.ok(!metrics.includes('alice'));
    assert.ok(!JSON.stringify(events).includes(good));
  });
});
