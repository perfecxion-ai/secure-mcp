import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import type { Transport } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { AuditedMcpServer, currentAuditRequest } from '../src/audit.js';
import type { AuditEvent } from '../src/audit.js';
import { RuntimeFailure } from '../src/errors.js';
import { SecureRuntime } from '../src/runtime.js';
import { defineTool, textResult } from '../src/tools.js';

type Reply = {
  id: string;
  result?: { isError?: boolean; content?: unknown };
  error?: { code: number; message: string };
};

function stdio(t: TestContext, runtime: SecureRuntime, mode: 'modern' | 'legacy') {
  const input = new PassThrough();
  const output = new PassThrough();
  const transport = new StdioServerTransport(input, output);
  const replies = new Map<string, (reply: Reply) => void>();
  const contexts = new Map<string, string | undefined>();
  // Observe context at the real wire boundary without adding client IDs to audit.
  const send = transport.send.bind(transport);
  transport.send = (message) => {
    if ('id' in message && typeof message.id === 'string')
      contexts.set(message.id, currentAuditRequest()?.requestId);
    return send(message);
  };
  let buffer = '';
  output.on('data', (chunk: Buffer) => {
    buffer += chunk.toString();
    for (let end; (end = buffer.indexOf('\n')) !== -1;) {
      const reply = JSON.parse(buffer.slice(0, end)) as Reply;
      buffer = buffer.slice(end + 1);
      const resolve = replies.get(reply.id);
      assert.ok(resolve, 'Each response must match a pending wire request');
      replies.delete(reply.id);
      resolve(reply);
    }
  });
  const handle = serveStdio(() => runtime.createServer(runtime.localPrincipal()), { transport });
  t.after(async () => {
    await handle.close();
    await runtime.close();
    input.destroy();
    output.destroy();
  });
  const request = (id: string, method: string, params: Record<string, unknown> = {}) => {
    const response = new Promise<Reply>((resolve) => replies.set(id, resolve));
    input.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params:
          mode === 'modern'
            ? {
                ...params,
                _meta: {
                  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
                  'io.modelcontextprotocol/clientCapabilities': {},
                },
              }
            : params,
      }) + '\n',
    );
    return response;
  };
  return {
    request,
    contexts,
    async ready() {
      if (mode === 'legacy') {
        const initialized = await request('private-initialize-id', 'initialize', {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'audit-correlation', version: '1' },
        });
        assert.ok(initialized.result);
        input.write('{"jsonrpc":"2.0","method":"notifications/initialized"}\n');
      }
      assert.ok((await request('private-discovery-id', 'tools/list')).result);
    },
  };
}

for (const mode of ['modern', 'legacy'] as const) {
  test(
    `stdio audit correlates concurrent decisions and early SDK rejections (${mode})`,
    { timeout: 10_000 },
    async (t) => {
      const events: AuditEvent[] = [];
      let release!: () => void;
      const bothStarted = new Promise<void>((resolve) => {
        release = resolve;
      });
      let entered = 0;
      const tools = ['denied_tool', 'successful_tool', 'error_tool'].map((name) =>
        defineTool({
          name,
          description: 'Audit correlation test tool',
          requiredScopes: ['test:run'],
          readOnly: true,
          inputSchema: z.strictObject({}),
          async invoke() {
            if (name !== 'error_tool') {
              if (++entered === 2) release();
              await bothStarted;
            }
            if (name === 'denied_tool') throw new RuntimeFailure('denied');
            return { ...textResult('private-result-canary'), isError: name === 'error_tool' };
          },
        }),
      );
      const runtime = await SecureRuntime.create({
        config: {
          allowedTools: tools.map((tool) => tool.name),
          localScopes: ['test:run'],
          limits: { maxInputElements: 8 },
        },
        tools,
        audit: (event) => {
          events.push(event);
        },
      });
      const session = stdio(t, runtime, mode);
      await session.ready();
      const ids = ['private-client-denied/secret', 'private-client-success\nsecret'];
      const denial = session.request(ids[0]!, 'tools/call', { name: 'denied_tool', arguments: {} });
      const success = session.request(ids[1]!, 'tools/call', {
        name: 'successful_tool',
        arguments: {},
      });
      const [denied, completed] = await Promise.all([denial, success]);
      assert.equal(entered, 2, 'Both handlers must overlap before either completes');
      assert.equal(denied.result?.isError, true);
      assert.equal(completed.result?.isError, false);
      assert.equal(
        (
          await session.request('private-client-tool-error', 'tools/call', {
            name: 'error_tool',
            arguments: {},
          })
        ).result?.isError,
        true,
      );
      assert.equal(
        (
          await session.request('private-client-sdk-limit', 'tools/call', {
            name: 'successful_tool',
            arguments: { collection: Array(9).fill('private-input-canary') },
          })
        ).result?.isError,
        true,
      );
      assert.equal(
        (
          await session.request('private-client-sdk-params', 'tools/call', {
            name: 42,
            arguments: {},
          })
        ).error?.code,
        -32602,
      );
      assert.equal(entered, 2, 'SDK validation must reject before calling a handler');

      const expected = [
        [ids[0]!, ['allowed', 'denied']],
        [ids[1]!, ['allowed', 'success']],
        ['private-client-tool-error', ['allowed', 'tool_error']],
        ['private-client-sdk-limit', ['tool_rejected']],
        ['private-client-sdk-params', ['invalid_params']],
      ] as const;
      const seen = new Set<string>();
      for (const [clientId, outcomes] of expected) {
        const generatedId = session.contexts.get(clientId);
        assert.match(generatedId ?? '', /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
        assert.ok(!seen.has(generatedId!));
        seen.add(generatedId!);
        assert.deepEqual(
          events.filter((event) => event.requestId === generatedId).map((event) => event.outcome),
          outcomes,
        );
      }
      assert.equal(
        events.length,
        8,
        'Tool errors already have a terminal outcome, not a second rejection',
      );
      assert.equal(
        events.filter((event) => event.kind === 'tool' && event.outcome !== 'allowed').length,
        3,
      );
      assert.equal(events.filter((event) => event.kind === 'protocol').length, 2);
      assert.match(runtime.metrics(), /secure_mcp_calls_total\{outcome="denied"\} 1/);
      assert.match(runtime.metrics(), /secure_mcp_calls_total\{outcome="success"\} 1/);
      assert.match(runtime.metrics(), /secure_mcp_calls_total\{outcome="tool_error"\} 1/);
      assert.doesNotMatch(JSON.stringify(events), /private-client|private-result|private-input/);
      assert.equal(runtime.audit.healthy, true);
    },
  );

  test(
    `stdio terminal audit failure keeps a bounded generic error (${mode})`,
    { timeout: 10_000 },
    async (t) => {
      const events: AuditEvent[] = [];
      const runtime = await SecureRuntime.create({
        config: {
          allowedTools: ['denied_tool'],
          localScopes: ['test:run'],
          audit: { timeoutMs: 25 },
        },
        tools: [
          defineTool({
            name: 'denied_tool',
            description: 'Terminal audit failure test',
            requiredScopes: ['test:run'],
            readOnly: true,
            inputSchema: z.strictObject({}),
            async invoke() {
              throw new RuntimeFailure('denied');
            },
          }),
        ],
        audit: (event) => {
          events.push(event);
          if (event.outcome !== 'allowed') return new Promise<void>(() => {});
        },
      });
      const session = stdio(t, runtime, mode);
      await session.ready();
      const start = performance.now();
      const response = await session.request('private-client-audit-failure', 'tools/call', {
        name: 'denied_tool',
        arguments: {},
      });
      assert.deepEqual(response.error, { code: -32603, message: 'audit_unavailable' });
      assert.ok(
        performance.now() - start < 1000,
        'A stuck terminal sink must not hang the response',
      );
      assert.equal(response.result, undefined);
      assert.equal(runtime.audit.healthy, false);
      assert.deepEqual(runtime.audit.state, { pending: 1, failures: 1, dropped: 1 });
      assert.equal(new Set(events.map((event) => event.requestId)).size, 1);
      assert.doesNotMatch(JSON.stringify(events), /private-client/);
    },
  );
}

test('audit request context covers messages buffered before transport start', async () => {
  const server = new AuditedMcpServer({ name: 'buffered-audit', version: '1' });
  let observed: string | undefined;
  let replied!: () => void;
  const reply = new Promise<void>((resolve) => {
    replied = resolve;
  });
  const transport: Transport = {
    async start() {
      this.onmessage?.({ jsonrpc: '2.0', id: 'private-buffered-id', method: 'unknown' });
    },
    async close() {},
    async send() {
      replied();
    },
  };
  server.observeProtocolError = async () => {
    observed = currentAuditRequest()?.requestId;
  };
  await server.connect(transport);
  await reply;
  assert.match(observed ?? '', /^[0-9a-f-]{36}$/);
  assert.equal(currentAuditRequest(), undefined, 'Request context must not leak into the caller');
  await server.close();
});
