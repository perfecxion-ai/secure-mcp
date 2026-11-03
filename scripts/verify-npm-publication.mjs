import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateContext, validateInputs, policy } from './lib/npm-preflight.mjs';
import { validatePreflight, validatePublishedRegistry } from './lib/npm-publication.mjs';
import {
  command,
  downloadCandidate,
  registryMetadata,
  fetchBounded,
  npmEnvironment,
} from './lib/npm-publication-io.mjs';
import { compareProductionGraphs } from './lib/consumer-evidence.mjs';

const [source, digest, run, preflightPath, destination, ...extra] = process.argv.slice(2);
assert.ok(destination && preflightPath && extra.length === 0);
validateInputs(source, digest, run);
validateContext(process.env, source, command('git', ['rev-parse', 'HEAD']).trim(), 'publish.yml');
const preflight = JSON.parse(await readFile(preflightPath, 'utf8'));
validatePreflight(preflight, source, digest, run);
const directory = resolve(destination);
await downloadCandidate(source, digest, run, directory);
const published = validatePublishedRegistry(await registryMetadata(), preflight.registryTags);
const archive = await fetchBounded(published.dist.tarball, 256 * 1024 * 1024);
assert.equal(
  createHash('sha256').update(archive).digest('hex'),
  digest,
  'Registry bytes differ from approved artifact',
);
const downloaded = join(directory, 'registry.tgz');
await writeFile(downloaded, archive, { flag: 'wx' });
const consumer = join(directory, 'consumer');
await mkdir(consumer, { mode: 0o700 });
const env = await npmEnvironment(join(directory, 'npm-config'));
await writeFile(
  join(consumer, 'package.json'),
  JSON.stringify({ name: 'secure-mcp-registry-validation', version: '1.0.0', private: true }),
);
command(
  'npm',
  [
    'install',
    '--save-exact',
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    `${policy.package}@${policy.version}`,
    `--registry=${policy.registry}`,
  ],
  { cwd: consumer, env },
);
const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
assert.equal(lock.packages[''].dependencies[policy.package], policy.version);
assert.equal(lock.packages[`node_modules/${policy.package}`].version, policy.version);
const collect = async (name, args) => {
  const result = JSON.parse(command('npm', args, { cwd: consumer, env }));
  await writeFile(join(directory, name), JSON.stringify(result, null, 2) + '\n');
  return result;
};
await collect('registry-signatures.json', [
  'audit',
  'signatures',
  '--json',
  `--registry=${policy.registry}`,
]);
await collect('registry-audit.json', [
  'audit',
  '--omit=dev',
  '--audit-level=high',
  '--json',
  `--registry=${policy.registry}`,
]);
await collect('registry-inventory.json', ['ls', '--omit=dev', '--all', '--json']);
const sbom = await collect('registry-consumer-sbom.json', ['sbom', '--sbom-format=cyclonedx']);
const comparison = compareProductionGraphs(
  JSON.parse(await readFile(join(directory, 'sbom.cdx.json'), 'utf8')),
  sbom,
);
await writeFile(
  join(directory, 'registry-dependency-comparison.json'),
  JSON.stringify(comparison, null, 2) + '\n',
);
assert.equal(
  comparison.result,
  'match',
  'Registry consumer graph differs from the signed SBOM; review before announcement',
);
command(process.execPath, [
  'scripts/package-smoke.mjs',
  '--artifact',
  downloaded,
  '--registry-version',
  policy.version,
  '--evidence-directory',
  join(directory, 'smoke'),
  '--sbom',
  join(directory, 'sbom.cdx.json'),
]);
validatePublishedRegistry(await registryMetadata(), preflight.registryTags);
await writeFile(
  join(directory, 'registry-verification.json'),
  JSON.stringify(
    {
      sourceCommit: source,
      sha256: digest,
      version: policy.version,
      result: 'verified',
      checks: [
        'registry bytes and all tags',
        'exact-version consumer install',
        'retained lockfile and production graph',
        'signatures and provenance',
        'dependency audit',
        'both-protocol package smoke',
      ],
    },
    null,
    2,
  ) + '\n',
);
console.log('Registry bytes, tags and fresh exact-version consumer checks passed.');
