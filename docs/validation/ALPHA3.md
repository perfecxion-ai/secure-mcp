# Alpha.3 validation candidate

This is the frozen successor to the held alpha.2 candidate. It is ready for isolated fresh-install acceptance, not approved for npm publication. Alpha.1's GitHub release and the retained alpha.2 bytes remain unchanged. This record is supplemental documentation; it does not rebuild or replace the package.

| Identity | Selected value |
| --- | --- |
| Package | `@perfecxion/secure-mcp-server@2.0.0-alpha.3` |
| Source commit | `7b05016eb832031efd0f2521bb6bef22e321ee28` |
| Successful main CI | [41698956383](https://github.com/perfecxion-ai/secure-mcp/actions/runs/41698956383) |
| Actions artifact | `13262273286`, `verified-alpha-7b05016eb832031efd0f2521bb6bef22e321ee28` |
| Artifact retention | Until `2027-02-01T18:59:07Z`; the handoff kit retains the downloaded bytes |
| Tarball | `perfecxion-secure-mcp-server-2.0.0-alpha.3.tgz` |
| Tarball SHA-256 | `9e19181fe772c0bacbeac68cb8a0fb03d85c7f978b6db79480c8d3c0a0953eaa` |
| SBOM SHA-256 | `03aedb429525bade2e9b112b8b18e836520ef2d679a83f87f6ede1f8921a422e` |

Fresh cryptographic verification binds build provenance to this source, `refs/heads/main` and `ci.yml`; the downloaded SBOM matches its signed predicate. The retained bundle was verified again after download. Saved verification reports are evidence of that run, not trust inputs for a later verifier. Version equality alone does not identify these bytes. The [machine-readable record](2026-11-03-alpha3-candidate.json) includes consumer evidence digests, runtime binding and the kit archive checksum.

## Engineering evidence

The [remediation record](2026-11-03-remediation.md) documents the original findings, fixes and remaining boundaries. Required CI passed all 208 tests, security mutations, short benchmarks, actual collector and storage-failure tests, OAuth, container confinement, TLS proxy, SBOM generation and the exact-tarball consumer check. Both validation and attestation jobs completed successfully.

| Check | Result and scope |
| --- | --- |
| Native Linux x64 consumer | Node 24.22.1, npm 11.19.1; exact CI tarball, both protocols, discovery/read/rejection/privacy/EOF and triage passed |
| Native Linux ARM64 consumer | Same exact tarball and toolchain; the same consumer checks passed on Spark |
| Consumer dependencies | Both fresh graphs match all seven production dependencies in the signed SBOM, including integrity identifiers and edges; lockfiles retained |
| Dependency verification | Both consumer audits report zero findings and dependency signature checks pass; local tarball root is verified with GitHub attestations, not claimed as an npm-signed package |
| Installed guide | Verbatim handoff install commands with only paths substituted passed in non-login Bash and a trial path containing a space; direct `dist/cli.js` doctor and triage verifier succeeded |
| Connection boundary | Both protocol clients completed 2,100 calls across the default 1,000-request connection limit with no unexpected failures or dropped requests |
| Durable collector endurance | Five minutes, four clients, 10 ms pacing, 28,099 calls, zero unexpected failures, health 200, zero audit loss and clean driver/server/collector exits |
| Browser and issuer | Local Keycloak/Chromium HTTPS integration passed login, consent, both protocols, scope separation, key rotation, outage/recovery, logout/expiry, replay and audit privacy |
| Runtime evidence binding | All 15 packaged runtime modules, the collector bytes and the installed lab production dependency graph match the corrected browser/endurance build |
| npm dry-run | The exact tarball passed locally with scripts disabled, empty npm configuration and no publishing credentials; its digest remained unchanged |

The five-minute result is a regression run on a shared host, not an isolated capacity measurement, an hour-long soak or independent operator acceptance. The earlier failed run is preserved alongside it. Historical alpha.1 endurance and human passes are not alpha.3 measurements. The development-only minimatch advisory remains tracked in [#62](https://github.com/perfecxion-ai/secure-mcp/issues/62); it is absent from the shipped production graph.

## Reverify and trial

Use a compatible authenticated GitHub CLI with `attestation verify`, `--source-ref`, `--source-digest` and `--signer-workflow`. Maintainer verification used GitHub CLI 2.103.3. Select Node `>=24.22.1 <25` in each new shell before running npm or the scripts. From the repository, a new download can be prepared without rebuilding:

```bash
MCP_SOURCE_SHA=7b05016eb832031efd0f2521bb6bef22e321ee28
MCP_EXPECTED_SHA256=9e19181fe772c0bacbeac68cb8a0fb03d85c7f978b6db79480c8d3c0a0953eaa
MCP_BUNDLE="$HOME/secure-mcp-alpha3-verified"
node scripts/prepare-validation.mjs "$MCP_SOURCE_SHA" "$MCP_BUNDLE"
node scripts/verify-validation.mjs "$MCP_SOURCE_SHA" "$MCP_BUNDLE"
printf '%s  %s\n' "$MCP_EXPECTED_SHA256" \
  "$MCP_BUNDLE/perfecxion-secure-mcp-server-2.0.0-alpha.3.tgz" | sha256sum --check -
```

The download directory must not already exist. For a retained handoff bundle, skip preparation and run the verifier against that bundle. Obtain the expected source and digest through this authenticated repository record or the maintainer; a checksum inside an untrusted archive is not authentication.

The retained Spark kit is `~/secure-mcp-alpha3-validation-2026-11-03`, with an archive at the same path plus `.tar.gz`. Start with `START_HERE.md`. It includes the unchanged bundle, exact extracted package references, both consumer lockfiles and reports, runtime evidence, checksums and blank VS Code, Cursor and remote-operator receipts. `CANDIDATE.json` indexes the evidence. The kit checksum list covers transport integrity and is not a signature. Copy blank receipts before filling them so the retained kit stays verifiable.

Testers handed the verified bundle can use the [packaged fresh-install guide](REAL_USER_VALIDATION.md) without a checkout, build, `npm ci` or GitHub CLI. npm registry access is still needed for dependencies. Use the installed `dist/cli.js` and an explicit supported Node path. Doctor checks local configuration and workspace access, not issuer/collector reachability.

## Remaining gates

No alpha.3 human or independent remote-operator acceptance is claimed. [#50](https://github.com/perfecxion-ai/secure-mcp/issues/50) needs exact-version VS Code and Cursor trials with restart and a second useful session. [#51](https://github.com/perfecxion-ai/secure-mcp/issues/51) needs an independent operator's issuer/audit setup while remote authentication remains a principal launch claim. Three successful independent users, two returning users and an external integration remain separate adoption goals.

A successful registry read on November 3 returned only `1.0.0`, with `latest=1.0.0`; alpha.3 was absent. The protected environment restricts deployment to `v2.0.0-alpha.3`, requires `scthornton` review, prevents self-review and disallows administrator bypass. Exact-artifact approval variables remain unset, no alpha.3 tag exists, and no hosted publication workflow was dispatched. The npm UI's earlier Pending validation report is setup evidence, not successful OIDC publication. Its timer does not waive acceptance gates.

The final npm decision still needs the missing receipts, authenticated withdrawal authority, separate authorization of the source tag and exact artifact, hosted read-only preflight and protected approval. Publish only these same bytes after that decision; keep `latest` unchanged. A later package change requires a new version and new receipts. Container and MCP-registry publication remain separate decisions.
