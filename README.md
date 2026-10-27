# SecureMCP

SecureMCP is an experimental MCP server prototype. The current v1 implementation is not ready for production deployment.

The [repository assessment](docs/reviews/2026-10-26-assessment.md) records protocol, authentication, packaging, and verification failures against commit `1df0af55bd2cebde48d643e3d3c852e64d37ce18`. It includes reproducible probes and the limits of the review. Build success does not establish a working installation or security boundary.

The [execution roadmap](docs/ROADMAP.md) describes a successor using the maintained MCP SDK, standard transports, external identity, explicit tool policy, bounded execution, and audit evidence. Application replacement is separate work. Existing npm 1.0.0 packages still contain the reviewed v1 implementation.

Automatic publication is disabled during the rebuild. The remaining v1 design documents contain historical, unverified claims and are scheduled for archival. Do not rely on their production, compliance, isolation, or performance statements.

The existing license declaration is AGPL-3.0-or-later. See LICENSE and NOTICE. No deployment, compatibility, or certification guarantee is made.
