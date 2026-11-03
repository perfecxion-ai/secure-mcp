import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { validateContext, validateInputs, policy } from './lib/npm-preflight.mjs';
import {
  validatePreflight,
  validatePublishedRegistry,
  validatePublicationReceipt,
} from './lib/npm-publication.mjs';
import {
  command,
  downloadCandidate,
  registryMetadata,
  fetchBounded,
  npmEnvironment,
  evidenceJson,
} from './lib/npm-publication-io.mjs';
import { compareProductionGraphs } from './lib/consumer-evidence.mjs';
import { validateNpmProvenance } from './lib/npm-provenance.mjs';

const [source, digest, run, preflightPath, publicationPath, destination, ...extra] =
  process.argv.slice(2);
assert.ok(destination && preflightPath && publicationPath && extra.length === 0);
validateInputs(source, digest, run);
validateContext(process.env, source, command('git', ['rev-parse', 'HEAD']).trim(), 'publish.yml');
assert.equal(
  process.versions.node,
  '24.22.1',
  'Registry verification requires pinned Node 24.22.1',
);
assert.equal(
  command('npm', ['--version']).trim(),
  '11.19.1',
  'Verified-attestation parsing requires npm 11.19.1',
);
const preflight = JSON.parse(await readFile(preflightPath, 'utf8'));
validatePreflight(preflight, source, digest, run);
const publication = JSON.parse(await readFile(publicationPath, 'utf8'));
validatePublicationReceipt(
  publication,
  source,
  digest,
  process.env.GITHUB_RUN_ID,
  process.env.GITHUB_RUN_ATTEMPT,
);
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
  const serialized = evidenceJson(result);
  await writeFile(
    join(directory, name),
    name === 'registry-inventory.json' ? serialized.replaceAll(directory, '.') : serialized,
  );
  return result;
};
const signatures = await collect('registry-signatures.json', [
  'audit',
  'signatures',
  '--json',
  '--include-attestations',
  `--registry=${policy.registry}`,
]);
const provenance = validateNpmProvenance(signatures, {
  source,
  sha512: createHash('sha512').update(archive).digest('hex'),
  runId: publication.publicationRunId,
  runAttempt: publication.publicationRunAttempt,
});
await writeFile(join(directory, 'registry-provenance-binding.json'), evidenceJson(provenance));
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
await writeFile(join(directory, 'registry-dependency-comparison.json'), evidenceJson(comparison));
assert.equal(
  comparison.result,
  'match',
  'Registry consumer graph differs from the signed SBOM; review before announcement',
);
command(
  process.execPath,
  [
    'scripts/package-smoke.mjs',
    '--artifact',
    downloaded,
    '--registry-version',
    policy.version,
    '--evidence-directory',
    join(directory, 'smoke'),
    '--sbom',
    join(directory, 'sbom.cdx.json'),
  ],
  { env },
);
validatePublishedRegistry(await registryMetadata(), preflight.registryTags);
await writeFile(
  join(directory, 'registry-verification.json'),
  evidenceJson({
    sourceCommit: source,
    sha256: digest,
    version: policy.version,
    result: 'verified',
    checks: [
      'registry bytes and all tags',
      'exact-version consumer install',
      'retained lockfile and production graph',
      'signatures and exact source/workflow/publication-run provenance',
      'dependency audit',
      'both-protocol package smoke',
    ],
  }),
);
console.log('Registry bytes, tags and fresh exact-version consumer checks passed.');
