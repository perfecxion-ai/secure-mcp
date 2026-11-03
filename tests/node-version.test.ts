import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { assertSupportedNode, SUPPORTED_NODE_RANGE } from '../src/node-version.js';

test('runtime contract rejects older patches, other majors and prereleases', async () => {
  for (const version of ['24.22.1', '24.22.2', '24.23.0', '24.100.0']) {
    assert.doesNotThrow(() => assertSupportedNode(version));
  }
  for (const version of [
    '24.22.0',
    '24.13.0',
    '24.21.99',
    '22.99.99',
    '25.0.0',
    '26.0.0',
    '24.22.1-rc.1',
    'v24.22.1',
    '24.22',
    '',
  ]) {
    assert.throws(() => assertSupportedNode(version), {
      name: 'UnsupportedRuntimeError',
      code: 'unsupported_runtime',
    });
  }
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  assert.equal(pkg.engines.node, SUPPORTED_NODE_RANGE);
  assert.equal(lock.packages[''].engines.node, SUPPORTED_NODE_RANGE);
});

function sourceProcess(source: string) {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', '--input-type=module', '-e', source],
    { encoding: 'utf8', timeout: 10_000 },
  );
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  return result;
}

test('library imports stay silent but custom-tool startup rejects before reading options', () => {
  const result = sourceProcess(`
    import assert from 'node:assert/strict';
    Object.defineProperty(process.versions, 'node', { value: '24.22.0' });
    const { SecureRuntime, UnsupportedRuntimeError } = await import('./src/index.ts');
    await assert.rejects(
      SecureRuntime.create({ config: { allowedTools: [] }, tools: [] }),
      error => error instanceof UnsupportedRuntimeError && error.code === 'unsupported_runtime',
    );
    await assert.rejects(
      SecureRuntime.create({ get config() { throw new Error('configuration was read'); } }),
      UnsupportedRuntimeError,
    );
  `);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
});

test('CLI reports unsupported Node on stderr before configuration or argument errors', () => {
  const result = sourceProcess(`
    Object.defineProperty(process.versions, 'node', { value: '24.22.0' });
    process.argv = [process.execPath, 'secure-mcp', '--unsupported-option'];
    await import('./src/cli.ts');
  `);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /^secure-mcp: Unsupported Node\.js 24\.22\.0;/);
  assert.match(result.stderr, /requires Node\.js >=24\.22\.1 <25/);
  assert.match(result.stderr, /Select a supported Node 24 binary and restart/);
  assert.doesNotMatch(result.stderr, /startup failed|ERR_PARSE_ARGS|\n\s+at /);
});
