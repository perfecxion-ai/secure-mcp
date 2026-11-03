import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createInterface } from 'node:readline';
import { createServer } from 'node:net';

const cli = resolve('src/cli.ts');
const canary = 'SECRET-DIAGNOSTIC-CANARY';

function invoke(args: string[]) {
  const result = spawnSync(process.execPath, ['--import', 'tsx', cli, ...args], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

test(
  'startup diagnostics identify safe fields and stages without leaking values or unknown keys',
  { timeout: 90_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'mcp-startup-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const config = join(directory, `${canary}.json`);
    const workspace = join(directory, 'workspace');
    await mkdir(workspace);
    const failure = (args: string[], message: RegExp) => {
      const result = invoke(args);
      assert.equal(result.status, 1, result.stderr);
      assert.equal(result.stdout, '');
      assert.match(result.stderr, message);
      assert.ok(!result.stderr.includes(canary));
      assert.ok(!result.stderr.includes(canary.toLowerCase().replaceAll('-', '_')));
      assert.ok(!result.stderr.includes(directory));
      assert.doesNotMatch(result.stderr, /\n\s+at /);
    };
    const cases: [unknown, RegExp][] = [
      [{ workspace, [canary]: 'secret' }, /config: contains an unknown setting/],
      [{ workspace, readOnly: canary }, /readOnly: has the wrong type/],
      [{ workspace, limits: { maxConcurrent: 0 } }, /limits.maxConcurrent: is outside/],
      [{ workspace, limits: { [canary]: true } }, /limits: contains an unknown setting/],
      [
        { workspace, allowedTools: [canary.toLowerCase().replaceAll('-', '_')] },
        /allowedTools: contains an unavailable tool/,
      ],
      [{ workspace, transport: 'http' }, /http: requires an HTTP configuration block/],
      [{ workspace, transport: canary }, /transport: must use a documented supported option/],
      [
        {
          workspace,
          http: {
            resource: canary,
            issuer: 'https://issuer.example',
            jwksUrl: 'https://issuer.example/keys',
          },
        },
        /http.resource:/,
      ],
      [
        {
          workspace,
          http: {
            resource: 'https://server.example/mcp',
            issuer: 'https://issuer.example',
            jwksUrl: 'https://issuer.example/keys',
            allowedOrigins: [canary],
          },
        },
        /http.allowedOrigins:/,
      ],
      [
        {
          workspace,
          transport: 'http',
          audit: { maxPending: 1 },
          http: {
            resource: 'https://server.example/mcp',
            issuer: 'https://issuer.example',
            jwksUrl: 'https://issuer.example/keys',
          },
        },
        /audit.maxPending: must be at least 2 for HTTP admission/,
      ],
      [[], /config: must be a JSON object/],
    ];
    for (const [value, expected] of cases) {
      await writeFile(config, JSON.stringify(value));
      failure(['--config', config, '--doctor'], expected);
    }
    await writeFile(config, `{"secret":"${canary}"`);
    failure(['--config', config], /config: invalid JSON/);
    failure(['--config', join(directory, `missing-${canary}`)], /config: does not exist/);
    failure(['--config', directory], /config: must be a readable JSON file/);
    failure(['--workspace', join(directory, canary), '--doctor'], /workspace: does not exist/);
    failure(['--workspace', config, '--doctor'], /workspace: requires a directory/);
    failure([`--${canary}`], /arguments: unknown option/);
    failure(['--config'], /arguments: unknown option, unexpected argument or missing option value/);
    failure([canary], /arguments: unknown option, unexpected argument/);
    if (process.getuid?.() !== 0) {
      await chmod(config, 0);
      failure(['--config', config, '--doctor'], /config: is not accessible/);
      await chmod(config, 0o600);
      await chmod(workspace, 0);
      failure(['--workspace', workspace, '--doctor'], /workspace: is not accessible/);
      await chmod(workspace, 0o700);
    }
    const listener = createServer();
    await new Promise<void>((ready) => listener.listen(0, '127.0.0.1', ready));
    t.after(() => new Promise<void>((closed) => listener.close(() => closed())));
    const address = listener.address();
    assert.ok(address && typeof address !== 'string');
    await writeFile(
      config,
      JSON.stringify({
        workspace,
        transport: 'http',
        http: {
          port: address.port,
          resource: 'http://127.0.0.1/mcp',
          issuer: 'https://issuer.example',
          jwksUrl: 'https://issuer.example/keys',
        },
      }),
    );
    failure(['--config', config], /http.port: listener address is already in use/);
    for (const transport of ['stdio', 'http']) {
      await writeFile(
        config,
        JSON.stringify({
          workspace,
          transport,
          audit: { maxPending: transport === 'http' ? 2 : 1 },
          ...(transport === 'http' && {
            http: {
              resource: 'https://server.example/mcp',
              issuer: 'https://issuer.example',
              jwksUrl: 'https://issuer.example/keys',
            },
          }),
        }),
      );
      const minimum = invoke(['--config', config, '--doctor']);
      assert.equal(minimum.status, 0, minimum.stderr);
      assert.equal(minimum.stderr, '');
    }
    const good = invoke(['--workspace', workspace, '--doctor']);
    assert.equal(good.status, 0, good.stderr);
    assert.equal(good.stderr, '');
    assert.equal(JSON.parse(good.stdout).transport, 'stdio');
    assert.ok(!good.stdout.includes(workspace));
  },
);

for (const shutdown of ['eof', 'SIGTERM'] as const)
  for (const auditFails of [false, true])
    test(
      `stdio ${shutdown} exits ${auditFails ? 1 : 0} after ${auditFails ? 'audit failure' : 'handled denial'}`,
      { timeout: 30_000 },
      async (t) => {
        const directory = await mkdtemp(join(tmpdir(), 'mcp-exit-audit-'));
        t.after(() => rm(directory, { recursive: true, force: true }));
        const config = join(directory, 'config.json');
        await writeFile(
          config,
          JSON.stringify({
            workspace: directory,
            ...(auditFails && {
              audit: { socketPath: join(directory, 'missing.sock'), timeoutMs: 50 },
            }),
          }),
        );
        const child = spawn(process.execPath, ['--import', 'tsx', cli, '--config', config], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        const exited = new Promise<number | null>((resolveExit) => child.once('exit', resolveExit));
        t.after(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        });
        child.stderr.resume();
        const lines = createInterface({ input: child.stdout });
        const request = (value: unknown, timeoutMs = 5000) =>
          new Promise<unknown>((resolveReply, reject) => {
            const timeout = setTimeout(() => reject(new Error('CLI reply timed out')), timeoutMs);
            lines.once('line', (line) => {
              clearTimeout(timeout);
              resolveReply(JSON.parse(line));
            });
            child.stdin.write(JSON.stringify(value) + '\n');
          });
        await request(
          {
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {
              protocolVersion: '2025-11-25',
              capabilities: {},
              clientInfo: { name: 'exit-test', version: '1' },
            },
          },
          20_000,
        );
        child.stdin.write(
          JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n',
        );
        const reply = await request({
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'documents_read',
            arguments: { path: '../outside.txt' },
          },
        });
        assert.match(JSON.stringify(reply), auditFails ? /audit_unavailable/ : /denied/);
        if (shutdown === 'eof') child.stdin.end();
        else child.kill(shutdown);
        assert.equal(await exited, auditFails ? 1 : 0);
      },
    );
