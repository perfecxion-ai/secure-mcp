# Fresh-install validation candidate

Status: local acceptance passed October 27, 2026; human-review pass reported October 28. The [human-review record](2026-10-28-human-review.md) records the outcome and remaining metadata. The candidate is entering prerelease preparation.

Package source: `1f9f7860696c4fae1bab650ab7f8c77513350657`. Runtime implementation is unchanged since `b757360854f67e819fb7cc2e6373419bd363a436`. The [artifact record](2026-10-27-candidate-artifact.json) binds the exact tarball to successful protected-main CI, build provenance, the signed production SBOM, and all 13 compiled runtime module hashes. Later documentation does not replace that artifact.

Start with the [fresh-install guide](REAL_USER_VALIDATION.md). Use a disposable Linux installation and approved fixture documents. No v1 credentials or existing deployment state are migrated. The package remains unpublished to npm.

## Completed checks

| Boundary                     | Evidence                                                                                                  | Scope                                                                                                                          |
| ---------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Runtime regression suite     | [44 passing tests and coverage](2026-10-27-candidate-coverage.txt)                                        | Both protocol generations, schema ownership, policy, filesystem/input/output bounds, cancellation, shutdown, and audit failure |
| Security regression controls | Four mutation probes in required CI                                                                       | Tests fail when all-scope checks, no-follow reads, audience verification, or both element-budget guards are removed            |
| Actual MCP hosts             | [Codex 0.164.0](2026-10-27-candidate-codex.json), [Claude Code 2.1.307](2026-10-27-candidate-claude.json) | Three synthetic stdio calls per host, with unrelated command execution disabled                                                |
| Browser and issuer           | [Keycloak 26.8.1 and Chromium 155](2026-10-27-candidate-keycloak.json)                                    | Real password/consent, TLS, PKCE, scopes, key rotation/cooldown, outage/recovery, logout/refresh, expiry, and replay           |
| Durable collection           | [Kill/restart and blocked delivery](2026-10-27-collector-restart.json)                                    | 800 records survive collector kill; restart appends to 802; blocked delivery fails closed                                   |
| Storage exhaustion           | [Actual ENOSPC probe](2026-10-27-candidate-storage-failure.json)                                          | OS-level full filesystem fails closed independently of the collector's journal limit                                           |
| Container                    | [ARM64 runtime hashes](2026-10-27-candidate-container.json)                                               | Actual allowed/denied calls as nonroot, read-only root, no network, dropped capabilities                                       |
| TypeScript consumer          | [Strict external compilation](2026-10-27-candidate-types.json)                                            | Fresh tarball install, NodeNext, no skipLibCheck, transformed input inferred as a number                                       |
| Package and provenance       | [Artifact and consumer record](2026-10-27-candidate-artifact.json)                                        | Exact downloaded tarball, silent import, stdio calls, EOF shutdown, provenance and SBOM checks                                 |

The installed [local trial launcher](2026-10-27-candidate-local-trial.json) also passes discovery, an approved read, traversal/hidden-file/symlink rejection, and policy inspection under both protocol generations. This is a local onboarding smoke check, not an independent user result.

The current native coverage report records 96.81% lines, 90.31% branches, and 91.55% functions. Coverage percentages are descriptive and do not establish security assurance.

The browser lab uses an independent maintained IdP with disposable accounts, not an organization's production account policy. MFA, federation, recovery, enrollment, and target-environment failure handling remain operator validation. Stale JWKS cache expiry and key removal additionally have deterministic HTTP-backed regression tests.

## Declared endurance gate

The [performance contract](PERFORMANCE_CONTRACT.md) predates these runs. Both use Node 24.22.1 on the ARM64 DGX Spark. Stdio runs four callers at maximum loop rate with stderr audit discarded. HTTP uses four identities paced at 200 ms per worker and a separate local collector that acknowledges every record after fsync. The workloads and other validation ran concurrently, so these are local acceptance measurements rather than isolated capacity claims.

Both document fixtures contain 29 printable bytes plus a newline, 30 bytes total. The original contract and raw stdio report label omitted the newline; the fixture bytes and acceptance thresholds were unchanged.

| Metric                 |      Stdio | Durable HTTP |
| ---------------------- | ---------: | -----------: |
| Calls                  | 13,317,342 |       60,906 |
| Duration, seconds      |   3600.006 |     3600.187 |
| Unexpected results     |          0 |            0 |
| Last-10,000 p95, ms    |      1.953 |       46.646 |
| Peak server RSS, MiB   |     251.20 |       180.43 |
| Median RSS growth, MiB |       0.11 |        15.07 |
| Peak descriptors       |         26 |           29 |
| Driver and server exit |          0 |            0 |

The [stdio report](2026-10-27-candidate-stdio-hour.json), [HTTP report](2026-10-27-candidate-http-hour.json), [run identities](2026-10-27-candidate-run-identities.json), and [computed assessment](2026-10-27-candidate-assessment.json) preserve the exact measurements. HTTP full readiness took 310.23 ms; final readiness was 200 with audit pending/failures/dropped all zero.

The 79,027,977-byte journal contains 307,609 valid records across 60,917 correlated HTTP requests and accounts for all 60,906 tool calls, including 6,092 expected denials. No partial records, missing terminal records, duplicate outcomes, cross-actor correlations, or content/token sentinels were found. The [assessment script](assess-candidate.mjs) checks these conditions and the predeclared numerical gates. Its journal checker also rejects a fixture with a deliberately removed completion record. Raw pseudonymous journals stay out of the public repository; their digest is recorded.

Both transports stayed below 512 MiB RSS and 64 descriptors. Median RSS growth between the second and final ten-minute windows stayed below 64 MiB. The latency and readiness gates passed. These are local acceptance results under the stated workload, not a production capacity estimate.

The separate [in-process audit comparison](2026-10-27-audit-overhead.json) measures the same policy tool with a no-op sink and with two durable acknowledgements per call. Mean latency was 0.017 ms and 9.016 ms respectively, an absolute difference of about 9.0 ms on this filesystem. It does not measure transport, IdP, model, or document-I/O costs.

Earlier incomplete attempts remain recorded: [before the error-response repair](2026-10-27-superseded-audit-soaks.json) and [before explicit server-exit capture](2026-10-27-superseded-exit-soaks.json). Both were deliberately stopped and are excluded from acceptance. Earlier Node 24.13.0 failures remain in the [historical evidence index](README.md).

## Post-review release work

The maintainer reports two successful human trials: one with VS Code MCP support and one with Cursor, both described as latest versions. Preserve exact version, repeat-use, and remote-issuer details as they become available; the report does not establish the complete original three-user adoption matrix. Prepare an immutable prerelease and record its publication decision. Local acceptance and onboarding success do not establish production approval or independent security certification.

This validation round targets the next version through fresh installations. Legacy deployment inventory, remediation, and migration are outside its scope and do not block this trial. Before a stable public release, validate the target operator's issuer/MFA and audit-retention setup, obtain independent security review, and make an explicit publication decision. The npm publication workflow remains disabled.
