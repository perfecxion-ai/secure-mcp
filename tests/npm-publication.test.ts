import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  validatePublicationGate,
  validateEnvironment,
  validateApproval,
  validatePreflight,
  publicationArguments,
  validatePublishedRegistry,
  validatePublicationWorkflow,
  // @ts-expect-error Release helpers are JavaScript and execute without a build.
} from '../scripts/lib/npm-publication.mjs';
import {
  registryInstallArguments,
  compareInstalledPackage,
  // @ts-expect-error Release helpers are JavaScript and execute without a build.
} from '../scripts/lib/npm-registry-smoke.mjs';

const source = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const settings = {
  enabled: true,
  environment: 'npm-alpha',
  environmentId: 99,
  reviewerIds: [38704968],
  settingsReceipt: {
    package: '@perfecxion/secure-mcp-server',
    repository: 'perfecxion-ai/secure-mcp',
    workflow: 'publish.yml',
    environment: 'npm-alpha',
    environmentId: 99,
    directPublish: true,
    adminBypassDisabled: true,
    reviewedAt: '2026-11-03T00:00:00Z',
    reviewedBy: 38704968,
  },
};
const gate = { MCP_APPROVED_SOURCE: source, MCP_APPROVED_SHA256: digest };
const environment = {
  name: 'npm-alpha',
  id: 99,
  protection_rules: [
    {
      type: 'required_reviewers',
      prevent_self_review: true,
      reviewers: [{ type: 'User', reviewer: { id: 38704968 } }],
    },
  ],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true },
};
const branches = { total_count: 1, branch_policies: [{ name: 'v2.0.0-alpha.2', type: 'tag' }] };
const approval = { state: 'approved', user: { id: 38704968 }, environments: [{ id: 99 }] };
const preflight = {
  status: 'preflight-passed',
  sourceCommit: source,
  version: '2.0.0-alpha.2',
  package: '@perfecxion/secure-mcp-server',
  registry: 'https://registry.npmjs.org/',
  tag: 'alpha',
  hashes: { 'perfecxion-secure-mcp-server-2.0.0-alpha.2.tgz': digest },
  workflowRun: 42,
  workflowRef: 'perfecxion-ai/secure-mcp/.github/workflows/publish.yml@refs/tags/v2.0.0-alpha.2',
  workflowSha: source,
  targetVersionAbsent: true,
  registryTags: { latest: '1.0.0' },
};

test('publication needs a reviewed settings receipt and independently enabled exact source and digest', () => {
  validatePublicationGate(settings, gate, source, digest);
  for (const patch of [
    { enabled: false },
    { reviewerIds: [] },
    { environment: 'unprotected' },
    { settingsReceipt: null },
    { settingsReceipt: { ...settings.settingsReceipt, directPublish: false } },
    { settingsReceipt: { ...settings.settingsReceipt, adminBypassDisabled: false } },
    { settingsReceipt: { ...settings.settingsReceipt, workflow: 'other.yml' } },
    { settingsReceipt: { ...settings.settingsReceipt, reviewedBy: 222053267 } },
  ])
    assert.throws(() => validatePublicationGate({ ...settings, ...patch }, gate, source, digest));
  assert.throws(() => validatePublicationGate(settings, {}, source, digest));
  assert.throws(() =>
    validatePublicationGate(
      settings,
      { ...gate, MCP_APPROVED_SOURCE: 'c'.repeat(40) },
      source,
      digest,
    ),
  );
  assert.throws(() =>
    validatePublicationGate(
      settings,
      { ...gate, MCP_APPROVED_SHA256: 'c'.repeat(64) },
      source,
      digest,
    ),
  );
});

test('environment must already enforce exact reviewers, self-review prevention and the single tag', () => {
  validateEnvironment(settings, environment, branches);
  for (const patch of [
    { name: 'new-auto-created' },
    { protection_rules: [] },
    { protection_rules: [{ ...environment.protection_rules[0], prevent_self_review: false }] },
    {
      protection_rules: [
        {
          ...environment.protection_rules[0],
          reviewers: [{ type: 'User', reviewer: { id: 222053267 } }],
        },
      ],
    },
    { deployment_branch_policy: null },
  ])
    assert.throws(() => validateEnvironment(settings, { ...environment, ...patch }, branches));
  for (const branchPolicy of [
    { total_count: 0, branch_policies: [] },
    {
      total_count: 2,
      branch_policies: [...branches.branch_policies, { name: 'main', type: 'branch' }],
    },
    { total_count: 1, branch_policies: [{ name: 'v*', type: 'tag' }] },
    { total_count: 1, branch_policies: [{ name: 'v2.0.0-alpha.2', type: 'branch' }] },
  ])
    assert.throws(() => validateEnvironment(settings, environment, branchPolicy));
});

test('admin bypass, another reviewer, self-review and a rejected run cannot authorize publication', () => {
  validateApproval([approval], settings, 99, '222053267');
  for (const reviews of [
    [],
    [{ ...approval, state: 'bypassed' }],
    [{ ...approval, user: { id: 222053267 } }],
    [{ ...approval, environments: [{ id: 100 }] }],
    [approval, { ...approval, state: 'rejected' }],
  ])
    assert.throws(() => validateApproval(reviews, settings, 99, '222053267'));
  assert.throws(() => validateApproval([approval], settings, 99, '38704968'));
});

test('publication cannot substitute a successful preflight from another artifact or workflow', () => {
  validatePreflight(preflight, source, digest, '42');
  for (const patch of [
    { sourceCommit: 'c'.repeat(40) },
    { version: '2.0.0-alpha.1' },
    { workflowRun: 43 },
    { hashes: {} },
    { tag: 'latest' },
    { registry: 'https://evil.invalid/' },
    { workflowRef: preflight.workflowRef.replace('publish.yml', 'npm-preflight.yml') },
    { workflowSha: 'c'.repeat(40) },
    { targetVersionAbsent: false },
  ])
    assert.throws(() => validatePreflight({ ...preflight, ...patch }, source, digest, '42'));
  assert.deepEqual(publicationArguments('/approved/artifact.tgz'), [
    'publish',
    '/approved/artifact.tgz',
    '--ignore-scripts',
    '--provenance',
    '--tag',
    'alpha',
    '--access',
    'public',
    '--registry=https://registry.npmjs.org/',
    '--json',
  ]);
});

test('post-publication requires unchanged other tags, canonical registry bytes and provenance metadata', () => {
  const previous = { latest: '1.0.0', custom: '1.0.0' };
  const pkg = {
    name: preflight.package,
    version: preflight.version,
    dist: {
      tarball:
        'https://registry.npmjs.org/@perfecxion/secure-mcp-server/-/secure-mcp-server-2.0.0-alpha.2.tgz',
      attestations: { provenance: { predicateType: 'https://slsa.dev/provenance/v1' } },
    },
  };
  const registry = {
    name: pkg.name,
    versions: { [pkg.version]: pkg },
    'dist-tags': { ...previous, alpha: pkg.version },
  };
  validatePublishedRegistry(registry, previous);
  for (const tags of [
    { ...registry['dist-tags'], latest: pkg.version },
    { latest: '1.0.0', alpha: pkg.version },
    { ...registry['dist-tags'], unexpected: pkg.version },
  ])
    assert.throws(() => validatePublishedRegistry({ ...registry, 'dist-tags': tags }, previous));
  for (const dist of [
    { ...pkg.dist, tarball: 'https://evil.invalid/package.tgz' },
    { ...pkg.dist, attestations: undefined },
  ])
    assert.throws(() =>
      validatePublishedRegistry(
        { ...registry, versions: { [pkg.version]: { ...pkg, dist } } },
        previous,
      ),
    );
});

test('workflow policy catches loss of approval, permission separation or post-publication checks', async () => {
  const workflow = await readFile('.github/workflows/publish.yml', 'utf8');
  validatePublicationWorkflow(workflow);
  for (const changed of [
    workflow.replace('environment: npm-alpha', 'environment: unprotected'),
    workflow.replace('scripts/check-npm-publication-gate.mjs', 'scripts/skip-gate.mjs'),
    workflow.replace('needs: preflight', 'needs: []'),
    workflow.replace('scripts/verify-npm-publication.mjs', 'scripts/skip-verification.mjs'),
    workflow.replace('contents: read', 'contents: read\n  id-token: write'),
    workflow.replace('cancel-in-progress: false', 'cancel-in-progress: true'),
  ])
    assert.throws(() => validatePublicationWorkflow(changed));
});

test('registry smoke rejects ranges and compares the actual installed package with approved bytes', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-registry-smoke-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const installed = join(directory, 'installed');
  await mkdir(join(directory, 'package'));
  await mkdir(installed);
  const metadata = JSON.stringify({ name: preflight.package, version: preflight.version });
  await writeFile(join(directory, 'package/package.json'), metadata);
  await writeFile(join(installed, 'package.json'), metadata);
  const archive = join(directory, 'candidate.tgz');
  execFileSync('tar', ['-czf', archive, '-C', directory, 'package/package.json']);
  const files = ['package/package.json'];
  assert.ok(registryInstallArguments('2.0.0-alpha.2', archive).includes('--save-exact'));
  for (const version of ['alpha', '^2.0.0-alpha.2', '2.0.0-alpha.1'])
    assert.throws(() => registryInstallArguments(version, archive));
  assert.throws(() => registryInstallArguments('2.0.0-alpha.2', undefined));
  await compareInstalledPackage(archive, files, installed);
  await writeFile(join(installed, 'package.json'), metadata + ' ');
  await assert.rejects(
    compareInstalledPackage(archive, files, installed),
    /Registry-installed file differs/,
  );
  await assert.rejects(compareInstalledPackage(archive, ['package/../escape'], installed));
});
