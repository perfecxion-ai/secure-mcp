import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  validateNpmProvenance,
  // @ts-expect-error Release helpers execute as JavaScript without compilation.
} from '../scripts/lib/npm-provenance.mjs';

test('npm provenance policy binds the cryptographically verified bundle to the approved publisher', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-provenance-policy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const repo = 'https://github.com/perfecxion-ai/secure-mcp';
  const ref = 'refs/tags/v2.0.0-alpha.3';
  const identity = `${repo}/.github/workflows/publish.yml@${ref}`;
  const expected = {
    source: 'a'.repeat(40),
    sha512: 'b'.repeat(128),
    runId: '99',
    runAttempt: '1',
  };
  // Self-signed fixtures exercise only this policy layer, never Sigstore trust.
  // The caller must supply npm's freshly verified stdout, not these test objects.
  const certificate = async (name: string, uri: string) => {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'ec',
        '-pkeyopt',
        'ec_paramgen_curve:P-256',
        '-nodes',
        '-keyout',
        join(directory, `${name}.key`),
        '-out',
        join(directory, `${name}.der`),
        '-outform',
        'DER',
        '-days',
        '1',
        '-subj',
        '/CN=policy-fixture',
        '-addext',
        `subjectAltName=URI:${uri}`,
      ],
      { stdio: 'ignore', timeout: 5000 },
    );
    return (await readFile(join(directory, `${name}.der`))).toString('base64');
  };
  const goodCertificate = await certificate('expected', identity);
  const otherCertificate = await certificate('other', identity.replace('publish.yml', 'other.yml'));
  const heldCertificate = await certificate('held', identity.replace('alpha.3', 'alpha.2'));
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [
      {
        name: 'pkg:npm/%40perfecxion/secure-mcp-server@2.0.0-alpha.3',
        digest: { sha512: expected.sha512 },
      },
    ],
    predicateType: 'https://slsa.dev/provenance/v1',
    predicate: {
      buildDefinition: {
        buildType: 'https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1',
        externalParameters: {
          workflow: { ref, repository: repo, path: '.github/workflows/publish.yml' },
        },
        internalParameters: { github: { event_name: 'workflow_dispatch' } },
        resolvedDependencies: [
          { uri: `git+${repo}@${ref}`, digest: { gitCommit: expected.source } },
        ],
      },
      runDetails: {
        builder: { id: 'https://github.com/actions/runner/github-hosted' },
        metadata: { invocationId: `${repo}/actions/runs/99/attempts/1` },
      },
    },
  };
  const report = (value = statement, cert = goodCertificate) => ({
    invalid: [],
    missing: [],
    verified: [
      {
        name: '@perfecxion/secure-mcp-server',
        version: '2.0.0-alpha.3',
        registry: 'https://registry.npmjs.org/',
        location: 'node_modules/@perfecxion/secure-mcp-server',
        attestationBundles: [
          {
            predicateType: statement.predicateType,
            bundle: {
              dsseEnvelope: {
                payloadType: 'application/vnd.in-toto+json',
                payload: Buffer.from(JSON.stringify(value)).toString('base64'),
              },
              verificationMaterial: { certificate: { rawBytes: cert } },
            },
          },
        ],
      },
    ],
  });
  await t.test(
    'accepts the pinned npm verified-output shape and expected publication identity',
    () => {
      const result = validateNpmProvenance(report(), expected);
      assert.equal(result.sourceCommit, expected.source);
      assert.equal(result.identity, identity);
      assert.equal(result.invocationId, `${repo}/actions/runs/99/attempts/1`);
    },
  );
  await t.test('does not accept missing or failed npm verification', () => {
    for (const value of [
      {},
      { ...report(), verified: [] },
      { ...report(), invalid: [{ name: 'bad' }] },
      { ...report(), missing: [{ name: 'unsigned' }] },
    ])
      assert.throws(() => validateNpmProvenance(value, expected));
  });
  await t.test('rejects held alpha.2 package and signing identity', () => {
    const heldReport = report();
    heldReport.verified[0]!.version = '2.0.0-alpha.2';
    assert.throws(() => validateNpmProvenance(heldReport, expected), /verified root package/);
    assert.throws(
      () => validateNpmProvenance(report(statement, heldCertificate), expected),
      /signer identity/,
    );
  });
  const mutations: [string, (value: typeof statement) => void][] = [
    [
      'subject',
      (value) => {
        value.subject[0]!.digest.sha512 = 'c'.repeat(128);
      },
    ],
    [
      'package',
      (value) => {
        value.subject[0]!.name = 'pkg:npm/other@1.0.0';
      },
    ],
    [
      'held alpha.2 subject',
      (value) => {
        value.subject[0]!.name = 'pkg:npm/%40perfecxion/secure-mcp-server@2.0.0-alpha.2';
      },
    ],
    [
      'source',
      (value) => {
        value.predicate.buildDefinition.resolvedDependencies[0]!.digest.gitCommit = 'c'.repeat(40);
      },
    ],
    [
      'repository',
      (value) => {
        value.predicate.buildDefinition.externalParameters.workflow.repository =
          'https://github.com/other/repo';
      },
    ],
    [
      'workflow',
      (value) => {
        value.predicate.buildDefinition.externalParameters.workflow.path =
          '.github/workflows/docs.yml';
      },
    ],
    [
      'ref',
      (value) => {
        value.predicate.buildDefinition.externalParameters.workflow.ref = 'refs/heads/main';
      },
    ],
    [
      'held alpha.2 tag',
      (value) => {
        value.predicate.buildDefinition.externalParameters.workflow.ref =
          'refs/tags/v2.0.0-alpha.2';
      },
    ],
    [
      'event',
      (value) => {
        value.predicate.buildDefinition.internalParameters.github.event_name = 'push';
      },
    ],
    [
      'builder',
      (value) => {
        value.predicate.runDetails.builder.id = 'https://github.com/actions/runner/self-hosted';
      },
    ],
    [
      'publication run',
      (value) => {
        value.predicate.runDetails.metadata.invocationId = `${repo}/actions/runs/42/attempts/1`;
      },
    ],
    [
      'publication attempt',
      (value) => {
        value.predicate.runDetails.metadata.invocationId = `${repo}/actions/runs/99/attempts/2`;
      },
    ],
  ];
  for (const [name, mutate] of mutations)
    await t.test(`rejects another ${name} in the verified statement`, () => {
      const value = structuredClone(statement);
      mutate(value);
      assert.throws(() => validateNpmProvenance(report(value), expected));
    });
  await t.test(
    'rejects a different certificate identity even if its statement claims the expected workflow',
    () => {
      assert.throws(
        () => validateNpmProvenance(report(statement, otherCertificate), expected),
        /signer identity/,
      );
    },
  );
});
