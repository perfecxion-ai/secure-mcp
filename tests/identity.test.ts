import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { parseConfig } from '../src/config.js';
import { createTokenVerifier } from '../src/identity.js';

test('JWKS rotation, cache expiry, and issuer outages preserve the trust boundary', async (t) => {
  // Advance only wall time. Network I/O and its timeout keep their real clocks.
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  const keys = await Promise.all([generateKeyPair('ES256'), generateKeyPair('ES256')]);
  const first = keys[0]!;
  const second = keys[1]!;
  const publicKeys = await Promise.all(
    keys.map(async (key, index) => ({
      ...(await exportJWK(key.publicKey)),
      kid: `key-${index}`,
      alg: 'ES256',
      use: 'sig',
    })),
  );
  let published = [publicKeys[0]!];
  let unavailable = false;
  let requests = 0;
  const server = createServer((_request, response) => {
    requests++;
    response.writeHead(unavailable ? 503 : 200, { 'content-type': 'application/json' });
    response.end(JSON.stringify(unavailable ? { error: 'unavailable' } : { keys: published }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const issuer = `http://127.0.0.1:${address.port}`;
  const resource = 'https://mcp.example/mcp';
  const config = parseConfig({
    transport: 'http',
    http: { issuer, resource, jwksUrl: issuer + '/jwks', algorithms: ['ES256'] },
  }).http!;
  const verify = createTokenVerifier(config);
  const now = Math.floor(Date.now() / 1000);
  const sign = (key: typeof first, kid: string) =>
    new SignJWT({
      sub: 'rotation-fixture',
      iss: issuer,
      aud: resource,
      iat: now,
      exp: now + 900,
      scope: 'policy:read',
    })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid })
      .sign(key.privateKey);
  const oldToken = await sign(first, 'key-0');
  const newToken = await sign(second, 'key-1');
  assert.equal((await verify(oldToken)).subject, 'rotation-fixture');
  assert.equal(requests, 1);

  // Switching signing keys without prepublication can deny callers during cooldown.
  published = publicKeys;
  await assert.rejects(verify(newToken));
  assert.equal(requests, 1);
  t.mock.timers.tick(31_000);
  assert.equal((await verify(newToken)).subject, 'rotation-fixture');
  assert.equal(requests, 2);

  // Removing a key at the issuer does not invalidate a still-cached signing key.
  published = [publicKeys[1]!];
  assert.equal((await verify(oldToken)).subject, 'rotation-fixture');
  assert.equal(requests, 2);
  t.mock.timers.tick(301_000);
  await assert.rejects(verify(oldToken));
  assert.equal(requests, 3);
  assert.equal((await verify(newToken)).subject, 'rotation-fixture');

  // Cached keys can bridge an outage. A cold or stale cache must fail closed.
  unavailable = true;
  assert.equal((await verify(newToken)).subject, 'rotation-fixture');
  await assert.rejects(createTokenVerifier(config)(newToken));
  t.mock.timers.tick(301_000);
  await assert.rejects(verify(newToken));
  unavailable = false;
  assert.equal((await verify(newToken)).subject, 'rotation-fixture');
});

test('token key-location headers cannot override the configured JWKS endpoint', async (t) => {
  const trusted = await generateKeyPair('ES256');
  const attacker = await generateKeyPair('ES256');
  const trustedJwk = { ...(await exportJWK(trusted.publicKey)), kid: 'trusted', alg: 'ES256' };
  let attackerRequests = 0;
  const server = createServer((request, response) => {
    if (request.url !== '/jwks') attackerRequests++;
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify({ keys: [trustedJwk] }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const issuer = `http://127.0.0.1:${address.port}`;
  const resource = 'https://mcp.example/mcp';
  const config = parseConfig({
    transport: 'http',
    http: { issuer, resource, jwksUrl: issuer + '/jwks', algorithms: ['ES256'] },
  }).http!;
  const now = Math.floor(Date.now() / 1000);
  const token = await new SignJWT({
    sub: 'attacker',
    iss: issuer,
    aud: resource,
    iat: now,
    exp: now + 300,
    scope: 'policy:read',
  })
    .setProtectedHeader({
      alg: 'ES256',
      typ: 'at+jwt',
      kid: 'trusted',
      jku: issuer + '/attacker-jwks',
      jwk: await exportJWK(attacker.publicKey),
      x5u: issuer + '/attacker-certificate',
    })
    .sign(attacker.privateKey);
  await assert.rejects(createTokenVerifier(config)(token));
  assert.equal(attackerRequests, 0);
});
