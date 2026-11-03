#!/usr/bin/env node
import { readFile, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { assertSupportedNode, UnsupportedRuntimeError } from './node-version.js';
import {
  StartupDiagnostic,
  configurationDiagnostic,
  filesystemDiagnostic,
} from './startup-diagnostics.js';

async function main(): Promise<void> {
  // Reject unsupported runtimes before loading SDK dependencies or opening resources.
  assertSupportedNode();
  const { parseConfig } = await import('./config.js');
  const { z } = await import('zod');
  const { SecureRuntime, VERSION } = await import('./runtime.js');
  const { serveHttp } = await import('./http.js');
  const { serveStdio, StdioServerTransport } = await import('@modelcontextprotocol/server/stdio');
  const { values } = (() => {
    try {
      return parseArgs({
        options: {
          config: { type: 'string' },
          workspace: { type: 'string' },
          doctor: { type: 'boolean' },
          help: { type: 'boolean', short: 'h' },
          version: { type: 'boolean' },
        },
      });
    } catch {
      throw new StartupDiagnostic(
        'arguments: unknown option, unexpected argument or missing option value; run --help for usage',
      );
    }
  })();
  if (values.help) {
    process.stdout.write(
      'secure-mcp [--config FILE] [--workspace DIRECTORY] [--doctor] [--version]\nDefault: stdio, read-only document tools. HTTP requires a config file.\n',
    );
    return;
  }
  if (values.version) {
    process.stdout.write(VERSION + '\n');
    return;
  }
  let config: Record<string, unknown> = {};
  if (values.config) {
    let contents: string;
    try {
      contents = await readFile(values.config, 'utf8');
    } catch (error) {
      throw filesystemDiagnostic('config', error);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(contents);
    } catch {
      throw new StartupDiagnostic('config: invalid JSON; check syntax in the selected file');
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new StartupDiagnostic('config: must be a JSON object');
    config = { ...raw };
    if (typeof config.workspace === 'string')
      config.workspace = resolve(dirname(resolve(values.config)), config.workspace);
  }
  if (values.workspace) config.workspace = resolve(values.workspace);
  let parsed;
  try {
    parsed = parseConfig(config);
  } catch (error) {
    if (error instanceof z.ZodError) throw configurationDiagnostic(error.issues);
    throw new StartupDiagnostic('config: could not validate configuration');
  }
  if (parsed.allowedTools.includes('documents_read')) {
    if (config.workspace === undefined)
      throw new StartupDiagnostic(
        'workspace: choose an approved workspace with --workspace DIRECTORY or --config FILE',
      );
    try {
      const workspace = await open(parsed.workspace, constants.O_RDONLY | constants.O_DIRECTORY);
      await workspace.close();
    } catch (error) {
      throw filesystemDiagnostic('workspace', error);
    }
  }
  if (
    parsed.allowedTools.some(
      (name) =>
        !['documents_read', 'policy_status', ...(parsed.api ? ['api_read'] : [])].includes(name),
    )
  )
    throw new StartupDiagnostic(
      'allowedTools: contains an unavailable tool; check supported names and optional API configuration',
    );
  const runtime = await SecureRuntime.create({ config });
  if (values.doctor) {
    process.stdout.write(
      JSON.stringify({
        version: VERSION,
        transport: runtime.config.transport,
        readOnly: runtime.config.readOnly,
        tools: runtime.config.allowedTools,
        externalAuthentication: !!runtime.config.http,
        limits: runtime.config.limits,
      }) + '\n',
    );
    await runtime.close();
    return;
  }
  let close: () => Promise<number>;
  let protocolFailed = false;
  if (runtime.config.transport === 'http') {
    const handle = await serveHttp(runtime).catch(async (error) => {
      await runtime.close();
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      throw new StartupDiagnostic(
        code === 'EADDRINUSE'
          ? 'http.port: listener address is already in use; choose a free port'
          : code === 'EACCES' || code === 'EPERM'
            ? 'http.port: permission denied when opening the listener; check host and port permissions'
            : 'http: listener startup failed; check bind address and port availability',
      );
    });
    process.stderr.write(JSON.stringify({ event: 'listening', url: handle.url }) + '\n');
    close = () => handle.close();
  } else {
    const transport = new StdioServerTransport(process.stdin, process.stdout, {
      maxBufferSize: runtime.config.limits.maxInputBytes,
    });
    const handle = serveStdio(() => runtime.createServer(runtime.localPrincipal()), {
      transport,
      onerror: () => {
        protocolFailed = true;
        process.stderr.write('{"event":"protocol_error"}\n');
      },
    });
    const sdkClosed = transport.onclose;
    transport.onclose = () => {
      sdkClosed?.();
      stop();
    };
    close = async () => {
      const remaining = await runtime.close();
      await handle.close();
      return remaining;
    };
  }
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    const forced = setTimeout(() => process.exit(1), runtime.config.limits.shutdownMs + 1000);
    void close().then(
      (remaining) => {
        clearTimeout(forced);
        process.exit(remaining || protocolFailed || !runtime.audit.healthy ? 1 : 0);
      },
      () => process.exit(1),
    );
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (runtime.config.transport === 'stdio') process.stdin.once('end', stop);
}
main().catch((error: unknown) => {
  process.stderr.write(
    error instanceof UnsupportedRuntimeError || error instanceof StartupDiagnostic
      ? `secure-mcp: ${error.message}\n`
      : 'secure-mcp: startup failed; check configuration, workspace access, and listener availability\n',
  );
  process.exitCode = 1;
});
