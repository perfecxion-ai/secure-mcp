import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { SecureRuntime } from '../src/runtime.js';
import type { RuntimeOptions } from '../src/runtime.js';
import type { AuditEvent } from '../src/audit.js';
import type { CallToolResult } from '@modelcontextprotocol/server';

export async function fixture(t: TestContext, options: RuntimeOptions = {}) {
  const workspace = await mkdtemp(join(tmpdir(), 'secure-mcp-test-'));
  await mkdir(join(workspace, 'nested'));
  await writeFile(join(workspace, 'note.txt'), 'Approved document <script>unaltered</script>');
  await writeFile(join(workspace, 'nested', 'note.txt'), 'Nested document');
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const events: AuditEvent[] = [];
  const config = { workspace, ...(options.config as Record<string, unknown> | undefined) };
  const runtime = await SecureRuntime.create({
    ...options,
    config,
    audit:
      options.audit ??
      ((event) => {
        events.push(event);
      }),
  });
  t.after(() => runtime.close());
  return { runtime, workspace, events, principal: runtime.localPrincipal() };
}

export function text(result: CallToolResult): string {
  return result.content
    .filter((item) => item.type === 'text')
    .map((item) => item.text)
    .join('');
}
