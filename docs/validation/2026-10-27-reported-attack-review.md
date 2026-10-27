# Reported attack review

The maintainer supplied a `FINDINGS.md` summary dated October 27, 2026. Its SHA-256 is `ad933eb1da29d5adebeb70beea4e96fed017d809f0b8da940ce4f540422f7370`. The summary identifies tested source commit `fd0980f0b539e804124bc20daa583a04e199d772`, Node 24.22.1, npm 11.19.1, and a separate cloud VM lab.

The identified revision has the same runtime source, dependency manifests, lockfile, and TypeScript build configuration as selected candidate `1f9f7860696c4fae1bab650ab7f8c77513350657`. This comparison establishes source correspondence. The summary does not supply the tested package digest, compiled-module hashes, probe harnesses, or raw results. It does not establish that the exact attested tarball was used. Infrastructure identifiers are omitted here.

## Reported observations

- Clean installation and build, 44 passing tests, package smoke success, and no dependency-audit findings at the time of review.
- All 24 reported HTTP probes met expectations, including defective/forged tokens, RS256 algorithm restrictions, Host/Origin rejection, scope-filtered discovery/invocation, metrics access, and oversized bodies.
- Traversal, absolute/hidden paths, backslashes, NUL bytes, directories, symlink files/components, oversized/non-UTF-8 documents, unknown fields, and excess input elements were rejected. Oversized stdio frames terminated the server as designed.
- Audit events omitted the tested workspace, filename, and content canaries. The summary correctly describes the actor as SHA-256 of issuer, a NUL separator, and subject.
- A hard-linked file inside the workspace remained readable, consistent with the documented operator-controlled workspace boundary.

These are reported observations, not an independently reproduced test run or a formal security certification. The raw probes remain unavailable to the repository maintainer's local checkout. No formal reviewer independence or complete attack coverage is inferred from this summary.

## Follow-up

The [threat model](../THREAT_MODEL.md) and [operations guide](../OPERATIONS.md) now state explicitly that actor hashes are unsalted and correlatable. They also clarify that a read-only mount does not neutralize existing hard links or changes through another writable alias. Workspace preparation requires trusted copies of approved data.

The maintained [RS256 HTTP regression test](../../tests/http-identity.test.ts) adds named cases for public-key/HMAC confusion, an algorithm published in JWKS but excluded by server configuration, wrong signing keys, defective claims, and subject bounds. It verifies safe HTTP responses, anonymous rejection audit, and no tool execution for rejected identities. A mutation probe verifies that broadening the configured signing-algorithm allowlist makes the test fail. These locally executed regressions are distinct from the reported cloud run and do not reconstruct its missing harness.

Fresh-install onboarding and repeat-use feedback remain the next adoption gate. This report supplies attack-review feedback, not evidence of three independent users or production approval. Preserve sanitized probe scripts, results, and environment details if the lab artifacts become available; their absence does not block development.
