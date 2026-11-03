# npm publication preparation

This is a settings and evidence checklist for issues [48](https://github.com/perfecxion-ai/secure-mcp/issues/48) and [49](https://github.com/perfecxion-ai/secure-mcp/issues/49). Development and publication tooling target alpha.3, with no frozen candidate or selected digest. The setup policy is enabled after revalidating GitHub restrictions, but no release tag exists and exact-artifact approval variables remain unset. A concrete candidate decision and required human environment review still block publication. Nothing here authorizes a registry write or changes the existing GitHub alpha.1 release or retained alpha.2 bytes, which remain held for remediation.

## Observed account and repository state

During the alpha.2 preparation, a successful public registry read returned only version `1.0.0`, with `latest=1.0.0`. Public npm owner metadata listed `scthornton`. That identifies a listed owner, not proof that the current session can authenticate as that owner or change publisher settings. An explicit npm authentication check did not establish an authenticated identity in this session; npm publisher settings are recorded from the maintainer's authenticated UI report, not independently queried by this session.

The GitHub repository is `perfecxion-ai/secure-mcp`. Its main branch requires the `Validate runtime` check with strict up-to-date checks and enforces protection for administrators. On November 3, 2026 at 18:27 UTC, authenticated API reads revalidated the protected `npm-alpha` environment (ID `26083491597`), required reviewer `scthornton` (User ID `38704968`), self-review prevention and `can_admins_bypass: false`. Its single allowed deployment tag is now `v2.0.0-alpha.3` (policy ID `65295025`), replacing the earlier alpha.2 restriction. Repository variables `NPM_ALPHA_APPROVED_SOURCE` and `NPM_ALPHA_APPROVED_SHA256` were absent. These reads establish the recorded GitHub state, not npm publishing authority.

The earlier npm setup receipt remains a maintainer UI report: saved settings matched the repository, workflow and environment, with direct npm publish and npm stage publish permitted. That receipt records Pending validation and a first-publication validation deadline of November 5, 2026 at 01:43 UTC. The GitHub revalidation does not renew that npm receipt or prove working OIDC publication. Recheck both services before approval.

Both GitHub accounts belong to the same maintainer. This separates workflow initiation and approval by account; it is not an independent two-person review.

## Proposed settings

| Setting | Required value or evidence |
| --- | --- |
| npm package | `@perfecxion/secure-mcp-server` |
| Registry | `https://registry.npmjs.org/` |
| GitHub owner/repository | `perfecxion-ai/secure-mcp` |
| Trusted workflow filename | `publish.yml` |
| Protected environment | `npm-alpha` |
| Allowed publishing action | Explicit direct `npm publish` permission |
| Reviewer | An authorized maintainer, recorded before enabling the workflow |
| Ref restriction | Approved release tag resolving to the exact reviewed source commit |
| Runner | GitHub-hosted Linux; no DGX publishing identity |
| Permissions | `contents: read`; `id-token: write` only on the approved publishing job |
| Authentication | OIDC trusted publisher; no stored token fallback |
| Tag | Explicit `alpha`, with all other tags checked for unintended changes |

The protected environment must have required human review, restricted deployment refs and no administrator bypass. Record whether self-review is prevented and who can dispatch versus approve. If the available repository plan or reviewer setup cannot enforce these controls, keep publication blocked and resolve the limitation rather than substituting an unprotected workflow.

Configure the npm trusted publisher to bind the exact repository, workflow filename and environment. Confirm control of the npm package using the owner's authenticated settings, then retain a sanitized settings receipt. GitHub account control is not npm scope ownership.

The [npm trusted-publisher documentation](https://docs.npmjs.com/trusted-publishers/) currently requires npm 11.5.1 or later and GitHub-hosted runners. Direct publication and dist-tag management are independently granted actions. Recheck these requirements when implementing the workflow. Use a pinned toolchain compatible with the package runtime requirement.

## Preflight and approval packet

The dedicated `npm-preflight.yml` workflow implements read-only preparation. It has no publishing token, OIDC permission or protected-environment declaration; it cannot silently create an unprotected publishing environment. `publish.yml` contains separate preflight, protected publication and verification jobs. Its setup gate is configured for alpha.3, but there is no selected candidate/tag and its exact-artifact repository variables are unset. No actual publication or complete end-to-end publisher run has occurred. The [retained alpha.2 candidate](validation/ALPHA2.md) is held; it is not the successor selected for new acceptance or publication.

The tooling's pinned version/tag policy and hosted restriction now target `v2.0.0-alpha.3`; this does not create that tag or select its artifact. After the final candidate source and digest are selected, a maintainer must separately authorize creation of the matching release tag. The workflow must already exist at that commit. Dispatch the preflight from that exact tag with its source SHA, independently selected tarball SHA-256 and successful main CI run ID. It creates no tags and rejects branch dispatches, mismatched workflow/checkout sources, disallowed versions and registry errors. Do not create a provisional tag merely to test this workflow.

Preflight uses the pinned Node 24.22.1 and checks for npm 11.19.1. It checks GitHub CLI support for the required source/ref/workflow verification flags and fails with an update instruction if the runner's CLI is too old. The saved report records the resolved toolchain. Its unconditional `npm publish --dry-run --ignore-scripts` runs outside the checkout with empty npm configuration files and the explicit public registry and alpha tag.

Download the `npm-preflight-SOURCE_SHA` report artifact to inspect the verified source/run, digest, complete registry tag snapshot, target-version absence and dry-run result. This report does not establish npm publishing authority, protected settings, human acceptance, or approval. The existing candidate bundle remains the authoritative retained artifact. No live preflight has been run before the candidate and tag exist; local policy and dry-run tests do not claim GitHub signature verification for a future artifact.

Prepare a read-only job that verifies the exact candidate version, source SHA, tarball digest, successful CI, signed provenance/SBOM and package metadata. Install/test without a publishing identity. Retain consumer dependency evidence and perform a dry-run without rebuilding the package. A dry-run does not prove the npm identity can publish.

The approval packet must include the exact artifact, workflow/ref/environment, current registry versions and all dist-tags, expected unchanged `latest`, validation receipts, account settings and withdrawal authority. A failed registry request is not proof that a version is unused. The publishing job must reverify the approved bytes immediately before publishing and must not rebuild or repack them.

After separate approval, publish the same tarball with scripts disabled, provenance enabled, public access, the explicit registry and `--tag alpha`. Verify registry metadata, every dist-tag, downloaded bytes, a fresh exact-version consumer, its retained dependency graph, package smoke results, vulnerability audit and signatures/provenance before announcing availability.

## Separate setup from artifact approval

The checked-in policy records `enabled: true` for the setup gate, with a new GitHub revalidation and the earlier npm settings receipt retained under its original timestamp and reported status. The receipt identifies the package, repository, `publish.yml`, `npm-alpha`, environment ID and reviewer. `directPublish` remains based on the maintainer's npm UI report; administrator bypass is now explicitly disabled in the GitHub API readback. Never copy an example as evidence. The setup gate alone cannot publish: candidate selection, the actual release tag, exact-artifact approval variables and required human environment approval remain separate gates. Live environment reads must still match the recorded ID, reviewer, self-review prevention and exact approved tag restriction.

The npm UI validation deadline is not a release deadline. If it passes before the acceptance gates and separate approval are complete, recheck or renew the same publisher configuration and retain that observation. Never publish a placeholder or skip human validation to satisfy the timer.

After selecting the final source and tarball, separate publication approval must identify both bytes and source. Only then enable repository variables `NPM_ALPHA_APPROVED_SOURCE` and `NPM_ALPHA_APPROVED_SHA256` with those exact values. Their presence does not replace the required human environment review. Dispatch `publish.yml` from the approved tag with matching source, digest and CI run inputs. No workflow creates or moves that tag, changes repository settings or configures npm ownership.

The first job verifies existing protections, artifact evidence, registry state and dry-run without OIDC. The `publish` job waits for `npm-alpha` approval, rechecks settings and the live approval history for this run, downloads and cryptographically verifies the candidate again, and refuses changed tags or an existing version. Only that job has `id-token: write`. It runs no install, tests, lifecycle hooks or build, and uses empty npm configuration files to prevent stored-token fallback. An administrator bypass alone cannot pass the explicit expected-reviewer approval-history check.

A separate job without OIDC downloads the registry tarball, checks the approved SHA-256 and all dist-tags, installs the exact registry version, retains its lockfile, and runs audit/signature/provenance and production-graph checks. The pinned npm CLI returns cryptographically verified bundles with `audit signatures --json --include-attestations`; the verifier binds the root package subject, archive digest, signing workflow identity, source commit, tag and publication run/attempt. That publication attempt is read from the same workflow run's publication receipt, so rerunning verification does not confuse it with a newer verification attempt or the original build CI run. Registry-mode package smoke installs by exact version, compares installed package files with the approved archive and then exercises the actual installed CLI under both protocols. Verification failures block announcement, even if npm accepted publication. Rerun a failed verification job after investigating; do not rerun publication as a substitute for inspection.

Local tests cover policy failures and fixture behavior. They do not prove npm OIDC ownership, GitHub environment approval execution, registry publication or future artifact provenance. Those remain live, separately approved release steps. The environment controls follow [GitHub's documented API](https://docs.github.com/en/rest/deployments/environments), with explicit human evidence for settings that API responses do not expose.

## Withdrawal authority

Record an authenticated maintainer path for version-specific deprecation and alpha-tag repair. Do not assume the publication OIDC identity can perform these operations; do not silently expand its permissions. If publication times out, inspect registry state before retrying. A defective published version is not replaced in place: issue a factual notice and a new version after separate authorization. Existing installations are not repaired by moving a tag.

Any v1 deprecation notice is separately approved. Container publication and MCP registry registration are separate decisions as well.
