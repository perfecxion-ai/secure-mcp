# Security policy

Version 2 is experimental. Version 1 has known release-blocking defects and is not recommended for new deployments. No stable supported release is currently claimed.

Use [GitHub private vulnerability reporting](https://github.com/perfecxion-ai/secure-mcp/security/advisories/new) if available. If GitHub does not offer private reporting for this repository, contact the [maintainer](https://github.com/perfecxion-ai) to arrange a private channel before sending sensitive details. Enabling and verifying that channel remains a launch requirement. Do not put secrets or live exploit targets into a public issue.

Include the source revision, configuration with secrets removed, prerequisites, a minimal reproduction, expected and observed behavior, and impact. Lab-only demonstrations are preferred. There is no published response SLA yet.

The [threat model](docs/THREAT_MODEL.md) defines the current trust boundaries and limitations. The [baseline review](docs/reviews/2026-10-26-assessment.md) records historical defects; new regression tests do not establish production certification or universal prompt-injection protection.
