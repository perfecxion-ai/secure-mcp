# Migrating from v1

Version 2 is an incompatible alpha. Keep any existing deployment on its known source revision until its actual integrations, users, and state have been inventoried. Do not replace a live service merely because the new checks pass.

The v1 source, tests, deployment manifests, client package, and design docs are retained under `legacy/v1`. They are unsupported historical material, excluded from installation, build, test discovery, and publication. Their known failures remain recorded in the [assessment](reviews/2026-10-26-assessment.md). Reproduce those findings in a disposable checkout of baseline `1df0af55bd2cebde48d643e3d3c852e64d37ce18`; the review probes assume that original layout.

| V1 behavior | V2 replacement |
| --- | --- |
| Importing the package starts services | Import `SecureRuntime`; start a transport explicitly |
| Socket.IO and bundled custom client | Standard MCP SDK clients over stdio or Streamable HTTP |
| Login, SAML, MFA, refresh tokens | External issuer, JWKS validation, scoped access tokens |
| PostgreSQL, Redis, Vault required | No external services for local stdio |
| Echo and calculate examples | Approved document read, policy diagnostics, optional fixed API read |
| Experimental container and AI executors | Trusted handlers only; no sandbox or screening claim |
| Helm, Kustomize, multi-service Compose | One tested container; old manifests archived |
| Jest suites with mock assurance checks | Node test runner with actual transport and adversarial cases |

Old client endpoint URLs, environment variables, permissions, and token records do not carry forward. Configure a new resource audience and explicit issuer/scopes. Never copy v1 MFA ciphertext into a new system as if it were securely encrypted. Have the identity provider handle re-enrollment and token lifecycle.

Existing custom tools must be re-registered with strict schemas, explicit scope requirements, read-only classification, and cancellation support. Review each handler's filesystem/network behavior against the operator policy. `readOnlyHint` is descriptive metadata; the runtime's read-only policy only trusts approved handler declarations and cannot inspect arbitrary code for side effects.

The old failing suite has been retired with the old runtime, not declared passing. The [execution record](EXECUTION.md) maps the original findings to replacements and remaining verification. New checks do not depend on legacy modules or test doubles that emulate Redis/Vault behavior.

The existing root AGPL-3.0-or-later declaration is preserved. Root package metadata and contributor terms now agree with it. Historical Apache declarations in the archived manifests describe the old conflict; they do not define the successor package's license.
