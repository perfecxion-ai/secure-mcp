#!/usr/bin/env node
// Minimal local collector for isolated validation. Stop before rotating the journal.
import { createServer } from 'node:net';
import { constants } from 'node:fs';
import { open, chmod, unlink } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    socket: { type: 'string' },
    journal: { type: 'string' },
    'max-bytes': { type: 'string', default: '268435456' },
  },
});
const maxBytes = Number(values['max-bytes']);
if (
  !values.socket?.startsWith('/') ||
  !values.journal?.startsWith('/') ||
  !Number.isSafeInteger(maxBytes) ||
  maxBytes < 1024
)
  throw new Error('Absolute socket/journal paths and a positive journal limit are required');
process.umask(0o077);
let journal;
let server;
let ownsSocket = false;
try {
  journal = await open(
    values.journal,
    constants.O_CREAT |
      constants.O_RDWR |
      constants.O_APPEND |
      constants.O_NOFOLLOW |
      constants.O_NONBLOCK,
    0o600,
  );
  const stat = await journal.stat();
  if (
    !stat.isFile() ||
    stat.nlink !== 1 ||
    stat.uid !== process.getuid() ||
    (stat.mode & 0o077) !== 0
  )
    throw new Error('Journal must be a private, singly-linked regular file owned by this user');
  let bytes = stat.size;
  if (bytes > maxBytes) throw new Error('Journal limit reached');
  if (bytes) {
    const last = Buffer.alloc(1);
    await journal.read(last, 0, 1, bytes - 1);
    if (last[0] !== 10)
      throw new Error('Journal ends with a partial record; preserve and recover it before restart');
  }
  await journal.sync();
  const directory = await open(dirname(values.journal), constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    await directory.sync();
  } finally {
    await directory.close();
  }
  // Bound queued and syncing records together; each frame is at most 4 KiB.
  let pending = 0;
  let healthy = true;
  let flushing = false;
  let tail = Promise.resolve();
  const queue = [];
  const sockets = new Set();
  const flush = () => {
    if (flushing) return;
    flushing = true;
    // Yield once so records arriving in the same turn share an append and fsync.
    tail = new Promise((resolve) => setImmediate(resolve))
      .then(async () => {
        while (queue.length) {
          const batch = queue.splice(0, 64);
          const data = Buffer.concat(batch.map((entry) => entry.data));
          if (!healthy || bytes + data.length > maxBytes) throw new Error('Journal unavailable');
          await journal.writeFile(data);
          await journal.sync();
          bytes += data.length;
          const acknowledgements = new Map();
          for (const { socket } of batch)
            acknowledgements.set(socket, (acknowledgements.get(socket) ?? 0) + 1);
          for (const [socket, count] of acknowledgements) {
            if (socket.destroyed) continue;
            if (socket.writableLength + count > 4096) socket.destroy();
            else socket.write(Buffer.alloc(count, 6));
          }
          pending -= batch.length;
        }
      })
      .catch(() => {
        healthy = false;
        queue.length = 0;
        pending = 0;
        for (const socket of sockets) socket.destroy();
      })
      .finally(() => {
        flushing = false;
      });
  };
  server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(2000, () => socket.destroy());
    let remainder = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      if (!healthy || chunk.length > 1024 * 4096) {
        socket.destroy();
        return;
      }
      const data = Buffer.concat([remainder, chunk]);
      let start = 0;
      for (;;) {
        const newline = data.indexOf(10, start);
        if (newline === -1) break;
        const frame = data.subarray(start, newline + 1);
        if (frame.length > 4096 || pending >= 1024) {
          socket.destroy();
          return;
        }
        try {
          const event = JSON.parse(frame.toString('utf8'));
          if (event.schema !== 1 || typeof event.requestId !== 'string')
            throw new Error('Invalid record');
        } catch {
          socket.destroy();
          return;
        }
        // Copy the frame so a small queued record does not retain a large input chunk.
        queue.push({ data: Buffer.from(frame), socket });
        pending++;
        flush();
        start = newline + 1;
      }
      if (data.length - start > 4096) {
        socket.destroy();
        return;
      }
      remainder = Buffer.from(data.subarray(start));
    });
  });
  server.maxConnections = 64;
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(values.socket, resolve);
  });
  ownsSocket = true;
  await chmod(values.socket, 0o600);
  process.stdout.write('{"status":"ready"}\n');
  await new Promise((resolve) => {
    let stopping = false;
    const stop = () => {
      if (stopping) return;
      stopping = true;
      const forced = setTimeout(() => process.exit(1), 5000);
      server.close(() => {
        clearTimeout(forced);
        resolve();
      });
      for (const socket of sockets) socket.destroy();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
  });
  await tail;
} catch {
  process.stderr.write(
    'audit collector failed; check private paths, journal integrity, capacity, and storage\n',
  );
  process.exitCode = 1;
} finally {
  if (ownsSocket) await unlink(values.socket).catch(() => {});
  await journal?.close();
}
