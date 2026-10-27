import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { z } from 'zod';
import { schemaRuntime } from './fixtures/schema-tools.js';
import { fixture, text } from './helpers.js';
import { serveHttp } from '../src/http.js';
import { defineTool, textResult } from '../src/tools.js';

async function assertions(
  call: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>,
) {
  assert.deepEqual(JSON.parse(text(await call('transform_fixture', { n: '3' }))), {
    sum: 5,
    label: 'fixture',
    transforms: 1,
  });
  assert.deepEqual(
    JSON.parse(text(await call('transform_fixture', { n: '7', offset: '4', label: 'custom' }))),
    {
      sum: 11,
      label: 'custom',
      transforms: 2,
    },
  );
  for (const args of [{ n: 3 }, { n: 'bad' }, { n: '3', unexpected: true }])
    assert.equal(text(await call('transform_fixture', args)), 'invalid_input');
  const thrown = await call('throw_fixture', { value: 'x' });
  assert.equal(thrown.isError, true);
  assert.equal(text(thrown), 'invalid_input');
  assert.ok(!JSON.stringify(thrown).includes('VALIDATOR_SECRET'));
}

test('direct calls validate asynchronous transforms, defaults, and coercion once', async (t) => {
  const runtime = await schemaRuntime();
  t.after(() => runtime.close());
  await assertions((name, args) => runtime.invoke(runtime.localPrincipal(), name, args));
});

for (const mode of ['modern', 'legacy'] as const) {
  test(`stdio schema ownership: ${mode}`, { timeout: 15000 }, async (t) => {
    const client = new Client(
      { name: 'schema-fixture', version: '1' },
      {
        versionNegotiation: { mode: mode === 'modern' ? { pin: '2026-07-28' } : 'legacy' },
      },
    );
    t.after(() => client.close());
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ['--import', 'tsx', resolve('tests/fixtures/schema-stdio.ts')],
        stderr: 'pipe',
      }),
    );
    const schema = (await client.listTools()).tools.find(
      (tool) => tool.name === 'transform_fixture',
    )?.inputSchema;
    assert.equal((schema?.properties?.n as { type: string }).type, 'string');
    await assertions(
      async (name, args) => (await client.callTool({ name, arguments: args })) as CallToolResult,
    );
  });

  test(`HTTP schema ownership: ${mode}`, { timeout: 15000 }, async (t) => {
    const keys = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'schema' };
    const issuerServer = createServer((_req, res) =>
      res
        .writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ keys: [jwk] })),
    );
    await new Promise<void>((resolve) => issuerServer.listen(0, '127.0.0.1', resolve));
    t.after(
      () =>
        new Promise<void>((resolve) => {
          issuerServer.close(() => resolve());
          issuerServer.closeAllConnections();
        }),
    );
    const address = issuerServer.address();
    assert.ok(address && typeof address !== 'string');
    const issuer = `http://127.0.0.1:${address.port}`;
    const resource = 'http://127.0.0.1:3000/mcp';
    const runtime = await schemaRuntime({
      transport: 'http',
      http: { port: 0, resource, issuer, jwksUrl: issuer, algorithms: ['ES256'] },
    });
    const endpoint = await serveHttp(runtime);
    t.after(() => endpoint.close());
    const token = await new SignJWT({ scope: 'fixture:read' })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'schema' })
      .setIssuer(issuer)
      .setAudience(resource)
      .setSubject('fixture')
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey);
    const client = new Client(
      { name: 'schema-fixture', version: '1' },
      { versionNegotiation: { mode: mode === 'modern' ? { pin: '2026-07-28' } : 'legacy' } },
    );
    t.after(() => client.close());
    await client.connect(
      new StreamableHTTPClientTransport(new URL(endpoint.url), {
        requestInit: { headers: { authorization: `Bearer ${token}` } },
      }),
    );
    await assertions(
      async (name, args) => (await client.callTool({ name, arguments: args })) as CallToolResult,
    );
  });
}

test('asynchronous validation holds capacity until settled and cannot execute after timeout', async (t) => {
  let enter: () => void = () => {};
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let finish: () => void = () => {};
  const finished = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  const { runtime, principal } = await fixture(t, {
    config: {
      allowedTools: ['slow_schema'],
      localScopes: ['fixture:read'],
      limits: { maxConcurrent: 1, timeoutMs: 30 },
    },
    tools: [
      defineTool({
        name: 'slow_schema',
        description: 'Stalled validation fixture',
        requiredScopes: ['fixture:read'],
        readOnly: true,
        inputSchema: z.strictObject({
          value: z.string().superRefine(async () => {
            enter();
            await finished;
          }),
        }),
        async invoke() {
          calls++;
          return textResult('should not run');
        },
      }),
    ],
  });
  const first = runtime.invoke(principal, 'slow_schema', { value: 'x' });
  await entered;
  assert.equal(text(await first), 'timeout');
  assert.equal(text(await runtime.invoke(principal, 'slow_schema', { value: 'x' })), 'busy');
  assert.equal(runtime.execution.running, 1);
  finish();
  for (let i = 0; i < 50 && runtime.execution.running; i++) await delay(2);
  assert.equal(runtime.execution.running, 0);
  assert.equal(calls, 0);
});
