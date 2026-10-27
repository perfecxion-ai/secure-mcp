# SecureMCP

An experimental TypeScript MCP runtime for hosting approved tools with explicit access policies, bounded execution, and structured audit events.

**Version 2 is an incompatible alpha.** It replaces the v1 prototype, whose known defects are documented in the [assessment](docs/reviews/2026-10-26-assessment.md). Do not treat the current branch as a production security boundary without reviewing its [threat model](docs/THREAT_MODEL.md).

## Try it locally

Requires Node 24 and Linux. No database, Redis, Vault, paid service, or API key is needed.

```bash
npm ci
npm run build
node dist/cli.js --config examples/secure-mcp.json --doctor
```

Configure a local MCP host to launch the built CLI:

```json
{
  "mcpServers": {
    "secure-mcp": {
      "command": "node",
      "args": ["/absolute/path/secure-mcp/dist/cli.js", "--workspace", "/absolute/path/approved-documents"]
    }
  }
}
```

Ask the client to call `documents_read` with `{"path":"welcome.md"}` using `examples/documents` as its workspace. Then call it with `{"path":"../README.md"}` and verify the denial. Audit events go to stderr; stdout carries only protocol messages.

The local package name is `@perfecxion/secure-mcp-server`, with a `secure-mcp` CLI. The successor alpha has not been published; the existing npm 1.0.0 package is the reviewed v1 implementation. Build this branch or install its verified local tarball until a new release is explicitly announced.

## Implemented scope

| Capability | Status |
| --- | --- |
| stdio and Streamable HTTP | Official SDK, tested with modern and legacy clients |
| Tool visibility and execution policy | Explicit allowlist, all required scopes, read-only mode |
| Remote identity | External JWT issuer, pinned JWKS URL, audience and lifetime validation |
| Execution bounds | Input/output limits, concurrency, deadlines, cancellation, shutdown |
| Documents | Linux workspace confinement, no symlinks/hidden paths, bounded UTF-8 reads |
| API example | Optional single fixed URL, GET only, redirects denied |
| Audit and metrics | Structured content-free events; authenticated, bounded-label metrics |
| Package and container | CLI and side-effect-free library; local consumer smoke checks |
| Untrusted plugin sandbox, content screening, gateway | Not implemented |
| Certification, production readiness, universal prompt-injection prevention | Not claimed |

The tool registry contains `documents_read`, `policy_status`, and optional `api_read`. Enable the API tool by configuring `api.url`, adding `api_read` to `allowedTools`, and granting `api:read`. It accepts no caller-controlled URL or headers.

## Extend with a trusted tool

```typescript
import { SecureRuntime, defineTool, textResult } from '@perfecxion/secure-mcp-server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { z } from 'zod';

const runtime = await SecureRuntime.create({
  config: { allowedTools: ['greet'], localScopes: ['greet:read'] },
  tools: [defineTool({
    name: 'greet', description: 'Return a greeting',
    requiredScopes: ['greet:read'], readOnly: true,
    inputSchema: z.strictObject({ name: z.string().max(80) }),
    async invoke({ name }) { return textResult(`Hello, ${name}`); }
  })]
});
const transport = serveStdio(() => runtime.createServer(runtime.localPrincipal()));
// The embedding application owns signal handling and shutdown:
// await runtime.close(); await transport.close();
```

Custom schemas run once inside the runtime, including transforms, defaults, coercion, and asynchronous refinements. Validation shares the execution deadline and capacity limit. Invoke tools through the runtime; `ToolDefinition.invoke` is the handler callback for already validated values. Keep refinements free of side effects.

Handlers are trusted process code. Policy checks do not sandbox malicious implementations. Production embeddings must own transport closure, audit failures, and cancellation.

## Development

```bash
npm run check
npm run test:package
npm run test:container
npm run test:mutations
npm audit
```

The Node test suite exercises real SDK transports, signed access tokens, local JWKS, cross-user policy, filesystem escape attempts, cancellation, and output limits. V1 tests and manifests are preserved in [legacy](legacy/README.md), with their original failures recorded rather than treated as passing.

Read [operations](docs/OPERATIONS.md), [migration](docs/MIGRATION.md), [execution status](docs/EXECUTION.md), and the [roadmap](docs/ROADMAP.md). Configuration is defined by `src/config.ts` and rejects unknown keys. Report vulnerabilities using [SECURITY.md](SECURITY.md).

## License

AGPL-3.0-or-later, consistent with the existing root declaration. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
