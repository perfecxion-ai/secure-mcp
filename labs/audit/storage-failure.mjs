import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { SecureRuntime } from '../../dist/index.js';

const image =
  'node:24-bookworm-slim@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205';
const name = 'mcp-storage-' + randomBytes(6).toString('hex');
const directory = await mkdtemp(join(tmpdir(), 'mcp-storage-'));
const docker = (...args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
let runtime,
  started = false;
try {
  docker(
    'run',
    '-d',
    '--name',
    name,
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges',
    '--user',
    `${process.getuid()}:${process.getgid()}`,
    '--memory',
    '128m',
    '--cpus',
    '1',
    '--tmpfs',
    `/journal:rw,size=64k,mode=0700,uid=${process.getuid()},gid=${process.getgid()}`,
    '-v',
    `${directory}:/sockets`,
    '-v',
    `${resolve('examples/audit-collector.mjs')}:/collector.mjs:ro`,
    '--entrypoint',
    'node',
    image,
    '/collector.mjs',
    '--socket',
    '/sockets/collector.sock',
    '--journal',
    '/journal/events.jsonl',
  );
  started = true;
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (docker('logs', name).includes('ready')) {
      ready = true;
      break;
    }
    await delay(50);
  }
  assert.ok(ready);
  runtime = await SecureRuntime.create({
    config: {
      allowedTools: ['policy_status'],
      audit: { socketPath: join(directory, 'collector.sock') },
    },
  });
  let successfulCalls = 0,
    failed = false;
  for (let i = 0; i < 1000; i++) {
    const result = await runtime.invoke(runtime.localPrincipal(), 'policy_status', {});
    if (result.isError) {
      assert.equal(result.content[0].text, 'audit_unavailable');
      failed = true;
      break;
    }
    successfulCalls++;
  }
  assert.ok(successfulCalls > 0 && failed);
  assert.equal(runtime.audit.healthy, false);
  // Probe the same filesystem independently to establish OS-level ENOSPC,
  // rather than relying on the collector's configured journal-size limit.
  const probe = JSON.parse(
    docker(
      'exec',
      name,
      'node',
      '--input-type=module',
      '-e',
      "import {writeFile,stat} from 'node:fs/promises'; let code; try {await writeFile('/journal/probe',Buffer.alloc(65536));} catch(e){code=e.code;} console.log(JSON.stringify({code,journalBytes:(await stat('/journal/events.jsonl')).size}));",
    ),
  );
  assert.equal(probe.code, 'ENOSPC');
  assert.ok(probe.journalBytes <= 65_536);
  const report = {
    node: process.version,
    image,
    result: 'pass',
    successfulCallsBeforeFull: successfulCalls,
    filesystemBytes: 65_536,
    journalBytes: probe.journalBytes,
    operatingSystemError: probe.code,
    applicationJournalLimitBytes: 268_435_456,
    auditState: runtime.audit.state,
    limitation: 'tmpfs capacity fault; not a power-loss persistence test',
  };
  if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await runtime?.close();
  if (started) docker('rm', '-f', name);
  await rm(directory, { recursive: true, force: true });
}
