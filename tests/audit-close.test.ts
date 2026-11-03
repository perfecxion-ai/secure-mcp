import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AuditDispatcher } from '../src/audit.js';
import type { AuditEvent, AuditSink } from '../src/audit.js';
import { SecureRuntime } from '../src/runtime.js';

const event: AuditEvent = {
  schema: 1,
  time: new Date(0).toISOString(),
  requestId: 'close-test',
  actor: 'fixture',
  tool: 'policy_status',
  outcome: 'success',
  durationMs: 0,
};

test(
  'audit close owns its sink once and waits for a successful hook',
  { timeout: 2000 },
  async () => {
    let closeCalls = 0;
    let finishClose: () => void = () => {};
    const sink: AuditSink = () => {};
    sink.close = () => {
      closeCalls++;
      return new Promise<void>((resolve) => {
        finishClose = resolve;
      });
    };
    const dispatcher = new AuditDispatcher(sink, 4, 1000);
    await dispatcher.write(event);
    const first = dispatcher.close();
    const second = dispatcher.close();
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(closeCalls, 1);
    finishClose();
    assert.deepEqual(await Promise.all([first, second, dispatcher.close()]), [0, 0, 0]);
    assert.equal(closeCalls, 1);
    assert.equal(dispatcher.healthy, true);
  },
);

for (const failure of ['never settles', 'rejects', 'throws'] as const)
  test(
    `audit close ${failure}: bounded library shutdown rejects safely and remains unhealthy`,
    { timeout: 3000 },
    async () => {
      let closeCalls = 0;
      const sink: AuditSink = () => {};
      sink.close = () => {
        closeCalls++;
        if (failure === 'never settles') return new Promise<void>(() => {});
        if (failure === 'throws') throw new Error('PRIVATE-CLOSE-CANARY');
        return Promise.reject(new Error('PRIVATE-CLOSE-CANARY'));
      };
      const runtime = await SecureRuntime.create({
        config: { allowedTools: [], audit: { timeoutMs: 20 } },
        tools: [],
        audit: sink,
      });
      const first = runtime.close();
      assert.equal(runtime.close(), first);
      await assert.rejects(first, {
        name: 'RuntimeFailure',
        message: 'audit_unavailable',
        code: 'audit_unavailable',
      });
      await assert.rejects(runtime.close(), { message: 'audit_unavailable' });
      assert.equal(closeCalls, 1);
      assert.equal(runtime.audit.healthy, false);
      assert.equal(runtime.audit.state.failures, 1);
      await assert.rejects(runtime.audit.write(event), { message: 'audit_unavailable' });
    },
  );

test(
  'close preserves the pending-write count when the sink hook completes',
  { timeout: 3000 },
  async () => {
    let finishWrite: () => void = () => {};
    let closeCalls = 0;
    const sink: AuditSink = () =>
      new Promise<void>((resolve) => {
        finishWrite = resolve;
      });
    sink.close = () => {
      closeCalls++;
    };
    const dispatcher = new AuditDispatcher(sink, 4, 20);
    const writeFailure = assert.rejects(dispatcher.write(event), { message: 'audit_unavailable' });
    assert.equal(await dispatcher.close(), 1);
    assert.equal(dispatcher.state.pending, 1);
    assert.equal(closeCalls, 1);
    finishWrite();
    await writeFailure;
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(await dispatcher.close(), 0);
    assert.equal(closeCalls, 1);
  },
);
