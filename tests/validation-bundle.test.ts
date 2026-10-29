import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm, rename, symlink, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';

test('retained bundle verification checks signed evidence and local metadata', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-bundle-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sha = 'a'.repeat(40);
  const filename = 'perfecxion-secure-mcp-server-2.0.0-alpha.1.tgz';
  const sbom = { bomFormat: 'CycloneDX', specVersion: '1.5', components: [] };
  const metadata = { name: '@perfecxion/secure-mcp-server', version: '2.0.0-alpha.1' };
  await mkdir(join(directory, 'package'));
  await writeFile(join(directory, 'package/package.json'), JSON.stringify(metadata));
  execFileSync('tar', ['-czf', join(directory, filename), '-C', directory, 'package/package.json']);
  await writeFile(join(directory, 'sbom.cdx.json'), JSON.stringify(sbom));
  const hashes: Record<string, string> = {};
  for (const name of [filename, 'sbom.cdx.json'])
    hashes[name] = createHash('sha256')
      .update(await readFile(join(directory, name)))
      .digest('hex');
  const manifest = {
    sourceCommit: sha,
    workflowRun: 42,
    workflowUrl: 'https://github.com/perfecxion-ai/secure-mcp/actions/runs/42',
    package: metadata.name,
    version: metadata.version,
    hashes,
  };
  await writeFile(join(directory, 'validation-manifest.json'), JSON.stringify(manifest));
  await writeFile(
    join(directory, 'SHA256SUMS'),
    Object.entries(hashes)
      .map(([name, hash]) => `${hash}  ${name}`)
      .join('\n') + '\n',
  );
  const fakeGh = join(directory, 'gh-fixture.mjs');
  // This fixture tests the wrapper's policy and metadata checks, not cryptography.
  // Real GitHub signature verification is exercised against the selected artifact separately.
  await writeFile(
    fakeGh,
    `#!/usr/bin/env node
import assert from 'node:assert/strict';
const args = process.argv.slice(2);
assert.deepEqual(args.slice(0, 2), ['attestation', 'verify']);
for (const [flag, value] of Object.entries({
  '--repo': 'perfecxion-ai/secure-mcp',
  '--signer-workflow': 'perfecxion-ai/secure-mcp/.github/workflows/ci.yml',
  '--source-ref': 'refs/heads/main', '--source-digest': '${sha}', '--format': 'json',
})) {
  assert.ok(args.includes(flag));
  assert.equal(args[args.indexOf(flag) + 1], value);
}
if (process.env.GH_TEST_REJECT === '1') process.exit(1);
const type = args[args.indexOf('--predicate-type') + 1];
assert.ok(['https://slsa.dev/provenance/v1', 'https://cyclonedx.org/bom'].includes(type));
const predicate = type === 'https://cyclonedx.org/bom'
  ? ${JSON.stringify(sbom)}
  : {runDetails: {metadata: {invocationId: '${manifest.workflowUrl}/attempts/1'}}};
console.log(JSON.stringify([{verificationResult: {statement: {predicate}}}]));
`,
    { mode: 0o700 },
  );
  const verify = (expected = sha, reject = false) =>
    spawnSync(process.execPath, [resolve('scripts/verify-validation.mjs'), expected, directory], {
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        PATH: `${dirname(process.execPath)}:${process.env.PATH ?? ''}`,
        GH_BIN: fakeGh,
        GH_TEST_REJECT: reject ? '1' : '0',
      },
    });
  const replace = async (name: string, contents: string, check: () => void) => {
    const path = join(directory, name);
    const original = await readFile(path);
    try {
      await writeFile(path, contents);
      check();
    } finally {
      await writeFile(path, original);
    }
  };
  const rejected = (pattern: RegExp, expected = sha, reject = false) => {
    const result = verify(expected, reject);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, pattern);
    assert.equal(result.stdout, '');
  };
  await t.test('valid bundle is verified without cached verification reports', () => {
    const result = verify();
    assert.equal(result.status, 0, result.stderr);
    const report = JSON.parse(result.stdout) as {
      result: string;
      hashes: Record<string, string>;
      workflowRun: number;
    };
    assert.equal(report.result, 'verified');
    assert.deepEqual(report.hashes, hashes);
    assert.equal(report.workflowRun, 42);
  });
  await t.test('expected source cannot be selected by the manifest', () => {
    rejected(/separately selected commit/, 'b'.repeat(40));
  });
  await t.test('manifest cannot point outside the bundle', async () => {
    await replace(
      'validation-manifest.json',
      JSON.stringify({
        ...manifest,
        hashes: { '../outside.tgz': hashes[filename], 'sbom.cdx.json': hashes['sbom.cdx.json'] },
      }),
      () => rejected(/Invalid tarball name/),
    );
  });
  await t.test('tarball symlinks are rejected', async () => {
    const path = join(directory, filename);
    await rename(path, path + '.saved');
    try {
      await symlink(path + '.saved', path);
      rejected(/bounded regular file/);
    } finally {
      await unlink(path);
      await rename(path + '.saved', path);
    }
  });
  await t.test('substituted manifest checksums are rejected', async () => {
    await replace(
      'validation-manifest.json',
      JSON.stringify({ ...manifest, hashes: { ...hashes, [filename]: '0'.repeat(64) } }),
      () => rejected(/Manifest checksums/),
    );
  });
  await t.test('substituted package version is rejected', async () => {
    await replace(
      'validation-manifest.json',
      JSON.stringify({ ...manifest, version: '2.0.0-alpha.2' }),
      () => rejected(/AssertionError/),
    );
  });
  await t.test('workflow run must be bound by provenance', async () => {
    await replace(
      'validation-manifest.json',
      JSON.stringify({
        ...manifest,
        workflowRun: 43,
        workflowUrl: manifest.workflowUrl.replace('/42', '/43'),
      }),
      () => rejected(/Workflow run must appear/),
    );
  });
  await t.test('SBOM must equal the signed predicate', async () => {
    await replace(
      'sbom.cdx.json',
      JSON.stringify({ ...sbom, components: [{ name: 'substituted' }] }),
      () => rejected(/SBOM must match/),
    );
  });
  await t.test('checksum file must describe the verified files', async () => {
    await replace('SHA256SUMS', '0'.repeat(64) + '  substituted.tgz\n', () =>
      rejected(/Checksum file/),
    );
  });
  await t.test('saved success reports cannot override a verifier failure', async () => {
    await writeFile(
      join(directory, 'provenance-verification.json'),
      JSON.stringify([{ result: 'verified' }]),
    );
    await writeFile(
      join(directory, 'sbom-verification.json'),
      JSON.stringify([{ result: 'verified' }]),
    );
    rejected(/Command failed/, sha, true);
  });
});
