import assert from 'node:assert/strict';

const version = '2.0.0-alpha.3';

export const policy = Object.freeze({
  repository: 'perfecxion-ai/secure-mcp',
  package: '@perfecxion/secure-mcp-server',
  version,
  filename: `perfecxion-secure-mcp-server-${version}.tgz`,
  registry: 'https://registry.npmjs.org/',
  tag: 'alpha',
  ref: `refs/tags/v${version}`,
  workflow: 'npm-preflight.yml',
  expectedLatest: '1.0.0',
});

export function validateInputs(source, digest, run) {
  assert.match(source ?? '', /^[a-f0-9]{40}$/, 'Expected exact source SHA');
  assert.match(digest ?? '', /^[a-f0-9]{64}$/, 'Expected approved SHA-256');
  assert.match(run ?? '', /^[1-9][0-9]*$/, 'Expected CI run ID');
  assert.ok(Number.isSafeInteger(Number(run)), 'CI run ID is out of range');
}

export function validateContext(env, source, checkout, workflow = policy.workflow, oidc = false) {
  assert.ok([policy.workflow, 'publish.yml'].includes(workflow));
  assert.equal(env.GITHUB_ACTIONS, 'true', 'GitHub Actions context required');
  assert.equal(env.GITHUB_REPOSITORY, policy.repository, 'Wrong repository');
  assert.equal(env.GITHUB_EVENT_NAME, 'workflow_dispatch', 'Manual dispatch required');
  assert.equal(env.GITHUB_REF, policy.ref, 'Approved release tag required');
  assert.equal(env.GITHUB_SHA, source, 'Dispatch source mismatch');
  assert.equal(env.GITHUB_WORKFLOW_SHA, source, 'Workflow source mismatch');
  assert.equal(
    env.GITHUB_WORKFLOW_REF,
    `${policy.repository}/.github/workflows/${workflow}@${policy.ref}`,
    'Workflow identity mismatch',
  );
  assert.equal(env.GITHUB_SERVER_URL, 'https://github.com');
  assert.equal(env.GITHUB_API_URL, 'https://api.github.com');
  assert.equal(checkout, source, 'Checkout source mismatch');
  for (const key of [
    'NODE_AUTH_TOKEN',
    'NPM_TOKEN',
    'NPM_AUTH_TOKEN',
    ...(!oidc ? ['ACTIONS_ID_TOKEN_REQUEST_URL', 'ACTIONS_ID_TOKEN_REQUEST_TOKEN'] : []),
  ]) {
    assert.ok(!env[key], `Preflight must not receive ${key}`);
  }
  if (oidc) {
    assert.ok(
      env.ACTIONS_ID_TOKEN_REQUEST_URL && env.ACTIONS_ID_TOKEN_REQUEST_TOKEN,
      'Publishing requires OIDC',
    );
  }
}

export function validateCiRun(run, source, expectedId) {
  assert.equal(run.id, Number(expectedId), 'CI run mismatch');
  assert.equal(run.head_sha, source, 'CI source mismatch');
  assert.equal(run.head_branch, 'main', 'CI must be on main');
  assert.equal(run.event, 'push', 'CI must be a main push');
  assert.equal(run.status, 'completed', 'CI must have completed');
  assert.equal(run.conclusion, 'success', 'Successful CI required');
  assert.equal(run.path, '.github/workflows/ci.yml', 'Wrong CI workflow');
  assert.equal(run.repository?.full_name, policy.repository, 'Wrong CI repository');
  assert.equal(run.head_repository?.full_name, policy.repository, 'Wrong CI source repository');
}

export function validateMetadata(metadata) {
  assert.equal(metadata.name, policy.package, 'Unexpected package');
  assert.equal(metadata.version, policy.version, 'Only the reviewed alpha.3 version is eligible');
  assert.equal(metadata.publishConfig?.registry, policy.registry, 'Unexpected registry');
  assert.equal(metadata.publishConfig?.tag, policy.tag, 'Unexpected dist-tag');
  assert.equal(metadata.publishConfig?.access, 'public', 'Expected public access');
  assert.equal(metadata.engines?.node, '>=24.22.1 <25', 'Unexpected Node requirement');
  assert.deepEqual(metadata.os, ['linux'], 'Unexpected platform support');
  assert.equal(metadata.license, 'AGPL-3.0-or-later', 'Unexpected license');
}

export function validateVerifiedArtifact(verified, digest) {
  validateMetadata(verified.metadata);
  assert.equal(verified.hashes[policy.filename], digest, 'Approved tarball digest mismatch');
}

export function validateRegistry(status, metadata) {
  // A missing/failed response is never proof that the version is available.
  assert.equal(status, 200, 'Successful registry metadata response required');
  assert.equal(metadata.name, policy.package, 'Wrong registry package');
  assert.ok(metadata.versions && typeof metadata.versions === 'object');
  assert.ok(!Array.isArray(metadata.versions));
  assert.ok(Object.hasOwn(metadata.versions, policy.expectedLatest), 'Missing existing version');
  assert.ok(!Object.hasOwn(metadata.versions, policy.version), 'Version is already published');
  const tags = metadata['dist-tags'];
  assert.ok(tags && typeof tags === 'object' && !Array.isArray(tags), 'Missing dist-tags');
  assert.ok(Object.entries(tags).every(([tag, version]) => tag && typeof version === 'string'));
  assert.equal(tags.latest, policy.expectedLatest, 'The expected latest tag changed');
  return structuredClone(tags);
}

export function dryRunArguments(tarball) {
  return [
    'publish',
    tarball,
    '--dry-run',
    '--ignore-scripts',
    '--tag',
    policy.tag,
    '--access',
    'public',
    `--registry=${policy.registry}`,
    '--json',
  ];
}
