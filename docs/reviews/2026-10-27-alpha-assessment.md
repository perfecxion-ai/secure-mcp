# Alpha follow-up assessment

Reviewed runtime: `c0a5f95b48253f69451be0cc8d7447f5eb970917`, with subsequent test, CI, and contribution changes through `eee12d17c5bb86559fdad12785b67b4d1614696b`. The runtime module hashes are recorded with the validation evidence. This assessment supplements the [v1 review](2026-10-26-assessment.md); it does not retroactively change that baseline's findings.

The replacement is a usable experimental runtime with reproducible security controls and working standard clients. It is not ready for a stable security-sensitive release. The next work should close evidence and extension-contract gaps, then test real operator adoption. Adding more tools or deployment systems would expand the maintenance burden before those gaps are resolved.

## What materially improved

| Area                      | Current evidence                                                                                                            | Limit                                                                            |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Protocol and installation | Official SDK, real stdio/HTTP clients, two protocol versions, clean tarball installation, isolated container smoke          | Linux and Node 24 only; successor remains unpublished                            |
| Identity                  | External JWT verification, pinned JWKS, scope isolation, key rotation/outage tests, client credentials and PKCE labs        | No immediate revocation, production IdP journey, or browser/MFA validation       |
| Tool boundaries           | Shared allowlist/scope/read-only policy, descriptor-anchored reads, input byte/element limits, bounded output and execution | Trusted handlers and operator-controlled workspaces; no untrusted-code isolation |
| Interoperability          | Versioned Codex and Claude Code reports; verified TLS through NGINX                                                         | Small, explicit acceptance workflows rather than universal host compatibility    |
| Maintenance               | Required checks, protected main, private security reporting, dependency automation, signed build provenance and SBOM        | Release promotion and an operator-maintained upgrade process are still needed    |
| Assurance                 | Regression tests, four control-removal mutation checks, raw benchmark reports                                               | Automated checks do not replace independent review or repeat users               |

## Outstanding findings

### A01 P1 HTTP endurance depends on the driver runtime

An initial 30-minute HTTP run on Node 24.13.0 recorded 54 unexpected results in 2,219,345 calls. Its driver RSS reached about 2.38 GiB while server RSS stayed below 351 MiB. That harness did not preserve error categories, so those failures cannot be assigned a precise cause retroactively.

The improved harness records bounded error categories, driver heap/RSS, event-loop delay, and progress. A repeat on the older Node patch recorded 13 request errors and a maximum driver event-loop stall of 20.75 seconds. Comparisons on Node 24.22.1, extracted from the pinned container image, and a standalone long-lived `AbortSignal.any()` probe distinguish client-side runtime behavior from server memory. The guarded 30-minute HTTP run on Node 24.22.1 then completed 5,094,415 calls with zero unexpected results and exit status 0. The guarded one-hour stdio run also passed with 16,901,942 calls on Node 24.13.0. See the [validation index](../validation/README.md) for completed reports and their limits.

Use a current Node 24 patch for both the server and benchmark driver. Do not describe a small number of successful short requests as endurance evidence. Do not discard the failed run when presenting newer results. A stable-release gate still needs a declared workload and sustained performance under the supported deployment environment.

### A02 P1 Remote audit coverage is incomplete

Admission audit failure prevents handler execution, and tool outcomes have content-free audit records. However, failed authentication, Host/Origin rejection, SDK wire/schema rejection, and some cancellation/saturation outcomes do not have a complete correlated audit trail. A successful call also does not prove durable remote ingestion: current load tests send JSON audit to `/dev/null`.

Next change: define bounded transport events and trusted correlation IDs, then cover authentication and wire rejection without recording bearer tokens, arguments, raw paths, or unbounded labels. Test backpressure, collector failure, cancellation, and shutdown. Specify which failures deny work and how an operator detects incomplete delivery. Do not add an unbounded logging queue.

### A03 P2 Custom schema transforms are applied repeatedly

`SecureRuntime.invoke()` parses input, and the `defineTool()` wrapper parses it again. SDK invocation adds its own input parse. A type-changing transform such as `z.strictObject({ n: z.string().transform(Number) })` accepts `{ n: '1' }` on its first parse, then fails when the parsed number is validated as a string again. The [direct library reproduction](evidence/reproduce-alpha-transform.mjs) returned `internal` without calling the handler. Run it after `npm ci` and `npm run build`; it deliberately exits nonzero while the defect is present. Shape-preserving transforms and refinements can also run more than once.

The built-in tools use strict schemas without transforms. Custom integrations should do conversion inside their trusted handler until this contract is repaired. Refinements should be deterministic and free of side effects.

Next change: give the trusted SDK callback and raw library invocation explicit validation boundaries, preserve typed parsed values, and execute transforms exactly once. Regression cases must cover direct calls and both transports, defaults/coercion/transforms, rejected input, and exceptions from custom validation. Keep the pre-validation element bound and safe error handling intact.

### A04 P1 Release and migration decisions need external evidence

The historical npm 1.0.0 package is still v1. The alpha removes its identity storage and endpoints rather than migrating them. Existing users, patched deployments, and stored credentials have not been inventoried. No release should assume there are zero consumers.

Private vulnerability reporting and artifact attestation are configured. Publication is still disabled. Before promotion, inventory consumers, agree on any migration or credential invalidation notice, select an immutable tested artifact, and verify its source commit, workflow identity, provenance, and SBOM. Publication needs a deliberate maintainer decision after those gates pass.

## Next execution sequence

1. Repair custom-tool validation ownership with regression cases. Keep it separate from new tools or providers.
2. Complete bounded remote audit coverage and exercise a real collector under failure and load.
3. Validate one operator-owned identity provider through actual browser login, consent, logout/expiry, rotation, and outage behavior behind TLS. Record exact host and provider versions.
4. Finish the performance contract: current Node patch, fixed workload and concurrency, no-op overhead measured separately from document I/O, explicit acceptance thresholds, and repeatable long runs.
5. Implement immutable artifact promotion while leaving publication off until migration and release approval are settled.
6. Collect three independent successful onboardings, two repeat users, and one substantive external integration or contribution. Use that feedback to select the next tool workflow.

Each item should be a focused PR or a versioned operator report. The first two are implementation work. Production identity, existing-consumer inventory, independent security review, and adoption require participation outside this local lab. No external users have been contacted as part of this work.
