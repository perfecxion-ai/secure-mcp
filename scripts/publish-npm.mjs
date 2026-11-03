import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { validateInputs, validateContext, validateRegistry, policy } from './lib/npm-preflight.mjs';
import {
  validateApproval,
  validatePreflight,
  publicationArguments,
} from './lib/npm-publication.mjs';
import {
  command,
  api,
  verifySettings,
  downloadCandidate,
  registryMetadata,
  npmEnvironment,
  evidenceJson,
} from './lib/npm-publication-io.mjs';

const [source, digest, run, preflightPath, destination, ...extra] = process.argv.slice(2);
assert.ok(destination && preflightPath && extra.length === 0);
validateInputs(source, digest, run);
validateContext(
  process.env,
  source,
  command('git', ['rev-parse', 'HEAD']).trim(),
  'publish.yml',
  true,
);
assert.equal(process.versions.node, '24.22.1');
assert.equal(command('npm', ['--version']).trim(), '11.19.1');
const { settings, environment } = await verifySettings(source, digest);
assert.match(process.env.GITHUB_RUN_ID ?? '', /^[1-9][0-9]*$/);
assert.match(process.env.GITHUB_RUN_ATTEMPT ?? '', /^[1-9][0-9]*$/);
validateApproval(
  api(`actions/runs/${process.env.GITHUB_RUN_ID}/approvals`),
  settings,
  environment.id,
  process.env.GITHUB_ACTOR_ID,
);
const preflight = JSON.parse(await readFile(preflightPath, 'utf8'));
validatePreflight(preflight, source, digest, run);
const directory = resolve(destination);
await downloadCandidate(source, digest, run, directory);
const tags = validateRegistry(200, await registryMetadata());
assert.deepEqual(
  tags,
  preflight.registryTags,
  'Registry tags changed after preflight; stop for review',
);
const npmCwd = join(directory, 'npm');
const npmEnv = await npmEnvironment(npmCwd);
const tarball = join(directory, policy.filename);
assert.equal(
  createHash('sha256')
    .update(await readFile(tarball))
    .digest('hex'),
  digest,
);
// No install, build, hooks or tests run in this OIDC-capable job.
// Any error (including an ambiguous timeout) stops. A rerun must inspect the registry first.
const result = command('npm', publicationArguments(tarball), { cwd: npmCwd, env: npmEnv });
await writeFile(
  join(directory, 'npm-publication.json'),
  evidenceJson({
    sourceCommit: source,
    sha256: digest,
    version: policy.version,
    registry: policy.registry,
    previousTags: tags,
    publicationRunId: process.env.GITHUB_RUN_ID,
    publicationRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    npmResult: JSON.parse(result),
    postPublicationVerification: 'pending separate job',
  }),
);
console.log(
  'npm accepted the publication command; separate registry verification is still required.',
);
