# Alpha follow-up assessment

Reviewed runtime: `c0a5f95b48253f69451be0cc8d7447f5eb970917`, with subsequent test, CI, and contribution changes through `eee12d17c5bb86559fdad12785b67b4d1614696b`. Follow-up dispositions below include repairs through `1f9f7860696c4fae1bab650ab7f8c77513350657`; the original findings retain their baseline. The runtime module hashes are recorded with the validation evidence. This assessment supplements the [v1 review](2026-10-26-assessment.md); it does not retroactively change that baseline's findings.

The replacement is a usable experimental runtime with reproducible security controls and working standard clients. It is not ready for a stable security-sensitive release. The follow-up closes the extension-contract and local evidence gaps described below. Independent operator adoption is the next gate; use the candidate record for exact acceptance status. Additional tools and deployment systems should follow that feedback.

## What materially improved

| Area                      | Current evidence                                                                                                            | Limit                                                                                        |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Protocol and installation | Official SDK, real stdio/HTTP clients, two protocol versions, clean tarball installation, isolated container smoke          | Linux and Node 24 only; successor remains unpublished                                        |
| Identity                  | External JWT verification, pinned JWKS, scope isolation, key rotation/outage tests, client credentials and PKCE labs        | No immediate revocation or organization-specific MFA validation                              |
| Tool boundaries           | Shared allowlist/scope/read-only policy, descriptor-anchored reads, input byte/element limits, bounded output and execution | Trusted handlers and operator-controlled workspaces; no untrusted-code isolation             |
| Interoperability          | Versioned Codex and Claude Code reports; verified TLS through NGINX                                                         | Small, explicit acceptance workflows rather than universal host compatibility                |
| Maintenance               | Required checks, protected main, private security reporting, dependency automation, signed build provenance and SBOM        | Verified fresh-install artifact available; public release and operator upgrades remain gated |
| Assurance                 | Regression tests, four control-removal mutation checks, raw benchmark reports                                               | Automated checks do not replace independent review or repeat users                           |

## Follow-up findings and dispositions

### A01 P1 HTTP endurance and measurement evidence

An initial 30-minute HTTP run on Node 24.13.0 recorded 54 unexpected results in 2,219,345 calls. Its driver RSS reached about 2.38 GiB while server RSS stayed below 351 MiB. That harness did not preserve error categories, so those failures cannot be assigned a precise cause retroactively.

The improved harness records bounded error categories, driver heap/RSS, event-loop delay, and progress. A repeat on the older Node patch recorded 13 request errors and a maximum driver event-loop stall of 20.75 seconds. Comparisons on Node 24.22.1, extracted from the pinned container image, and a standalone long-lived `AbortSignal.any()` probe distinguish client-side runtime behavior from server memory. The guarded 30-minute HTTP run on Node 24.22.1 then completed 5,094,415 calls with zero unexpected results and exit status 0. The guarded one-hour stdio run also passed with 16,901,942 calls on Node 24.13.0. See the [validation index](../validation/README.md) for completed reports and their limits.

Use a current Node 24 patch for both the server and benchmark driver. Do not describe a small number of successful short requests as endurance evidence. Do not discard the failed run when presenting newer results. The follow-up now has a declared [performance contract](../validation/PERFORMANCE_CONTRACT.md), separate audit overhead measurement, explicit server exit checks, final HTTP audit counters, and a durable journal reconciliation step. See the [candidate record](../validation/CANDIDATE.md) for its completion status. Target-operator performance remains a later release gate.

### A02 P1 Remote audit coverage and durable delivery

The initial assessment found missing transport rejection and terminal records. Bounded transport audit now records HTTP status/rejection, SDK protocol failures, and tool cancellation/saturation with server-generated correlation IDs. Audit failure latches readiness unhealthy. A separate collector now acknowledges file sync, bounds pending work and storage, and fails closed on delivery loss. Kill/restart, blocked delivery, journal capacity, and actual OS-level ENOSPC probes pass. The current candidate endurance run uses this collector; its final reconciliation is recorded separately. Earlier `/dev/null` runs do not establish persistence.

Transport events use fixed categories and server-generated correlation IDs. Tool timeout, cancellation, saturation, and shutdown records do not compete for execution slots. Auditing an error response can no longer suppress the error itself: callers receive a generic audit_unavailable response, while readiness stays unhealthy. Socket terminal records and failures before the runtime request handler remain explicit loss boundaries; this is not a lossless or tamper-resistant audit system.

### A03 P2 Custom schema transforms were applied repeatedly (resolved)

`SecureRuntime.invoke()` parses input, and the `defineTool()` wrapper parses it again. SDK invocation adds its own input parse. A type-changing transform such as `z.strictObject({ n: z.string().transform(Number) })` accepts `{ n: '1' }` on its first parse, then fails when the parsed number is validated as a string again. The [direct library reproduction](evidence/reproduce-alpha-transform.mjs) returned `internal` without calling the handler. Run it after `npm ci` and `npm run build`; it deliberately exits nonzero while the defect is present. Shape-preserving transforms and refinements can also run more than once.

The validation boundary now belongs to `SecureRuntime`. The SDK advertises the input JSON schema and checks the wire envelope and element budget; custom schema parsing runs once inside runtime policy, capacity, deadline, and safe-error handling. Asynchronous refinements are supported. A timed-out validator retains its slot until it settles and cannot subsequently invoke the handler. Validator exception text is not returned to callers.

Regression tests cover direct calls and both stdio/HTTP protocol generations, advertised input types, transforms, defaults, coercion, unknown fields, unsafe validator exceptions, and delayed validation. The historical reproduction now passes.

### A04 P1 Release and migration decisions need external evidence

The historical npm 1.0.0 package is still v1. The alpha removes its identity storage and endpoints rather than migrating them. Existing users, patched deployments, and stored credentials have not been inventoried. That historical concern applies to legacy remediation and in-place migration; the selected next-version trial uses fresh installations.

Private vulnerability reporting and artifact attestation are configured. A fresh-install trial can use the immutable verified package without importing v1 state. The preparation script selects a successful main artifact, verifies source/workflow identity, and compares the downloaded SBOM with its signed predicate; an altered tarball and non-main selection are rejected. In-place migration would require a separate inventory and migration decision; it is outside this workstream. Publication of the next version requires deliberate maintainer approval and remains disabled.

## Next execution sequence

Custom-schema validation, bounded transport audit, durable collector faults, real browser/Keycloak lifecycle, the performance contract, and immutable artifact preparation are implemented. The [candidate record](../validation/CANDIDATE.md) is the source of truth for completed local acceptance; do not substitute earlier measurements.

Next, collect three independent fresh installations across two MCP hosts and one remote issuer deployment, followed by repeat use and one substantive external integration or contribution. Validate the operator's own identity/MFA policy, audit retention, and workload. Obtain independent security review before stable release. Legacy deployment inventory and migration are outside this next-version workstream. Use that evidence to choose the next useful tool workflow. No external users have been contacted by this work.
