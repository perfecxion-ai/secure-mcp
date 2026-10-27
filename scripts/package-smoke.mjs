import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm, readdir, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, basename } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const { values } = parseArgs({ options: { artifact: { type: 'string' } } });
const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-consumer-'));
try {
  if (values.artifact)
    await copyFile(resolve(values.artifact), join(directory, basename(values.artifact)));
  else
    execFileSync('npm', ['pack', '--pack-destination', directory], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  const archive = (await readdir(directory)).find((file) => file.endsWith('.tgz'));
  assert.ok(archive);
  const files = execFileSync('tar', ['-tzf', join(directory, archive)], { encoding: 'utf8' }).split(
    '\n',
  );
  assert.ok(files.includes('package/dist/cli.js'));
  assert.ok(!files.some((file) => /legacy\/|tests\/|\.test\.|prisma|node_modules\//.test(file)));
  await writeFile(
    join(directory, 'package.json'),
    JSON.stringify({ name: 'clean-consumer', private: true, type: 'module' }),
  );
  execFileSync('npm', ['install', '--no-audit', '--no-fund', join(directory, archive)], {
    cwd: directory,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const code = 'await import("@perfecxion/secure-mcp-server");';
  assert.equal(
    execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 5000,
    }),
    '',
  );
  await writeFile(join(directory, 'fixture.txt'), 'Clean package installation works.');
  const binary = join(directory, 'node_modules/.bin/secure-mcp');
  const client = new Client(
    { name: 'package-smoke', version: '1.0.0' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  try {
    await client.connect(
      new StdioClientTransport({
        command: binary,
        args: ['--workspace', directory],
        stderr: 'pipe',
      }),
    );
    assert.equal((await client.listTools()).tools.length, 2);
    const result = await client.callTool({
      name: 'documents_read',
      arguments: { path: 'fixture.txt' },
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.content[0].text, 'Clean package installation works.');
  } finally {
    await client.close();
  }
  // A caller closing stdin must not leave a daemon behind.
  const child = spawn(binary, ['--workspace', directory], { stdio: ['pipe', 'pipe', 'pipe'] });
  child.stdin.end();
  const exit = await new Promise((resolveExit, reject) => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('CLI did not exit after stdin EOF'));
    }, 5000);
    child.once('error', reject);
    child.once('exit', (value) => {
      clearTimeout(timer);
      resolveExit(value);
    });
  });
  assert.equal(exit, 0);
  console.log(
    JSON.stringify({
      package: archive,
      source: values.artifact ? 'provided immutable artifact' : 'local npm pack',
      sha256: createHash('sha256')
        .update(await readFile(join(directory, archive)))
        .digest('hex'),
      files: files.filter(Boolean).length,
      installation: 'pass',
      import: 'silent',
      stdio: 'pass',
      stdinEof: 'pass',
    }),
  );
} finally {
  await rm(resolve(directory), { recursive: true, force: true });
}
