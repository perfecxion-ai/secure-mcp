import { test } from 'node:test';
import type { TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import type { Socket } from 'node:net';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setImmediate as turn } from 'node:timers/promises';
import { socketAuditSink } from '../src/collector.js';
import { AuditDispatcher } from '../src/audit.js';
import type { AuditEvent } from '../src/audit.js';

const event: AuditEvent = {
  schema: 1,
  time: 'fixture',
  requestId: 'fixture',
  actor: 'anonymous',
  tool: 'unknown',
  outcome: 'received',
  durationMs: 0,
};

async function fixture(t: TestContext, receive: (socket: Socket) => void, timeoutMs = 1000) {
  const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-collector-'));
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.once('close', () => sockets.delete(socket));
    receive(socket);
  });
  const path = join(directory, 'audit.sock');
  server.listen(path);
  await once(server, 'listening');
  const sink = socketAuditSink(path, timeoutMs);
  t.after(async () => {
    await sink.close?.();
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  return { sink };
}

test('persistent sink maps split and coalesced ACKs to FIFO records on one connection', async (t) => {
  let connections = 0;
  let connection: Socket | undefined;
  let frames = 0;
  let received!: () => void;
  const threeFrames = new Promise<void>((resolve) => {
    received = resolve;
  });
  const { sink } = await fixture(t, (socket) => {
    connections++;
    connection = socket;
    socket.on('data', (chunk: Buffer) => {
      frames += chunk.filter((value) => value === 10).length;
      if (frames === 3) received();
      if (frames === 4) socket.write(Buffer.from([6]));
    });
  });
  const completed: number[] = [];
  const work = [0, 1, 2].map((index) =>
    Promise.resolve(sink({ ...event, requestId: String(index) })).then(() => completed.push(index)),
  );
  await threeFrames;
  connection!.write(Buffer.from([6]));
  await work[0];
  assert.deepEqual(completed, [0]);
  connection!.write(Buffer.from([6, 6]));
  await Promise.all(work);
  assert.deepEqual(completed, [0, 1, 2]);
  await sink(event);
  assert.equal(connections, 1);
});

test('disconnect with outstanding records rejects all deliveries without reconnecting', async (t) => {
  let connections = 0;
  const { sink } = await fixture(t, (socket) => {
    connections++;
    socket.once('data', () => socket.destroy());
  });
  const audit = new AuditDispatcher(sink, 64, 1000);
  const outcomes = await Promise.allSettled(Array.from({ length: 32 }, () => audit.write(event)));
  assert.ok(outcomes.every((result) => result.status === 'rejected'));
  assert.equal(audit.healthy, false);
  await assert.rejects(Promise.resolve(sink(event)), /audit_unavailable/);
  assert.equal(connections, 1);
});

test('idle collector closure may reconnect because no record needs retrying', async (t) => {
  let connections = 0;
  let closed!: () => void;
  const firstClosed = new Promise<void>((resolve) => {
    closed = resolve;
  });
  const { sink } = await fixture(t, (socket) => {
    connections++;
    if (connections === 1) socket.once('close', closed);
    socket.once('data', () => socket.end(Buffer.from([6])));
  });
  await sink(event);
  await firstClosed;
  await sink(event);
  assert.equal(connections, 2);
});

test('invalid and excessive ACKs fail the whole unacknowledged stream', async (t) => {
  for (const reply of [Buffer.from([6, 7]), Buffer.from([6, 6, 6])]) {
    await t.test(reply.toString('hex'), async (t) => {
      const { sink } = await fixture(t, (socket) => socket.once('data', () => socket.write(reply)));
      const outcomes = await Promise.allSettled([sink(event), sink(event)]);
      assert.ok(outcomes.every((result) => result.status === 'rejected'));
      await assert.rejects(Promise.resolve(sink(event)), /audit_unavailable/);
    });
  }
});

test('unacknowledged delivery times out and does not retry on another connection', async (t) => {
  let connections = 0;
  const { sink } = await fixture(
    t,
    (socket) => {
      connections++;
      socket.resume();
    },
    30,
  );
  await assert.rejects(Promise.resolve(sink(event)), /audit_unavailable/);
  await assert.rejects(Promise.resolve(sink(event)), /audit_unavailable/);
  assert.equal(connections, 1);
});

test('sink bounds outstanding records and serialized record size', async (t) => {
  const { sink } = await fixture(t, (socket) => socket.resume(), 5000);
  await assert.rejects(
    Promise.resolve(sink({ ...event, requestId: 'x'.repeat(4096) })),
    /audit_unavailable/,
  );
  const pending = Promise.allSettled(Array.from({ length: 1024 }, () => sink(event)));
  await assert.rejects(Promise.resolve(sink(event)), /audit_unavailable/);
  await sink.close?.();
  assert.ok((await pending).every((result) => result.status === 'rejected'));
});

test('dispatcher drains acknowledged work before closing its persistent sink', async (t) => {
  let connection!: Socket;
  let ready!: () => void;
  const received = new Promise<void>((resolve) => {
    ready = resolve;
  });
  const { sink } = await fixture(t, (socket) => {
    connection = socket;
    socket.once('data', ready);
  });
  let closes = 0;
  const close = sink.close!;
  sink.close = () => {
    closes++;
    return close();
  };
  const audit = new AuditDispatcher(sink);
  const written = audit.write(event);
  await received;
  const drained = audit.close();
  await turn();
  assert.equal(connection.destroyed, false);
  const disconnected = once(connection, 'close');
  connection.write(Buffer.from([6]));
  await written;
  assert.equal(await drained, 0);
  assert.equal(await audit.close(), 0);
  assert.equal(closes, 1);
  await disconnected;
  await assert.rejects(Promise.resolve(sink(event)), /audit_unavailable/);
});

test(
  'reference collector never acknowledges records when the journal fsync fails',
  { timeout: 10_000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-fsync-failure-'));
    const socket = join(directory, 'audit.sock');
    const journal = join(directory, 'journal.jsonl');
    const preload = join(directory, 'fail-sync.mjs');
    // Fault injection targets fsync after startup. The actual collector and append run unchanged.
    await writeFile(
      preload,
      `
import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
const open = fs.open;
fs.open = async (...args) => {
  const file = await open(...args);
  if (args[0] === process.env.AUDIT_TEST_JOURNAL) {
    const sync = file.sync.bind(file);
    let startup = true;
    file.sync = async () => {
      if (!startup) throw new Error('injected fsync failure');
      startup = false;
      return sync();
    };
  }
  return file;
};
syncBuiltinESMExports();
`,
    );
    const child = spawn(
      process.execPath,
      [
        '--import',
        preload,
        resolve('examples/audit-collector.mjs'),
        '--socket',
        socket,
        '--journal',
        journal,
      ],
      { env: { ...process.env, AUDIT_TEST_JOURNAL: journal }, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    const sink = socketAuditSink(socket);
    t.after(async () => {
      await sink.close?.();
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGTERM');
        await exited;
      }
      await rm(directory, { recursive: true, force: true });
    });
    const ready = await Promise.race([
      once(child.stdout!, 'data'),
      once(child, 'exit').then(() => {
        throw new Error('collector exited before ready');
      }),
    ]);
    assert.match(String(ready[0]), /ready/);
    const audit = new AuditDispatcher(sink);
    const outcomes = await Promise.allSettled(Array.from({ length: 16 }, () => audit.write(event)));
    assert.ok(outcomes.every((outcome) => outcome.status === 'rejected'));
    assert.equal(audit.healthy, false);
    assert.ok(
      (await readFile(journal, 'utf8')).includes('fixture'),
      'Append happened before the injected fsync failure',
    );
    await assert.rejects(audit.write(event), /audit_unavailable/);
  },
);
