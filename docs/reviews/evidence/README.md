# Secure MCP review evidence

These artifacts accompany the [October 26 assessment](../2026-10-26-assessment.md). They describe baseline commit `1df0af55bd2cebde48d643e3d3c852e64d37ce18` and are diagnostic evidence, not a replacement for the project's test suite.

- `2026-10-26-summary.json` records commands, outcomes, audit package entries, package metadata, public repository observations, and probe limitations.
- `reproduce-critical-paths.cjs` loads actual source through the installed TypeScript transpiler. It substitutes configuration, logging, and infrastructure dependencies to isolate protocol validation, response filtering, token lifecycle, and MFA key-context behavior. It uses real signing and cryptographic helper code. No live services or credentials are needed.
- `reproduce-backup-code-generation.cjs` inspects the actual backup-code entropy rule. Its `generate` mode calls the affected generator and must be run with an external process timeout because the baseline code loops synchronously.

Run from the repository root in a disposable copy with development dependencies installed:

```bash
npm install --ignore-scripts --no-audit --no-fund
node docs/reviews/evidence/reproduce-critical-paths.cjs
node docs/reviews/evidence/reproduce-backup-code-generation.cjs
timeout 2s node docs/reviews/evidence/reproduce-backup-code-generation.cjs generate
```

On the reviewed baseline, the final command exits 124 because generation does not finish. The critical-path probe includes assertions for observed defective behavior; after fixes, update or replace these diagnostics with regression tests asserting correct behavior. Do not interpret a diagnostic assertion failure after a fix as a product regression.

Dependency versions may resolve differently without the original generated lockfile. The summary records its digest, environment, and resolution date. The complete temporary run directory is `/tmp/secure-mcp-review-82ldkxsg`, including the generated lockfile and command logs; temporary files are not durable evidence. The repository review artifacts preserve the material observations without copying the entire dependency tree or raw logs.

The Redis revocation cases model the prefix behavior verified against ioredis command construction. They do not constitute a live Redis concurrency test. MFA context probes substitute TOTP generation to avoid the independently reproduced backup-code loop. No real container isolation, external identity-provider flow, Kubernetes deployment, or production throughput was established by these probes.
