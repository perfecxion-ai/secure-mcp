# November 3 review remediation

These are maintainer-side reproductions and regression results following the supplied independent review. They are not independent reviewer acceptance of alpha.3. The supplied report, screenshots and raw journals remain local. Alpha.1 and the frozen alpha.2 bundle are unchanged; alpha.2 remains held.

## Changes and regression evidence

| Finding | Change | Evidence |
| --- | --- | --- |
| Durable audit bursts | Persistent bounded FIFO delivery, grouped append/sync acknowledgements, bounded sink shutdown | [PR 80](https://github.com/perfecxion-ai/secure-mcp/pull/80); real collector burst, kill/restart, forced sync failure and ENOSPC checks |
| HTTP admission | Authenticate headers before body buffering; reserve audit capacity through terminal acknowledgement; aggregate pre-admission rejection counters | [PR 86](https://github.com/perfecxion-ai/secure-mcp/pull/86); paired burst reproduction, flood recovery and disconnect regressions |
| Proxy body buffering | Buffer incomplete uploads outside runtime admission | [PR 89](https://github.com/perfecxion-ai/secure-mcp/pull/89); four incomplete authenticated uploads coexist with ten successful tool calls; disabling buffering makes the regression fail with 503 |
| Token interoperability | Accept both registered access-token media types, case-insensitively | [PR 79](https://github.com/perfecxion-ai/secure-mcp/pull/79); malformed, missing, unrelated and parameterized types remain rejected |
| Request targets | Validate one origin-form target before routing and audit labeling | [PR 86](https://github.com/perfecxion-ai/secure-mcp/pull/86); absolute-form, authority-form, normalized dot paths, fragments and backslashes rejected before SDK dispatch |
| Startup and shutdown | Fixed diagnostic reasons and schema-known field names; audit-unhealthy shutdown returns failure | [PR 81](https://github.com/perfecxion-ai/secure-mcp/pull/81); configuration, workspace, listener, EOF and signal tests |
| Audit interpretation | Server-generated stdio correlation; suppress duplicate protocol rejection only after the terminal tool audit is acknowledged | [PR 87](https://github.com/perfecxion-ai/secure-mcp/pull/87); both protocol versions, concurrent requests, privacy and failed-delivery tests |
| Protocol edges | Reject HTTP JSON-RPC batches before dispatch and reserved argument keys before handler execution; document exact Host and clock policy | [PR 86](https://github.com/perfecxion-ai/secure-mcp/pull/86), [PR 87](https://github.com/perfecxion-ai/secure-mcp/pull/87); raw stdio/HTTP regressions fail before the guard and pass afterward |
| Test robustness | Separate startup readiness from the unchanged bounded audit-call deadline; isolated synthetic Git fixture | [PR 88](https://github.com/perfecxion-ai/secure-mcp/pull/88); source-export tests also pass with six seconds of injected startup delay |

The original burst harness first reproduced the audit latch on the reviewed implementation. On the combined delivery/admission changes, 40, 48 and 56 concurrent authenticated calls returned bounded mixtures of 200 and 503, followed by healthy readiness and a successful new call without restart. With audit capacity 256 or 1,024, a 64-call burst returned 32 successes and 32 capacity rejections, then recovered. The unauthenticated four-second flood with 60 clients returned 80,421 responses, all 401, and health stayed 200. These are local regression observations on Linux ARM64 and Node 24.22.1, not a throughput or fairness guarantee. Scheduling and storage change the counts.

Four disconnect regressions cover both supported protocol versions and two acknowledgement schedules. They demonstrate that request admission remains reserved while cancellation and terminal records settle. All four fail on the original implementation and pass after the fix. Losing or ambiguously delivering an actual audit record still latches unhealthy; the remediation does not silently discard admitted tool outcomes to improve availability.

The real Keycloak browser lab also passed against remediated runtime source `e186537fa43553f470b58bcfc3f55e0ec18fae47` on Node 24.22.1 with Chromium `155.0.8059.39`. It covered verified HTTPS, browser login and consent, both MCP protocols, scope isolation, ID-token rejection, key rotation, issuer outage/recovery, logout, expiry, code replay and audit privacy. This source precedes the dependency refresh. The retained local report includes container digests and built-module hashes; it is a local integration test, not an operator trial with an organization's issuer.

Required CI on each merged PR covers the full suite, security mutations, short load runs, real collector failures, OAuth, container confinement, proxy behavior, SBOM generation and the exact packed consumer. Native x64 CI and local native ARM64 are distinct from the review's emulated amd64 run. The startup regressions do not establish that every test is reliable under every emulator.

## Acceptance and remaining limits

The supplied review's confidentiality, integrity and audit-privacy results remain attributed to that reviewed artifact. Regression passes do not turn alpha.3 into a production-certified server. Use a separately verified alpha.3 candidate manifest and its exact package bytes for new acceptance receipts.

The HTTP default is 21 admitted requests, bounded by three audit slots per request. Admission overload returns 503 with retry guidance and can recover; detected audit loss still requires restart. Finite sockets and partial headers require proxy/edge controls. A valid-token attacker can consume configured capacity, and detached writes from trusted embedded code are outside the HTTP admission accounting contract.

Pre-admission rejection counters reset on restart and are not durable per-request audit history. Authenticated admitted operations retain correlated audit records. An SSE response that already started cannot have its status changed after audit failure. `allowed` denotes admission, not completed document access; use terminal tool outcomes for completion counts.

Trusted handlers, trusted read-only workspaces, hard-link limits, tool-scoped authorization, token lifetime/revocation limits and prompt injection within granted authority retain their documented boundaries. Optional network checks in `--doctor` remain deferred in [#55](https://github.com/perfecxion-ai/secure-mcp/issues/55); it validates local setup only. The development-only dependency advisory remains in [#62](https://github.com/perfecxion-ai/secure-mcp/issues/62).

Exact-digest VS Code and Cursor receipts with restart and return use, independent remote-operator evidence, and adoption goals remain open in [#50](https://github.com/perfecxion-ai/secure-mcp/issues/50), [#51](https://github.com/perfecxion-ai/secure-mcp/issues/51) and [#57](https://github.com/perfecxion-ai/secure-mcp/issues/57). No human receipts were inferred from these automated labs. No tag, GitHub release, npm version or dist-tag was published by this remediation.
