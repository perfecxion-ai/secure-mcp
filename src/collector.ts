import { connect } from 'node:net';
import type { AuditSink } from './audit.js';

// Local operator-owned Unix socket. The collector acknowledges only after fsync.
export function socketAuditSink(path: string, timeoutMs = 1000): AuditSink {
  return (event) =>
    new Promise<void>((resolve, reject) => {
      const socket = connect({ path });
      let acknowledged = false;
      const timer = setTimeout(() => socket.destroy(new Error('audit_timeout')), timeoutMs);
      socket.once('connect', () => socket.write(JSON.stringify(event) + '\n'));
      socket.once('data', (data) => {
        acknowledged = data.length === 1 && data[0] === 6;
        socket.destroy();
      });
      socket.once('error', () => {});
      socket.once('close', () => {
        clearTimeout(timer);
        if (acknowledged) resolve();
        else reject(new Error('audit_unavailable'));
      });
    });
}
