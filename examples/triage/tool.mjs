import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import {
  SecureRuntime,
  RuntimeFailure,
  defineTool,
  textResult,
} from '@perfecxion/secure-mcp-server';
import { z } from 'zod';

// Fixed, operator-owned fixtures. Callers select an ID, never a path or URL.
const resources = new Map([
  ['alert', new URL('./fixtures/alert.json', import.meta.url)],
  ['asset', new URL('./fixtures/asset.json', import.meta.url)],
  ['runbook', new URL('./fixtures/runbook.json', import.meta.url)],
  ['restricted', new URL('./fixtures/restricted.json', import.meta.url)],
]);
const grants = new Map([['process\0local', new Set(['alert', 'asset', 'runbook'])]]);
const maxBytes = 8192;

export function triageTool() {
  return defineTool({
    name: 'triage_context_read',
    description: 'Read an approved sanitized alert, asset context or runbook by fixed resource ID.',
    requiredScopes: ['triage:read'],
    readOnly: true,
    inputSchema: z.strictObject({ resource: z.enum(['alert', 'asset', 'runbook', 'restricted']) }),
    async invoke({ resource }, { principal, signal }) {
      // Identity comes from the trusted runtime/transport boundary, not tool input.
      const allowed = grants.get(`${principal.issuer}\0${principal.subject}`);
      if (!allowed?.has(resource)) throw new RuntimeFailure('denied');
      signal.throwIfAborted();
      const file = await open(resources.get(resource), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.size > maxBytes) throw new RuntimeFailure('output_too_large');
        const buffer = Buffer.alloc(maxBytes + 1);
        let length = 0;
        while (length < buffer.length) {
          signal.throwIfAborted();
          const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
          if (!bytesRead) break;
          length += bytesRead;
        }
        signal.throwIfAborted();
        if (length > maxBytes) throw new RuntimeFailure('output_too_large');
        const data = JSON.parse(
          new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length)),
        );
        return textResult(JSON.stringify({ resource, data }));
      } finally {
        await file.close();
      }
    },
  });
}

export function createTriageRuntime(audit) {
  return SecureRuntime.create({
    config: {
      allowedTools: ['triage_context_read'],
      localScopes: ['triage:read'],
      readOnly: true,
      limits: { maxConcurrent: 2, timeoutMs: 1000, maxInputBytes: 1024, maxOutputBytes: 16384 },
    },
    tools: [triageTool()],
    ...(audit && { audit }),
  });
}
