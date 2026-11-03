# Execution record

Alpha.3 is in development under [the November 3 review follow-up](validation/2026-11-03-review-followup.md) and [readiness tracker](https://github.com/perfecxion-ai/secure-mcp/issues/57). No alpha.3 candidate or digest is frozen. The [alpha.2 candidate](validation/ALPHA2.md) remains unchanged and held for remediation. Alpha.1 remains an unchanged [GitHub prerelease](https://github.com/perfecxion-ai/secure-mcp/releases/tag/v2.0.0-alpha.1), explicitly rejected for npm promotion. Earlier human passes and endurance measurements remain evidence for their recorded artifacts, not acceptance of the successor.

The alpha.2 consumer/runtime work is merged: [development metadata](https://github.com/perfecxion-ai/secure-mcp/pull/59), [minimum Node enforcement](https://github.com/perfecxion-ai/secure-mcp/pull/60), [installed onboarding](https://github.com/perfecxion-ai/secure-mcp/pull/61), [exact tarball and dependency evidence](https://github.com/perfecxion-ai/secure-mcp/pull/63), [read-only release preflight](https://github.com/perfecxion-ai/secure-mcp/pull/64), and [useful triage/tool guide](https://github.com/perfecxion-ai/secure-mcp/pull/65). The complete publisher landed in [PR 66](https://github.com/perfecxion-ai/secure-mcp/pull/66). Its setup gate now targets alpha.3 after GitHub revalidation, with the earlier npm UI receipt retained. No candidate/tag is selected and exact-artifact approval variables remain unset; see the [publisher checklist](NPM_PUBLISHING.md). The alpha.2 integrated check passed 119 tests, with a fresh ARM64 consumer graph/audit/signature comparison and installed triage/shutdown checks; required CI also passed. These are engineering checks, not a live npm publication or independent human receipt.

The [SBOM correction record](validation/2026-11-03-sbom-inventory-correction.json) documents missing runtime components in the historical signed inventory and the corrected alpha.2 generation/comparison path. Signatures authenticate an inventory; they do not establish completeness. The development-only minimatch advisory remains visible in [issue 62](https://github.com/perfecxion-ai/secure-mcp/issues/62).

The [alpha.3 development notes](releases/2.0.0-alpha.3.md) describe the remediation. No live OIDC publication has occurred. Freeze a successor only after required CI and fresh exact-artifact checks, then collect two-host repeat-use receipts plus independent operator evidence while remote authentication remains a principal launch claim. Three independent successful users, two returning users and an external integration remain broader adoption goals. npm, containers and MCP registry distribution each require their own decision.

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

## Historical alpha.1 verification

The earlier alpha.1-era regression check passed 75 tests, strict TypeScript, lint, formatting, build, configuration/registry metadata checks, and five security mutation probes. The added RS256 cases detect an expanded signing-algorithm allowlist; the selected alpha.1 candidate retains its original 44-test evidence. The [candidate evidence](validation/CANDIDATE.md) binds the package, container, both real MCP hosts, browser IdP lab, and endurance measurements to the same 13 compiled runtime modules. Recorded native coverage was 96.81% lines, 90.31% branches, and 91.55% functions; it is not a security guarantee or coverage of the current source.

Fresh-consumer checks install the exact attested tarball, verify silent import, invoke the CLI, and require clean EOF shutdown. A separate strict TypeScript consumer compiles the public runtime, transformed tool input, collector, and SDK transport types. Container checks exercise nonroot execution with a read-only root, no network, dropped capabilities, resource bounds, and a read-only document mount.

The Keycloak lab uses real Chromium password login and consent, PostgreSQL, issuer HTTPS, and an NGINX TLS resource proxy. It verifies both MCP protocols, scope isolation, real key rotation/cooldown, fresh versus cold JWKS cache behavior during outage, restart, logout/refresh failure, expiry, and replay. Deterministic identity tests separately cover stale-cache expiry and key removal. Production account policy and MFA remain operator validation.

The alpha.1 audit tests covered failed authentication, Host/Origin and wire rejection, correlation/privacy, timeout/cancellation/saturation, blocked delivery, collector kill/restart, journal limits, actual filesystem exhaustion, and a bounded safe error response when logging that response also fails. Current pre-admission HTTP rejection counters and audit event boundaries differ; see [operations](OPERATIONS.md). The collector reference has explicit capacity, retention, and local-trust limits.

Both alpha.1 candidate one-hour runs met the predeclared performance contract: 13,317,342 stdio calls and 60,906 durable HTTP calls, zero unexpected results, clean driver/server exits, healthy audit, bounded resources, and complete durable journal reconciliation. That candidate was handed off for independent fresh-install validation. Earlier failed and interrupted runs remain in the validation index.

The [reported attack review](validation/2026-10-27-reported-attack-review.md) supplies additional feedback tied to the same runtime source. Its raw artifacts have not been reproduced here and are not counted as local acceptance or independent user adoption.

Two human reviews passed according to the maintainer on October 28, 2026, using VS Code MCP support and Cursor. The [review record](validation/2026-10-28-human-review.md) separates that outcome from the earlier agent trial and lists the details still needed for release reporting.

## Remaining gates

- Complete new digest-bound VS Code/Cursor restart and repeat-use receipts after freezing the successor. Preserve the [reported historical human pass](validation/2026-10-28-human-review.md) without inventing its missing versions or coverage.
- Validate the target operator's identity/MFA policy, TLS routing, and audit capacity/retention.
- The approved GitHub prerelease is published; see the [publication record](validation/2026-10-29-published-alpha.json). npm publication has no approved successor artifact. Independent security assurance and broader operator acceptance remain stable-release work.

Legacy remediation and migration are outside this fresh-install workstream.

Content screening, upstream proxying, and isolated untrusted execution remain separate optional workstreams. Choose further tool workflows from user evidence while keeping the core useful without a paid service.
