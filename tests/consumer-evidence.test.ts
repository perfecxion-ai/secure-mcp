import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

test('consumer SBOM comparison detects inventory, integrity and dependency changes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'consumer-sbom-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const component = (ref: string, name: string, version = '1.0.0') => ({
    'bom-ref': ref,
    purl: `pkg:npm/${name}@${version}`,
    version,
    hashes: [{ alg: 'SHA-512', content: 'abcd' }],
  });
  const build = {
    bomFormat: 'CycloneDX',
    metadata: { component: component('root', 'candidate') },
    components: [component('a', 'a'), component('b', 'b')],
    dependencies: [
      { ref: 'root', dependsOn: ['a'] },
      { ref: 'a', dependsOn: ['b'] },
      { ref: 'b', dependsOn: [] },
    ],
  };
  const consumer = {
    bomFormat: 'CycloneDX',
    metadata: { component: component('wrapper', 'consumer') },
    components: [
      component('candidate-install', 'candidate'),
      component('a-install', 'a'),
      component('b-install', 'b'),
    ],
    dependencies: [
      { ref: 'wrapper', dependsOn: ['candidate-install'] },
      { ref: 'candidate-install', dependsOn: ['a-install'] },
      { ref: 'a-install', dependsOn: ['b-install'] },
      { ref: 'b-install', dependsOn: [] },
    ],
  };
  await writeFile(join(directory, 'build.json'), JSON.stringify(build));
  let sequence = 0;
  const compare = async (value: typeof consumer) => {
    const path = join(directory, `consumer-${sequence}.json`);
    const output = join(directory, `comparison-${sequence++}.json`);
    await writeFile(path, JSON.stringify(value));
    const result = spawnSync(
      process.execPath,
      [resolve('scripts/compare-consumer-sbom.mjs'), join(directory, 'build.json'), path, output],
      { encoding: 'utf8', timeout: 5000 },
    );
    return {
      ...result,
      report: result.stderr ? undefined : JSON.parse(await readFile(output, 'utf8')),
    };
  };
  await t.test('normalizes wrapper and installation references', async () => {
    const result = await compare(consumer);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.report.result, 'match');
  });
  await t.test('collapses equivalent duplicate installations', async () => {
    const value = structuredClone(consumer);
    value.components.push(component('a-duplicate', 'a'));
    value.dependencies.push({ ref: 'a-duplicate', dependsOn: ['b-install'] });
    value.dependencies[1]!.dependsOn.push('a-duplicate');
    const result = await compare(value);
    assert.equal(result.status, 0, result.stderr);
  });
  await t.test('records a transitive version difference', async () => {
    const value = structuredClone(consumer);
    value.components[2] = component('b-install', 'b', '1.0.1');
    const result = await compare(value);
    assert.equal(result.status, 1);
    assert.equal(result.report.added[0].version, '1.0.1');
    assert.equal(result.report.removed[0].version, '1.0.0');
  });
  await t.test('records changed integrity without a version change', async () => {
    const value = structuredClone(consumer);
    value.components[1]!.hashes[0]!.content = 'ffff';
    const result = await compare(value);
    assert.equal(result.status, 1);
    assert.equal(result.report.changed[0].purl, 'pkg:npm/a@1.0.0');
  });
  await t.test('records changed edges despite identical package inventory', async () => {
    const value = structuredClone(consumer);
    value.dependencies[2]!.dependsOn = [];
    assert.equal((await compare(value)).status, 1);
  });
  await t.test('rejects unresolved graph references', async () => {
    const value = structuredClone(consumer);
    value.dependencies[1]!.dependsOn.push('missing');
    const result = await compare(value);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Unknown dependency target/);
  });
  await t.test('rejects conflicting duplicate integrity', async () => {
    const value = structuredClone(consumer);
    const duplicate = component('a-duplicate', 'a');
    duplicate.hashes[0]!.content = 'ffff';
    value.components.push(duplicate);
    value.dependencies.push({ ref: 'a-duplicate', dependsOn: ['b-install'] });
    const result = await compare(value);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Conflicting duplicate integrity/);
  });
});
