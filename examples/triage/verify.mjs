import assert from 'node:assert/strict';
import { createTriageRuntime } from './tool.mjs';

const events = [];
let available = true;
const sink = (event) => {
  if (!available) throw new Error('Injected local demo sink outage');
  events.push(event);
};
let runtime = await createTriageRuntime(sink);
try {
  const principal = runtime.localPrincipal();
  const read = async (resource) => {
    const result = await runtime.invoke(principal, 'triage_context_read', { resource });
    assert.ok(!result.isError);
    return JSON.parse(result.content[0].text).data;
  };
  const alert = await read('alert');
  const asset = await read('asset');
  const runbook = await read('runbook');
  assert.equal(alert.asset, asset.id);
  assert.equal(alert.destination, asset.approvedDestination);
  assert.equal(alert.parentProcess, 'scheduled-healthcheck');
  assert.equal(asset.changeApprovalVerified, false);
  assert.equal(runbook.steps.length, 3);
  const denied = await runtime.invoke(principal, 'triage_context_read', { resource: 'restricted' });
  assert.equal(denied.isError, true);
  assert.equal(denied.content[0].text, 'denied');
  const spoofed = await runtime.invoke(principal, 'triage_context_read', {
    resource: 'restricted',
    subject: 'administrator',
  });
  assert.equal(spoofed.content[0].text, 'invalid_input');
  const other = await runtime.invoke(
    { ...principal, subject: 'other-operator' },
    'triage_context_read',
    { resource: 'asset' },
  );
  assert.equal(other.content[0].text, 'denied');
  available = false;
  assert.equal(
    (await runtime.invoke(principal, 'triage_context_read', { resource: 'alert' })).content[0].text,
    'audit_unavailable',
  );
  available = true;
  assert.equal(
    (await runtime.invoke(principal, 'triage_context_read', { resource: 'alert' })).content[0].text,
    'audit_unavailable',
  );
  assert.equal(runtime.audit.healthy, false);
  await runtime.close();
  runtime = await createTriageRuntime(sink);
  assert.ok(
    !(await runtime.invoke(runtime.localPrincipal(), 'triage_context_read', { resource: 'alert' }))
      .isError,
  );
  assert.equal(runtime.audit.healthy, true);
  const audit = JSON.stringify(events);
  for (const canary of [
    'status.example.test',
    'edge-worker-07',
    'RESTRICTED-FIXTURE-NOT-FOR-TRIAGE',
    'fixtures/',
    'alert.json',
  ])
    assert.ok(!audit.includes(canary));
  assert.ok(events.some((event) => event.outcome === 'denied'));
  const successes = events.filter((event) => event.outcome === 'success');
  assert.ok(successes.length >= 4);
  for (const event of successes)
    assert.ok(
      events.some((start) => start.requestId === event.requestId && start.outcome === 'allowed'),
    );
  console.log(
    JSON.stringify(
      {
        kind: 'engineering demonstration, not independent adoption evidence',
        allowedReads: 3,
        resourceDenial: 'pass',
        identitySpoofing: 'rejected',
        otherPrincipal: 'denied',
        auditFailure: 'fail closed',
        latchAfterRepair: 'requires runtime restart',
        restart: 'pass',
        auditPrivacy: 'pass',
        brief: {
          observation:
            'ALERT-1042 records curl HTTPS to status.example.test from scheduled-healthcheck at 12:00 UTC.',
          assessment:
            'Asset context matches the destination and hourly schedule; scheduled polling is a hypothesis.',
          nextAction:
            'Infrastructure must verify CHG-1042 approval and the actual command line before closure.',
          unknown: 'Change approval is not verified; no live telemetry was queried.',
          sources: ['alert', 'asset', 'runbook'],
        },
        auditEvents: events,
      },
      null,
      2,
    ),
  );
} finally {
  assert.equal(await runtime.close(), 0);
}
