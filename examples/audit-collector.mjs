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
  let pending = 0;
  let healthy = true;
  let tail = Promise.resolve();
  const sockets = new Set();
  server = createServer((socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setTimeout(2000, () => socket.destroy());
    let data = Buffer.alloc(0);
    let accepted = false;
    socket.on('data', (chunk) => {
      if (accepted) {
        socket.destroy();
        return;
      }
      if (data.length + chunk.length > 4096) {
        socket.destroy();
        return;
      }
      data = Buffer.concat([data, chunk]);
      if (!data.includes(10)) return;
      accepted = true;
      if (!healthy || pending >= 64 || data.at(-1) !== 10 || data.indexOf(10) !== data.length - 1) {
        socket.destroy();
        return;
      }
      try {
        const event = JSON.parse(data.toString('utf8'));
        if (event.schema !== 1 || typeof event.requestId !== 'string')
          throw new Error('Invalid record');
      } catch {
        socket.destroy();
        return;
      }
      pending++;
      tail = tail
        .then(async () => {
          if (!healthy || bytes + data.length > maxBytes) throw new Error('Journal unavailable');
          await journal.writeFile(data);
          await journal.sync();
          bytes += data.length;
          socket.end(Buffer.from([6]));
        })
        .catch(() => {
          healthy = false;
          socket.destroy();
        })
        .finally(() => pending--);
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
