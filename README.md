# SecureMCP

An experimental TypeScript MCP runtime for approved local tools, explicit access policies, bounded execution, and structured audit events.

Version 2 is an incompatible, unpublished alpha. The [v1 assessment](docs/reviews/2026-10-26-assessment.md) records the defects behind this replacement. Historical code and tests are preserved in [legacy](legacy/README.md).

## Local setup

Requires Linux and Node 24.

```bash
npm ci
npm run build
node dist/cli.js --config examples/secure-mcp.json --doctor
node dist/cli.js --workspace /absolute/path/approved-documents
```

Configure an MCP host to launch the CLI with that explicit workspace. Call `documents_read` with a relative document path. Absolute paths, traversal, hidden files, and symlinks are denied. Stdout carries protocol messages; audit events go to stderr.

The official SDK provides stdio transport. Tool discovery and invocation share allowlist, all-scope, and read-only checks. Execution bounds cover input, output, concurrency, deadlines, cancellation, and shutdown. `policy_status` reports visible tools and limits. Optional `api_read` fetches one operator-configured URL without redirects or caller-supplied credentials.

Library imports have no startup side effects. Tool implementations and audit sinks are trusted process code. Read the [threat model](docs/THREAT_MODEL.md) before embedding. HTTP transport is not included in this change.

## Validation

```bash
npm run check
npm run test:package
npm audit
```

Tests exercise real SDK clients, policy decisions, filesystem escape attempts, audit failures, cancellation, and CLI lifecycle. Legacy test failures are preserved in the assessment and are not counted as passing. Publication remains disabled.

## License

AGPL-3.0-or-later. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
