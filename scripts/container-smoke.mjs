import assert from 'node:assert/strict';
import { mkdtemp, chmod, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-container-'));
const name = `secure-mcp-smoke-${process.pid}`;
try {
  await chmod(directory, 0o755);
  await writeFile(join(directory, 'fixture.txt'), 'Container confinement smoke test.', {
    mode: 0o444,
  });
  execFileSync('docker', ['build', '-t', 'secure-mcp:local-test', '.'], {
    stdio: 'inherit',
    timeout: 300_000,
  });
  const client = new Client(
    { name: 'container-smoke', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  try {
    await client.connect(
      new StdioClientTransport({
        command: 'docker',
        args: [
          'run',
          '--rm',
          '-i',
          '--name',
          name,
          '--network',
          'none',
          '--read-only',
          '--cap-drop',
          'ALL',
          '--security-opt',
          'no-new-privileges',
          '--pids-limit',
          '64',
          '--memory',
          '512m',
          '--cpus',
          '2',
          '--mount',
          `type=bind,src=${directory},dst=/workspace,readonly`,
          'secure-mcp:local-test',
          '--workspace',
          '/workspace',
        ],
        stderr: 'pipe',
      }),
    );
    const result = await client.callTool({
      name: 'documents_read',
      arguments: { path: 'fixture.txt' },
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text, 'Container confinement smoke test.');
    assert.equal(
      (await client.callTool({ name: 'documents_read', arguments: { path: '/etc/passwd' } }))
        .isError,
      true,
    );
    assert.notEqual(
      execFileSync('docker', ['exec', name, 'id', '-u'], { encoding: 'utf8' }).trim(),
      '0',
    );
    const config = JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8' }))[0];
    assert.equal(config.HostConfig.ReadonlyRootfs, true);
    assert.equal(config.HostConfig.NetworkMode, 'none');
    console.log(
      'Container client round trip, denied path, non-root user, read-only root, and disabled network verified.',
    );
  } finally {
    await client.close();
  }
} finally {
  try {
    execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
  } catch {
    /* Already removed by --rm. */
  }
  await rm(directory, { recursive: true, force: true });
}
