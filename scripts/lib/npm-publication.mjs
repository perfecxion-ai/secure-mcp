import assert from 'node:assert/strict';
import { policy } from './npm-preflight.mjs';

export function validatePublicationGate(settings, env, source, digest) {
  assert.equal(settings.enabled, true, 'Publication policy is disabled');
  assert.equal(settings.environment, 'npm-alpha');
  assert.ok(Number.isSafeInteger(settings.environmentId) && settings.environmentId > 0);
  assert.ok(Array.isArray(settings.reviewerIds) && settings.reviewerIds.length > 0);
  assert.ok(settings.reviewerIds.every((id) => Number.isSafeInteger(id) && id > 0));
  assert.equal(new Set(settings.reviewerIds).size, settings.reviewerIds.length);
  const receipt = settings.settingsReceipt;
  assert.ok(receipt && typeof receipt === 'object', 'Verified settings receipt required');
  assert.equal(receipt.package, policy.package);
  assert.equal(receipt.repository, policy.repository);
  assert.equal(receipt.workflow, 'publish.yml');
  assert.equal(receipt.environment, 'npm-alpha');
  assert.equal(receipt.environmentId, settings.environmentId);
  assert.equal(receipt.directPublish, true);
  assert.equal(receipt.adminBypassDisabled, true);
  assert.match(receipt.reviewedAt ?? '', /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
  assert.ok(settings.reviewerIds.includes(receipt.reviewedBy));
  assert.equal(env.MCP_APPROVED_SOURCE, source, 'Exact source has not been enabled');
  assert.equal(env.MCP_APPROVED_SHA256, digest, 'Exact digest has not been enabled');
}

export function validateEnvironment(settings, environment, branches) {
  assert.equal(environment.name, settings.environment, 'Wrong protected environment');
  if (Object.hasOwn(environment, 'can_admins_bypass'))
    assert.equal(environment.can_admins_bypass, false, 'Administrator bypass must be disabled');
  assert.ok(Number.isSafeInteger(environment.id) && environment.id > 0);
  assert.equal(environment.id, settings.environmentId, 'Protected environment was replaced');
  const rules = environment.protection_rules.filter((rule) => rule.type === 'required_reviewers');
  assert.equal(rules.length, 1, 'Required reviewers must already be configured');
  assert.equal(rules[0].prevent_self_review, true, 'Self-review must be prevented');
  assert.ok(rules[0].reviewers.every((reviewer) => reviewer.type === 'User'));
  assert.deepEqual(
    rules[0].reviewers.map(({ reviewer }) => reviewer.id).sort((a, b) => a - b),
    [...settings.reviewerIds].sort((a, b) => a - b),
    'Configured reviewers differ from reviewed policy',
  );
  assert.deepEqual(environment.deployment_branch_policy, {
    protected_branches: false,
    custom_branch_policies: true,
  });
  assert.equal(branches.total_count, 1, 'Only the approved tag may deploy');
  assert.equal(branches.branch_policies.length, 1);
  assert.equal(branches.branch_policies[0].name, policy.ref.slice('refs/tags/'.length));
  assert.equal(
    branches.branch_policies[0].type,
    'tag',
    'A branch restriction is not a tag restriction',
  );
  // When the API omits admin bypass, the reviewed receipt remains required.
  // Publication also requires an actual reviewer approval below.
}

export function validateApproval(reviews, settings, environmentId, actorId) {
  assert.ok(Array.isArray(reviews));
  assert.match(actorId ?? '', /^[1-9][0-9]*$/, 'Workflow actor identity is required');
  const relevant = reviews.filter((review) =>
    review.environments?.some((environment) => environment.id === environmentId),
  );
  assert.ok(relevant.length > 0, 'No review for this environment and workflow run');
  assert.ok(!relevant.some((review) => review.state === 'rejected'), 'Workflow run was rejected');
  assert.ok(
    relevant.some(
      (review) =>
        review.state === 'approved' &&
        settings.reviewerIds.includes(review.user?.id) &&
        String(review.user.id) !== actorId,
    ),
    'An expected reviewer must explicitly approve this run; administrator bypass is insufficient',
  );
}

export function validatePreflight(receipt, source, digest, run) {
  assert.equal(receipt.status, 'preflight-passed');
  assert.equal(receipt.sourceCommit, source);
  assert.equal(receipt.version, policy.version);
  assert.equal(receipt.package, policy.package);
  assert.equal(receipt.registry, policy.registry);
  assert.equal(receipt.tag, policy.tag);
  assert.equal(receipt.hashes?.[policy.filename], digest);
  assert.equal(receipt.workflowRun, Number(run));
  assert.equal(
    receipt.workflowRef,
    `${policy.repository}/.github/workflows/publish.yml@${policy.ref}`,
  );
  assert.equal(receipt.workflowSha, source);
  assert.equal(receipt.targetVersionAbsent, true);
  assert.equal(receipt.registryTags?.latest, '1.0.0');
}

export function publicationArguments(tarball) {
  return [
    'publish',
    tarball,
    '--ignore-scripts',
    '--provenance',
    '--tag',
    'alpha',
    '--access',
    'public',
    `--registry=${policy.registry}`,
    '--json',
  ];
}

export function validatePublicationReceipt(receipt, source, digest, runId, runAttempt) {
  assert.match(runId ?? '', /^[1-9][0-9]*$/);
  assert.match(runAttempt ?? '', /^[1-9][0-9]*$/);
  assert.equal(receipt.sourceCommit, source);
  assert.equal(receipt.sha256, digest);
  assert.equal(receipt.version, policy.version);
  assert.equal(receipt.registry, policy.registry);
  assert.equal(receipt.publicationRunId, runId, 'Receipt must come from this publication run');
  assert.match(receipt.publicationRunAttempt ?? '', /^[1-9][0-9]*$/);
  assert.ok(
    Number(receipt.publicationRunAttempt) <= Number(runAttempt),
    'Publication attempt cannot be newer than verification',
  );
}

export function validatePublishedRegistry(metadata, previousTags) {
  assert.equal(metadata.name, policy.package);
  assert.deepEqual(
    metadata['dist-tags'],
    { ...previousTags, alpha: policy.version },
    'Unexpected registry tag change',
  );
  const published = metadata.versions?.[policy.version];
  assert.equal(published?.name, policy.package);
  assert.equal(published?.version, policy.version);
  assert.equal(
    published?.dist?.tarball,
    `${policy.registry}@perfecxion/secure-mcp-server/-/secure-mcp-server-${policy.version}.tgz`,
  );
  assert.equal(
    published.dist.attestations?.provenance?.predicateType,
    'https://slsa.dev/provenance/v1',
    'Registry provenance metadata is missing',
  );
  return published;
}

export function validatePublicationWorkflow(workflow) {
  assert.match(workflow, /workflow_dispatch:/);
  assert.doesNotMatch(workflow, /\b(?:push|pull_request|schedule):/);
  assert.match(workflow, /group: npm-alpha-publication/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.equal(
    (workflow.match(/id-token: write/g) ?? []).length,
    1,
    'Only publisher may receive OIDC',
  );
  assert.doesNotMatch(workflow, /secrets\.|NODE_AUTH_TOKEN|NPM_TOKEN/);
  const preflight = workflow.match(/\n  preflight:\n([\s\S]*?)\n  publish:\n/)?.[1];
  const publish = workflow.match(/\n  publish:\n([\s\S]*?)\n  verify:\n/)?.[1];
  const verify = workflow.match(/\n  verify:\n([\s\S]*)/)?.[1];
  assert.ok(preflight && publish && verify, 'Required publication stages are missing');
  assert.doesNotMatch(preflight + verify, /id-token:|:\s*write\b/);
  assert.match(preflight, /scripts\/check-npm-publication-gate\.mjs/);
  assert.match(preflight, /scripts\/npm-preflight\.mjs[^\n]+--publisher-preflight/);
  assert.ok(
    preflight.includes(`[[ "$GITHUB_REF" == ${policy.ref} ]]`),
    'Workflow must require the exact policy tag before checkout',
  );
  assert.match(publish, /needs: preflight/);
  assert.match(publish, /environment: npm-alpha/);
  assert.match(publish, /id-token: write/);
  assert.match(publish, /scripts\/publish-npm\.mjs/);
  assert.doesNotMatch(publish, /npm (?:ci|install|test|run|pack)|scripts\/package-smoke/);
  assert.match(verify, /needs: publish/);
  assert.match(verify, /npm ci --ignore-scripts/);
  assert.match(verify, /scripts\/verify-npm-publication\.mjs/);
  assert.equal((workflow.match(/runs-on: ubuntu-24\.04/g) ?? []).length, 3);
  assert.equal((workflow.match(/persist-credentials: false/g) ?? []).length, 3);
  for (const [, action] of workflow.matchAll(/uses:\s+(\S+)/g))
    assert.match(action, /^[\w/-]+@[a-f0-9]{40}$/);
}
