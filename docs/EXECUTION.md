# Execution record

The replacement runtime is merged as an unpublished `2.0.0-alpha.1`. This is an experimental checkpoint, not completion of the stable-release roadmap. The [v1 assessment](reviews/2026-10-26-assessment.md) remains a historical review of its recorded commit; the [alpha assessment](reviews/2026-10-27-alpha-assessment.md) identifies current gaps and the next execution sequence.

## Merged work

| Change                                                                 | Pull requests                                                                                                                                                                      |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Record release blockers and suspend publication                        | [#1](https://github.com/perfecxion-ai/secure-mcp/pull/1)                                                                                                                           |
| Archive v1 and introduce the official SDK stdio runtime                | [#2](https://github.com/perfecxion-ai/secure-mcp/pull/2)                                                                                                                           |
| Protect Streamable HTTP with externally issued access tokens           | [#3](https://github.com/perfecxion-ai/secure-mcp/pull/3)                                                                                                                           |
| Gate package/container artifacts, add fault and mutation checks        | [#4](https://github.com/perfecxion-ai/secure-mcp/pull/4)                                                                                                                           |
| Test issuer key lifecycle and authorization code with PKCE             | [#11](https://github.com/perfecxion-ai/secure-mcp/pull/11), [#17](https://github.com/perfecxion-ai/secure-mcp/pull/17)                                                             |
| Separate artifact signing from execution of repository code            | [#12](https://github.com/perfecxion-ai/secure-mcp/pull/12)                                                                                                                         |
| Maintain supported dependency lines and pinned CI actions              | [#13](https://github.com/perfecxion-ai/secure-mcp/pull/13), [#15](https://github.com/perfecxion-ai/secure-mcp/pull/15), [#16](https://github.com/perfecxion-ai/secure-mcp/pull/16) |
| Exercise actual Codex and Claude Code hosts                            | [#14](https://github.com/perfecxion-ai/secure-mcp/pull/14)                                                                                                                         |
| Bound tool-input collections before schema validation                  | [#19](https://github.com/perfecxion-ai/secure-mcp/pull/19)                                                                                                                         |
| Measure authenticated HTTP with distinct scopes and driver diagnostics | [#20](https://github.com/perfecxion-ai/secure-mcp/pull/20)                                                                                                                         |
| Refresh contribution and issue-reporting guidance                      | [#21](https://github.com/perfecxion-ai/secure-mcp/pull/21)                                                                                                                         |
| Test both protocols through a verified TLS reverse proxy               | [#22](https://github.com/perfecxion-ai/secure-mcp/pull/22)                                                                                                                         |

Each merged PR passed its required validation check. Main now requires an up-to-date PR and the GitHub Actions `Validate runtime` check, including for administrators. Force pushes and deletion are disabled. Private vulnerability reporting is enabled. These settings support review discipline; they do not constitute an independent security review.

## Current runtime

The official TypeScript SDK owns stdio and HTTP protocol handling. The side-effect-free library and explicit-workspace CLI share allowlist, all-scope, read-only, and expiry policy. The runtime bounds input bytes and collection entries, output, concurrency, cooperative deadlines, cancellation, and shutdown. It exposes content-free audit events and authenticated metrics.

Documents are read through Linux descriptor-anchored paths with symlink, hidden-path, traversal, regular-file, UTF-8, and size checks. The optional API tool performs GET against one fixed operator-selected destination without redirects or forwarded tokens. Handlers remain trusted process code. Workspaces must be operator-controlled; hard links and hostile local writers are outside confinement guarantees.

V1 source and tests are preserved in `legacy/v1`, outside the runtime dependency graph and package allowlist. Their old failures are not counted as passing tests. Built-in accounts, custom token issuance, MFA/SAML, databases, Vault, mock isolation, and AI-screening claims are absent from the successor. License metadata follows the existing AGPL-3.0-or-later declaration. Registry metadata is prepared, not registered.

## Verification

The guarded runtime passes 33 native tests, strict TypeScript checks, lint, formatting, build, and configuration/registry validation. Four mutation checks confirm that regression tests detect weakened all-scope enforcement, symlink confinement, audience verification, and the SDK's pre-schema element limit. [Current coverage](validation/2026-10-27-guarded-coverage.txt) records 96.31% lines, 90.31% branches, and 92.31% functions; coverage is not a security guarantee.

The tests exercise real SDK stdio and HTTP for `2026-07-28` and `2025-11-25`, signed tokens and local JWKS, cross-user scope isolation, malformed/oversized inputs, filesystem escape attempts, cancellation, capacity, deadlines, shutdown, and audit-stream failure. Inspector acceptance was also recorded during the initial implementation.

Fresh-consumer tests install the tarball with normal lifecycle scripts, import it silently, invoke the CLI, and verify EOF shutdown. Container checks exercise a non-root process with a read-only filesystem, no network, dropped capabilities, resource limits, and a read-only document mount. The pinned container base runs Node 24.22.1.

The external issuer lab covers client credentials and authorization code with S256 PKCE, state/issuer binding, replay rejection, and incorrect-verifier rejection. Its login and consent are scripted fixtures. Key rotation, cache cooldown, removal, outage, and recovery have deterministic HTTP-backed tests. These do not establish production browser, MFA, logout, or refresh behavior.

Codex 0.164.0 and Claude Code 2.1.307 both completed the guarded runtime's allowed-read, denied-traversal, and policy-discovery workflow. The TLS proxy lab tests both protocols through digest-pinned NGINX with certificate verification, canonical resource discovery, scope isolation, and Host/Origin rejection. Filtered reports and runtime hashes are indexed in [validation](validation/README.md).

Root and optional issuer-lab dependency audits reported zero findings in their locked trees. The SDK input-validation advisory still required explicitly enabling an element budget; a clean dependency audit alone did not establish safety.

The guarded one-hour stdio run completed 16,901,942 calls on Node 24.13.0; the guarded 30-minute HTTP run completed 5,094,415 calls on Node 24.22.1. Both had zero unexpected results and exited 0. A fresh ARM64 container check passed and its runtime hashes match the attested tarball. The initial runs, failed older-Node HTTP results, driver diagnostics, and completed guarded runs are kept separate in the validation index. Do not treat a report from an earlier runtime or driver as certification of every later change. Benchmark startup and percentile fields have documented limits in [BENCHMARKS.md](BENCHMARKS.md).

## Remaining gates

- Define stable performance thresholds for a declared workload, measure no-op overhead separately, and repeat validation in the target operator environment. The initial guarded soak gate has completed.
- Repair repeated custom-schema parsing and verify exactly-once transforms across direct and transport calls.
- Complete remote authentication/wire-rejection audit coverage and validate a durable collector under load and failure.
- Validate a production-like operator IdP and actual browser journey, including key rotation and outage behavior.
- Inventory deployed v1 users and credential state before recommending migration or publishing the successor.
- Promote an immutable, attested artifact through an explicit release process. npm publication remains disabled.
- Obtain independent security review and design-partner onboarding/repeat-use evidence. No external users have been contacted by this work.

Content screening, upstream proxying, and isolated untrusted execution remain separate optional workstreams. The core must remain useful without a paid service.
