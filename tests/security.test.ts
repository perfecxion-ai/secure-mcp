import { test } from 'node:test';
import assert from 'node:assert/strict';
import { symlink, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import { Writable } from 'node:stream';
import { jsonAuditSink } from '../src/audit.js';
import { parseConfig } from '../src/config.js';
import { SecureRuntime } from '../src/runtime.js';
import { defineTool, textResult } from '../src/tools.js';
import { fixture, text } from './helpers.js';

test('schema rejects unknown options and unauthenticated HTTP configuration', () => {
  assert.throws(() => parseConfig({ transport: 'http' }));
  assert.throws(() => parseConfig({ unsafeMode: true }));
  assert.throws(() => parseConfig({ limits: { maxConcurrent: 0 } }));
  for (const url of [
    'http://example.com/mcp',
    'https://user:secret@example.com/mcp',
    'https://example.com/mcp?token=secret',
  ]) {
    assert.throws(() =>
      parseConfig({
        http: { resource: url, issuer: 'https://id.example', jwksUrl: 'https://id.example/keys' },
      }),
    );
  }
});

test('document read preserves text and emits safe structured evidence', async (t) => {
  const { runtime, principal, events } = await fixture(t);
  const result = await runtime.invoke(principal, 'documents_read', { path: 'note.txt' });
  assert.equal(result.isError, undefined);
  assert.equal(text(result), 'Approved document <script>unaltered</script>');
  assert.deepEqual(
    events.map((e) => e.outcome),
    ['allowed', 'success'],
  );
  assert.equal(events[0]?.requestId, events[1]?.requestId);
  const serialized = JSON.stringify(events);
  assert.ok(!serialized.includes('note.txt') && !serialized.includes('<script>'));
  assert.match(events[0]!.actor, /^[a-f0-9]{64}$/);
  assert.equal(
    text(await runtime.invoke(principal, 'documents_read', { path: 'nested/note.txt' })),
    'Nested document',
  );
});

test('traversal, hidden paths, and symlink escape cannot read outside the workspace', async (t) => {
  const { runtime, workspace, principal } = await fixture(t);
  const outside = await mkdtemp(join(tmpdir(), 'secure-mcp-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await writeFile(join(outside, 'secret.txt'), 'NEVER_DISCLOSE');
  await symlink(join(outside, 'secret.txt'), join(workspace, 'link.txt'));
  await symlink(outside, join(workspace, 'linkdir'));
  for (const path of [
    `../${basename(outside)}/secret.txt`,
    '../secret.txt',
    '/etc/passwd',
    'nested/../../secret.txt',
    '.env',
    'nested/.secret',
    'nested\\secret',
    'bad\0name',
    'link.txt',
    'linkdir/secret.txt',
    'nested',
  ]) {
    const result = await runtime.invoke(principal, 'documents_read', { path });
    assert.equal(result.isError, true, path);
    assert.ok(!text(result).includes('NEVER_DISCLOSE'));
  }
});

test('input schema denies missing fields and identity injection', async (t) => {
  const { runtime, principal } = await fixture(t);
  for (const args of [
    {},
    { path: 'note.txt', subject: 'admin' },
    { path: 1 },
    { path: 'x'.repeat(70_000) },
  ]) {
    assert.equal(text(await runtime.invoke(principal, 'documents_read', args)), 'invalid_input');
  }
});

test('tool discovery and invocation agree on scopes, allowlist, and expiry', async (t) => {
  const { runtime, principal } = await fixture(t, { config: { allowedTools: ['documents_read'] } });
  const denied = { ...principal, subject: 'bob', scopes: ['policy:read'] };
  assert.deepEqual(runtime.visibleTools(denied), []);
  assert.equal(
    text(await runtime.invoke(denied, 'documents_read', { path: 'note.txt' })),
    'denied',
  );
  assert.equal(text(await runtime.invoke(principal, 'policy_status', {})), 'denied');
  assert.equal(
    text(
      await runtime.invoke({ ...principal, expiresAt: 1 }, 'documents_read', { path: 'note.txt' }),
    ),
    'denied',
  );
  assert.equal(text(await runtime.invoke(principal, 'not_registered', {})), 'denied');
  assert.equal(runtime.visibleTools(principal).length, 1);
});

test('all scopes are required and read-only mode prevents mutation', async (t) => {
  let ran = false;
  const tool = defineTool({
    name: 'mutate',
    description: 'fixture',
    requiredScopes: ['a', 'b'],
    readOnly: false,
    inputSchema: z.strictObject({}),
    async invoke() {
      ran = true;
      return textResult('ok');
    },
  });
  const { runtime, principal } = await fixture(t, {
    tools: [tool],
    config: { allowedTools: ['mutate'], localScopes: ['a', 'b'] },
  });
  assert.deepEqual(runtime.visibleTools(principal), []);
  assert.equal(text(await runtime.invoke(principal, 'mutate', {})), 'denied');
  const writable = await SecureRuntime.create({
    tools: [tool],
    config: { allowedTools: ['mutate'], readOnly: false },
    audit: () => {},
  });
  t.after(() => writable.close());
  assert.equal(
    text(await writable.invoke({ ...principal, scopes: ['a'] }, 'mutate', {})),
    'denied',
  );
  assert.equal(ran, false);
  assert.equal(text(await writable.invoke(principal, 'mutate', {})), 'ok');
});

test('large files and binary files return bounded safe errors', async (t) => {
  const { runtime, workspace, principal } = await fixture(t, {
    config: { limits: { maxOutputBytes: 1024 } },
  });
  await writeFile(join(workspace, 'large.txt'), 'a'.repeat(2048));
  await writeFile(join(workspace, 'binary.txt'), Buffer.from([0xff, 0xfe]));
  assert.equal(
    text(await runtime.invoke(principal, 'documents_read', { path: 'large.txt' })),
    'output_too_large',
  );
  assert.equal(
    text(await runtime.invoke(principal, 'documents_read', { path: 'binary.txt' })),
    'not_found',
  );
});

test('exceptions do not disclose secrets or create arbitrary metric labels', async (t) => {
  const tool = defineTool({
    name: 'fails',
    description: 'fixture',
    requiredScopes: ['a'],
    readOnly: true,
    inputSchema: z.strictObject({}),
    async invoke() {
      throw new Error('SECRET_TOKEN /private/workspace');
    },
  });
  const { runtime, events, principal } = await fixture(t, {
    tools: [tool],
    config: { allowedTools: ['fails'], localScopes: ['a'] },
  });
  assert.equal(text(await runtime.invoke(principal, 'fails', {})), 'internal');
  await runtime.invoke(principal, 'random-attacker-label', {});
  assert.ok(!JSON.stringify(events).includes('SECRET_TOKEN'));
  assert.ok(!runtime.metrics().includes('random-attacker-label'));
  assert.ok(!runtime.metrics().includes(principal.subject));
});

test('audit failure prevents execution', async (t) => {
  let ran = false;
  const tool = defineTool({
    name: 'probe',
    description: 'fixture',
    requiredScopes: ['a'],
    readOnly: true,
    inputSchema: z.strictObject({}),
    async invoke() {
      ran = true;
      return textResult('ok');
    },
  });
  const { runtime, principal } = await fixture(t, {
    tools: [tool],
    config: { allowedTools: ['probe'], localScopes: ['a'] },
    audit: () => {
      throw new Error('disk unavailable');
    },
  });
  assert.equal(text(await runtime.invoke(principal, 'probe', {})), 'audit_unavailable');
  assert.equal(ran, false);
});

test('a failed writable audit stream denies work without an unhandled error event', async (t) => {
  const stream = new Writable({
    write(_chunk, _encoding, callback) {
      callback(new Error('closed sink'));
    },
  });
  const { runtime, principal } = await fixture(t, { audit: jsonAuditSink(stream) });
  assert.equal(
    text(await runtime.invoke(principal, 'documents_read', { path: 'note.txt' })),
    'audit_unavailable',
  );
  await delay(1);
  assert.equal(runtime.execution.running, 0);
});

test('timeout retains capacity for noncooperative work and shutdown rejects new work', async (t) => {
  let finish: (() => void) | undefined;
  const tool = defineTool({
    name: 'wait',
    description: 'fixture',
    requiredScopes: ['a'],
    readOnly: true,
    inputSchema: z.strictObject({}),
    async invoke() {
      await new Promise<void>((resolve) => {
        finish = resolve;
      });
      return textResult('done');
    },
  });
  const { runtime, principal } = await fixture(t, {
    tools: [tool],
    config: {
      allowedTools: ['wait'],
      localScopes: ['a'],
      limits: { timeoutMs: 30, maxConcurrent: 1, shutdownMs: 20 },
    },
  });
  assert.equal(text(await runtime.invoke(principal, 'wait', {})), 'timeout');
  assert.equal(runtime.execution.running, 1);
  assert.equal(text(await runtime.invoke(principal, 'wait', {})), 'busy');
  finish?.();
  await delay(1);
  assert.equal(runtime.execution.running, 0);
  assert.equal(await runtime.close(), 0);
  assert.equal(text(await runtime.invoke(principal, 'wait', {})), 'shutting_down');
});

test('caller cancellation reaches a cooperative handler', async (t) => {
  let cancelled = false;
  const tool = defineTool({
    name: 'wait',
    description: 'fixture',
    requiredScopes: ['a'],
    readOnly: true,
    inputSchema: z.strictObject({}),
    async invoke(_args, { signal }) {
      try {
        await delay(1000, undefined, { signal });
      } catch {
        cancelled = signal.aborted;
      }
      return textResult('done');
    },
  });
  const { runtime, principal } = await fixture(t, {
    tools: [tool],
    config: { allowedTools: ['wait'], localScopes: ['a'] },
  });
  const controller = new AbortController();
  const pending = runtime.invoke(principal, 'wait', {}, controller.signal);
  await delay(5);
  controller.abort();
  assert.equal(text(await pending), 'cancelled');
  await delay(1);
  assert.equal(cancelled, true);
  assert.equal(runtime.execution.running, 0);
});

test('unknown allowlist entries and tools without policy fail startup', async () => {
  await assert.rejects(
    SecureRuntime.create({ config: { allowedTools: ['missing'] } }),
    /not registered/,
  );
  const tool = defineTool({
    name: 'probe',
    description: 'fixture',
    requiredScopes: [],
    readOnly: true,
    inputSchema: z.strictObject({}),
    async invoke() {
      return textResult('ok');
    },
  });
  await assert.rejects(
    SecureRuntime.create({ tools: [tool], config: { allowedTools: ['probe'] } }),
    /explicit scopes/,
  );
});

test('collection budgets stop validation and cyclic inputs before execution', async (t) => {
  let validated = 0;
  let invoked = 0;
  const tool = defineTool({
    name: 'collect',
    description: 'bounded collection fixture',
    requiredScopes: ['collect:read'],
    readOnly: true,
    inputSchema: z.strictObject({
      values: z.array(
        z.string().superRefine(() => {
          validated++;
        }),
      ),
    }),
    async invoke({ values }) {
      invoked++;
      return textResult(String(values.length));
    },
  });
  const { runtime, principal } = await fixture(t, {
    tools: [tool],
    config: {
      allowedTools: ['collect'],
      localScopes: ['collect:read'],
      limits: { maxInputElements: 8 },
    },
  });
  assert.equal(
    text(await runtime.invoke(principal, 'collect', { values: Array(8).fill('x') })),
    'invalid_input',
  );
  assert.equal(validated, 0);
  assert.equal(invoked, 0);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.equal(text(await runtime.invoke(principal, 'collect', cyclic)), 'invalid_input');
  assert.equal(
    text(await runtime.invoke(principal, 'collect', { values: Array(7).fill('x') })),
    '7',
  );
  assert.equal(invoked, 1);
});
