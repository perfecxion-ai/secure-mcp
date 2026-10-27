import { McpServer } from '@modelcontextprotocol/server';
import type { CallToolResult } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { parseConfig } from './config.js';
import type { RuntimeConfig } from './config.js';
import { mayInvoke } from './policy.js';
import type { Principal } from './policy.js';
import { auditContext, jsonAuditSink, record } from './audit.js';
import type { AuditSink } from './audit.js';
import { ExecutionController } from './execution.js';
import { failureCode, RuntimeFailure } from './errors.js';
import { deferredInputSchema, withinInputElementLimit } from './input.js';
import { createApiTool, createDocumentTool, defineTool, textResult } from './tools.js';
import type { ToolDefinition } from './tools.js';

export const VERSION = '2.0.0-alpha.1';
export interface RuntimeOptions {
  config?: unknown;
  tools?: readonly ToolDefinition[];
  audit?: AuditSink;
}

export class SecureRuntime {
  readonly config: RuntimeConfig;
  readonly execution: ExecutionController;
  private readonly registry = new Map<string, ToolDefinition>();
  private readonly audit: AuditSink;
  private readonly counts = new Map<string, number>();
  private readonly disposers: (() => Promise<void>)[] = [];
  private closing: Promise<number> | undefined;

  private constructor(options: RuntimeOptions) {
    this.config = parseConfig(options.config ?? {});
    this.execution = new ExecutionController(
      this.config.limits.maxConcurrent,
      this.config.limits.timeoutMs,
    );
    this.audit = options.audit ?? jsonAuditSink(process.stderr);
  }

  static async create(options: RuntimeOptions = {}): Promise<SecureRuntime> {
    const runtime = new SecureRuntime(options);
    try {
      if (options.tools) for (const tool of options.tools) runtime.register(tool);
      else {
        if (runtime.config.allowedTools.includes('documents_read')) {
          const documents = await createDocumentTool(
            runtime.config.workspace,
            Math.floor(runtime.config.limits.maxOutputBytes / 2),
          );
          runtime.disposers.push(documents.close);
          runtime.register(documents.tool);
        }
        runtime.register(
          defineTool({
            name: 'policy_status',
            description: 'Show the effective tool names and execution limits for this caller.',
            requiredScopes: ['policy:read'],
            readOnly: true,
            inputSchema: z.strictObject({}),
            async invoke(_args, { principal }) {
              return textResult(
                JSON.stringify({
                  tools: runtime.visibleTools(principal).map((t) => t.name),
                  readOnly: runtime.config.readOnly,
                  limits: runtime.config.limits,
                }),
              );
            },
          }),
        );
        if (runtime.config.api) runtime.register(createApiTool(runtime.config.api));
      }
      for (const name of runtime.config.allowedTools)
        if (!runtime.registry.has(name)) throw new Error(`Allowed tool is not registered: ${name}`);
      return runtime;
    } catch (error) {
      await runtime.close();
      throw error;
    }
  }

  private register(tool: ToolDefinition): void {
    if (
      !/^[a-z][a-z0-9_]{0,63}$/.test(tool.name) ||
      this.registry.has(tool.name) ||
      tool.requiredScopes.length === 0
    )
      throw new Error('Tools require unique valid names and explicit scopes');
    this.registry.set(
      tool.name,
      Object.freeze({ ...tool, requiredScopes: Object.freeze([...tool.requiredScopes]) }),
    );
  }

  localPrincipal(): Principal {
    return { subject: 'local', issuer: 'process', scopes: [...this.config.localScopes] };
  }
  visibleTools(principal: Principal): ToolDefinition[] {
    return [...this.registry.values()].filter((tool) => mayInvoke(this.config, principal, tool));
  }

  createServer(principal: Principal): McpServer {
    // Capture identity at the trusted transport boundary, never from arguments or _meta.
    const identity: Principal = Object.freeze({
      ...principal,
      scopes: Object.freeze([...principal.scopes]),
    });
    const server = new McpServer(
      { name: 'secure-mcp', version: VERSION },
      {
        maxToolInputElements: this.config.limits.maxInputElements,
        capabilities: { tools: { listChanged: false } },
        cacheHints: { 'tools/list': { ttlMs: 0, cacheScope: 'private' } },
      },
    );
    for (const tool of this.visibleTools(identity))
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: deferredInputSchema(tool.inputSchema),
          annotations: {
            readOnlyHint: tool.readOnly,
            destructiveHint: !tool.readOnly,
            openWorldHint: !['documents_read', 'policy_status'].includes(tool.name),
          },
        },
        (args, ctx) => this.invoke(identity, tool.name, args, ctx.mcpReq.signal),
      );
    return server;
  }

  async invoke(
    principal: Principal,
    name: string,
    args: Record<string, unknown>,
    signal = new AbortController().signal,
  ): Promise<CallToolResult> {
    const tool = this.registry.get(name);
    const event = auditContext(principal, tool?.name ?? 'unknown');
    const start = performance.now();
    let outcome = 'internal';
    try {
      if (!tool || !mayInvoke(this.config, principal, tool)) throw new RuntimeFailure('denied');
      if (!withinInputElementLimit(args, this.config.limits.maxInputElements))
        throw new RuntimeFailure('invalid_input');
      if (Buffer.byteLength(JSON.stringify(args)) > this.config.limits.maxInputBytes)
        throw new RuntimeFailure('invalid_input');
      const result = await this.execution.run(async (boundedSignal) => {
        let parsed: z.ZodSafeParseResult<Record<string, unknown>>;
        try {
          parsed = await tool.inputSchema.safeParseAsync(args);
        } catch {
          throw new RuntimeFailure('invalid_input');
        }
        boundedSignal.throwIfAborted();
        if (!parsed.success) throw new RuntimeFailure('invalid_input');
        await record(this.audit, event, 'allowed', start);
        boundedSignal.throwIfAborted();
        try {
          const value = await tool.invoke(parsed.data, { principal, signal: boundedSignal });
          boundedSignal.throwIfAborted();
          if (Buffer.byteLength(JSON.stringify(value)) > this.config.limits.maxOutputBytes)
            throw new RuntimeFailure('output_too_large');
          await record(this.audit, event, value.isError ? 'tool_error' : 'success', start);
          return value;
        } catch (error) {
          if (!boundedSignal.aborted) await record(this.audit, event, failureCode(error), start);
          throw error;
        }
      }, signal);
      outcome = result.isError ? 'tool_error' : 'success';
      return result;
    } catch (error) {
      outcome = failureCode(error);
      if (outcome === 'denied' || outcome === 'invalid_input') {
        try {
          await this.execution.run(() => record(this.audit, event, outcome, start), signal);
        } catch (auditError) {
          outcome = failureCode(auditError);
        }
      }
      return { content: [{ type: 'text', text: outcome }], isError: true };
    } finally {
      this.counts.set(outcome, (this.counts.get(outcome) ?? 0) + 1);
    }
  }

  metrics(): string {
    return (
      '# TYPE secure_mcp_active gauge\nsecure_mcp_active ' +
      this.execution.running +
      '\n' +
      '# TYPE secure_mcp_calls_total counter\n' +
      [...this.counts]
        .map(([outcome, count]) => `secure_mcp_calls_total{outcome="${outcome}"} ${count}\n`)
        .join('')
    );
  }

  close(): Promise<number> {
    this.closing ??= (async () => {
      const remaining = await this.execution.close(this.config.limits.shutdownMs);
      // Trusted handlers which ignore cancellation can retain resources until process exit.
      if (!remaining) await Promise.all(this.disposers.map((dispose) => dispose()));
      return remaining;
    })();
    return this.closing;
  }
}
