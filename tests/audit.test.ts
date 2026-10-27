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
