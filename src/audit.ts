import { createHash, randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import type { Principal } from './policy.js';
import { RuntimeFailure } from './errors.js';
export interface AuditEvent {
  readonly schema: 1;
  readonly time: string;
  readonly requestId: string;
  readonly actor: string;
  readonly tool: string;
  readonly outcome: string;
  readonly durationMs: number;
}
export type AuditSink = (event: AuditEvent) => void | Promise<void>;
const watchedStreams = new WeakSet<Writable>();
export function jsonAuditSink(stream: Writable): AuditSink {
  if (!watchedStreams.has(stream)) {
    // Writable failures also emit an error event after the write callback.
    // The callback rejects the operation; consuming the event avoids a process crash.
    stream.on('error', () => {});
    watchedStreams.add(stream);
  }
  return (event) =>
    new Promise<void>((resolve, reject) => {
      stream.write(JSON.stringify(event) + '\n', (error) => (error ? reject(error) : resolve()));
    });
}
export function auditContext(principal: Principal, tool: string) {
  return {
    requestId: randomUUID(),
    tool,
    actor: createHash('sha256')
      .update(principal.issuer)
      .update('\0')
      .update(principal.subject)
      .digest('hex'),
  };
}
export async function record(
  sink: AuditSink,
  context: ReturnType<typeof auditContext>,
  outcome: string,
  start: number,
): Promise<void> {
  try {
    await sink({
      schema: 1,
      time: new Date().toISOString(),
      ...context,
      outcome,
      durationMs: Math.max(0, Math.round(performance.now() - start)),
    });
  } catch {
    throw new RuntimeFailure('audit_unavailable');
  }
}
