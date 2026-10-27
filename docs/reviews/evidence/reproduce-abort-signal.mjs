// Bound the diagnostic: timeout 120s node --max-old-space-size=256 docs/reviews/evidence/reproduce-abort-signal.mjs
const controller = new AbortController();
const samples = [];
const start = performance.now();
let count = 0;
await new Promise((resolve) => {
  function next() {
    AbortSignal.any([controller.signal]);
    if (++count % 100000 === 0)
      samples.push({ count, elapsedMs: performance.now() - start, ...process.memoryUsage() });
    if (count === 1000000) resolve();
    else setImmediate(next);
  }
  next();
});
console.log(
  JSON.stringify(
    {
      node: process.version,
      scenario:
        'One million discarded AbortSignal.any combinations with a long-lived parent, one per event-loop turn',
      samples,
    },
    null,
    2,
  ),
);
