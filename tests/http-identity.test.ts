import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { exportJWK, exportSPKI, generateKeyPair, SignJWT } from 'jose';
import type { JWTPayload } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { serveHttp } from '../src/http.js';
import { fixture } from './helpers.js';

test(
  'default RS256 HTTP identity boundary rejects forged and defective tokens',
  { timeout: 30_000 },
  async (t) => {
    const [trusted, attacker, ec] = await Promise.all([
      generateKeyPair('RS256'),
      generateKeyPair('RS256'),
      generateKeyPair('ES256'),
    ]);
    const keys = [
      { ...(await exportJWK(trusted.publicKey)), alg: 'RS256', kid: 'trusted' },
      // Publishing this key must not enable an algorithm absent from configuration.
      { ...(await exportJWK(ec.publicKey)), alg: 'ES256', kid: 'ec' },
    ];
    const jwks = createServer((_request, response) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ keys }));
    });
    await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
    t.after(
      () =>
        new Promise<void>((resolve) => {
          jwks.close(() => resolve());
          jwks.closeAllConnections();
        }),
    );
    const address = jwks.address();
    assert.ok(address && typeof address !== 'string');
    const issuer = `http://127.0.0.1:${address.port}`;
    const resource = 'http://127.0.0.1:3000/mcp';
    const { runtime, events } = await fixture(t, {
      config: { transport: 'http', http: { port: 0, issuer, resource, jwksUrl: issuer + '/jwks' } },
    });
    assert.deepEqual(runtime.config.http!.algorithms, ['RS256']);
    const handle = await serveHttp(runtime);
    t.after(() => handle.close());
    const now = Math.floor(Date.now() / 1000);
    const claims: JWTPayload = {
      sub: 'identity-canary',
      iss: issuer,
      aud: resource,
      iat: now,
      exp: now + 300,
      scope: 'policy:read metrics:read',
    };
    const sign = (payload: JWTPayload = claims, typ: string | undefined = 'at+jwt') =>
      new SignJWT(payload)
        .setProtectedHeader({ alg: 'RS256', kid: 'trusted', ...(typ ? { typ } : {}) })
        .sign(trusted.privateKey);
    const without = (claim: string) => {
      const payload = { ...claims };
      delete payload[claim];
      return payload;
    };
    const good = await sign();
    const client = new Client(
      { name: 'rs256-identity-test', version: '1' },
      {
        versionNegotiation: { mode: { pin: '2026-07-28' } },
      },
    );
    t.after(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(handle.url), {
        requestInit: { headers: { authorization: `Bearer ${good}` } },
      }),
    );
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name),
      ['policy_status'],
    );
    assert.ok(!(await client.callTool({ name: 'policy_status', arguments: {} })).isError);
    await assert.rejects(
      client.callTool({ name: 'documents_read', arguments: { path: 'note.txt' } }),
      (error: unknown) =>
        typeof error === 'object' && error !== null && 'code' in error && error.code === -32602,
    );

    const pem = await exportSPKI(trusted.publicKey);
    const der = Buffer.from(pem.replace(/-----[^-]+-----|\s/g, ''), 'base64');
    const invalid: [string, string][] = [
      ['wrong issuer', await sign({ ...claims, iss: 'https://untrusted.example' })],
      ['wrong audience', await sign({ ...claims, aud: 'https://other.example/mcp' })],
      ['wrong token type', await sign(claims, 'JWT')],
      ['missing token type', await sign(claims, '')],
      [
        'wrong signing key',
        await new SignJWT(claims)
          .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: 'trusted' })
          .sign(attacker.privateKey),
      ],
      [
        'published but disallowed ES256',
        await new SignJWT(claims)
          .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'ec' })
          .sign(ec.privateKey),
      ],
      [
        'HS256 with public PEM as secret',
        await new SignJWT(claims)
          .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'trusted' })
          .sign(Buffer.from(pem)),
      ],
      [
        'HS256 with public DER as secret',
        await new SignJWT(claims)
          .setProtectedHeader({ alg: 'HS256', typ: 'at+jwt', kid: 'trusted' })
          .sign(der),
      ],
      ['expired', await sign({ ...claims, exp: now - 1 })],
      ['future issuance', await sign({ ...claims, iat: now + 60 })],
      ['excessive lifetime', await sign({ ...claims, exp: now + 901 })],
      ['illegal scope characters', await sign({ ...claims, scope: 'policy:read\nmetrics:read' })],
      ['oversized subject', await sign({ ...claims, sub: 's'.repeat(257) })],
      ['empty subject', await sign({ ...claims, sub: '' })],
      ['non-string scope', await sign({ ...claims, scope: ['policy:read'] })],
    ];
    for (const claim of ['sub', 'iat', 'exp', 'scope'])
      invalid.push([`missing ${claim}`, await sign(without(claim))]);
    for (const [name, token] of invalid) {
      await t.test(name, async () => {
        const before = events.length;
        const response = await fetch(handle.url, {
          method: 'POST',
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: 'policy_status', arguments: {} },
          }),
        });
        assert.equal(response.status, 401);
        assert.equal(await response.text(), 'Unauthorized');
        assert.match(response.headers.get('www-authenticate')!, /resource_metadata=/);
        const rejection = events
          .slice(before)
          .findLast(
            (event) =>
              event.kind === 'http' && event.outcome === 'response' && event.status === 401,
          );
        assert.ok(rejection);
        assert.equal(rejection.actor, 'anonymous');
        assert.ok(
          !events.some((event) => event.requestId === rejection.requestId && event.kind === 'tool'),
        );
      });
    }
    const metrics = new URL('/metrics', handle.url);
    const atSubjectLimit = await sign({ ...claims, sub: 's'.repeat(256) });
    const accepted = await fetch(metrics, {
      headers: { authorization: `Bearer ${atSubjectLimit}` },
    });
    assert.equal(accepted.status, 200);
    await accepted.text();
    const wrongMethod = await fetch(metrics, {
      method: 'POST',
      headers: { authorization: `Bearer ${good}` },
    });
    assert.equal(wrongMethod.status, 405);
    assert.equal(wrongMethod.headers.get('allow'), 'GET');
    await wrongMethod.text();
    const serialized = JSON.stringify(events);
    assert.ok(!serialized.includes('identity-canary'));
    for (const token of [good, atSubjectLimit, ...invalid.map(([, value]) => value)])
      assert.ok(!serialized.includes(token));
  },
);
