import { constants } from 'node:fs';
import { open, realpath } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/server';
import type { Principal, ToolPolicy } from './policy.js';
import type { RuntimeConfig } from './config.js';
import { RuntimeFailure } from './errors.js';

export interface ToolContext {
  readonly principal: Principal;
  readonly signal: AbortSignal;
}
export interface ToolDefinition extends ToolPolicy {
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  invoke(args: Record<string, unknown>, context: ToolContext): Promise<CallToolResult>;
}

export function defineTool<S extends z.ZodRawShape>(
  definition: ToolPolicy & {
    description: string;
    inputSchema: z.ZodObject<S>;
    invoke(args: z.output<z.ZodObject<S>>, context: ToolContext): Promise<CallToolResult>;
  },
): ToolDefinition {
  return {
    ...definition,
    invoke: (args, context) => definition.invoke(definition.inputSchema.parse(args), context),
  };
}

export function textResult(text: string): CallToolResult {
  return { content: [{ type: 'text', text }] };
}

export async function createDocumentTool(
  workspace: string,
  maxBytes: number,
): Promise<{ tool: ToolDefinition; close(): Promise<void> }> {
  if (process.platform !== 'linux')
    throw new Error('Document confinement currently requires Linux /proc');
  const root = await open(
    await realpath(workspace),
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  const tool = defineTool({
    name: 'documents_read',
    description:
      'Read one UTF-8 document relative to the operator-approved workspace. Hidden paths and symlinks are denied.',
    requiredScopes: ['documents:read'],
    readOnly: true,
    inputSchema: z.strictObject({ path: z.string().min(1).max(1024) }),
    async invoke({ path }, { signal }) {
      const parts = path.split('/');
      if (
        isAbsolute(path) ||
        path.includes('\\') ||
        path.includes('\0') ||
        parts.some((part) => !part || part.startsWith('.'))
      )
        throw new RuntimeFailure('denied');
      const opened: FileHandle[] = [];
      let parent = root;
      try {
        for (const [index, part] of parts.entries()) {
          signal.throwIfAborted();
          const final = index === parts.length - 1;
          const handle = await open(
            `/proc/self/fd/${parent.fd}/${part}`,
            constants.O_RDONLY |
              constants.O_NOFOLLOW |
              constants.O_NONBLOCK |
              (final ? 0 : constants.O_DIRECTORY),
          );
          opened.push(handle);
          parent = handle;
        }
        const stat = await parent.stat();
        if (!stat.isFile()) throw new RuntimeFailure('denied');
        if (stat.size > maxBytes) throw new RuntimeFailure('output_too_large');
        const buffer = Buffer.alloc(maxBytes + 1);
        let total = 0;
        while (total < buffer.length) {
          signal.throwIfAborted();
          const { bytesRead } = await parent.read(buffer, total, buffer.length - total, null);
          if (bytesRead === 0) break;
          total += bytesRead;
        }
        if (total > maxBytes) throw new RuntimeFailure('output_too_large');
        return textResult(
          new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, total)),
        );
      } catch (error) {
        if (error instanceof RuntimeFailure) throw error;
        if (signal.aborted) throw new RuntimeFailure('cancelled');
        // Do not disclose absolute paths or filesystem error messages.
        throw new RuntimeFailure('not_found');
      } finally {
        await Promise.all(opened.map((handle) => handle.close()));
      }
    },
  });
  return { tool, close: () => root.close() };
}

export function createApiTool(config: NonNullable<RuntimeConfig['api']>): ToolDefinition {
  return defineTool({
    name: 'api_read',
    description:
      'Read the single API URL fixed by the operator. No caller-supplied URLs or forwarded credentials.',
    requiredScopes: ['api:read'],
    readOnly: true,
    inputSchema: z.strictObject({}),
    async invoke(_args, { signal }) {
      try {
        const response = await fetch(config.url, {
          method: 'GET',
          redirect: 'error',
          signal,
          headers: { accept: 'application/json, text/plain' },
        });
        if (!response.ok || !response.body) {
          await response.body?.cancel();
          throw new RuntimeFailure('upstream_failed');
        }
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let size = 0;
        try {
          while (true) {
            signal.throwIfAborted();
            const { value, done } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > config.maxBytes) throw new RuntimeFailure('output_too_large');
            chunks.push(value);
          }
          return textResult(
            new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)),
          );
        } finally {
          await reader.cancel();
          reader.releaseLock();
        }
      } catch (error) {
        if (error instanceof RuntimeFailure) throw error;
        if (signal.aborted) throw new RuntimeFailure('cancelled');
        throw new RuntimeFailure('upstream_failed');
      }
    },
  });
}
