# Contributing

Use Node 24 on Linux. Run `npm ci`, then `npm run check`. Package or CLI changes also require `npm run test:package`; container changes require `npm run test:container`.

Keep PRs focused on one caller-visible problem. Describe the resulting behavior, relevant tradeoffs, actual validation, and any untested boundary. Include a failing regression case for security fixes. Do not replace a failing assertion with a skipped test or unconditional success.

Use strict TypeScript and explicit tool schemas. No `any` in new runtime code. Do not log tokens, raw tool arguments, document contents, or internal exceptions in user-visible responses. Keep runtime dependencies small and optional integrations explicit.

Node 24 and its matching type declarations are the supported runtime line. Compiler major upgrades need a coordinated change with the TypeScript ESLint peer range and both strict builds. Dependabot keeps compatible updates flowing but leaves Node, Node type, and TypeScript major upgrades to an explicit compatibility PR. This is a deliberate support policy, not a reason to ignore security updates.

Do not edit `legacy/v1` to add features. It preserves the reviewed baseline; use the assessment and migration guide when retiring or replacing behavior.

Contributions to the current project are under AGPL-3.0-or-later. Do not add Apache declarations copied from the historical manifests. The maintainer reviews licensing changes explicitly.

The project is an experimental alpha. No response-time SLA, certification, production guarantee, or benchmark is promised without corresponding evidence. Security disclosures belong in the private process described in SECURITY.md.
