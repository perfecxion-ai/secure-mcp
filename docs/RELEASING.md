# Preparing a prerelease

The first [GitHub prerelease, `2.0.0-alpha.1`](https://github.com/perfecxion-ai/secure-mcp/releases/tag/v2.0.0-alpha.1), was published after maintainer approval using the already-tested tarball. This procedure governs subsequent prerelease preparation. It is a limited experimental distribution, not a stable production release. npm publication and MCP registry submission remain separate decisions. The publication workflow remains disabled; each publication needs an approved concrete release. Alpha.1 is explicitly rejected for npm promotion. Prepare alpha.2 under [the readiness plan](https://github.com/perfecxion-ai/secure-mcp/issues/57), with [separate npm identity and approval preparation](NPM_PUBLISHING.md).

## Pin the artifact and evidence

Select an exact source commit, version and digest from the reviewed candidate packet. The [existing candidate record](validation/CANDIDATE.md) is historical alpha.1 evidence, not an alpha.2 approval. No final alpha.2 digest has been selected. Version equality does not establish artifact equality. Once a candidate is distributed to reviewers, do not replace its bytes under the same version; use a new prerelease version after package changes.

Download an unexpired CI artifact with `scripts/prepare-validation.mjs`, or use the retained operator-owned bundle. Recheck it with the current verifier:

```bash
: "${MCP_SOURCE_SHA:?Required from the reviewed candidate packet}"
: "${MCP_BUNDLE:?Required verified bundle directory}"
node scripts/verify-validation.mjs "$MCP_SOURCE_SHA" "$MCP_BUNDLE"
```

This uses GitHub CLI to verify provenance and SBOM signatures again, pins the source/ref/workflow, binds the manifest's workflow run to signed provenance, compares the SBOM with its signed predicate, and checks package metadata and checksums. It ignores saved success reports as trust inputs. It does not download the Actions artifact, rebuild, install, or publish anything. It still needs access to GitHub's attestation service and a compatible authenticated `gh`. Run it in an operator-owned directory without concurrent writers.

The [release-verification record](validation/2026-10-28-release-verification.json) records a successful retained-bundle check, a fresh download, and rejection of a modified tarball.

For a final consumer check, use `scripts/package-smoke.mjs --artifact /absolute/path/to/the.tgz`. Retain its result and the verifier output. Do not replace the candidate tarball with a new `npm pack` output, even if the version matches.

## Prepare a reviewable release packet

Use a new private staging directory. Copy only the package tarball, `sbom.cdx.json`, `SHA256SUMS`, `validation-manifest.json`, `provenance-verification.json`, and `sbom-verification.json` from the verified bundle. Do not copy local installations, client configuration with machine paths, raw transcripts, audit journals, or credentials.

Add release notes, the current installation guide, and the current operations/threat-model documents. Link the documentation to its own source revision; later documentation does not change the package's attested source. Record checksums for the supplemental assets separately from the original bundle's `SHA256SUMS`, then run the verifier against the staging directory again. Supplemental notes and guides are not covered by the tarball's attestation.

The proposal must identify:

- Candidate version and matching release tag, with prerelease enabled and latest disabled.
- Tag target matching the selected package source, including the reviewed workflow, rather than a newer documentation head. Never move or overwrite an existing tag.
- Exact asset filenames and SHA-256 digests, source/workflow provenance, and the separate documentation revision.
- Linux and Node 24.22.1 or later supported Node 24 patch requirements, explicit workspace setup, and the verified-bundle onboarding path.
- Implemented controls and trust boundaries, measured acceptance, reported human-review coverage, known limits, and the private vulnerability-reporting channel.
- Explicit publication scope and maintainer decision. A successful CI run or a review pass alone does not publish a release.

The [human-review record](validation/2026-10-28-human-review.md) reports two passing testers on VS Code and Cursor. Exact versions, repeat-use details, and remote-issuer coverage are not recorded. Present that evidence as reported; do not claim the original three-user adoption target or production approval. The alpha.2 npm decision requires fresh exact-digest two-host trials with repeat use, plus independent operator evidence while remote authentication remains a principal launch claim. Keep post-freeze receipts as supplemental evidence with their own revision; do not rebuild the package to include them.

## Publish only the approved packet

After the maintainer approves the proposal, use the selected source tag and upload the exact staged files. Do not rebuild or silently substitute assets during publication. Download the published files into a new directory, compare their checksums, and run the same bundle verifier and package smoke check. Record the release URL and verification results before announcing availability.

This GitHub prerelease does not authorize `npm publish`, a `latest` npm dist-tag, container publication, or MCP registry submission. Those require their own reviewed promotion and identity configuration. The selected package's AGPL-3.0-or-later license remains unchanged.

## Recovery and rollback

For a failed isolated trial, stop its server/collector, remove the test profile's MCP entry, and remove only the trial's installation and fixture directories. Preserve sanitized failure evidence and the downloaded tarball/digest for investigation. No existing installation or credentials were migrated by this workflow.

If a released artifact is found unsafe, mark the prerelease as withdrawn and stop recommending it. Publish a clear advisory with affected digests and corrective instructions through the repository's security process. Do not overwrite the existing tag or replace an asset under the same version; issue a new version with fresh provenance and validation. Revoking an identity at an issuer does not immediately revoke already-issued JWTs; follow the documented token lifetime and JWKS-cache limits.
