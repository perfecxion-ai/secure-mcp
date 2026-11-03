import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { AuditDispatcher } from '../../dist/audit.js';
import { socketAuditSink } from '../../dist/collector.js';

// Collector transport capacity, separate from HTTP request admission and tool concurrency.
export async function verifyBursts() {
  const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-audit-bursts-'));
  const socket = join(directory, 'audit.sock');
  const journal = join(directory, 'journal.jsonl');
  let collector;
  let audit;
  const sizes = [16, 32, 64, 256, 1024];
  let count = 0;
  try {
    collector = spawn(process.execPath, [resolve('examples/audit-collector.mjs'), '--socket', socket, '--journal', journal], { stdio: ['ignore', 'pipe', 'pipe'] });
    const ready = await Promise.race([once(collector.stdout, 'data'), once(collector, 'exit').then(() => { throw new Error('Collector exited before ready'); })]);
    assert.match(String(ready[0]), /ready/);
    audit = new AuditDispatcher(socketAuditSink(socket), 1024, 1000);
    for (const size of sizes) {
      await Promise.all(Array.from({ length: size }, () => audit.write({
        schema: 1, time: new Date().toISOString(), requestId: `burst-${count++}`,
        actor: 'anonymous', tool: 'unknown', outcome: 'burst_fixture', durationMs: 0,
      })));
      assert.equal(audit.healthy, true);
      assert.equal(audit.state.pending, 0);
    }
    assert.equal(await audit.close(), 0);
    const stopped = once(collector, 'exit');
    collector.kill('SIGKILL');
    const [, signal] = await stopped;
    assert.equal(signal, 'SIGKILL');
    collector = undefined;
    const lines = (await readFile(journal, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(lines.length, count);
    assert.equal(new Set(lines.map((line) => line.requestId)).size, count);
    return { recordBurstSizes: sizes, acknowledgedRecords: count, uniqueJournalRecordsAfterKill: lines.length, auditHealthy: true, delivery: 'bounded persistent FIFO; acknowledgements follow grouped fsync' };
  } finally {
    await audit?.close();
    if (collector) {
      const stopped = once(collector, 'exit');
      collector.kill('SIGKILL');
      await stopped;
    }
    await rm(directory, { recursive: true, force: true });
  }
}
