import assert from 'node:assert/strict';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import {
  github as run,
  repository as repo,
  verifyArtifact,
  verifyWorkflowRun,
} from './lib/validation-artifact.mjs';

// Read-only GitHub operations. Promote the exact successful main artifact, never rebuild it.
const [sha, destination] = process.argv.slice(2);
assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'Supply an exact main commit SHA');
assert.ok(destination, 'Supply a new output directory');
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
const { metadata, hashes, provenance, sbomVerification } = await verifyArtifact(
  directory,
  sha,
  filename,
);
assert.equal(selected.html_url, verifyWorkflowRun(provenance, selected.id));
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
