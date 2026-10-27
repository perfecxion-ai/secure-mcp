import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { once } from 'node:events';
import { SecureRuntime, socketAuditSink } from '../../dist/index.js';

const directory = await mkdtemp(join(tmpdir(), 'mcp-audit-'));
const socket = join(directory, 'audit.sock');
const journal = join(directory, 'journal.jsonl');
let child;
let runtime;
let blocker;
const sockets = new Set();
let total = 0;
const report = { node: process.version, checks: [] };
async function start(limit = 8 * 1024 * 1024) {
  child = spawn(process.execPath, [resolve('examples/audit-collector.mjs'), '--socket', socket, '--journal', journal, '--max-bytes', String(limit)], { stdio: ['ignore', 'pipe', 'pipe'] });
  const ready = await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error('collector exited before ready'); })]);
  assert.match(String(ready[0]), /ready/);
}
async function stop(signal = 'SIGTERM') {
  const exited = once(child, 'exit'); child.kill(signal); const [code, exitSignal] = await exited;
  assert.ok(signal === 'SIGKILL' ? exitSignal === signal : code === 0);
  child = undefined;
  if (signal === 'SIGKILL') await unlink(socket);
}
async function create(timeoutMs = 1000) {
  return SecureRuntime.create({ config: { allowedTools: ['policy_status'], audit: { socketPath: socket, timeoutMs, maxPending: 64 } } });
}
try {
  await start();
  runtime = await create();
  const principal = { issuer: 'fixture', subject: 'private-subject-sentinel', scopes: ['policy:read'] };
  for (let batch = 0; batch < 50; batch++) {
    const results = await Promise.all(Array.from({ length: 8 }, () => runtime.invoke(principal, 'policy_status', {})));
    assert.ok(results.every((result) => !result.isError), JSON.stringify({ audit: runtime.audit.state, failures: results.filter((result) => result.isError).map((result) => result.content[0].text) }));
    total += results.length;
  }
  assert.equal(runtime.audit.healthy, true);
  await runtime.close();
  await stop('SIGKILL');
  let lines = (await readFile(journal, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, total * 2);
  assert.ok(!JSON.stringify(lines).includes('sentinel'));
  report.checks.push('400 calls acknowledged after file sync and retained across collector kill');
  await start();
  runtime = await create();
  assert.equal((await runtime.invoke(principal, 'policy_status', {})).isError, undefined);
  total++;
  await runtime.close();
  await stop();
  lines = (await readFile(journal, 'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, total * 2);
  report.checks.push('restart appends without losing prior records');
  await start(Buffer.byteLength(await readFile(journal)) + 1);
  runtime = await create();
  assert.equal((await runtime.invoke(principal, 'policy_status', {})).isError, true);
  assert.equal(runtime.audit.healthy, false);
  await runtime.close();
  await stop();
  report.checks.push('journal capacity failure denies work and latches readiness');
  blocker = createServer((client) => { sockets.add(client); client.on('error', () => {}); client.once('close', () => sockets.delete(client)); });
  await new Promise((resolve) => blocker.listen(socket, resolve));
  runtime = await create(200);
  const startTime = performance.now();
  const results = await Promise.all(Array.from({ length: 200 }, () => runtime.invoke(principal, 'policy_status', {})));
  assert.ok(results.every((result) => result.isError));
  assert.ok(performance.now() - startTime < 2000);
  assert.equal(runtime.audit.healthy, false);
  assert.ok(runtime.audit.state.pending <= 64);
  report.checks.push('blocked collector and 200 concurrent calls remain bounded and fail closed');
  report.callsWithDurableAcknowledgement = total;
  report.journalRecords = lines.length;
  const output = process.argv[2];
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await runtime?.close();
  if (child) await stop();
  for (const client of sockets) client.destroy();
  if (blocker) await new Promise((resolve) => blocker.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
