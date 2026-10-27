import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { schemaRuntime } from './schema-tools.js';
const runtime = await schemaRuntime();
const handle = serveStdio(() => runtime.createServer(runtime.localPrincipal()));
const stop = () => {
  void runtime
    .close()
    .then(() => handle.close())
    .then(() => process.exit(0));
};
process.once('SIGTERM', stop);
process.stdin.once('end', stop);
