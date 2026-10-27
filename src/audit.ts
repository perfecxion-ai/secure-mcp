import { createHash, randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import type { Principal } from './policy.js';
import { RuntimeFailure } from './errors.js';
import { McpServer } from '@modelcontextprotocol/server';
import type { Transport } from '@modelcontextprotocol/server';
export interface AuditEvent {
  readonly schema: 1;
  readonly time: string;
  readonly requestId: string;
  readonly actor: string;
  readonly tool: string;
  readonly outcome: string;
  readonly durationMs: number;
  readonly kind?: 'tool' | 'http' | 'protocol';
  readonly endpoint?: 'mcp' | 'metrics' | 'health' | 'metadata' | 'other';
  readonly method?: 'GET' | 'POST' | 'DELETE' | 'OPTIONS' | 'other';
  readonly status?: number;
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
export function auditContext(principal: Principal, tool: string, requestId: string = randomUUID()) {
  return {
    requestId,
    tool,
    actor: createHash('sha256')
      .update(principal.issuer)
      .update('\0')
      .update(principal.subject)
      .digest('hex'),
  };
}

// No queue: a blocked sink retains its slot even after its caller times out.
// Delivery loss latches readiness off until restart so failures cannot disappear.
export class AuditDispatcher {
  private readonly pending = new Set<Promise<void>>();
  private failures = 0;
  private dropped = 0;
  constructor(
    private readonly sink: AuditSink,
    private readonly capacity = 64,
    private readonly timeoutMs = 1000,
  ) {}
  get healthy(): boolean {
    return this.failures === 0 && this.dropped === 0;
  }
  get state() {
    return { pending: this.pending.size, failures: this.failures, dropped: this.dropped };
  }
  async write(event: AuditEvent): Promise<void> {
    if (!this.healthy || this.pending.size >= this.capacity) {
      this.dropped++;
      throw new RuntimeFailure('audit_unavailable');
    }
    const work = Promise.resolve().then(() => this.sink(event));
    this.pending.add(work);
    void work.finally(() => this.pending.delete(work)).catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new RuntimeFailure('audit_unavailable')), this.timeoutMs);
        }),
      ]);
    } catch {
      this.failures++;
      throw new RuntimeFailure('audit_unavailable');
    } finally {
      clearTimeout(timer);
    }
  }
  async close(): Promise<number> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled([...this.pending]),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.timeoutMs);
      }),
    ]);
    clearTimeout(timer);
    return this.pending.size;
  }
}

// Observe the SDK's structured response before serialization. Never parse or log
// response text, request IDs supplied by clients, error messages, or tool arguments.
export class AuditedMcpServer extends McpServer {
  observeProtocolError?: (code: number) => Promise<void>;
  observeToolRejection?: () => Promise<void>;
  override async connect(transport: Transport): Promise<void> {
    const send = transport.send.bind(transport);
    transport.send = async (message, options) => {
      if ('error' in message) await this.observeProtocolError?.(message.error.code);
      if ('result' in message && message.result.isError === true)
        await this.observeToolRejection?.();
      await send(message, options);
    };
    await super.connect(transport);
  }
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
