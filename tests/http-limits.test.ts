import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { z } from 'zod';
import { serveHttp } from '../src/http.js';
import { defineTool, textResult } from '../src/tools.js';
import { fixture, text } from './helpers.js';

test(
  'HTTP cancellation, deadlines, capacity, and shutdown reach the handler',
  { timeout: 15_000 },
  async (t) => {
    const keys = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'lab-key' };
    const jwks = createServer((_req, res) =>
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ keys: [jwk] })),
    );
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
    let cancelled = 0;
    let enter: () => void = () => {};
    const entered = () =>
      new Promise<void>((resolve) => {
        enter = resolve;
      });
    const tool = defineTool({
      name: 'wait',
      description: 'cooperative lab handler',
      readOnly: true,
      requiredScopes: ['wait:read'],
      inputSchema: z.strictObject({}),
      async invoke(_args, { signal }) {
        enter();
        try {
          await delay(60_000, undefined, { signal });
        } finally {
          if (signal.aborted) cancelled++;
        }
        return textResult('done');
      },
    });
    let collectionValidations = 0;
    let collectionCalls = 0;
    const collection = defineTool({
      name: 'collect',
      description: 'collection budget fixture',
      requiredScopes: ['wait:read'],
      readOnly: true,
      inputSchema: z.strictObject({
        values: z.array(
          z.string().superRefine(() => {
            collectionValidations++;
          }),
        ),
      }),
      async invoke({ values }) {
        collectionCalls++;
        return textResult(String(values.length));
      },
    });
    const { runtime } = await fixture(t, {
      tools: [tool, collection],
      config: {
        transport: 'http',
        allowedTools: ['wait', 'collect'],
        limits: { maxConcurrent: 1, timeoutMs: 200, maxInputElements: 8 },
        http: { port: 0, resource, issuer, jwksUrl: issuer + '/jwks', algorithms: ['ES256'] },
      },
    });
    const handle = await serveHttp(runtime);
    t.after(() => handle.close());
    const token = await new SignJWT({ scope: 'wait:read' })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'lab-key' })
      .setSubject('lab-user')
      .setIssuer(issuer)
      .setAudience(resource)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey);
    const client = new Client(
      { name: 'limit-test', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    t.after(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(handle.url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );

    const rejected = await client.callTool({
      name: 'collect',
      arguments: { values: Array(8).fill('x') },
    });
    assert.equal(rejected.isError, true);
    assert.equal(collectionValidations, 0);
    assert.equal(collectionCalls, 0);
    assert.equal(
      text(await client.callTool({ name: 'collect', arguments: { values: Array(7).fill('x') } })),
      '7',
    );
    assert.equal(collectionCalls, 1);

    const controller = new AbortController();
    let ready = entered();
    const first = client.callTool({ name: 'wait', arguments: {} }, { signal: controller.signal });
    const firstRejected = assert.rejects(first);
    await ready;
    assert.equal(text(await client.callTool({ name: 'wait', arguments: {} })), 'busy');
    controller.abort();
    await firstRejected;
    for (let i = 0; i < 50 && runtime.execution.running; i++) await delay(5);
    assert.equal(cancelled, 1);
    assert.equal(runtime.execution.running, 0);

    assert.equal(text(await client.callTool({ name: 'wait', arguments: {} })), 'timeout');
    for (let i = 0; i < 50 && runtime.execution.running; i++) await delay(5);
    assert.equal(runtime.execution.running, 0);
    ready = entered();
    const last = client.callTool({ name: 'wait', arguments: {} }).catch(() => undefined);
    await ready;
    assert.equal(await handle.close(), 0);
    await last;
    assert.equal(handle.server.listening, false);
    assert.equal(cancelled, 3);
  },
);
