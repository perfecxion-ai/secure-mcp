import { connect } from 'node:net';
import type { Socket } from 'node:net';
import type { AuditSink } from './audit.js';

// Local operator-owned Unix stream. Each ACK covers one FIFO record after fsync.
// Never retry an unacknowledged record: a disconnect can leave its durability unknown.
export function socketAuditSink(path: string, timeoutMs = 1000): AuditSink {
  const pending: {
    line: Buffer;
    resolve: () => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  }[] = [];
  let socket: Socket | undefined;
  let connected = false;
  let writable = false;
  let sent = 0;
  let failed = false;
  let closed = false;

  const fail = () => {
    failed = true;
    for (const item of pending.splice(0)) {
      clearTimeout(item.timer);
      item.reject(new Error('audit_unavailable'));
    }
    sent = 0;
    socket?.destroy();
  };
  const flush = () => {
    while (socket && connected && writable && sent < pending.length) {
      const item = pending[sent++]!;
      writable = socket.write(item.line);
    }
  };
  const open = () => {
    const current = connect({ path });
    socket = current;
    current.once('connect', () => {
      if (socket !== current) return;
      connected = true;
      writable = true;
      flush();
    });
    current.on('drain', () => {
      if (socket !== current) return;
      writable = true;
      flush();
    });
    current.on('data', (data: Buffer) => {
      if (socket !== current) return;
      if (data.length > sent || data.some((value) => value !== 6)) {
        fail();
        return;
      }
      for (let index = 0; index < data.length; index++) {
        const item = pending.shift()!;
        sent--;
        clearTimeout(item.timer);
        item.resolve();
      }
      if (pending.length === 0) current.unref();
      flush();
    });
    current.on('error', () => {
      if (socket === current && pending.length) fail();
    });
    const disconnected = () => {
      if (socket === current) {
        if (pending.length) fail();
        socket = undefined;
        connected = false;
        writable = false;
      }
    };
    current.once('end', () => {
      disconnected();
      current.destroy();
    });
    current.once('close', disconnected);
  };

  const sink: AuditSink = (event) => {
    if (failed || closed || pending.length >= 1024)
      return Promise.reject(new Error('audit_unavailable'));
    const line = Buffer.from(JSON.stringify(event) + '\n');
    if (line.length > 4096) return Promise.reject(new Error('audit_unavailable'));
    return new Promise<void>((resolve, reject) => {
      pending.push({ line, resolve, reject, timer: setTimeout(fail, timeoutMs) });
      if (!socket) open();
      socket!.ref();
      flush();
    });
  };
  sink.close = () => {
    closed = true;
    if (pending.length) fail();
    else socket?.destroy();
  };
  return sink;
}
