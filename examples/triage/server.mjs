import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createTriageRuntime } from './tool.mjs';

const runtime = await createTriageRuntime();
const handle = serveStdio(() => runtime.createServer(runtime.localPrincipal()));
let stopping;
function stop() {
  stopping ??= (async () => {
    const force = setTimeout(() => process.exit(1), runtime.config.limits.shutdownMs + 1000);
    try {
      const remaining = await runtime.close();
      await handle.close();
      process.exitCode = remaining ? 1 : 0;
    } catch {
      process.exitCode = 1;
    } finally {
      clearTimeout(force);
    }
  })();
  return stopping;
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());
process.stdin.once('end', () => void stop());
