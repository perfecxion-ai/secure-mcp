# Fresh-install validation

This alpha is for isolated Linux installations with approved, disposable documents. This round tests the next version through fresh installations; legacy deployments and credential migration are outside its scope. Do not replace an existing server installation. The package is not published to npm.

## Obtain the candidate

Use the commit and CI run in the candidate evidence record. GitHub CLI must support `gh attestation verify` with source-digest and signer-workflow verification. Authenticate it for read access to Actions artifacts, then run from a checked-out copy of this repository:

```bash
node scripts/prepare-validation.mjs EXACT_MAIN_COMMIT /tmp/secure-mcp-candidate
cd /tmp/secure-mcp-candidate
sha256sum --check SHA256SUMS
```

The script downloads the successful main CI artifact without rebuilding it, verifies its provenance against that exact commit and workflow, and compares the included SBOM with its signed predicate. It refuses expired artifacts, non-main commits, and an existing output directory. Retain the manifest and verification records. The bundle can be handed to another tester through an approved channel; verify its provenance again after transfer. GitHub artifact retention is finite, so archive the verified bundle before its manifest's expiry date. A checksum alone does not establish provenance.

## Start with stdio

Use Node 24.22.1 or a later supported Node 24 security patch on Linux. Create separate install and document directories, copy one harmless UTF-8 text file into the document directory, and install the downloaded tarball locally:

```bash
mkdir -p /tmp/secure-mcp-trial/install /tmp/secure-mcp-trial/documents
cd /tmp/secure-mcp-trial/install
npm init -y
npm install --ignore-scripts /tmp/secure-mcp-candidate/perfecxion-secure-mcp-server-2.0.0-alpha.1.tgz
./node_modules/.bin/secure-mcp --doctor --workspace /tmp/secure-mcp-trial/documents
```

Configure your MCP host to launch the absolute path to `node_modules/.bin/secure-mcp` with `--workspace` and that document directory as two arguments. The server uses stdin/stdout for MCP and stderr for audit. The current acceptance evidence includes actual Codex and Claude Code CLI hosts; record the exact host version you use. Do not enable unrelated shell or network tools for the trial.

Ask the host to list tools, read the harmless file, and call `policy_status`. Confirm a traversal path such as `../outside.txt`, a hidden file, and a symlink to an outside file are rejected. Use a disposable outside file containing a unique harmless marker, and confirm the marker never appears in results. Files inside the workspace are trusted documents, not executable instructions or a guarantee of prompt-injection filtering.

## Optional remote trial

Use a separate test realm/client and the issuer's supported login flow. Follow [operations](../OPERATIONS.md) for exact audience, `at+jwt` token type, scopes, TLS proxy, Host/Origin rules, short token lifetimes, and the durable collector. Keep the runtime on loopback behind the TLS proxy. The Keycloak lab provides a reproducible browser integration example; it is not a managed identity deployment or an MFA acceptance test.

Confirm an authorized account can list/read, a policy-only account cannot discover or invoke document access, expired tokens receive 401, and audit records correlate transport and tool outcomes without token or document content. Exercise collector unavailability once in the disposable trial: readiness must become unhealthy and work must fail closed. Restore the collector, restart the server, and confirm readiness before continuing. Retain a content-free count/status summary rather than raw authentication traces.

## Feedback and exit criteria

Record the candidate commit and tarball SHA-256, Node/Linux/architecture and MCP host versions, transport, steps, expected result, actual result, and whether the behavior reproduced after a clean restart. Use the validation issue template for ordinary defects. Report suspected authorization bypass, data exposure, or token leakage through the repository's private vulnerability reporting channel; do not attach raw tokens, documents, config secrets, or unredacted logs.

Stop the trial for an unexpected file read, cross-user tool access, missing durable audit, recurring unbounded growth, or an unexplained crash. Shutdown the isolated server and collector and preserve sanitized evidence. Rollback is removal of these isolated install/config directories; there is no existing deployment or credential migration to undo.

Target at least three independent testers across two MCP hosts, with one remote issuer deployment. Advance only after their acceptance steps pass, blocker defects are fixed and retested, onboarding friction is documented, and the operator confirms audit capacity and retention. These user observations are the next gate; local lab results do not substitute for them.
