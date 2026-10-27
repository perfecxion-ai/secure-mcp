import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fixture, text } from './helpers.js';

for (const mode of ['modern', 'legacy'] as const)
  test(`official SDK over stdio: ${mode}`, { timeout: 15_000 }, async (t) => {
    const { workspace } = await fixture(t);
    const client = new Client(
      { name: 'secure-mcp-test', version: '1.0.0' },
      {
        versionNegotiation: { mode: mode === 'modern' ? { pin: '2026-07-28' } : 'legacy' },
      },
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: ['--import', 'tsx', resolve('src/cli.ts'), '--workspace', workspace],
      stderr: 'pipe',
    });
    t.after(() => client.close());
    await client.connect(transport);
    assert.equal(
      client.getNegotiatedProtocolVersion(),
      mode === 'modern' ? '2026-07-28' : '2025-11-25',
    );
    const listed = await client.listTools();
    assert.deepEqual(listed.tools.map((tool) => tool.name).sort(), [
      'documents_read',
      'policy_status',
    ]);
    assert.equal(
      text(await client.callTool({ name: 'documents_read', arguments: { path: 'note.txt' } })),
      'Approved document <script>unaltered</script>',
    );
    const malformed = await client.callTool({ name: 'documents_read', arguments: {} });
    assert.equal(malformed.isError, true);
    const denied = await client.callTool({
      name: 'documents_read',
      arguments: { path: '../secret.txt' },
    });
    assert.equal(denied.isError, true);
  });

test(
  'package source import is silent and does not start listeners',
  { timeout: 5000 },
  async () => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', 'await import("./src/index.ts")'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      output += String(chunk);
    });
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    assert.equal(code, 0);
    assert.equal(output, '');
  },
);

test('CLI requires an explicit document workspace', { timeout: 5000 }, async () => {
  const child = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let error = '';
  child.stderr.on('data', (chunk) => {
    error += String(chunk);
  });
  const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
  assert.equal(code, 1);
  assert.match(error, /approved workspace/);
});

test(
  'oversized stdio frame exits even while the caller keeps stdin open',
  { timeout: 5000 },
  async (t) => {
    const { workspace } = await fixture(t);
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', 'src/cli.ts', '--workspace', workspace],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    t.after(() => {
      if (child.exitCode === null) child.kill('SIGKILL');
    });
    let error = '';
    child.stderr.on('data', (chunk) => {
      error += String(chunk);
    });
    child.stdin.on('error', () => {});
    child.stdin.write('x'.repeat(70_000));
    const code = await new Promise<number | null>((resolve) => child.once('exit', resolve));
    assert.equal(code, 1);
    assert.match(error, /protocol_error/);
  },
);
