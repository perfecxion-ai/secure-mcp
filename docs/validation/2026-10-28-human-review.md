# Human-review outcome

On October 28, 2026, the maintainer reported that human reviews passed and requested continued development. This records that reported pass and advances the next-version work into prerelease preparation.

The active fresh-install candidate is `1f9f7860696c4fae1bab650ab7f8c77513350657`, tarball SHA-256 `5c205f99e3011330fcab11dd981b89f00a735c0992151b7c9d58c32bb71ba5f0`. It is the candidate referenced by the current onboarding guide. The maintainer subsequently confirmed two human testers across two MCP hosts:

| Tester | Host | Reported version | Outcome |
| --- | --- | --- | --- |
| 1 | VS Code with MCP support | Latest; exact version not recorded | Passed |
| 2 | Cursor | Latest; exact version not recorded | Passed |

The report does not separately supply the tested digest, exact host versions, repeat-use results, or remote-issuer coverage. Those omissions do not block development. Two successful human trials across two hosts support prerelease preparation; the original three-user adoption target and production approval are not established by this record.

The earlier agent trial supplied useful onboarding feedback. Its later update reports two successful runs through Claude Code 2.1.307, including restart, approved and denied reads, policy inspection, and no canary exposure. That report is separate from the human-review statement and does not supply the missing human-review metadata. Its raw transcripts are not part of this record.

Node/PATH setup, verified-bundle handoff, and explicit client entry paths were repaired in [PR #40](https://github.com/perfecxion-ai/secure-mcp/pull/40). Both Node-selection paths and generated client configuration were exercised in non-login shells, including directories containing spaces.

The [candidate evidence](CANDIDATE.md) remains the source of technical acceptance results. Next work prepares immutable release assets, notes, verification, and rollback. Stable-release assurance, target-operator identity/MFA and audit retention, and the publication decision remain separate from this onboarding pass.
