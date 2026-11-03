import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { github, verifyArtifact, verifyWorkflowRun } from './lib/validation-artifact.mjs';
import {
  policy,
  validateInputs,
  validateContext,
  validateCiRun,
  validateVerifiedArtifact,
  validateRegistry,
  dryRunArguments,
} from './lib/npm-preflight.mjs';

const [source, digest, runId, destination, mode, ...extra] = process.argv.slice(2);
assert.ok(
  destination && extra.length === 0 && (mode === undefined || mode === '--publisher-preflight'),
  'Usage: node scripts/npm-preflight.mjs SOURCE_SHA TARBALL_SHA256 CI_RUN NEW_DIRECTORY',
);
validateInputs(source, digest, runId);
const command = (binary, args, options = {}) =>
  execFileSync(binary, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
validateContext(
  process.env,
  source,
  command('git', ['rev-parse', 'HEAD']).trim(),
  mode ? 'publish.yml' : policy.workflow,
);
assert.equal(process.versions.node, '24.22.1', 'Preflight requires the pinned Node 24.22.1');
const npmVersion = command('npm', ['--version']).trim();
assert.equal(npmVersion, '11.19.1', 'Preflight requires the tested npm 11.19.1 toolchain');
const verificationHelp = github('attestation', 'verify', '--help');
for (const flag of ['--source-ref', '--source-digest', '--predicate-type', '--signer-workflow']) {
  assert.ok(
    verificationHelp.includes(flag),
    `Update GitHub CLI: attestation verify must support ${flag} before preflight can proceed`,
  );
}
const api = (path) =>
  JSON.parse(github('api', '--hostname', 'github.com', `repos/${policy.repository}/${path}`));
assert.equal(api('commits/v2.0.0-alpha.2').sha, source, 'Release tag source mismatch');
validateCiRun(api(`actions/runs/${runId}`), source, runId);
const comparison = api(`compare/${source}...main`);
assert.ok(['ahead', 'identical'].includes(comparison.status), 'Source must remain on main');
const artifactName = `verified-alpha-${source}`;
const matches = api(`actions/runs/${runId}/artifacts`).artifacts.filter(
  (artifact) => artifact.name === artifactName && !artifact.expired,
);
assert.equal(matches.length, 1, 'One unexpired verified artifact required');

const directory = resolve(destination);
await mkdir(directory, { mode: 0o700 });
github(
  'run',
  'download',
  runId,
  '--repo',
  policy.repository,
  '--name',
  artifactName,
  '--dir',
  directory,
);
const files = await readdir(directory);
// Additional consumer evidence may accompany the two attested subjects.
assert.ok(files.includes(policy.filename) && files.includes('sbom.cdx.json'));
assert.deepEqual(
  files.filter((file) => file.endsWith('.tgz')),
  [policy.filename],
);
const verified = await verifyArtifact(directory, source, policy.filename);
validateVerifiedArtifact(verified, digest);
const ciUrl = verifyWorkflowRun(verified.provenance, Number(runId));

const registryResponse = await fetch(`${policy.registry}@perfecxion%2fsecure-mcp-server`, {
  redirect: 'error',
  signal: AbortSignal.timeout(20_000),
  headers: { accept: 'application/json' },
});
assert.equal(registryResponse.status, 200, 'Successful registry metadata response required');
const chunks = [];
let size = 0;
for await (const chunk of registryResponse.body) {
  size += chunk.byteLength;
  assert.ok(size <= 16 * 1024 * 1024, 'Registry metadata exceeds the response limit');
  chunks.push(chunk);
}
const tags = validateRegistry(
  registryResponse.status,
  JSON.parse(Buffer.concat(chunks).toString('utf8')),
);

// Run npm outside the checkout with empty config files and no publishing credentials.
// This command is deliberately incapable of publishing: --dry-run is unconditional.
const npmDirectory = join(directory, 'dry-run');
await mkdir(npmDirectory, { mode: 0o700 });
const userConfig = join(npmDirectory, 'user.npmrc');
const globalConfig = join(npmDirectory, 'global.npmrc');
await writeFile(userConfig, '', { mode: 0o600 });
await writeFile(globalConfig, '', { mode: 0o600 });
const npmEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/^npm_config_/i.test(key) && !/^(NODE_AUTH_TOKEN|NPM_TOKEN|NPM_AUTH_TOKEN)$/.test(key),
  ),
);
npmEnv.NPM_CONFIG_USERCONFIG = userConfig;
npmEnv.NPM_CONFIG_GLOBALCONFIG = globalConfig;
const tarball = join(directory, policy.filename);
const dryRun = JSON.parse(
  command('npm', dryRunArguments(tarball), { cwd: npmDirectory, env: npmEnv }),
);
const hashAfterDryRun = createHash('sha256')
  .update(await readFile(tarball))
  .digest('hex');
assert.equal(hashAfterDryRun, digest, 'Artifact changed during dry-run');
const report = {
  status: 'preflight-passed',
  publication: 'held; no registry write performed',
  publishingAuthorization: 'not tested by dry-run',
  sourceCommit: source,
  workflowRef: process.env.GITHUB_WORKFLOW_REF,
  workflowSha: process.env.GITHUB_WORKFLOW_SHA,
  package: policy.package,
  version: policy.version,
  registry: policy.registry,
  tag: policy.tag,
  workflowRun: Number(runId),
  workflowUrl: ciUrl,
  artifactId: matches[0].id,
  hashes: verified.hashes,
  registryTags: tags,
  targetVersionAbsent: true,
  node: process.version,
  npm: npmVersion,
  githubCli: github('--version').split('\n')[0],
  checks: [
    'successful main CI',
    'fresh provenance and signed SBOM',
    'approved digest and metadata',
    'registry absence and tag snapshot',
    'npm dry-run of unchanged tarball',
  ],
};
for (const [filename, contents] of Object.entries({
  'npm-preflight.json': report,
  'npm-dry-run.json': dryRun,
  'provenance-verification.json': verified.provenance,
  'sbom-verification.json': verified.sbomVerification,
})) {
  // Preserve signed JSON strings without literal Unicode dash characters in the saved JSON.
  const json = JSON.stringify(contents, null, 2).replace(
    /[\u2013\u2014]/g,
    (value) => `\\u${value.charCodeAt(0).toString(16)}`,
  );
  await writeFile(join(directory, filename), json + '\n');
}
console.log(JSON.stringify(report, null, 2));
