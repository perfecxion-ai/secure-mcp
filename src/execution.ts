import { RuntimeFailure } from './errors.js';
export class ExecutionController {
  private readonly active = new Set<{ controller: AbortController; settled: Promise<void> }>();
  private closing = false;
  constructor(
    private readonly maxConcurrent: number,
    private readonly timeoutMs: number,
  ) {}
  get running(): number {
    return this.active.size;
  }
  async run<T>(operation: (signal: AbortSignal) => Promise<T>, caller: AbortSignal): Promise<T> {
    if (this.closing) throw new RuntimeFailure('shutting_down');
    if (caller.aborted) throw new RuntimeFailure('cancelled');
    if (this.active.size >= this.maxConcurrent) throw new RuntimeFailure('busy');
    const controller = new AbortController();
    const signal = AbortSignal.any([caller, controller.signal]);
    const timer = setTimeout(() => controller.abort(new RuntimeFailure('timeout')), this.timeoutMs);
    const entry = { controller, settled: Promise.resolve() };
    this.active.add(entry);
    const work = Promise.resolve().then(() => {
      signal.throwIfAborted();
      return operation(signal);
    });
    // Hold capacity until underlying work ends, even if its caller timed out.
    entry.settled = work
      .then(
        () => undefined,
        () => undefined,
      )
      .finally(() => {
        clearTimeout(timer);
        this.active.delete(entry);
      });
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () =>
        reject(
          controller.signal.reason instanceof RuntimeFailure
            ? controller.signal.reason
            : new RuntimeFailure('cancelled'),
        );
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    });
    try {
      return await Promise.race([work, aborted]);
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  }
  async close(graceMs: number): Promise<number> {
    this.closing = true;
    for (const entry of this.active) entry.controller.abort(new RuntimeFailure('shutting_down'));
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.all([...this.active].map((entry) => entry.settled)),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, graceMs);
      }),
    ]);
    clearTimeout(timer);
    return this.active.size;
  }
}
