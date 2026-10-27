# Execution record

Work started October 26, 2026 on `feat/secure-runtime-v2`. This is an unpublished alpha, not completion of the stable-release roadmap. The original v1 review remains a historical assessment of its recorded commit.

## Prepared changes

The successor uses the official TypeScript SDK with strict application types. It provides stdio and Streamable HTTP, a side-effect-free library, an explicit-workspace CLI, external JWT verification, one tool discovery/invocation policy, bounded execution, safe errors, audit events, and authenticated metrics. It has useful bounded document and fixed-destination API tools.

V1 source and tests are preserved in `legacy/v1`, outside the runtime dependency graph and package allowlist. Its old failures are not counted as passing tests. PostgreSQL, Redis, Vault, custom refresh tokens, MFA, SAML, Socket.IO, and mock isolation helpers are absent from the new runtime.

The package version is provisionally `2.0.0-alpha.1`; it has not been published. Root license metadata follows the existing AGPL-3.0-or-later declaration. `server.json` is prepared registry metadata, validated against the official 2025-12-11 schema, not a registry listing.

## PR sequence

1. **Document v1 release blockers and suspend publication.** Merged as [PR #1](https://github.com/perfecxion-ai/secure-mcp/pull/1) after its GitHub check passed. Includes the review, truthful support status, license metadata, and publication hold. Its CI validates those artifacts and explicitly does not claim that v1 runtime checks pass.
2. **Replace the v1 entrypoint with the bounded SDK stdio runtime.** Merged as [PR #2](https://github.com/perfecxion-ai/secure-mcp/pull/2) after its GitHub check passed. Archive the historical implementation; introduce strict builds, the approved document workflow, shared policy, audit, and execution bounds. HTTP code and its dependencies are excluded from this PR candidate. Its isolated strict checks, 19 tests, and fresh tarball installation pass.
3. **Add protected Streamable HTTP and external issuer verification.** Merged as [PR #3](https://github.com/perfecxion-ai/secure-mcp/pull/3) after its GitHub check passed. Includes cross-user tests, host/origin defenses, metadata discovery, token validation, and the disposable issuer lab.
4. **Gate artifacts and document the alpha's operating limits.** Include clean-consumer/container checks, fault and mutation checks, configuration/registry metadata validation, measured evidence, and migration documentation.

These are reviewable units of the existing roadmap, not a claim that four PRs finish every milestone. Use short descriptions of concrete behavior and actual validation. Merge after the relevant checks pass; do not publish an npm release during this sequence.

## Validation performed

The [October 27 validation record](validation/2026-10-27-alpha.json) identifies the full local candidate by SHA-256 file hashes and records final package, container, OAuth, and dependency checks. The [test log](validation/2026-10-27-check.txt) reports 30 passing tests. [Native coverage](validation/2026-10-27-coverage.txt) reports 96.20% lines, 90.23% branches, and 92.16% functions. These historical logs were recorded before PR publication. Subsequent GitHub results are linked in the PR sequence above.

- Strict TypeScript, lint, formatting, and builds pass on the DGX Spark's ARM64 Linux host with Node 24.13.0.
- Official SDK clients exercise stdio and HTTP using negotiated protocols `2026-07-28` and `2025-11-25`.
- MCP Inspector 2.12.0 independently lists tools and reads the approved fixture.
- Adversarial cases cover traversal, outside-file and directory symlinks, hidden paths, schema/identity injection, all-scope policy, read-only mode, cross-user visibility, token issuer/audience/type/expiry, Host/Origin rejection, request ID zero, repeated requests, and bounded input/output.
- Real HTTP cancellation, capacity, deadline, and shutdown checks reach the handler. A failed Writable audit sink denies work without an unhandled process error. An oversized stdio frame now terminates the CLI even when the caller leaves stdin open.
- Deliberately weakening all-scope enforcement, symlink protection, and audience validation makes the corresponding regression checks fail.
- A fresh consumer installs the tarball with normal lifecycle scripts, imports it silently, calls the installed CLI, and verifies exit after stdin EOF. No Prisma generation or external service is needed.
- A real ARM64 Docker image runs as non-root with a read-only root filesystem, no network, dropped capabilities, memory/CPU/PID limits, and a read-only document mount. An SDK client completes a permitted read and observes denial of an absolute path. The pinned base image runs Node 24.22.1.
- The optional OAuth lab uses maintained `oidc-provider` 9.13.0, protected-resource/OIDC discovery, an actual client-credentials token endpoint, and pinned JWKS verification. Keys and client credentials are ephemeral and are not persisted. This does not validate a browser login/consent/refresh journey.
- Root and optional-lab npm audits reported zero findings in their resolved, locked trees. That is a dependency audit result, not proof of application security.

The [initial one-hour stdio run](validation/2026-10-26-initial-soak.json) completed 12,550,140 calls with zero unexpected results. It used four concurrent client calls, a 29-byte document, periodic denied traversal attempts, and JSON audit to `/dev/null`. The last 10,000 calls had median 1.23 ms and p95 2.47 ms. Peak sampled server RSS was about 242 MiB. These measurements describe one ARM64 host and workload, not a general capacity guarantee.

That run predates the audit-stream error and oversized-frame lifecycle fixes. It is not certification of the final candidate. A new one-hour run against the candidate identified by the October 27 validation hashes is in progress. Both scripts record `startupMs` as SDK transport connection time; for the modern protocol, that is not a full service-readiness measurement. Real-host acceptance remains required.

## Findings disposition

| Baseline findings | Replacement or remaining work |
| --- | --- |
| F01, F02, F14, F15 | Official SDK dispatch and standard transports; both protocol generations tested; custom client archived |
| F03 through F07 | Custom identity services retired; external token verification and actual issuer lab added; migration must inventory deployed users |
| F08 | Content-free structured audit, correct Writable error handling, no Pino startup dependency; broader remote audit coverage remains |
| F09, F16 | Clean package and bounded container validated; old deployment stacks archived; remote proxy deployment still needs operator testing |
| F10 | New discoverable native test suite, mutation checks, strict types, blocking successor CI; required-check repository settings pending |
| F11 | Minimal locked runtime dependencies, Node 24, current audit checks |
| F12 | Mock isolation and AI helpers retired; no untrusted execution or screening claim |
| F13 | Shared allowlist/scope/read-only policy and strict schemas; document workspace and fixed API enforce resource limits |
| F17 | Unsupported claims removed from current docs; license metadata aligned; registry and release remain unpublished |
| F18 | Admission/deadline/cancellation/shutdown bounds and authenticated bounded-label metrics; tracing and broader operating evidence pending |

## Remaining release gates

- Obtain a final-candidate one-hour soak and publish its exact revision, workload, and raw measurements.
- Validate two actual assistant hosts and a production-like external identity-provider journey, including key rotation and failure behavior.
- Inventory existing users and credential state before recommending migration.
- Complete remote authentication/wire-rejection audit coverage and optional tracing without logging content or secrets.
- Configure required GitHub checks, verify private vulnerability reporting, and wire artifact provenance and immutable release promotion.
- Collect independent design-partner onboarding and repeat-use evidence. No external users have been contacted by this work.
- Publish only after the technical and feedback gates pass. Content-screening providers and isolated untrusted execution remain separate optional workstreams.

## Git identity

Origin is `git@github-perfecxion:perfecxion-ai/secure-mcp.git`. Global identity remains `perfecxion-ai` / `pluckymon@proton.me`. The maintainer approved a repository-local email override to `222053267+perfecxion-ai@users.noreply.github.com` after GitHub rejected the original private email. The unpublished baseline commit was amended before its successful push. No account privacy setting was changed.
