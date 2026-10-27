#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { dirname, resolve } from 'node:path';
import { serveStdio, StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { SecureRuntime, VERSION } from './runtime.js';
import { serveHttp } from './http.js';

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      config: { type: 'string' },
      workspace: { type: 'string' },
      doctor: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean' },
    },
  });
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
    const raw: unknown = JSON.parse(await readFile(values.config, 'utf8'));
    if (!raw || typeof raw !== 'object' || Array.isArray(raw))
      throw new Error('Config must be an object');
    config = { ...raw };
    if (typeof config.workspace === 'string')
      config.workspace = resolve(dirname(resolve(values.config)), config.workspace);
  }
  if (values.workspace) config.workspace = resolve(values.workspace);
  if (
    config.workspace === undefined &&
    (!Array.isArray(config.allowedTools) || config.allowedTools.includes('documents_read'))
  ) {
    process.stderr.write(
      'secure-mcp: choose an approved workspace with --workspace DIRECTORY or --config FILE\n',
    );
    process.exitCode = 1;
    return;
  }
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
      throw error;
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
        process.exit(remaining || protocolFailed ? 1 : 0);
      },
      () => process.exit(1),
    );
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (runtime.config.transport === 'stdio') process.stdin.once('end', stop);
}
main().catch(() => {
  process.stderr.write(
    'secure-mcp: startup failed; check configuration, workspace access, and listener availability\n',
  );
  process.exitCode = 1;
});
