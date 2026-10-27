import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const seconds = Number(process.env.BENCH_SECONDS ?? '60');
const intervalMs = Number(process.env.BENCH_INTERVAL_MS ?? '0');
assert.ok(Number.isInteger(intervalMs) && intervalMs >= 0 && intervalMs <= 1000);
const auditSocket = process.env.BENCH_AUDIT_SOCKET;
assert.ok(Number.isInteger(seconds) && seconds >= 1 && seconds <= 7200);
const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-http-load-'));
const clients = [];
const memory = [];
const latencies = [];
const failureCounts = {};
const failureSamples = [];
const eventLoop = monitorEventLoopDelay({ resolution: 20 });
eventLoop.enable();
function failed(reason, index, started, error) {
  failures++;
  failureCounts[reason] = (failureCounts[reason] ?? 0) + 1;
  if (failureSamples.length < 20)
    failureSamples.push({
      elapsedSeconds: Math.round((performance.now() - started) / 1000),
      worker: index,
      reason,
      code: Number.isSafeInteger(error?.code) ? error.code : null,
      eventLoopMaxMs: eventLoop.max / 1e6,
    });
}
let processHandle, processExit, sampler;
let lastProgress = 0;
let calls = 0,
  failures = 0,
  deniedCalls = 0,
  tokenIssues = 0,
  keyRequests = 0;
const keys = await generateKeyPair('ES256');
const publicKey = { ...(await exportJWK(keys.publicKey)), kid: 'load-key', alg: 'ES256' };
const issuerServer = createServer((_request, response) => {
  keyRequests++;
  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify({ keys: [publicKey] }));
});
try {
  await new Promise((resolve) => issuerServer.listen(0, '127.0.0.1', resolve));
  const issuer = `http://127.0.0.1:${issuerServer.address().port}`;
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const resource = `http://127.0.0.1:${port}/mcp`;
  await mkdir(join(directory, 'documents'));
  const document = 'A bounded HTTP load document.\n';
  await writeFile(join(directory, 'documents/document.txt'), document);
  await writeFile(
    join(directory, 'config.json'),
    JSON.stringify({
      transport: 'http',
      ...(auditSocket ? { audit: { socketPath: auditSocket } } : {}),
      workspace: join(directory, 'documents'),
      http: { port, resource, issuer, jwksUrl: issuer + '/jwks', algorithms: ['ES256'] },
    }),
  );
  const sha256 = {};
  for (const name of (await readdir('dist')).filter((name) => name.endsWith('.js')).sort())
    sha256[`dist/${name}`] = createHash('sha256')
      .update(await readFile(join('dist', name)))
      .digest('hex');
  const boot = performance.now();
  processHandle = spawn(
    process.execPath,
    [resolve('dist/cli.js'), '--config', join(directory, 'config.json')],
    { stdio: 'ignore' },
  );
  processExit = new Promise((resolve, reject) => {
    processHandle.once('error', reject);
    processHandle.once('exit', (code) => resolve(code));
  });
  let ready = false;
  while (performance.now() - boot < 10_000) {
    if (processHandle.exitCode !== null) throw new Error('HTTP CLI exited during startup');
    try {
      ready = (await fetch(new URL('/health', resource))).ok;
    } catch {
      /* Await listener. */
    }
    if (ready) break;
    await delay(25);
  }
  assert.ok(ready, 'HTTP listener did not become ready');
  for (let index = 0; index < 4; index++) {
    const restricted = index === 3;
    let bearer,
      issuedAt = 0;
    const client = new Client(
      { name: 'http-load-client', version: '1' },
      { versionNegotiation: { mode: { pin: '2026-07-28' } } },
    );
    clients.push(client);
    const transport = new StreamableHTTPClientTransport(new URL(resource), {
      fetch: async (input, init) => {
        const now = Math.floor(Date.now() / 1000);
        if (!bearer || now - issuedAt >= 120) {
          bearer = await new SignJWT({
            sub: `load-user-${index}`,
            iss: issuer,
            aud: resource,
            iat: now,
            exp: now + 300,
            scope: restricted ? 'policy:read' : 'documents:read policy:read',
          })
            .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'load-key' })
            .sign(keys.privateKey);
          issuedAt = now;
          tokenIssues++;
        }
        const headers = new Headers(input instanceof Request ? input.headers : undefined);
        new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
        headers.set('authorization', `Bearer ${bearer}`);
        return fetch(input, { ...init, headers });
      },
    });
    await client.connect(transport);
    assert.deepEqual(
      (await client.listTools()).tools.map((tool) => tool.name).sort(),
      restricted ? ['policy_status'] : ['documents_read', 'policy_status'],
    );
  }
  const readyMs = performance.now() - boot;
  const started = performance.now();
  async function sample() {
    const status = await readFile(`/proc/${processHandle.pid}/status`, 'utf8');
    memory.push({
      elapsedSeconds: Math.round((performance.now() - started) / 1000),
      rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]),
      descriptors: (await readdir(`/proc/${processHandle.pid}/fd`)).length,
      clientRssKiB: Math.round(process.memoryUsage().rss / 1024),
      clientHeapUsedKiB: Math.round(process.memoryUsage().heapUsed / 1024),
    });
  }
  await sample();
  sampler = setInterval(() => {
    void sample()
      .then(() => {
        const latest = memory.at(-1);
        if (process.env.BENCH_PROGRESS === '1' && latest.elapsedSeconds >= lastProgress + 60) {
          lastProgress = latest.elapsedSeconds;
          process.stderr.write(
            JSON.stringify({ progress: latest.elapsedSeconds, calls, failures, memory: latest }) +
              '\n',
          );
        }
      })
      .catch(() => {});
  }, 10_000);
  await Promise.all(
    clients.map(async (client, index) => {
      let iteration = 0;
      const restricted = index === 3;
      while (performance.now() - started < seconds * 1000) {
        if (intervalMs) await delay(intervalMs);
        const denied = iteration++ % 10 === 0;
        const start = performance.now();
        if (denied) deniedCalls++;
        try {
          const result = await client.callTool(
            restricted && !denied
              ? { name: 'policy_status', arguments: {} }
              : {
                  name: 'documents_read',
                  arguments: { path: denied && !restricted ? '../outside' : 'document.txt' },
                },
          );
          if (restricted && denied) failed('hidden_tool_returned', index, started);
          else if (denied) {
            if (!result.isError || result.content[0]?.text !== 'denied')
              failed('traversal_result_mismatch', index, started);
          } else if (restricted) {
            const policy = JSON.parse(result.content[0].text);
            if (result.isError || policy.tools.length !== 1 || policy.tools[0] !== 'policy_status')
              failed('policy_result_mismatch', index, started);
          } else if (result.isError || result.content[0]?.text !== document)
            failed('document_result_mismatch', index, started);
        } catch (error) {
          // A scope-hidden tool must be rejected by the SDK's unknown-tool dispatch.
          if (!(restricted && denied && error.code === -32602))
            failed('request_error', index, started, error);
        }
        calls++;
        latencies[calls % 10_000] = performance.now() - start;
      }
    }),
  );
  clearInterval(sampler);
  await sample();
  const sorted = latencies.filter(Number.isFinite).sort((a, b) => a - b);
  const report = {
    date: new Date().toISOString(),
    node: process.version,
    architecture: process.arch,
    protocol: '2026-07-28',
    transport: 'HTTP on loopback, no TLS',
    concurrency: 4,
    authentication: 'Local ES256 JWT fixtures renewed every 120 seconds; real HTTP JWKS requests',
    audit: auditSocket
      ? 'Unix socket collector, fsync acknowledgement per record'
      : 'JSON events to /dev/null',
    workerIntervalMs: intervalMs,
    workload: 'Three document readers, one policy-only subject; 10% expected denials per worker',
    latencySample: 'Last 10000 calls',
    durationSeconds: (performance.now() - started) / 1000,
    calls,
    failures,
    failureCounts,
    failureSamples,
    driverHeapLimitMiB:
      process.execArgv.find((arg) => arg.startsWith('--max-old-space-size='))?.split('=')[1] ??
      null,
    driverEventLoopDelayMs: {
      p50: eventLoop.percentile(50) / 1e6,
      p99: eventLoop.percentile(99) / 1e6,
      max: eventLoop.max / 1e6,
    },
    deniedCalls,
    tokenIssues,
    keyRequests,
    readyMs,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    memory,
    sha256,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (failures) process.exitCode = 1;
} finally {
  eventLoop.disable();
  clearInterval(sampler);
  await Promise.all(clients.map((client) => client.close()));
  if (processHandle && processHandle.exitCode === null) processHandle.kill('SIGTERM');
  if (processExit) {
    const timer = setTimeout(() => processHandle.kill('SIGKILL'), 6000);
    const code = await processExit;
    clearTimeout(timer);
    if (code !== 0) process.exitCode = 1;
  }
  await new Promise((resolve) => {
    issuerServer.close(() => resolve());
    issuerServer.closeAllConnections();
  });
  await rm(directory, { recursive: true, force: true });
}
