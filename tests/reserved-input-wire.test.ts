import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { createServer } from 'node:http';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';
import { defineTool, textResult } from '../src/tools.js';
import { serveHttp } from '../src/http.js';
import { fixture } from './helpers.js';
import type { AuditEvent } from '../src/audit.js';

type Mode = 'modern' | 'legacy';
type Reply = {
  id: number;
  result?: { isError?: boolean };
  error?: { code: number; message: string };
};
const metadata = {
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
  'io.modelcontextprotocol/clientCapabilities': {},
};
const malicious = [
  '{"value":"approved","__proto__":{"reservedKeyCanary":true}}',
  String.raw`{"value":"approved","\u005f\u005fproto\u005f\u005f":{"reservedKeyCanary":true}}`,
  '{"__proto__":{"value":"approved"}}',
  '{"value":"approved","nested":{"__proto__":{"reservedKeyCanary":true}}}',
  '{"value":"approved","constructor":{"prototype":{"reservedKeyCanary":true}}}',
  '{"value":"approved","prototype":{"reservedKeyCanary":true}}',
];

function call(mode: Mode, id: number, args: string) {
  const meta = mode === 'modern' ? `,"_meta":${JSON.stringify(metadata)}` : '';
  return `{"jsonrpc":"2.0","id":${id},"method":"tools/call","params":{"name":"inspect","arguments":${args}${meta}}}`;
}

async function inspectFixture(t: TestContext, config: Record<string, unknown> = {}) {
  const invoked = { calls: 0, failProtocolAudit: false };
  const events: AuditEvent[] = [];
  const tool = defineTool({
    name: 'inspect',
    description: 'wire input consistency fixture',
    requiredScopes: ['inspect:read'],
    readOnly: true,
    inputSchema: z.strictObject({
      value: z.string(),
      nested: z.record(z.string(), z.unknown()).optional(),
    }),
    async invoke() {
      invoked.calls++;
      return textResult('approved');
    },
  });
  return {
    ...(await fixture(t, {
      config: { allowedTools: ['inspect'], localScopes: ['inspect:read'], ...config },
      tools: [tool],
      audit: (event) => {
        events.push(event);
        if (invoked.failProtocolAudit && event.kind === 'protocol')
          throw new Error('reservedKeyCanary audit failure');
      },
    })),
    invoked,
    events,
  };
}

async function checkRequests(
  mode: Mode,
  invoked: { calls: number },
  request: (raw: string, id: number) => Promise<Reply>,
) {
  const positive = await request(call(mode, 1, '{"value":"approved"}'), 1);
  assert.ok(positive.result, JSON.stringify(positive));
  assert.equal(invoked.calls, 1);
  for (const [index, args] of malicious.entries()) {
    const reply = await request(call(mode, index + 2, args), index + 2);
    assert.ok(reply.error?.code === -32602 || reply.result?.isError === true, args);
    assert.equal(invoked.calls, 1, 'rejected input must not reach a handler');
    assert.ok(!Object.hasOwn(Object.prototype, 'reservedKeyCanary'));
  }
  assert.ok((await request(call(mode, 10, '{"value":"approved"}'), 10)).result);
  assert.equal(invoked.calls, 2, 'valid calls must still work after rejected input');
}

for (const mode of ['modern', 'legacy'] as const) {
  test(`raw stdio rejects reserved argument keys without rewriting input (${mode})`, async (t) => {
    const { runtime, invoked, events } = await inspectFixture(t);
    const input = new PassThrough();
    const output = new PassThrough();
    const transport = new StdioServerTransport(input, output);
    const pending = new Map<number, (reply: Reply) => void>();
    let buffer = '';
    output.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      for (let end; (end = buffer.indexOf('\n')) !== -1;) {
        const reply = JSON.parse(buffer.slice(0, end)) as Reply;
        buffer = buffer.slice(end + 1);
        const resolve = pending.get(reply.id);
        assert.ok(resolve);
        pending.delete(reply.id);
        resolve(reply);
      }
    });
    const handle = serveStdio(() => runtime.createServer(runtime.localPrincipal()), { transport });
    t.after(async () => {
      await handle.close();
      input.destroy();
      output.destroy();
    });
    const request = (raw: string, id: number) =>
      new Promise<Reply>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Raw stdio response timed out')), 2000);
        pending.set(id, (reply) => {
          clearTimeout(timer);
          resolve(reply);
        });
        input.write(raw + '\n');
      });
    if (mode === 'legacy') {
      assert.ok(
        (
          await request(
            '{"jsonrpc":"2.0","id":0,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"reserved-input","version":"1"}}}',
            0,
          )
        ).result,
      );
      input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
    }
    await checkRequests(mode, invoked, request);
    assert.ok(
      events.some((event) => event.kind === 'protocol' && event.outcome === 'invalid_params'),
    );
    assert.ok(!JSON.stringify(events).includes('reservedKeyCanary'));
    assert.equal(runtime.audit.healthy, true);
    invoked.failProtocolAudit = true;
    const failedAudit = await request(call(mode, 11, malicious[0]!), 11);
    assert.deepEqual(failedAudit.error, { code: -32603, message: 'audit_unavailable' });
    assert.equal(invoked.calls, 2);
    assert.equal(runtime.audit.healthy, false);
  });

  test(`raw HTTP rejects reserved argument keys without rewriting input (${mode})`, async (t) => {
    const keys = await generateKeyPair('ES256');
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: 'reserved-input' };
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
    const resource = 'http://127.0.0.1/mcp';
    const { runtime, invoked, events } = await inspectFixture(t, {
      transport: 'http',
      http: { port: 0, issuer, resource, jwksUrl: issuer + '/jwks', algorithms: ['ES256'] },
    });
    const handle = await serveHttp(runtime);
    t.after(() => handle.close());
    const token = await new SignJWT({ scope: 'inspect:read' })
      .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'reserved-input' })
      .setSubject('reserved-input-fixture')
      .setIssuer(issuer)
      .setAudience(resource)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(keys.privateKey);
    const request = async (raw: string): Promise<Reply> => {
      const response = await fetch(handle.url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          'mcp-protocol-version': mode === 'modern' ? '2026-07-28' : '2025-11-25',
          ...(mode === 'modern' && { 'mcp-method': 'tools/call', 'mcp-name': 'inspect' }),
        },
        body: raw,
        signal: AbortSignal.timeout(2000),
      });
      assert.ok([200, 400].includes(response.status));
      const rawReply = await response.text();
      const data = rawReply.split('\n').find((line) => line.startsWith('data: '));
      return JSON.parse(data ? data.slice(6) : rawReply) as Reply;
    };
    await checkRequests(mode, invoked, request);
    assert.ok(
      events.some((event) => event.kind === 'protocol' && event.outcome === 'invalid_params'),
    );
    assert.ok(!JSON.stringify(events).includes('reservedKeyCanary'));
    assert.equal(runtime.audit.healthy, true);
  });
}
