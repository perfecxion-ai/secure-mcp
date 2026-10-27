# Validation evidence

Reports identify a workload and a particular runtime. Passing results are not transferable to arbitrary tools, clients, deployment settings, or later source changes.

## Guarded runtime

Runtime source: `c0a5f95b48253f69451be0cc8d7447f5eb970917`. Later lab and documentation changes do not change its compiled runtime modules. Each current host/proxy report contains SHA-256 hashes of all 12 built JavaScript modules.

| Evidence                                           | Result and boundary                                                                                 |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [Codex](2026-10-27-guarded-codex-host.json)        | Actual Codex 0.164.0, three stdio calls, command execution disabled                                 |
| [Claude Code](2026-10-27-guarded-claude-host.json) | Actual Claude Code 2.1.307, same workflow, existing login used without stored configuration changes |
| [NGINX TLS proxy](2026-10-27-guarded-proxy.json)   | Verified HTTPS, modern and legacy protocols, authorization and Host/Origin checks                   |
| [Native coverage](2026-10-27-guarded-coverage.txt) | 33 passing tests; 96.31% lines, 90.31% branches, 92.31% functions                                   |

The [older-Node HTTP diagnostic](2026-10-27-http-node24-old-diagnostic.json) completed with 13 request errors in 1,386,459 calls and a maximum driver event-loop stall of 20.75 seconds. It used the guarded runtime and Node 24.13.0. The [standalone AbortSignal probe](../reviews/evidence/reproduce-abort-signal.mjs) completed one million operations in [1.75 seconds on Node 24.22.1](2026-10-27-abort-signal-node24-current.json); the [24.13.0 attempt was stopped after at least 120 seconds](2026-10-27-abort-signal-node24-old-stopped.json) without completing. These observations support investigating the client runtime; they do not prove the exact cause of every HTTP failure.

A one-hour guarded stdio run and current-Node HTTP comparisons are in progress. Their results will be added only after completion. The earlier HTTP run failed; it is retained below rather than relabeled as a pass.

## Historical runs

| Evidence                                                               | Interpretation                                                                                                           |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| [Initial one-hour stdio](2026-10-26-initial-soak.json)                 | 12,550,140 calls, zero unexpected results; predates audit-stream and oversized-frame lifecycle fixes                     |
| [Follow-up one-hour stdio](2026-10-27-before-element-guard-stdio.json) | 14,170,871 calls, zero unexpected results; includes lifecycle fixes, predates the input-element guard                    |
| [Initial HTTP endurance](2026-10-27-before-element-guard-http.json)    | 2,219,345 calls, 54 unexpected results; Node 24.13.0 driver, no per-failure diagnostics, predates the element guard      |
| [Initial alpha record](2026-10-27-alpha.json)                          | Earlier local candidate and its file hashes; historical 30-test, package, container, and issuer checks                   |
| Initial `codex-host.json` and `claude-host.json` reports               | Earlier host acceptance before the element guard; superseded for current runtime identification by guarded reports above |

All load measurements ran on the same ARM64 DGX Spark host. Background validation and overlapping load runs occurred; these were not isolated capacity benchmarks. The reports use a small local document, four callers, and JSON audit to `/dev/null`. Stdio `startupMs` measures transport connection rather than first-call readiness. Latency percentiles cover the last 10,000 calls, not all calls. See [benchmark instructions](../BENCHMARKS.md).

Only synthetic fixtures and filtered reports belong here. Do not add raw assistant transcripts, credentials, issuer keys, real document contents, or local Git configuration.
