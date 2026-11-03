import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { github, verifyArtifact, verifyWorkflowRun } from './validation-artifact.mjs';
import { policy, validateCiRun, validateVerifiedArtifact } from './npm-preflight.mjs';
import { validateEnvironment, validatePublicationGate } from './npm-publication.mjs';

export const command = (binary, args, options = {}) =>
  execFileSync(binary, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
    maxBuffer: 16 * 1024 * 1024,
    ...options,
  });
export const api = (path) =>
  JSON.parse(github('api', '--hostname', 'github.com', `repos/${policy.repository}/${path}`));

export const evidenceJson = (value) =>
  JSON.stringify(value, null, 2).replace(
    /[\u2013\u2014]/g,
    (character) => `\\u${character.charCodeAt(0).toString(16)}`,
  ) + '\n';

export async function verifySettings(source, digest) {
  const settings = JSON.parse(await readFile('.github/npm-publisher-policy.json', 'utf8'));
  validatePublicationGate(settings, process.env, source, digest);
  const environment = api('environments/npm-alpha');
  validateEnvironment(
    settings,
    environment,
    api('environments/npm-alpha/deployment-branch-policies?per_page=100'),
  );

  return { settings, environment };
}

export async function downloadCandidate(source, digest, run, directory) {
  assert.equal(
    api(`commits/${policy.ref.slice('refs/tags/'.length)}`).sha,
    source,
    'Release tag changed',
  );
  validateCiRun(api(`actions/runs/${run}`), source, run);
  const comparison = api(`compare/${source}...main`);
  assert.ok(['ahead', 'identical'].includes(comparison.status), 'Source must remain on main');
  const artifactName = `verified-alpha-${source}`;
  const matches = api(`actions/runs/${run}/artifacts`).artifacts.filter(
    (artifact) => artifact.name === artifactName && !artifact.expired,
  );
  assert.equal(matches.length, 1, 'One verified CI artifact required');
  await mkdir(directory, { mode: 0o700 });
  github(
    'run',
    'download',
    run,
    '--repo',
    policy.repository,
    '--name',
    artifactName,
    '--dir',
    directory,
  );
  const verified = await verifyArtifact(directory, source, policy.filename);
  validateVerifiedArtifact(verified, digest);
  verifyWorkflowRun(verified.provenance, Number(run));
  return verified;
}

export async function fetchBounded(url, limit) {
  const response = await fetch(url, {
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
    headers: { accept: 'application/json' },
  });
  assert.equal(response.status, 200, 'Successful registry response required');
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.byteLength;
    assert.ok(bytes <= limit, 'Registry response exceeds size limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
export const registryMetadata = async () =>
  JSON.parse(
    (
      await fetchBounded(`${policy.registry}@perfecxion%2fsecure-mcp-server`, 16 * 1024 * 1024)
    ).toString('utf8'),
  );

export async function npmEnvironment(directory) {
  await mkdir(directory, { mode: 0o700 });
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^npm_config_/i.test(key) && !/^(NODE_AUTH_TOKEN|NPM_TOKEN|NPM_AUTH_TOKEN)$/.test(key),
    ),
  );
  for (const [kind, key] of [
    ['user', 'NPM_CONFIG_USERCONFIG'],
    ['global', 'NPM_CONFIG_GLOBALCONFIG'],
  ]) {
    const path = join(directory, `${kind}.npmrc`);
    await writeFile(path, '', { mode: 0o600 });
    env[key] = path;
  }
  return env;
}
