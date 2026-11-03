import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

for (const mode of [{ pin: '2026-07-28' }, 'legacy'] as const)
  test(
    `stdio collector failure returns a bounded safe protocol error (${typeof mode === 'string' ? mode : mode.pin})`,
    // Child startup with tsx/coverage is separate from the audit-response deadline.
    { timeout: 30_000 },
    async (t) => {
      const directory = await mkdtemp(join(tmpdir(), 'mcp-wire-audit-'));
      const socket = join(directory, 'collector.sock');
      let receivedRecords = 0;
      const collector = createServer((connection) => {
        connection.on('error', () => {});
        connection.once('data', () => {
          receivedRecords++;
          connection.destroy();
        });
      });
      await new Promise<void>((resolve) => collector.listen(socket, resolve));
      t.after(async () => {
        await new Promise<void>((resolve) => collector.close(() => resolve()));
        await rm(directory, { recursive: true, force: true });
      });
      const { writeFile } = await import('node:fs/promises');
      await writeFile(
        join(directory, 'config.json'),
        JSON.stringify({
          allowedTools: ['policy_status'],
          audit: { socketPath: socket, timeoutMs: 100 },
        }),
      );
      const client = new Client(
        { name: 'audit-wire', version: '1' },
        { versionNegotiation: { mode } },
      );
      t.after(() => client.close());
      const startup = AbortSignal.timeout(20_000);
      await client.connect(
        new StdioClientTransport({
          command: process.execPath,
          args: [
            '--import',
            'tsx',
            resolve('src/cli.ts'),
            '--config',
            join(directory, 'config.json'),
          ],
          stderr: 'ignore',
        }),
        { signal: startup },
      );
      // Modern stdio connect can complete before the child finishes loading.
      // Discovery establishes readiness without invoking the failing audit sink.
      assert.ok(
        (await client.listTools(undefined, { signal: startup })).tools.some(
          (tool) => tool.name === 'policy_status',
        ),
      );
      assert.equal(receivedRecords, 0);
      await assert.rejects(
        client.callTool(
          { name: 'policy_status', arguments: {} },
          { signal: AbortSignal.timeout(1500) },
        ),
        /audit_unavailable/,
      );
      assert.ok(receivedRecords > 0, 'the collector must receive the event before disconnecting');
    },
  );
