import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const repository = 'perfecxion-ai/secure-mcp';
export function github(...args) {
  return execFileSync(process.env.GH_BIN ?? 'gh', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 16 * 1024 * 1024,
    timeout: 120_000,
  });
}

async function readRegular(path, maximumBytes) {
  const info = await lstat(path);
  assert.ok(
    info.isFile() && info.size > 0 && info.size <= maximumBytes,
    'Expected bounded regular file',
  );
  return readFile(path);
}

export function verifyWorkflowRun(provenance, run) {
  assert.ok(Number.isSafeInteger(run) && run > 0, 'Invalid workflow run');
  const url = `https://github.com/${repository}/actions/runs/${run}`;
  assert.ok(
    provenance.some((result) => {
      const invocation =
        result.verificationResult?.statement?.predicate?.runDetails?.metadata?.invocationId;
      return (
        typeof invocation === 'string' &&
        invocation.startsWith(url + '/attempts/') &&
        /^\d+$/.test(invocation.slice((url + '/attempts/').length))
      );
    }),
    'Workflow run must appear in verified provenance',
  );
  return url;
}

export async function verifyArtifact(directory, sha, filename) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'Supply an exact expected commit SHA');
  assert.match(
    filename ?? '',
    /^perfecxion-secure-mcp-server-[a-zA-Z0-9.+-]+\.tgz$/,
    'Invalid tarball name',
  );
  const tarball = join(directory, filename);
  const archive = await readRegular(tarball, 256 * 1024 * 1024);
  const sbomBytes = await readRegular(join(directory, 'sbom.cdx.json'), 16 * 1024 * 1024);
  const hashes = Object.fromEntries(
    [
      [filename, archive],
      ['sbom.cdx.json', sbomBytes],
    ].map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')]),
  );
  const verify = (predicate) => {
    const result = JSON.parse(
      github(
        'attestation',
        'verify',
        tarball,
        '--repo',
        repository,
        '--signer-workflow',
        `${repository}/.github/workflows/ci.yml`,
        '--source-ref',
        'refs/heads/main',
        '--source-digest',
        sha,
        '--predicate-type',
        predicate,
        '--format',
        'json',
      ),
    );
    assert.ok(Array.isArray(result) && result.length > 0, 'No verified attestations returned');
    return result;
  };
  const provenance = verify('https://slsa.dev/provenance/v1');
  const sbomVerification = verify('https://cyclonedx.org/bom');
  const sbom = JSON.parse(sbomBytes.toString('utf8'));
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
    execFileSync('tar', ['-xOf', tarball, 'package/package.json'], {
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    }),
  );
  assert.equal(metadata.name, '@perfecxion/secure-mcp-server');
  assert.match(metadata.version, /^2\.0\.0-alpha\.[0-9]+$/);
  for (const [name, expected] of Object.entries(hashes)) {
    const actual = createHash('sha256')
      .update(await readFile(join(directory, name)))
      .digest('hex');
    assert.equal(actual, expected, 'Artifact changed during verification');
  }
  return { metadata, hashes, provenance, sbomVerification };
}

export async function verifyBundle(directory, sha) {
  assert.match(sha ?? '', /^[a-f0-9]{40}$/, 'Supply an exact expected commit SHA');
  const manifest = JSON.parse(
    (await readRegular(join(directory, 'validation-manifest.json'), 1024 * 1024)).toString('utf8'),
  );
  assert.equal(manifest.sourceCommit, sha, 'Manifest must match the separately selected commit');
  assert.ok(manifest.hashes && typeof manifest.hashes === 'object');
  const files = Object.keys(manifest.hashes).sort();
  assert.equal(files.length, 2, 'Manifest must identify exactly the tarball and SBOM');
  assert.ok(files.includes('sbom.cdx.json'));
  const filename = files.find((name) => name !== 'sbom.cdx.json');
  const verified = await verifyArtifact(directory, sha, filename);
  assert.deepEqual(
    manifest.hashes,
    verified.hashes,
    'Manifest checksums do not match verified bytes',
  );
  assert.equal(manifest.package, verified.metadata.name);
  assert.equal(manifest.version, verified.metadata.version);
  assert.equal(manifest.workflowUrl, verifyWorkflowRun(verified.provenance, manifest.workflowRun));
  const sums =
    Object.entries(verified.hashes)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, hash]) => `${hash}  ${name}`)
      .join('\n') + '\n';
  assert.equal(
    (await readRegular(join(directory, 'SHA256SUMS'), 4096)).toString('utf8'),
    sums,
    'Checksum file does not match verified bytes',
  );
  return {
    result: 'verified',
    sourceCommit: sha,
    workflowRun: manifest.workflowRun,
    workflowUrl: manifest.workflowUrl,
    package: verified.metadata.name,
    version: verified.metadata.version,
    hashes: verified.hashes,
    checks: [
      'fresh provenance and SBOM signature verification',
      'exact source/ref/workflow identity',
      'signed SBOM predicate matches file',
      'manifest, package metadata, and checksum file agree',
    ],
  };
}
