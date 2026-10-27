import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { SecureRuntime } from '../../dist/index.js';
const directory = await mkdtemp(join(tmpdir(), 'mcp-audit-timing-'));
const socket = join(directory, 'collector.sock');
const child = spawn(process.execPath, [resolve('examples/audit-collector.mjs'), '--socket', socket, '--journal', join(directory, 'events.jsonl')], { stdio: ['ignore', 'pipe', 'ignore'] });
try {
  await once(child.stdout, 'data');
  const runs = [];
  for (const durable of [false, true]) {
    const runtime = await SecureRuntime.create({ config: { allowedTools: ['policy_status'], audit: { socketPath: socket } }, ...(durable ? {} : { audit: () => {} }) });
    try {
      const samples = [];
      for (let i = 0; i < 1050; i++) {
        const start = performance.now();
        assert.equal((await runtime.invoke(runtime.localPrincipal(), 'policy_status', {})).isError, undefined);
        if (i >= 50) samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      runs.push({ audit: durable ? 'socket collector, two fsync acknowledgements per call' : 'no-op sink', calls: samples.length, meanMs: samples.reduce((a, b) => a + b) / samples.length, p50Ms: samples[500], p95Ms: samples[950] });
      assert.equal(runtime.audit.healthy, true);
    } finally { await runtime.close(); }
  }
  const report = { node: process.version, workload: 'Identical in-process policy_status calls; 50 warmup calls then 1000 measured sequential calls; no transport', runs, meanOverheadMs: runs[1].meanMs - runs[0].meanMs };
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  const exited = once(child, 'exit'); child.kill('SIGTERM'); await exited;
  await rm(directory, { recursive: true, force: true });
}
