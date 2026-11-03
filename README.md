# SecureMCP

An experimental TypeScript MCP runtime for hosting approved tools with explicit access policies, bounded execution, and structured audit events.

**Version 2 is an incompatible alpha.** It replaces the v1 prototype, whose known defects are documented in the [assessment](https://github.com/perfecxion-ai/secure-mcp/blob/6fec1886ca2e400694007819384105fdba9eb6a6/docs/reviews/2026-10-26-assessment.md). Do not treat the current branch as a production security boundary without reviewing its [threat model](docs/THREAT_MODEL.md).

## Install and run

Use Linux, Node `>=24.22.1 <25`, and npm 11. Select Node explicitly in a non-login shell: load nvm and run `nvm use 24.22.1`, or prepend the supported Node installation's `bin` directory to `PATH`. No database, paid service, or API key is needed for local documents.

Alpha.2 is being prepared and is **not available on npm**. Alpha.1 remains a [GitHub prerelease](https://github.com/perfecxion-ai/secure-mcp/releases/tag/v2.0.0-alpha.1), excluded from npm promotion. Obtain the new candidate tarball and its source/digest from an authenticated maintainer handoff once available. A checksum shipped with an untrusted archive does not authenticate it. See the [verification and trial guide](docs/validation/REAL_USER_VALIDATION.md).

Run this in Bash after setting `MCP_TARBALL` to the absolute path of the received tarball and `MCP_EXPECTED_SHA256` to its independently trusted digest. No checkout, build, `npm ci`, or GitHub CLI is required for a maintainer-verified handoff:

```bash
: "${MCP_TARBALL:?Set the absolute path to the verified tarball}"
: "${MCP_EXPECTED_SHA256:?Set the digest from the authenticated handoff}"
printf '%s  %s\n' "$MCP_EXPECTED_SHA256" "$MCP_TARBALL" | sha256sum --check - || exit 1
MCP_NODE="$(node -p 'process.execPath')"
MCP_TRIAL="$HOME/secure-mcp-trial"
mkdir -m 700 "$MCP_TRIAL" || exit 1
mkdir "$MCP_TRIAL/install" "$MCP_TRIAL/documents"
printf 'Approved example runbook.\n' > "$MCP_TRIAL/documents/welcome.txt"
cd "$MCP_TRIAL/install" || exit 1
npm init -y
npm install --save-exact --ignore-scripts "$MCP_TARBALL" || exit 1
MCP_CLI="$MCP_TRIAL/install/node_modules/@perfecxion/secure-mcp-server/dist/cli.js"
"$MCP_NODE" "$MCP_CLI" --doctor --workspace "$MCP_TRIAL/documents"
```

Keep `package-lock.json`, the tarball, and the trusted digest with the trial. Dependencies still require registry access. The real entry point is `dist/cli.js`; doctor checks local configuration and workspace access, prints JSON and exits. It does not establish issuer or collector availability. The MCP host launches the same command without `--doctor`.

Continue with [host configuration and first calls](docs/INSTALL.md): generate absolute-path configuration, read `welcome.txt`, deny `../outside.txt`, inspect audit output and restart. VS Code and Cursor configuration formats differ. The guide also explains the Linux server requirement for desktop hosts.

Only after a separate npm publication decision, the intended exact-version install is:

```bash
# Future command; alpha.2 is not yet published.
npm install --save-exact --ignore-scripts @perfecxion/secure-mcp-server@2.0.0-alpha.2 --registry=https://registry.npmjs.org/
```

Do not use an unqualified install: `latest` remains v1. The `alpha` tag is mutable; a range such as `^2.0.0-alpha.2` can admit later releases. Exact pins and the consumer lockfile preserve the reviewed selection.

## Security and compatibility boundaries

- Handlers are trusted Node process code. Read-only declarations and cancellation depend on their cooperation; this is not a sandbox.
- Document access assumes a trusted workspace. Traversal and symlinks are rejected; existing hard links and hostile local writers remain outside the guarantee. Prepare trusted copies and a dedicated read-only mount.
- Scopes authorize tools. Every caller with document access can read within the configured workspace; there is no per-document or tenant isolation without additional authorization or deployment separation.
- Remote authentication requires the documented JWT access-token type, issuer, audience, scopes and lifetime. There is no opaque-token introspection or immediate revocation.
- Audit delivery failure or saturation can latch the service unhealthy until restart. Stderr is not durable storage; the reference collector is not a production retention system.
- Prompt injection can still persuade an agent to exercise already granted authority.

Read the [threat model](docs/THREAT_MODEL.md), [operations guide](docs/OPERATIONS.md), and [security policy](SECURITY.md) before deployment.

**This is not an ordinary v1 upgrade.** V2 uses ESM exports, explicit startup and standard MCP transports. Old accounts, credentials, endpoints and client protocols are not migrated. The package supports Linux only. npm v1 declares Apache-2.0; v2 declares **AGPL-3.0-or-later**. Review the [migration and license notice](docs/MIGRATION.md) before adoption. Keeping `latest=1.0.0` protects compatibility and does not endorse v1's security.

## Implemented scope

| Capability | Status |
| --- | --- |
| stdio and Streamable HTTP | Official SDK, tested with modern and legacy clients |
| Tool visibility and execution policy | Explicit allowlist, all required scopes, read-only mode |
| Remote identity | External JWT issuer, pinned JWKS URL, audience and lifetime validation |
| Execution bounds | Input/output limits, concurrency, deadlines, cancellation, shutdown |
| Documents | Linux workspace confinement, no symlinks/hidden paths, bounded UTF-8 reads |
| API example | Optional single fixed URL, GET only, redirects denied |
| Audit and metrics | Correlated content-free events, bounded delivery, optional fsync-acknowledged collector, authenticated metrics |
| Package and container | CLI and side-effect-free library; local consumer smoke checks |
| Untrusted plugin sandbox, content screening, gateway | Not implemented |
| Certification, production readiness, universal prompt-injection prevention | Not claimed |

The tool registry contains `documents_read`, `policy_status`, and optional `api_read`. Enable the API tool by configuring `api.url`, adding `api_read` to `allowedTools`, and granting `api:read`. It accepts no caller-controlled URL or headers.

## Try a useful workflow

The [sanitized alert-triage demo](docs/DEMO.md) combines an alert, approved asset context and a runbook into a brief with explicit unknowns. It demonstrates resource authorization, a denied operation, audit inspection and failure recovery using harmless fixtures. The [trusted-tool guide](docs/TRUSTED_TOOLS.md) shows how to build a separate consumer using public exports. These examples are engineering demonstrations; independent repeat-use and external integration evidence remain open.

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

For a separate TypeScript application using this example, declare compatible `zod` and `@modelcontextprotocol/server` dependencies and Node types in that application.

Custom schemas run once inside the runtime, including transforms, defaults, coercion, and asynchronous refinements. Validation shares the execution deadline and capacity limit. Invoke tools through the runtime; `ToolDefinition.invoke` is the handler callback for already validated values. Keep refinements free of side effects.

Handlers are trusted process code. Policy checks do not sandbox malicious implementations. Production embeddings must own transport closure, audit failures, and cancellation.

## Development

From a source checkout, using the supported Node version:

```bash
npm ci
npm run check
npm run test:package
npm run test:container
npm run test:mutations
npm audit
```

The Node test suite exercises real SDK transports, signed access tokens, local JWKS, cross-user policy, filesystem escape attempts, cancellation, and output limits. V1 tests and manifests are preserved in [legacy](https://github.com/perfecxion-ai/secure-mcp/blob/6fec1886ca2e400694007819384105fdba9eb6a6/legacy/README.md), with their original failures recorded rather than treated as passing.

Read [operations](docs/OPERATIONS.md), [migration](docs/MIGRATION.md), [active execution plan](https://github.com/perfecxion-ai/secure-mcp/issues/57), and the [original roadmap](https://github.com/perfecxion-ai/secure-mcp/blob/6fec1886ca2e400694007819384105fdba9eb6a6/docs/ROADMAP.md). Configuration is defined by `src/config.ts` and rejects unknown keys. Report vulnerabilities using [SECURITY.md](SECURITY.md).

## License

AGPL-3.0-or-later. The npm v1 package advertises Apache-2.0; v2 is an incompatible successor with different license metadata. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
