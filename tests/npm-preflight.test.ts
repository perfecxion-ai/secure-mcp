import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  policy,
  validateInputs,
  validateContext,
  validateCiRun,
  validateMetadata,
  validateVerifiedArtifact,
  validateRegistry,
  dryRunArguments,
  // @ts-expect-error Release helpers run directly as JavaScript without a compilation step.
} from '../scripts/lib/npm-preflight.mjs';

const source = 'a'.repeat(40);
const digest = 'b'.repeat(64);
const context = {
  GITHUB_ACTIONS: 'true',
  GITHUB_REPOSITORY: 'perfecxion-ai/secure-mcp',
  GITHUB_EVENT_NAME: 'workflow_dispatch',
  GITHUB_REF: 'refs/tags/v2.0.0-alpha.2',
  GITHUB_SHA: source,
  GITHUB_WORKFLOW_SHA: source,
  GITHUB_WORKFLOW_REF:
    'perfecxion-ai/secure-mcp/.github/workflows/npm-preflight.yml@refs/tags/v2.0.0-alpha.2',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_API_URL: 'https://api.github.com',
};
const run = {
  id: 42,
  head_sha: source,
  head_branch: 'main',
  event: 'push',
  status: 'completed',
  conclusion: 'success',
  path: '.github/workflows/ci.yml',
  repository: { full_name: 'perfecxion-ai/secure-mcp' },
  head_repository: { full_name: 'perfecxion-ai/secure-mcp' },
};
const metadata = {
  name: '@perfecxion/secure-mcp-server',
  version: '2.0.0-alpha.2',
  publishConfig: { registry: 'https://registry.npmjs.org/', tag: 'alpha', access: 'public' },
  engines: { node: '>=24.22.1 <25' },
  os: ['linux'],
  license: 'AGPL-3.0-or-later',
};
const registry = {
  name: metadata.name,
  versions: { '1.0.0': {} },
  'dist-tags': { latest: '1.0.0', previous: '1.0.0' },
};

test('npm preflight accepts only an exact manual release-tag context without publishing authority', () => {
  validateInputs(source, digest, '42');
  validateContext(context, source, source);
  for (const [sha, hash, id] of [
    ['main', digest, '42'],
    [source, 'a'.repeat(63), '42'],
    [source, digest, '0'],
    [source, digest, '9007199254740993'],
    [source + '; echo injected', digest, '42'],
  ])
    assert.throws(() => validateInputs(sha, hash, id));
  for (const patch of [
    { GITHUB_ACTIONS: 'false' },
    { GITHUB_REPOSITORY: 'someone/secure-mcp' },
    { GITHUB_EVENT_NAME: 'push' },
    { GITHUB_REF: 'refs/heads/main' },
    { GITHUB_REF: 'refs/tags/v2.0.0-alpha.1' },
    { GITHUB_SHA: 'c'.repeat(40) },
    { GITHUB_WORKFLOW_SHA: 'c'.repeat(40) },
    { GITHUB_WORKFLOW_REF: context.GITHUB_WORKFLOW_REF.replace('npm-preflight', 'publish') },
    { NODE_AUTH_TOKEN: 'credential-canary' },
    { NPM_TOKEN: 'credential-canary' },
    { ACTIONS_ID_TOKEN_REQUEST_URL: 'https://oidc.invalid' },
    { ACTIONS_ID_TOKEN_REQUEST_TOKEN: 'credential-canary' },
  ])
    assert.throws(() => validateContext({ ...context, ...patch }, source, source));
  assert.throws(() => validateContext(context, source, 'c'.repeat(40)));
});

test('npm preflight rejects CI from another source, workflow, repository or failed run', () => {
  validateCiRun(run, source, '42');
  for (const patch of [
    { id: 43 },
    { head_sha: 'c'.repeat(40) },
    { head_branch: 'feature' },
    { event: 'pull_request' },
    { status: 'in_progress' },
    { conclusion: 'failure' },
    { path: '.github/workflows/publish.yml' },
    { repository: { full_name: 'other/repo' } },
    { head_repository: { full_name: 'other/repo' } },
  ])
    assert.throws(() => validateCiRun({ ...run, ...patch }, source, '42'));
});

test('npm preflight rejects other artifacts and unsafe package publication settings', () => {
  validateMetadata(metadata);
  validateVerifiedArtifact({ metadata, hashes: { [policy.filename]: digest } }, digest);
  assert.throws(() =>
    validateVerifiedArtifact({ metadata, hashes: { [policy.filename]: 'c'.repeat(64) } }, digest),
  );
  assert.throws(() => validateVerifiedArtifact({ metadata, hashes: {} }, digest));
  for (const patch of [
    { name: '@someone/secure-mcp-server' },
    { version: '2.0.0-alpha.1' },
    { version: '2.0.0-alpha.3' },
    { publishConfig: { ...metadata.publishConfig, tag: 'latest' } },
    { publishConfig: { ...metadata.publishConfig, registry: 'https://registry.invalid/' } },
    { publishConfig: { ...metadata.publishConfig, access: 'restricted' } },
    { engines: { node: '>=24 <25' } },
    { os: ['darwin', 'linux'] },
    { license: 'Apache-2.0' },
  ])
    assert.throws(() => validateMetadata({ ...metadata, ...patch }));
});

test('npm absence requires successful metadata and preserves the whole dist-tag snapshot', () => {
  assert.deepEqual(validateRegistry(200, registry), registry['dist-tags']);
  for (const status of [401, 403, 404, 429, 500])
    assert.throws(() => validateRegistry(status, registry));
  for (const value of [
    {},
    { ...registry, name: 'wrong-package' },
    { ...registry, versions: {} },
    { ...registry, versions: { ...registry.versions, '2.0.0-alpha.2': {} } },
    { ...registry, 'dist-tags': {} },
    { ...registry, 'dist-tags': { latest: '2.0.0-alpha.1' } },
    { ...registry, 'dist-tags': { latest: '1.0.0', next: null } },
  ])
    assert.throws(() => validateRegistry(200, value));
  const copy = validateRegistry(200, registry);
  copy.latest = 'changed';
  assert.equal(registry['dist-tags'].latest, '1.0.0');
});

test('manual preflight has read-only permissions and cannot publish', async () => {
  const workflow = await readFile('.github/workflows/npm-preflight.yml', 'utf8');
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\b(?:push|pull_request|schedule|environment|id-token):/);
  assert.doesNotMatch(workflow, /:\s*write\b|secrets\.|npm (?:publish|ci|install)|npm run build/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /runs-on: ubuntu-24\.04/);
  assert.match(workflow, /refs\/tags\/v2\.0\.0-alpha\.2/);
  assert.match(workflow, /MCP_SOURCE_SHA: \$\{\{ inputs\.source_sha \}\}/);
  for (const [, target] of workflow.matchAll(/uses:\s+(\S+)/g)) {
    assert.match(target!, /^[\w/-]+@[a-f0-9]{40}$/);
  }
});

test('preflight npm command dry-runs an exact tarball without lifecycle hooks', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-npm-preflight-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'package'));
  const canary = join(directory, 'lifecycle-ran');
  const pkg = {
    ...metadata,
    scripts: {
      prepublishOnly: `node -e 'require("fs").writeFileSync(${JSON.stringify(canary)}, "bad")'`,
    },
  };
  await writeFile(join(directory, 'package/package.json'), JSON.stringify(pkg));
  const tarball = join(directory, policy.filename);
  execFileSync('tar', ['-czf', tarball, '-C', directory, 'package']);
  const userconfig = join(directory, 'user.npmrc');
  const globalconfig = join(directory, 'global.npmrc');
  await writeFile(userconfig, '');
  await writeFile(globalconfig, '');
  const args = dryRunArguments(tarball);
  assert.deepEqual(args, [
    'publish',
    tarball,
    '--dry-run',
    '--ignore-scripts',
    '--tag',
    'alpha',
    '--access',
    'public',
    '--registry=https://registry.npmjs.org/',
    '--json',
  ]);
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) =>
        !/^npm_config_/i.test(key) && !/^(NODE_AUTH_TOKEN|NPM_TOKEN|NPM_AUTH_TOKEN)$/.test(key),
    ),
  );
  const result = execFileSync('npm', args, {
    cwd: directory,
    env: { ...env, NPM_CONFIG_USERCONFIG: userconfig, NPM_CONFIG_GLOBALCONFIG: globalconfig },
    encoding: 'utf8',
    timeout: 30_000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.ok(JSON.parse(result));
  await assert.rejects(access(canary));
});

test('preflight orchestration stops on a substituted checkout, CI source or tarball digest', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-preflight-wrapper-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const checkout = join(directory, 'checkout');
  execFileSync('git', ['init', '--quiet', checkout]);
  // The mocked release has a synthetic HEAD, independent of the caller's checkout.
  // No commit, identity override or source-repository mutation is needed.
  const actualSource = source;
  const script = resolve('scripts/npm-preflight.mjs');
  await mkdir(join(directory, 'package'));
  await writeFile(join(directory, 'package/package.json'), JSON.stringify(metadata));
  execFileSync('tar', ['-czf', join(directory, policy.filename), '-C', directory, 'package']);
  const sbom = { bomFormat: 'CycloneDX', components: [] };
  await writeFile(join(directory, 'sbom.cdx.json'), JSON.stringify(sbom));
  const gh = join(directory, 'fixture-gh.mjs');
  // Mock GitHub verifies orchestration policy only. This is not a cryptographic verification.
  await writeFile(
    gh,
    `#!/usr/bin/env node
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
const args = process.argv.slice(2);
const source = ${JSON.stringify(actualSource)};
const run = ${JSON.stringify(run)};
run.head_sha = process.env.PREFLIGHT_BAD_CI === '1' ? 'c'.repeat(40) : source;
let output;
if (args.includes('--help')) {
  console.log('--source-ref --source-digest --predicate-type --signer-workflow');
  process.exit(0);
}
if (args[0] === 'api') {
  const path = args.at(-1);
  if (path.endsWith('/commits/v2.0.0-alpha.2')) output = {sha:source};
  else if (path.endsWith('/actions/runs/42')) output = run;
  else if (path.includes('/compare/')) output = {status:'identical'};
  else if (path.endsWith('/artifacts')) output = {artifacts:[{id:7,name:'verified-alpha-'+source,expired:false}]};
  else throw Error('unexpected API path');
} else if (args[0] === 'run') {
  const target = args[args.indexOf('--dir')+1];
  for(const name of [${JSON.stringify(policy.filename)},'sbom.cdx.json'])
    copyFileSync(join(${JSON.stringify(directory)},name),join(target,name));
  process.exit(0);
} else if (args[0] === 'attestation') {
  const type=args[args.indexOf('--predicate-type')+1];
  output=[{verificationResult:{statement:{predicate:type==='https://cyclonedx.org/bom'
    ? ${JSON.stringify(sbom)}
    : {runDetails:{metadata:{invocationId:'https://github.com/perfecxion-ai/secure-mcp/actions/runs/42/attempts/1'}}}}}}];
} else throw Error('unexpected GitHub command');
console.log(JSON.stringify(output));
`,
    { mode: 0o700 },
  );
  for (const [name, checkoutSource, badCi, error] of [
    ['checkout-source', 'c'.repeat(40), '0', /Checkout source mismatch/],
    ['ci-source', actualSource, '1', /CI source mismatch/],
    ['tarball-digest', actualSource, '0', /Approved tarball digest mismatch/],
  ] as const) {
    await writeFile(join(checkout, '.git/HEAD'), checkoutSource + '\n');
    await t.test(name, () => {
      const result = spawnSync(
        process.execPath,
        [script, actualSource, digest, '42', join(directory, name)],
        {
          cwd: checkout,
          encoding: 'utf8',
          timeout: 10_000,
          env: {
            ...process.env,
            ...context,
            GITHUB_SHA: actualSource,
            GITHUB_WORKFLOW_SHA: actualSource,
            GH_BIN: gh,
            PREFLIGHT_BAD_CI: badCi,
          },
        },
      );
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, result.stdout + result.stderr);
      assert.match(result.stderr, error);
      assert.equal(result.stdout, '');
    });
  }
});
