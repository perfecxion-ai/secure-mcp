import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { policy } from './npm-preflight.mjs';

export function registryInstallArguments(version, artifact) {
  assert.equal(version, policy.version, 'Registry smoke requires the exact alpha.2 version');
  assert.ok(artifact, 'Registry smoke requires the approved tarball for comparison');
  return [
    'install',
    '--save-exact',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    `${policy.package}@${version}`,
    `--registry=${policy.registry}`,
  ];
}

export async function compareInstalledPackage(archive, files, installed) {
  for (const file of files.filter((name) => name && !name.endsWith('/'))) {
    assert.ok(file.startsWith('package/'));
    const relative = file.slice('package/'.length);
    assert.ok(
      relative && !relative.split('/').some((part) => part === '..' || part === '.' || !part),
    );
    assert.ok(!relative.includes('\\') && !relative.startsWith('/'));
    const expected = execFileSync('tar', ['-xOf', archive, file], {
      maxBuffer: 16 * 1024 * 1024,
      timeout: 10_000,
    });
    assert.deepEqual(
      await readFile(join(installed, relative)),
      expected,
      `Registry-installed file differs: ${file}`,
    );
  }
  const metadata = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  assert.equal(metadata.name, policy.package);
  assert.equal(metadata.version, policy.version);
}
