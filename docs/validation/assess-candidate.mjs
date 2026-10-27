import assert from 'node:assert/strict';
import { createReadStream } from 'node:fs';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: Object.fromEntries(
    ['journal', 'calls', 'stdio', 'http', 'stdio-exit', 'http-exit', 'output'].map((name) => [
      name,
      { type: 'string' },
    ]),
  ),
});
assert.ok(values.journal, 'Supply the durable journal');
const maximumBytes = 256 * 1024 * 1024;
assert.ok((await stat(values.journal)).size <= maximumBytes);
const allowedKeys = new Set([
  'schema',
  'time',
  'requestId',
  'actor',
  'tool',
  'outcome',
  'durationMs',
  'kind',
  'endpoint',
  'method',
  'status',
]);
const expectedOutcomes = {
  http: new Set(['received', 'response', 'completed']),
  tool: new Set(['allowed', 'success', 'denied']),
  protocol: new Set(['invalid_params', 'tool_rejected']),
};
const active = new Map();
const completed = new Set();
const actors = new Set();
const counts = {};
const digest = createHash('sha256');
let records = 0,
  bytes = 0,
  peakOpenRequests = 0;
function record(line) {
  assert.ok(line.length > 0 && line.length <= 4096, 'Journal record size');
  let event;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(line);
    assert.ok(
      ![
        'A bounded HTTP load document.',
        'document.txt',
        '../outside',
        'load-user-',
        'Bearer ',
        'PRIVATE KEY',
      ].some((sentinel) => text.includes(sentinel)),
      'Content or identity sentinel in journal',
    );
    assert.doesNotMatch(text, /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
    event = JSON.parse(text);
  } catch {
    throw new Error('Invalid journal JSON or UTF-8');
  }
  assert.equal(event.schema, 1);
  assert.ok(
    Object.keys(event).every((key) => allowedKeys.has(key)),
    'Unexpected content field',
  );
  assert.match(event.requestId, /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/);
  assert.ok(event.actor === 'anonymous' || /^[a-f0-9]{64}$/.test(event.actor));
  assert.ok(['unknown', 'documents_read', 'policy_status'].includes(event.tool));
  assert.ok(
    Number.isFinite(Date.parse(event.time)) &&
      Number.isInteger(event.durationMs) &&
      event.durationMs >= 0,
  );
  assert.ok(expectedOutcomes[event.kind]?.has(event.outcome), 'Unexpected audit outcome');
  if (event.kind === 'http') {
    assert.ok(['mcp', 'metrics', 'health'].includes(event.endpoint));
    assert.ok(['GET', 'POST'].includes(event.method));
    if (event.outcome !== 'received') assert.equal(event.status, 200);
  } else
    assert.ok(
      event.endpoint === undefined && event.method === undefined && event.status === undefined,
    );
  assert.ok(!completed.has(event.requestId), 'Record after terminal completion');
  const context = active.get(event.requestId) ?? { actor: undefined, outcomes: {} };
  const key = `${event.kind}:${event.outcome}`;
  context.outcomes[key] = (context.outcomes[key] ?? 0) + 1;
  assert.equal(context.outcomes[key], 1, 'Duplicate event for a request');
  if (event.actor !== 'anonymous') {
    if (context.actor) assert.equal(context.actor, event.actor, 'Cross-actor correlation');
    context.actor = event.actor;
  }
  actors.add(event.actor);
  counts[key] = (counts[key] ?? 0) + 1;
  records++;
  active.set(event.requestId, context);
  peakOpenRequests = Math.max(peakOpenRequests, active.size);
  assert.ok(active.size <= 128 && completed.size <= 100_000, 'Assessment bounds exceeded');
  if (key === 'http:completed') {
    assert.equal(context.outcomes['http:received'], 1);
    assert.equal(context.outcomes['http:response'], 1);
    if (context.outcomes['tool:allowed']) {
      assert.equal(
        (context.outcomes['tool:success'] ?? 0) + (context.outcomes['tool:denied'] ?? 0),
        1,
        'Missing tool terminal record',
      );
      assert.equal(
        context.outcomes['protocol:tool_rejected'] ?? 0,
        context.outcomes['tool:denied'] ?? 0,
      );
    } else assert.ok(!context.outcomes['tool:success'] && !context.outcomes['tool:denied']);
    active.delete(event.requestId);
    completed.add(event.requestId);
  }
}
let pending = Buffer.alloc(0);
for await (const chunk of createReadStream(values.journal, { highWaterMark: 64 * 1024 })) {
  bytes += chunk.length;
  assert.ok(bytes <= maximumBytes);
  digest.update(chunk);
  pending = Buffer.concat([pending, chunk]);
  let start = 0,
    end;
  while ((end = pending.indexOf(10, start)) !== -1) {
    record(pending.subarray(start, end));
    start = end + 1;
  }
  pending = pending.subarray(start);
  assert.ok(pending.length <= 4096);
}
assert.equal(pending.length, 0, 'Partial final journal record');
assert.equal(active.size, 0, 'Missing HTTP terminal record');
const http = values.http ? JSON.parse(await readFile(values.http, 'utf8')) : undefined;
const calls = http?.calls ?? Number(values.calls);
assert.ok(Number.isSafeInteger(calls) && calls > 0, 'Supply expected call count or HTTP report');
assert.equal(
  (counts['tool:allowed'] ?? 0) + (counts['protocol:invalid_params'] ?? 0),
  calls,
  'Journal must cover every attempted tool call',
);
const report = {
  journal: {
    sha256: digest.digest('hex'),
    bytes,
    records,
    correlatedRequests: completed.size,
    matchedCalls: calls,
    actorCount: actors.size,
    peakOpenRequests,
    counts,
    contentSentinelsAbsent: true,
  },
};
function assess(result, transport) {
  assert.equal(result.node, 'v24.22.1');
  assert.equal(result.failures, 0);
  assert.equal(result.concurrency, 4);
  assert.ok(result.durationSeconds >= 3600 && result.durationSeconds < 3660);
  assert.ok(result.p95Ms < (transport === 'stdio' ? 50 : 100));
  assert.ok(
    result.memory.every(
      (sample) => sample.rssKiB > 0 && sample.rssKiB < 512 * 1024 && sample.descriptors < 64,
    ),
  );
  const median = (samples) => {
    assert.ok(samples.length >= 50);
    const sorted = samples.map((s) => s.rssKiB).sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  const early = median(
    result.memory.filter((sample) => sample.elapsedSeconds >= 600 && sample.elapsedSeconds < 1200),
  );
  const late = median(
    result.memory.filter((sample) => sample.elapsedSeconds >= result.durationSeconds - 600),
  );
  assert.ok(late - early < 64 * 1024);
  if (transport === 'stdio') assert.deepEqual(result.serverExit, { code: 0, signal: null });
  else {
    assert.equal(result.serverExit, 0);
    assert.equal(result.readinessStatus, 200);
    assert.equal(result.auditState.failures, 0);
    assert.equal(result.auditState.dropped, 0);
    assert.equal(result.workerIntervalMs, 200);
    assert.ok(result.readyMs < 2000 && result.audit.includes('fsync'));
  }
  return {
    result: 'pass',
    calls: result.calls,
    durationSeconds: result.durationSeconds,
    p95Ms: result.p95Ms,
    peakRssMiB: Math.max(...result.memory.map((s) => s.rssKiB)) / 1024,
    peakDescriptors: Math.max(...result.memory.map((s) => s.descriptors)),
    medianGrowthMiB: (late - early) / 1024,
    serverExit: result.serverExit,
  };
}
if (values.stdio || http) {
  assert.ok(values.stdio && http && values['stdio-exit'] && values['http-exit']);
  const stdio = JSON.parse(await readFile(values.stdio, 'utf8'));
  for (const key of ['stdio-exit', 'http-exit'])
    assert.equal((await readFile(values[key], 'utf8')).trim(), '0');
  report.stdio = assess(stdio, 'stdio');
  report.http = assess(http, 'http');
  assert.equal(
    (counts['tool:denied'] ?? 0) + (counts['protocol:invalid_params'] ?? 0),
    http.deniedCalls,
  );
}
if (values.output) await writeFile(values.output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
