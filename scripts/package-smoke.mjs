import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import { execFileSync, spawnSync, spawn } from 'node:child_process';
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
import { compareProductionGraphs } from './lib/consumer-evidence.mjs';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const { values } = parseArgs({
  options: {
    artifact: { type: 'string' },
    'evidence-directory': { type: 'string' },
    sbom: { type: 'string' },
  },
});
const evidence = values['evidence-directory'] && resolve(values['evidence-directory']);
if (values.sbom) assert.ok(evidence, '--sbom requires --evidence-directory');
if (evidence) await mkdir(evidence, { mode: 0o700 }); // Never overwrite an earlier receipt.
const save = async (name, value) => {
  if (evidence)
    await writeFile(
      join(evidence, name),
      JSON.stringify(value, null, 2).replaceAll(directory, '.') + '\n',
      {
        flag: 'wx',
        mode: 0o600,
      },
    );
};
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
    JSON.stringify({ name: 'clean-consumer', version: '1.0.0', private: true, type: 'module' }),
  );
  execFileSync(
    'npm',
    ['install', '--save-exact', '--ignore-scripts', '--no-audit', '--no-fund', `./${archive}`],
    {
      cwd: directory,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let dependencyEvidence;
  if (evidence) {
    for (const name of ['package.json', 'package-lock.json'])
      await save(name, JSON.parse(await readFile(join(directory, name), 'utf8')));
    const runJson = async (name, args) => {
      const result = spawnSync('npm', args, {
        cwd: directory,
        encoding: 'utf8',
        timeout: 120_000,
        maxBuffer: 16 * 1024 * 1024,
      });
      // Store structured npm output only, not stderr containing host paths.
      const output = JSON.parse(result.stdout || '{}');
      await save(name, {
        command: ['npm', ...args],
        exitCode: result.status,
        signal: result.signal,
        output,
      });
      assert.equal(result.status, 0, `npm check failed: ${args.join(' ')}`);
      assert.ok(!output.error, `npm returned an error: ${args.join(' ')}`);
      return output;
    };
    await runJson('production-inventory.json', ['ls', '--omit=dev', '--all', '--json']);
    await runJson('dependency-audit.json', ['audit', '--omit=dev', '--audit-level=high', '--json']);
    const signatures = await runJson('dependency-signatures.json', [
      'audit',
      'signatures',
      '--json',
    ]);
    const consumerSbom = await runJson('consumer-sbom-command.json', [
      'sbom',
      '--sbom-format=cyclonedx',
    ]);
    await save('consumer-sbom.cdx.json', consumerSbom);
    let comparison;
    if (values.sbom) {
      const buildSbom = JSON.parse(await readFile(resolve(values.sbom), 'utf8'));
      await save('build-sbom.cdx.json', buildSbom);
      comparison = compareProductionGraphs(buildSbom, consumerSbom);
      await save('dependency-comparison.json', comparison);
    }
    dependencyEvidence = {
      signatures: signatures.error ? 'failed' : 'pass',
      candidateSignature: 'Local tarball root is not a registry signature/provenance check',
      graph: comparison?.result ?? 'not compared',
      lockfile: 'package-lock.json',
    };
  }
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
  const exitsAfterEof = async (command, args) => {
    const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdout.resume();
    child.stderr.resume();
    child.stdin.end();
    return new Promise((resolveExit, reject) => {
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Server did not exit after stdin EOF'));
      }, 5000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', (value) => {
        clearTimeout(timer);
        resolveExit(value);
      });
    });
  };
  assert.equal(await exitsAfterEof(binary, ['--workspace', workspace]), 0);
  let triage;
  if (files.includes('package/examples/triage/verify.mjs')) {
    const example = join(directory, 'node_modules/@perfecxion/secure-mcp-server/examples/triage');
    const result = JSON.parse(
      execFileSync(process.execPath, [join(example, 'verify.mjs')], {
        cwd: directory,
        encoding: 'utf8',
        timeout: 10_000,
        maxBuffer: 1024 * 1024,
      }),
    );
    assert.equal(result.resourceDenial, 'pass');
    assert.equal(result.auditFailure, 'fail closed');
    assert.equal(result.restart, 'pass');
    assert.equal(result.auditPrivacy, 'pass');
    assert.equal(await exitsAfterEof(process.execPath, [join(example, 'server.mjs')]), 0);
    // Inject a real handler which ignores cancellation and keeps a process handle.
    // The installed server's shutdown path must still force a nonzero exit.
    const preload = join(directory, 'stubborn-handler.mjs');
    await writeFile(
      preload,
      `
import { SecureRuntime, defineTool } from '@perfecxion/secure-mcp-server';
import { z } from 'zod';
const original = SecureRuntime.create;
SecureRuntime.create = async () => {
  let started;
  const running = new Promise(resolve => { started = resolve; });
  const runtime = await original.call(SecureRuntime, {
    config: { allowedTools: ['stubborn'], localScopes: ['test:read'], limits: { shutdownMs: 20 } },
    audit: () => {},
    tools: [defineTool({ name: 'stubborn', description: 'Test fixture',
      requiredScopes: ['test:read'], readOnly: true, inputSchema: z.strictObject({}),
      async invoke() { setInterval(() => {}, 1000); started(); return new Promise(() => {}); }
    })]
  });
  void runtime.invoke(runtime.localPrincipal(), 'stubborn', {});
  await running;
  await import('node:fs/promises').then(fs => fs.writeFile(new URL('./handler-started', import.meta.url), 'yes'));
  return runtime;
};
`,
    );
    assert.equal(
      await exitsAfterEof(process.execPath, ['--import', preload, join(example, 'server.mjs')]),
      1,
    );
    assert.equal(await readFile(join(directory, 'handler-started'), 'utf8'), 'yes');
    triage = { workflow: 'pass', stdinEof: 'pass', uncooperativeHandlerExit: 1 };
  }
  const report = {
    result: dependencyEvidence?.graph === 'different' ? 'failed_dependency_comparison' : 'pass',
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
    ...(triage && { triage }),
    ...(dependencyEvidence && { dependencyEvidence }),
    npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
  };
  await save('package-smoke.json', report);
  console.log(JSON.stringify(report));
  assert.notEqual(
    dependencyEvidence?.graph,
    'different',
    'Consumer production graph differs from build SBOM; inspect retained comparison',
  );
} finally {
  await rm(resolve(directory), { recursive: true, force: true });
}
