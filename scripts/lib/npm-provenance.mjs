import assert from 'node:assert/strict';
import { X509Certificate } from 'node:crypto';
import { policy } from './npm-preflight.mjs';

const predicateType = 'https://slsa.dev/provenance/v1';
const repository = `https://github.com/${policy.repository}`;
const workflow = '.github/workflows/publish.yml';

// This is policy validation of the SAME bundle emitted in `verified` by a
// successful pinned npm audit signatures --json --include-attestations run.
// It does not authenticate arbitrary saved JSON or independently fetched bundles.
export function validateNpmProvenance(report, { source, sha512, runId, runAttempt }) {
  assert.match(source ?? '', /^[a-f0-9]{40}$/, 'Expected independently approved source');
  assert.match(sha512 ?? '', /^[a-f0-9]{128}$/, 'Expected approved archive SHA-512');
  for (const value of [runId, runAttempt])
    assert.match(String(value ?? ''), /^[1-9][0-9]*$/, 'Expected publication run and attempt');
  assert.deepEqual(report.invalid, [], 'npm reported invalid signatures or attestations');
  assert.deepEqual(report.missing, [], 'npm reported missing registry signatures');
  assert.ok(Array.isArray(report.verified), 'npm must emit verified attestation bundles');
  const roots = report.verified.filter(
    (entry) => entry.name === policy.package && entry.version === policy.version,
  );
  assert.equal(roots.length, 1, 'Expected one verified root package');
  const root = roots[0];
  assert.equal(root.registry, policy.registry, 'Unexpected provenance registry');
  assert.equal(root.location, `node_modules/${policy.package}`, 'Unexpected root installation');
  assert.ok(Array.isArray(root.attestationBundles), 'Verified bundles missing');
  const entries = root.attestationBundles.filter((entry) => entry.predicateType === predicateType);
  assert.equal(entries.length, 1, 'Expected one verified SLSA provenance bundle');
  const bundle = entries[0].bundle;
  assert.equal(bundle?.dsseEnvelope?.payloadType, 'application/vnd.in-toto+json');
  const payload = bundle.dsseEnvelope.payload;
  assert.ok(typeof payload === 'string' && payload.length > 0 && payload.length <= 4 * 1024 * 1024);
  const statement = JSON.parse(Buffer.from(payload, 'base64').toString('utf8'));
  assert.equal(statement._type, 'https://in-toto.io/Statement/v1');
  assert.equal(statement.predicateType, predicateType);
  assert.deepEqual(
    statement.subject,
    [
      {
        name: `pkg:npm/%40perfecxion/secure-mcp-server@${policy.version}`,
        digest: { sha512 },
      },
    ],
    'Signed subject must identify the approved archive',
  );
  const definition = statement.predicate?.buildDefinition;
  assert.equal(
    definition?.buildType,
    'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
  );
  assert.deepEqual(
    definition.externalParameters?.workflow,
    {
      ref: policy.ref,
      repository,
      path: workflow,
    },
    'Provenance workflow differs from the approved publisher',
  );
  assert.equal(definition.internalParameters?.github?.event_name, 'workflow_dispatch');
  assert.deepEqual(
    definition.resolvedDependencies,
    [
      {
        uri: `git+${repository}@${policy.ref}`,
        digest: { gitCommit: source },
      },
    ],
    'Provenance source differs from the approved source',
  );
  const invocationId = `${repository}/actions/runs/${runId}/attempts/${runAttempt}`;
  assert.equal(
    statement.predicate?.runDetails?.builder?.id,
    'https://github.com/actions/runner/github-hosted',
    'GitHub-hosted publisher required',
  );
  assert.equal(
    statement.predicate?.runDetails?.metadata?.invocationId,
    invocationId,
    'Provenance belongs to another publication run or attempt',
  );
  const material = bundle.verificationMaterial;
  const certificate =
    material?.certificate?.rawBytes ?? material?.x509CertificateChain?.certificates?.[0]?.rawBytes;
  assert.ok(typeof certificate === 'string', 'Verified signer certificate missing');
  const identity = `${repository}/${workflow}@${policy.ref}`;
  assert.equal(
    new X509Certificate(Buffer.from(certificate, 'base64')).subjectAltName,
    `URI:${identity}`,
    'Verified signer identity differs from the approved publisher',
  );
  return {
    result: 'verified npm provenance matches approved publication',
    sourceCommit: source,
    sha512,
    identity,
    invocationId,
    statement,
    verification:
      'Policy checked against bundles returned by successful npm cryptographic verification',
  };
}
