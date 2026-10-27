import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { execFileSync, spawn } from 'node:child_process';
import {
  mkdtemp,
  writeFile,
  rm,
  readdir,
  copyFile,
  readFile,
  mkdir,
  symlink,
} from 'node:fs/promises';
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
  execFileSync(
    'npm',
    ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(directory, archive)],
    {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const code = 'await import("@perfecxion/secure-mcp-server");';
  assert.equal(
    execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: directory,
      encoding: 'utf8',
      timeout: 5000,
    }),
    '',
  );
  const workspace = join(directory, 'documents');
  const outside = join(directory, 'outside');
  await mkdir(workspace);
  await mkdir(outside);
  const approved = `Approved package fixture ${randomUUID()}`;
  const canary = `Outside package fixture ${randomUUID()}`;
  await writeFile(join(workspace, 'fixture.txt'), approved);
  await writeFile(join(outside, 'private.txt'), canary);
  await writeFile(join(workspace, '.private.txt'), canary);
  await symlink(join(outside, 'private.txt'), join(workspace, 'linked-file.txt'));
  await symlink(outside, join(workspace, 'linked-directory'));
  await mkdir(join(workspace, 'directory'));
  const binary = join(directory, 'node_modules/.bin/secure-mcp');
  const protocols = [];
  for (const protocol of ['2026-07-28', '2025-11-25']) {
    const client = new Client(
      { name: 'package-smoke', version: '1.0.0' },
      { versionNegotiation: { mode: protocol === '2026-07-28' ? { pin: protocol } : 'legacy' } },
    );
    const transport = new StdioClientTransport({
      command: binary,
      args: ['--workspace', workspace],
      stderr: 'pipe',
    });
    const chunks = [];
    let auditBytes = 0;
    transport.stderr.on('data', (chunk) => {
      auditBytes += chunk.length;
      if (auditBytes <= 1024 * 1024) chunks.push(Buffer.from(chunk));
    });
    try {
      await client.connect(transport);
      assert.equal(client.getNegotiatedProtocolVersion(), protocol);
      assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), [
        'documents_read',
        'policy_status',
      ]);
      const result = await client.callTool({
        name: 'documents_read',
        arguments: { path: 'fixture.txt' },
      });
      assert.ok(!result.isError);
      assert.equal(result.content[0].text, approved);
      const policy = await client.callTool({ name: 'policy_status', arguments: {} });
      assert.ok(!policy.isError);
      assert.equal(JSON.parse(policy.content[0].text).readOnly, true);
      const denials = [
        ['traversal', '../outside/private.txt'],
        ['absolute path', join(outside, 'private.txt')],
        ['hidden file', '.private.txt'],
        ['symlink file', 'linked-file.txt'],
        ['symlink directory', 'linked-directory/private.txt'],
        ['directory', 'directory'],
      ];
      for (const [name, path] of denials) {
        const denied = await client.callTool({ name: 'documents_read', arguments: { path } });
        assert.equal(denied.isError, true, name);
        assert.ok(['denied', 'not_found'].includes(denied.content[0].text), name);
        assert.ok(!JSON.stringify(denied).includes(canary), name);
      }
      protocols.push({
        protocol,
        discovery: 'pass',
        approvedRead: 'pass',
        policy: 'pass',
        rejected: denials.map(([name]) => name),
      });
    } finally {
      await client.close();
    }
    assert.ok(auditBytes > 0 && auditBytes <= 1024 * 1024, 'Missing or excessive audit output');
    const audit = Buffer.concat(chunks).toString('utf8');
    assert.ok(audit.endsWith('\n'), 'Partial audit record');
    const events = audit
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.ok(events.some((event) => event.kind === 'tool' && event.outcome === 'success'));
    for (const sentinel of [
      directory,
      approved,
      canary,
      'fixture.txt',
      'private.txt',
      'linked-file.txt',
      'linked-directory',
    ])
      assert.ok(!audit.includes(sentinel), 'Fixture content or path in audit');
  }
  // A caller closing stdin must not leave a daemon behind.
  const child = spawn(binary, ['--workspace', workspace], { stdio: ['pipe', 'pipe', 'pipe'] });
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
      node: process.version,
      platform: process.platform,
      architecture: process.arch,
      package: archive,
      source: values.artifact ? 'provided immutable artifact' : 'local npm pack',
      sha256: createHash('sha256')
        .update(await readFile(join(directory, archive)))
        .digest('hex'),
      files: files.filter(Boolean).length,
      installation: 'pass',
      lifecycleScripts: 'disabled',
      import: 'silent',
      stdio: 'pass',
      protocols,
      auditPrivacy: 'pass',
      stdinEof: 'pass',
    }),
  );
} finally {
  await rm(resolve(directory), { recursive: true, force: true });
}
