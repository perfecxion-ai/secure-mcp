# Alpha.3 consumer trial receipt template

Status: template, not a completed trial. No alpha.3 candidate is frozen yet. Fill this from actual observations after receiving its exact candidate packet. Use one receipt per tester/host, and retain earlier alpha.1 reports and alpha.2 review evidence without backfilling or transferring their results. Agent runs must be labeled engineering checks.

## Artifact and environment

| Field | Observed value |
| --- | --- |
| Tester identifier and independent human / engineering check | |
| Trial dates, first and return sessions | |
| Package version | |
| Source SHA and CI run URL | |
| Tarball SHA-256 independently computed by tester | |
| Authenticated source of expected digest; comparison result | |
| Desktop OS/version and architecture | |
| Server OS/version and architecture | |
| Node version and executable selection method | |
| npm version | |
| MCP host exact version, build and harness | |
| Configuration destination and format | |
| Transport and where the MCP process runs | |
| Authentication profile (local process trust or remote issuer) | |
| Issuer product/version and token contract, if remote | |
| Consumer lockfile SHA-256 and sanitized evidence location | |
| Prerequisite time and product setup time, measured separately | |

Do not record tokens, secrets or identifiable private infrastructure. Record exact commands with sensitive values replaced by consistent placeholders; retain their real values privately if needed for reproduction.

## Observations

| Step | Commands or tool inputs | Expected outcome | Actual result and evidence |
| --- | --- | --- | --- |
| Digest verification and exact artifact installation | | Match and install succeeds | |
| Doctor and generated host configuration | | Supported runtime and workspace, explicit paths | |
| Discovery and approved document read | | Intended tools and approved content | |
| Traversal, hidden path and symlink rejection | | No unauthorized content | |
| Policy inspection | | Read-only, intended tools/scopes | |
| Audit inspection | | Correlated outcome, no content/token/path canaries | |
| First useful task | | State the desired user outcome | |
| Clean stop and restart | | Successful subsequent call | |
| Second useful task in a return session | | State a distinct useful outcome | |
| Friction and manual interventions | | Reproducible explanation | |

For remote operator trials additionally record distinct-principal scope separation, invalid/expired token behavior, collector interruption, unhealthy/fail-closed behavior, recovery after delivery repair and service restart, and audit capacity/retention operations. Record the token media type, transport protocol version, HTTP status and MCP result separately. Count terminal tool outcomes separately from admission events; pre-admission HTTP rejections use aggregate metrics rather than individual audit events. A local host pass does not establish remote authentication coverage.

## Decision

Record pass/fail per step, unresolved defects and issue links, what the tester would use again, and permission to publish the sanitized receipt. Do not infer independent cryptographic verification from saved maintainer reports: distinguish a digest check via authenticated handoff from fresh signature verification.

Minimum npm-alpha evidence is two independent testers on two hosts (VS Code and Cursor), each with a digest-bound receipt, clean restart and repeat useful work. Remote operator evidence is required while remote authentication remains a principal launch claim. The broader adoption target remains three independent successful users, two returning users and one externally authored useful integration. Internal automation cannot satisfy those independent usage goals.
