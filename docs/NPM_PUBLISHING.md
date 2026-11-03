# npm publication preparation

This is a settings and evidence checklist for issues [48](https://github.com/perfecxion-ai/secure-mcp/issues/48) and [49](https://github.com/perfecxion-ai/secure-mcp/issues/49). The workflow remains on hold. Nothing here authorizes a registry write or changes the existing GitHub alpha.1 release.

## Observed account and repository state

During the alpha.2 preparation, a successful public registry read returned only version `1.0.0`, with `latest=1.0.0`. Public npm owner metadata listed `scthornton`. That identifies a listed owner, not proof that the current session can authenticate as that owner or change publisher settings. An explicit npm authentication check did not establish an authenticated identity in this session; publisher settings remain unverified.

The GitHub repository is `perfecxion-ai/secure-mcp`. Its main branch requires the `Validate runtime` check with strict up-to-date checks and enforces protection for administrators. No GitHub environments were returned by the authenticated environment-list request. These are observations at preparation time; recheck settings before approval.

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

Prepare a read-only job that verifies the exact candidate version, source SHA, tarball digest, successful CI, signed provenance/SBOM and package metadata. Install/test without a publishing identity. Retain consumer dependency evidence and perform a dry-run without rebuilding the package. A dry-run does not prove the npm identity can publish.

The approval packet must include the exact artifact, workflow/ref/environment, current registry versions and all dist-tags, expected unchanged `latest`, validation receipts, account settings and withdrawal authority. A failed registry request is not proof that a version is unused. The publishing job must reverify the approved bytes immediately before publishing and must not rebuild or repack them.

After separate approval, publish the same tarball with scripts disabled, provenance enabled, public access, the explicit registry and `--tag alpha`. Verify registry metadata, every dist-tag, downloaded bytes, a fresh exact-version consumer, its retained dependency graph, package smoke results, vulnerability audit and signatures/provenance before announcing availability.

## Withdrawal authority

Record an authenticated maintainer path for version-specific deprecation and alpha-tag repair. Do not assume the publication OIDC identity can perform these operations; do not silently expand its permissions. If publication times out, inspect registry state before retrying. A defective published version is not replaced in place: issue a factual notice and a new version after separate authorization. Existing installations are not repaired by moving a tag.

Any v1 deprecation notice is separately approved. Container publication and MCP registry registration are separate decisions as well.
