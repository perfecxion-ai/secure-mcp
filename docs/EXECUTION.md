# Execution record

The replacement runtime is merged as an unpublished `2.0.0-alpha.1`. The [candidate record](validation/CANDIDATE.md) tracks the current fresh-install acceptance gate; independent user validation and stable-release work remain. The [v1 assessment](reviews/2026-10-26-assessment.md) remains a historical review of its recorded commit; the [alpha assessment](reviews/2026-10-27-alpha-assessment.md) identifies current gaps and the next execution sequence.

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
| Apply custom schemas once within runtime bounds                        | [#26](https://github.com/perfecxion-ai/secure-mcp/pull/26)                                                                                                                         |
| Bound and correlate transport audit; return safe failures              | [#27](https://github.com/perfecxion-ai/secure-mcp/pull/27), [#30](https://github.com/perfecxion-ai/secure-mcp/pull/30)                                                             |
| Require durable collector acknowledgement and test ENOSPC              | [#28](https://github.com/perfecxion-ai/secure-mcp/pull/28), [#32](https://github.com/perfecxion-ai/secure-mcp/pull/32)                                                             |
| Declare workload gates and capture server exit/audit readiness         | [#29](https://github.com/perfecxion-ai/secure-mcp/pull/29), [#34](https://github.com/perfecxion-ai/secure-mcp/pull/34)                                                             |
| Prepare immutable artifacts and tester onboarding                      | [#31](https://github.com/perfecxion-ai/secure-mcp/pull/31)                                                                                                                         |
| Exercise actual browser OAuth and provider lifecycle                   | [#33](https://github.com/perfecxion-ai/secure-mcp/pull/33)                                                                                                                         |
| Separate stdio startup from the audit-failure deadline test            | [#35](https://github.com/perfecxion-ai/secure-mcp/pull/35)                                                                                                                         |

Each merged PR passed its required validation check. Main now requires an up-to-date PR and the GitHub Actions `Validate runtime` check, including for administrators. Force pushes and deletion are disabled. Private vulnerability reporting is enabled. These settings support review discipline; they do not constitute an independent security review.

## Current runtime

The official TypeScript SDK owns stdio and HTTP protocol handling. The side-effect-free library and explicit-workspace CLI share allowlist, all-scope, read-only, and expiry policy. The runtime bounds input bytes and collection entries, output, concurrency, cooperative deadlines, cancellation, and shutdown. It exposes content-free audit events and authenticated metrics.

Documents are read through Linux descriptor-anchored paths with symlink, hidden-path, traversal, regular-file, UTF-8, and size checks. The optional API tool performs GET against one fixed operator-selected destination without redirects or forwarded tokens. Handlers remain trusted process code. Workspaces must be operator-controlled; hard links and hostile local writers are outside confinement guarantees.

V1 source and tests are preserved in `legacy/v1`, outside the runtime dependency graph and package allowlist. Their old failures are not counted as passing tests. Built-in accounts, custom token issuance, MFA/SAML, databases, Vault, mock isolation, and AI-screening claims are absent from the successor. License metadata follows the existing AGPL-3.0-or-later declaration. Registry metadata is prepared, not registered.

## Verification

The current runtime passes 44 tests, strict TypeScript, lint, formatting, build, configuration/registry metadata checks, and four security mutation probes. The [candidate evidence](validation/CANDIDATE.md) binds the package, container, both real MCP hosts, browser IdP lab, and endurance measurements to the same 13 compiled runtime modules. Native coverage is 96.81% lines, 90.31% branches, and 91.55% functions; it is not a security guarantee.

Fresh-consumer checks install the exact attested tarball, verify silent import, invoke the CLI, and require clean EOF shutdown. A separate strict TypeScript consumer compiles the public runtime, transformed tool input, collector, and SDK transport types. Container checks exercise nonroot execution with a read-only root, no network, dropped capabilities, resource bounds, and a read-only document mount.

The Keycloak lab uses real Chromium password login and consent, PostgreSQL, issuer HTTPS, and an NGINX TLS resource proxy. It verifies both MCP protocols, scope isolation, real key rotation/cooldown, fresh versus cold JWKS cache behavior during outage, restart, logout/refresh failure, expiry, and replay. Deterministic identity tests separately cover stale-cache expiry and key removal. Production account policy and MFA remain operator validation.

Audit tests cover failed authentication, Host/Origin and wire rejection, correlation/privacy, timeout/cancellation/saturation, blocked delivery, collector kill/restart, journal limits, actual filesystem exhaustion, and a bounded safe error response when logging that response also fails. The collector reference has explicit capacity, retention, and local-trust limits.

Both candidate one-hour runs meet the predeclared performance contract: 13,317,342 stdio calls and 60,906 durable HTTP calls, zero unexpected results, clean driver/server exits, healthy audit, bounded resources, and complete durable journal reconciliation. The candidate is ready for independent fresh-install validation. Earlier failed and interrupted runs remain in the validation index.

## Remaining gates

- Collect independent fresh-install onboarding and repeat-use feedback; no external users have been contacted.
- Validate the target operator's identity/MFA policy, TLS routing, and audit capacity/retention.
- Obtain independent security review and make a deliberate release/publication decision. npm publication remains disabled.

Legacy remediation and migration are outside this fresh-install workstream.

Content screening, upstream proxying, and isolated untrusted execution remain separate optional workstreams. Choose further tool workflows from user evidence while keeping the core useful without a paid service.
