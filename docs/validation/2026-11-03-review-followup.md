# Independent review follow-up

This records the initial remediation plan. See the [completed regression work and remaining acceptance gates](2026-11-03-remediation.md) for the follow-up results. Current publication configuration is described in [npm preparation](../NPM_PUBLISHING.md); the initial disabled policy below is historical context, not the current setup state.

The maintainer supplied the November 3 review and raw lab evidence at `secure-mcp-review-2026-11-03` on Spark. The downloaded tarball and SBOM hashes match the frozen alpha.2 record. The report evaluated source `42282c0`, with frozen package source `ba16751`; it reports successful confinement, authentication, authorization and audit-privacy probes, plus availability and operability findings. The full report and raw traces remain local. This summary tracks remediation and does not republish the review or its screenshots.

Alpha.2 was held for remediation. Its exact tarball and prior receipts were preserved; runtime changes target `2.0.0-alpha.3`. At the start of this work, no alpha.3 candidate or digest was selected, the npm setup policy was disabled, exact-artifact approval variables were unset, and the hosted tag restriction was unchanged. Publication tooling remained pinned to the earlier candidate until successor configuration could be reviewed. No registry write, tag or release was authorized by that plan.

| Finding | Work | Acceptance |
| --- | --- | --- |
| F1 durable audit bursts | #71 | Bounded delivery and admission; fsync acknowledgement and fail-closed loss handling preserved; burst and recovery evidence |
| F2 HTTP admission before identity | #72 | Header authentication before body buffering, separate bounded verification/execution budgets, proxy limits stated |
| F3 access-token media types | #73 | RFC-defined forms accepted; malformed and unrelated types rejected |
| F4 HTTP request targets | #74 | One validated routing/audit target, safe rejection before the SDK adapter |
| F5 startup diagnostics | #55 | Actionable fixed reasons and schema-known fields without values, paths or secrets |
| F6 observability | #75 | Explicit counting/correlation, failed audit reflected at shutdown, consistent unavailable responses |
| F7 protocol edge cases | #76 | Specification-based batch handling, reserved-key evidence, explicit clock and Host policy |
| F7 test robustness | #77 | Bounded readiness-based tests, source-export fixtures, honest coverage/emulation results |

Three agents own audit delivery, diagnostics/shutdown, and JWT/test reliability in isolated worktrees. The lead owns HTTP admission/targets, release metadata, integration and small PRs. Required CI and peer review precede merges. Reproduce priority failures before the fix, retain the reproduction, and rerun affected transport, collector, proxy and issuer checks. Do not describe local regression tests as independent retesting by the reviewer.

The supplied review reports 119 native ARM64 tests passing, one cancelled test under emulated amd64, a passing browser/Keycloak lab and reproducible package bytes. These are attributed results until separately reproduced. It explicitly did not complete live LLM-host trials, hour-long endurance or independent remote-operator acceptance. Issues #50 and #51 remain open. Native x64 CI and emulated amd64 are different evidence classes.

After remediation, prepare one new candidate with its own source, digest, signed inventory and fresh consumer evidence. Then collect exact-version VS Code/Cursor restart and return-use receipts and the operator evidence needed for the retained remote claim. The npm trust validation deadline does not waive these gates. The development minimatch advisory remains in #62.
