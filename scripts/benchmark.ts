import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { join, resolve } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';

const seconds = Number(process.env.BENCH_SECONDS ?? '60');
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 7200)
  throw new Error('BENCH_SECONDS must be 1..7200');
const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-bench-'));
await writeFile(join(directory, 'document.txt'), 'A bounded benchmark document.\n');
const client = new Client(
  { name: 'secure-mcp-benchmark', version: '1.0.0' },
  { versionNegotiation: { mode: { pin: '2026-07-28' } } },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [resolve('dist/cli.js'), '--workspace', directory],
  stderr: 'ignore',
});
const latencies: number[] = [];
const memory: { elapsedSeconds: number; rssKiB: number; descriptors: number }[] = [];
let calls = 0,
  failures = 0;
const boot = performance.now();
try {
  await client.connect(transport);
  const startupMs = performance.now() - boot;
  const started = performance.now(),
    end = started + seconds * 1000;
  const memorySample = async () => {
    if (!transport.pid) return;
    const status = await readFile(`/proc/${transport.pid}/status`, 'utf8');
    const { readdir } = await import('node:fs/promises');
    memory.push({
      elapsedSeconds: Math.round((performance.now() - started) / 1000),
      rssKiB: Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1]),
      descriptors: (await readdir(`/proc/${transport.pid}/fd`)).length,
    });
  };
  await memorySample();
  const sampler = setInterval(() => {
    void memorySample().catch(() => {});
  }, 10_000);
  try {
    await Promise.all(
      Array.from({ length: 4 }, async () => {
        while (performance.now() < end) {
          const start = performance.now();
          const denied = calls % 10 === 0;
          try {
            const result = await client.callTool({
              name: 'documents_read',
              arguments: { path: denied ? '../outside' : 'document.txt' },
            });
            if (!!result.isError !== denied) failures++;
          } catch {
            failures++;
          }
          calls++;
          // A bounded rolling sample prevents the measurement process from growing without limit.
          latencies[calls % 10_000] = performance.now() - start;
        }
      }),
    );
  } finally {
    clearInterval(sampler);
  }
  await memorySample();
  const sorted = latencies.filter(Number.isFinite).sort((a, b) => a - b);
  const report = {
    date: new Date().toISOString(),
    node: process.version,
    architecture: process.arch,
    cpu: cpus()[0]?.model,
    protocol: '2026-07-28',
    transport: 'stdio',
    concurrency: 4,
    audit: 'JSON events to /dev/null',
    workload: '29-byte local document; 10% denied traversal attempts; last 10000 calls sampled',
    durationSeconds: (performance.now() - started) / 1000,
    calls,
    failures,
    startupMs,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.floor(sorted.length * 0.95)],
    memory,
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  if (failures) process.exitCode = 1;
} finally {
  await client.close();
  await rm(directory, { recursive: true, force: true });
}
