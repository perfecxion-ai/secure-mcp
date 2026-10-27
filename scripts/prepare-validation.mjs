import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Read-only GitHub operations. Promote the exact successful main artifact, never rebuild it.
const [sha, destination] = process.argv.slice(2);
assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'Supply an exact main commit SHA');
assert.ok(destination, 'Supply a new output directory');
const repo = 'perfecxion-ai/secure-mcp';
const gh = process.env.GH_BIN ?? 'gh';
const run = (...args) =>
  execFileSync(gh, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
  });
const api = (path) => JSON.parse(run('api', `repos/${repo}/${path}`));
const comparison = api(`compare/${sha}...main`);
assert.ok(['ahead', 'identical'].includes(comparison.status), 'Commit must be on main');
const runs = api(
  `actions/workflows/ci.yml/runs?head_sha=${sha}&event=push&branch=main&status=completed&per_page=100`,
).workflow_runs;
const selected = runs.find(
  (candidate) =>
    candidate.head_sha === sha &&
    candidate.conclusion === 'success' &&
    candidate.event === 'push' &&
    candidate.head_branch === 'main',
);
assert.ok(selected, 'Successful main CI run required');
const artifacts = api(`actions/runs/${selected.id}/artifacts`).artifacts;
const artifact = artifacts.find(
  (candidate) => candidate.name === `verified-alpha-${sha}` && !candidate.expired,
);
assert.ok(artifact, 'Unexpired verified artifact required');
const directory = resolve(destination);
await mkdir(directory, { mode: 0o700 }); // Refuse reuse and accidental overwrite.
run(
  'run',
  'download',
  String(selected.id),
  '--repo',
  repo,
  '--name',
  artifact.name,
  '--dir',
  directory,
);
const files = await readdir(directory);
assert.equal(files.length, 2, 'Unexpected artifact contents');
const filename = files.find((name) =>
  /^perfecxion-secure-mcp-server-[a-zA-Z0-9.+-]+\.tgz$/.test(name),
);
assert.ok(filename && files.includes('sbom.cdx.json'));
const tarball = join(directory, filename);
const verify = (predicate) =>
  JSON.parse(
    run(
      'attestation',
      'verify',
      tarball,
      '--repo',
      repo,
      '--signer-workflow',
      `${repo}/.github/workflows/ci.yml`,
      '--source-ref',
      'refs/heads/main',
      '--source-digest',
      sha,
      '--format',
      'json',
      ...(predicate ? ['--predicate-type', predicate] : []),
    ),
  );
const provenance = verify();
const sbomVerification = verify('https://cyclonedx.org/bom');
const sbom = JSON.parse(await readFile(join(directory, 'sbom.cdx.json'), 'utf8'));
assert.ok(
  sbomVerification.some((result) => {
    try {
      assert.deepEqual(result.verificationResult.statement.predicate, sbom);
      return true;
    } catch {
      return false;
    }
  }),
  'Downloaded SBOM must match the signed predicate',
);
const metadata = JSON.parse(
  execFileSync('tar', ['-xOf', tarball, 'package/package.json'], { encoding: 'utf8' }),
);
assert.equal(metadata.name, '@perfecxion/secure-mcp-server');
assert.match(metadata.version, /^2\.0\.0-alpha\.[0-9]+$/);
const hashes = {};
for (const file of files.sort())
  hashes[file] = createHash('sha256')
    .update(await readFile(join(directory, file)))
    .digest('hex');
const manifest = {
  sourceCommit: sha,
  workflowRun: selected.id,
  workflowUrl: selected.html_url,
  artifactId: artifact.id,
  artifactExpiresAt: artifact.expires_at,
  package: metadata.name,
  version: metadata.version,
  hashes,
  provenance: 'verified against exact main commit and CI workflow',
  sbom: 'verified signature and exact predicate match',
  publication: 'none',
};
await writeFile(
  join(directory, 'validation-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
await writeFile(
  join(directory, 'SHA256SUMS'),
  Object.entries(hashes)
    .map(([name, hash]) => `${hash}  ${name}`)
    .join('\n') + '\n',
);
await writeFile(
  join(directory, 'provenance-verification.json'),
  JSON.stringify(provenance, null, 2) + '\n',
);
await writeFile(
  join(directory, 'sbom-verification.json'),
  JSON.stringify(sbomVerification, null, 2) + '\n',
);
console.log(JSON.stringify(manifest, null, 2));
