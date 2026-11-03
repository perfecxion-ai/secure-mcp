# Alpha.2 frozen validation candidate

Status: held after the November 3 independent review. The original bytes and evidence below are preserved. Development fixes target alpha.3; new acceptance trials and npm promotion wait for remediation and a new frozen candidate. See [the follow-up plan](2026-11-03-review-followup.md). This is supplemental evidence recorded after the package source was frozen; this documentation revision does not replace or rebuild the candidate.

| Field | Frozen value |
| --- | --- |
| Package | `@perfecxion/secure-mcp-server@2.0.0-alpha.2` |
| Source | `ba16751e68e0904774c2ed54020336365fecd707` |
| CI and attestation | [41562396132](https://github.com/perfecxion-ai/secure-mcp/actions/runs/41562396132), both jobs succeeded |
| Tarball | `perfecxion-secure-mcp-server-2.0.0-alpha.2.tgz` |
| Tarball SHA-256 | `a83e4e51143f9fdadcca0b8beac87dcb36d8cb06cd6015ccd8c1a728a597ac36` |
| Signed SBOM SHA-256 | `e11ace246adddb5734b40523bc7b72243ef94aef3698e9a3c0162acdda4b3edf` |
| CI artifact | `13198200885`, retention ends February 1, 2027 at 01:51:05 UTC |
| Supported runtime | Linux, Node `>=24.22.1 <25`, npm 11 |

The [machine-readable record](2026-11-03-alpha2-candidate.json) retains source/run identity, verification results, consumer evidence hashes, registry snapshot, settings provenance and outstanding gates. The maintainer's local kit is `/home/plucky/secure-mcp-alpha2-validation-2026-11-03`, starting at `START_HERE.md`. It includes the unchanged verified bundle, full x64 and ARM64 consumer evidence, exact packaged documentation and blank receipts. This local path is not a public download URL; testers receive the kit through an authenticated maintainer handoff.

## Engineering evidence

The package was built once by protected-main CI, tested as that exact tarball, uploaded and attested without repacking. Fresh local cryptographic verification checked the expected source/ref/workflow, package provenance, signed SBOM predicate and checksums. A second agent reviewed the retained evidence for consistency without claiming another cryptographic verification or independent human trial.

Both fresh consumers, Linux x64 in CI and Linux ARM64 on Spark, used Node 24.22.1/npm 11.19.1 and the selected digest. Both passed installation without lifecycle scripts, silent public import, discovery, approved reads, policy inspection, six path rejection classes, content-free audit checks and EOF shutdown under protocols `2026-07-28` and `2025-11-25`. The packaged triage exercise passed resource denials, audit failure/recovery and shutdown, including exit 1 for a deliberately noncooperative handler.

Both consumer production graphs match the signed SBOM: seven dependencies plus the root package, including integrity identifiers and dependency edges. Each consumer retains its lockfile, inventories, comparison, zero-finding production audit and successful registry dependency signature check. Those signature checks do not authenticate the unpublished root tarball; its trust comes from the separately verified GitHub evidence. The [SBOM correction record](2026-11-03-sbom-inventory-correction.json) explains the earlier incomplete inventory without changing historical alpha.1 assets.

Required CI passed the 119-test suite, type/lint/format/build/schema/metadata checks, five security mutations, transport regression, OAuth, audit, storage failure, proxy, container and short benchmarks. Runtime source changes since the historical baseline are limited to the Node minimum guard, startup import order, version and export in four files. Request-control modules are unchanged. Two transitive Hono lock entries received reviewed patch updates, with affected path regression coverage. Historical hour-long endurance and browser/IdP results remain alpha.1 evidence; no new alpha.2 hour-long or browser run is claimed. The development-only minimatch advisory remains tracked in [issue 62](https://github.com/perfecxion-ai/secure-mcp/issues/62).

An actual `npm publish --dry-run --ignore-scripts --tag alpha --access public --registry=https://registry.npmjs.org/` passed on the unchanged tarball, outside the checkout with empty npm configuration and no publishing identity. It does not prove publication authority. A successful registry response still contained only `1.0.0`, with `latest=1.0.0`; alpha.2 was absent. Recheck immediately before any future approval and publication.

## Independent trials

Send the original tarball and verified bundle with this exact source/digest through an authenticated channel. Use the [packaged README at the frozen source](https://github.com/perfecxion-ai/secure-mcp/blob/ba16751e68e0904774c2ed54020336365fecd707/README.md), then its installation and demo links. Testers do not need a checkout, build, `npm ci` or GitHub CLI for a verified handoff. Select Node explicitly before npm and launch the installed `dist/cli.js` with an absolute Node path.

Two independent testers must complete [receipts](TRIAL_RECEIPT.md), one using VS Code and one Cursor, recording exact OS/Node/npm/host versions and harness, independently checked digest, configuration, commands/results, audit inspection, clean restart and repeat useful work. Test approved documents and the sanitized alert-triage workflow. A local doctor pass does not validate issuer or collector connectivity. Historical alpha.1 reports cannot fill these receipts.

An independent operator must additionally exercise their isolated issuer/audit deployment while remote authentication remains a principal launch claim. Record principal separation, invalid/expired tokens, collector interruption, fail-closed health, repaired delivery and restart recovery. Agent labs do not satisfy this requirement. The broader goals of three independent successful users, two returning users and one externally authored integration remain open.

## Publication hold

The maintainer supplied saved npm settings for `perfecxion-ai/secure-mcp`, `publish.yml`, `npm-alpha`, allowing direct npm publish. npm reports Pending validation with a November 5, 2026, 01:43 UTC deadline. GitHub API reads verified the environment ID, reviewer, self-review prevention and exact tag restriction; administrator bypass was disabled according to the maintainer's UI confirmation. Both reviewer accounts belong to the same maintainer, so this is not independent two-person review.

The setup policy is enabled. Exact-artifact approval variables remain unset, no alpha.2 tag/release exists, and no publishing workflow was dispatched. The reported npm deadline does not waive acceptance gates; recheck or renew setup if needed. Live OIDC authorization remains unproven until a separately approved first publication.

Before an npm decision, complete the human/operator receipts, confirm authenticated withdrawal authority, separately authorize the exact source tag and hosted read-only preflight, reverify settings/registry/evidence, and assemble the concrete approval packet. Follow the [publication runbook](../NPM_PUBLISHING.md). Approval must name this source and digest; publishing from a newer documentation commit or rebuilding the package is not equivalent.

Any publication must preserve all other dist-tags, including `latest=1.0.0`, and pass exact-byte registry download, fresh consumer, dependency, signature/provenance and tag checks before announcement. npm deprecation, tag repair, container and MCP registry distribution are separate decisions. Alpha.1's GitHub tag and assets remain unchanged and excluded from npm promotion.

Trusted handlers/workspaces, hardlink limits, tool-level scopes, the JWT contract, audit availability and prompt injection within granted authority remain documented boundaries. See the [frozen threat model](https://github.com/perfecxion-ai/secure-mcp/blob/ba16751e68e0904774c2ed54020336365fecd707/docs/THREAT_MODEL.md). This is an experimental consumer candidate, not production certification.
