import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { AuditDispatcher } from '../src/audit.js';
import type { AuditEvent } from '../src/audit.js';
import { fixture, text } from './helpers.js';

const event: AuditEvent = {
  schema: 1,
  time: new Date().toISOString(),
  requestId: 'fixture',
  actor: 'anonymous',
  tool: 'unknown',
  outcome: 'received',
  durationMs: 0,
};

test('audit backpressure has no queue and latches readiness after loss', async () => {
  let release: () => void = () => {};
  let calls = 0;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  const audit = new AuditDispatcher(
    () => {
      calls++;
      return blocked;
    },
    2,
    25,
  );
  const results = await Promise.allSettled(Array.from({ length: 1000 }, () => audit.write(event)));
  assert.equal(results.filter((result) => result.status === 'rejected').length, 1000);
  assert.equal(calls, 2);
  assert.deepEqual(audit.state, { pending: 2, failures: 2, dropped: 998 });
  assert.equal(audit.healthy, false);
  assert.equal(await audit.close(), 2);
  release();
  await delay(0);
  assert.equal(audit.state.pending, 0);
  await assert.rejects(audit.write(event), /audit_unavailable/);
  assert.equal(calls, 2);
});

test('a stalled sink bounds tool latency and prevents invocation', async (t) => {
  const { runtime, principal } = await fixture(t, {
    config: { audit: { timeoutMs: 25, maxPending: 2 } },
    audit: () => new Promise<void>(() => {}),
  });
  const start = performance.now();
  assert.equal(text(await runtime.invoke(principal, 'policy_status', {})), 'audit_unavailable');
  assert.ok(performance.now() - start < 1000);
  assert.equal(runtime.audit.healthy, false);
  assert.equal(runtime.audit.state.pending, 1);
  assert.match(runtime.metrics(), /secure_mcp_audit_failures 1/);
  assert.equal(await runtime.close(), 1);
});

test('audit scope drains descendant writes even after the handler callback has returned', async () => {
  const releases: (() => void)[] = [];
  const audit = new AuditDispatcher(
    () => new Promise<void>((resolve) => releases.push(resolve)),
    2,
    1000,
  );
  const scope = audit.scope();
  let descendant: Promise<void> | undefined;
  const result = scope.run(() => {
    // Model an adapter returning after cancellation while its original write is pending.
    descendant = audit.write(event).then(() => audit.write({ ...event, outcome: 'cancelled' }));
    return 'handler finished';
  });
  assert.equal(result, 'handler finished');
  let settled = false;
  const draining = scope.settle().then(() => {
    settled = true;
  });
  await delay(0);
  assert.equal(releases.length, 1);
  assert.equal(settled, false);
  releases[0]!();
  await delay(0);
  assert.equal(releases.length, 2);
  assert.equal(settled, false, 'Descendant cancellation record must settle before terminal audit');
  releases[1]!();
  await draining;
  await descendant;
  assert.equal(settled, true);
  assert.equal(audit.healthy, true);
  assert.equal(audit.state.pending, 0);
});

test('independent audit scopes do not wait for another request', async () => {
  let release!: () => void;
  const audit = new AuditDispatcher(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    2,
    1000,
  );
  const first = audit.scope();
  const second = audit.scope();
  const writing = first.run(() => audit.write(event));
  await delay(0);
  await second.settle();
  assert.equal(audit.state.pending, 1);
  release();
  await writing;
  await first.settle();
  assert.equal(audit.healthy, true);
});

test('audit scope drainage is bounded after delivery failure and leaves the loss latch intact', async () => {
  const audit = new AuditDispatcher(() => new Promise<void>(() => {}), 1, 25);
  const scope = audit.scope();
  const outcome = scope.run(() => audit.write(event)).catch((error: unknown) => error);
  await scope.settle();
  assert.match(String(await outcome), /audit_unavailable/);
  assert.deepEqual(audit.state, { pending: 1, failures: 1, dropped: 0 });
  assert.equal(audit.healthy, false);
  const refused = scope.run(() => audit.write(event)).catch((error: unknown) => error);
  await scope.settle();
  assert.match(String(await refused), /audit_unavailable/);
  assert.deepEqual(audit.state, { pending: 1, failures: 1, dropped: 1 });
});
