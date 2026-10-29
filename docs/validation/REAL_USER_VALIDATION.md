# Fresh-install validation

This alpha is for isolated Linux installations with approved, disposable documents. This round tests the next version through fresh installations; legacy deployments and credential migration are outside its scope. Do not replace an existing server installation. The package is available as a [GitHub prerelease](https://github.com/perfecxion-ai/secure-mcp/releases/tag/v2.0.0-alpha.1) and is not published to npm.

## Select Node before running npm

Use Node 24.22.1 or a later supported Node 24 security patch on Linux, with npm 11. Run the following steps in the same Bash session and stop if a command fails. On hosts with multiple Node installations, select one explicitly before any npm command. Non-login SSH shells often do not load your usual shell configuration. Even an absolute path to `npm` still needs `node` on `PATH` because of npm's executable shebang.

If you use nvm, load it explicitly and select the version:

```bash
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
. "$NVM_DIR/nvm.sh"
nvm use 24.22.1
```

If nvm reports that this version is missing, run `nvm install 24.22.1`, then repeat `nvm use 24.22.1`. Alternatively, prepend the directory containing an existing supported Node binary to `PATH`:

```bash
export PATH="/absolute/path/to/your/node/bin:$PATH"
```

For the prepared ARM64 Node installation on Spark, that command is `export PATH="$HOME/.local/opt/node-v24.22.1-linux-arm64/bin:$PATH"`. Use the appropriate installation directory on another machine. Verify both executables and save the resolved Node path:

```bash
node --version
npm --version
MCP_NODE="$(node -p 'process.execPath')"
```

Expect Node `v24.22.1` or a later Node 24 security patch, and npm `11.x`. Repeat this selection in each new SSH session. The client configuration below uses the absolute Node path so the MCP host does not depend on its own `PATH`.

## Obtain the candidate

Set the bundle location once. Change this path to the directory you received, or a new directory if you will download it yourself:

```bash
MCP_BUNDLE="$HOME/secure-mcp-candidate"
MCP_TARBALL="$MCP_BUNDLE/perfecxion-secure-mcp-server-2.0.0-alpha.1.tgz"
```

### Download the published prerelease

The [public release page](https://github.com/perfecxion-ai/secure-mcp/releases/tag/v2.0.0-alpha.1) provides the verified bundle files without GitHub CLI or Actions access. Download `perfecxion-secure-mcp-server-2.0.0-alpha.1.tgz`, `sbom.cdx.json`, `SHA256SUMS`, `validation-manifest.json`, `provenance-verification.json`, and `sbom-verification.json` into your chosen bundle directory. Use the npm tarball asset, not GitHub's automatically generated source archive. Continue with the digest check below, using the known project repository as the trusted source for the expected commit and checksum.

### You were handed a verified bundle

You do not need GitHub CLI, Actions access, a repository checkout, `npm ci`, or the optional repository smoke check for this path. You still need npm registry access when installing the package's dependencies below.

The maintainer prepares the bundle with `prepare-validation.mjs`, which verifies the exact source/workflow provenance and signed SBOM. Obtain the expected commit and tarball SHA-256 through an authenticated message from the maintainer or the [candidate record on the known project repository](https://github.com/perfecxion-ai/secure-mcp/blob/main/docs/validation/CANDIDATE.md). Do not take the expected digest solely from files delivered alongside an otherwise untrusted archive.

The selected candidate is commit `1f9f7860696c4fae1bab650ab7f8c77513350657`. Its tarball SHA-256 is pinned in this check:

```bash
MCP_EXPECTED_SHA256="5c205f99e3011330fcab11dd981b89f00a735c0992151b7c9d58c32bb71ba5f0"
printf '%s  %s\n' "$MCP_EXPECTED_SHA256" "$MCP_TARBALL" | sha256sum --check -
(cd "$MCP_BUNDLE" && sha256sum --check SHA256SUMS)
```

Both checks must report `OK`. Confirm `validation-manifest.json` names that source commit and retain it with `provenance-verification.json`, `sbom-verification.json`, and `sbom.cdx.json`. Those files document the maintainer's verification; their mere presence is not a new cryptographic verification by the recipient. Trust comes from the authenticated handoff of the verified digest, and the checksum binds your received bytes to it. If the digest or commit differs, stop and resolve the mismatch with the maintainer. Then go directly to **Start with stdio**.

### Download and verify it yourself

This alternative is for maintainers and testers who want to perform provenance verification themselves. GitHub CLI must support `gh attestation verify` with source-digest and signer-workflow verification. Authenticate it for read access to Actions artifacts, then run from a checked-out copy of this repository. The output directory must not already exist:

```bash
node scripts/prepare-validation.mjs 1f9f7860696c4fae1bab650ab7f8c77513350657 "$MCP_BUNDLE"
(cd "$MCP_BUNDLE" && sha256sum --check SHA256SUMS)
```

The script downloads the successful main CI artifact without rebuilding it, verifies its provenance against that exact commit and workflow, and compares the included SBOM with its signed predicate. It needs no `npm ci`. It refuses expired artifacts, non-main commits, and an existing output directory. Retain the manifest and verification records. GitHub artifact retention is finite, so archive the verified bundle before its manifest's expiry date. For a handoff, send the verified commit and tarball digest through an authenticated channel with the bundle.

## Start with stdio

Choose a new trial directory; it can be persistent and does not need to be under `/tmp`. Create separate install and document directories, copy one harmless UTF-8 text file named `welcome.txt` into the document directory, and install the verified tarball locally:

```bash
MCP_TRIAL="$HOME/secure-mcp-trial"
mkdir -m 700 "$MCP_TRIAL"
mkdir "$MCP_TRIAL/install" "$MCP_TRIAL/documents"
cd "$MCP_TRIAL/install"
npm init -y
npm install --ignore-scripts "$MCP_TARBALL"
MCP_CLI="$MCP_TRIAL/install/node_modules/@perfecxion/secure-mcp-server/dist/cli.js"
"$MCP_NODE" "$MCP_CLI" --doctor --workspace "$MCP_TRIAL/documents"
```

The real server entry point is `node_modules/@perfecxion/secure-mcp-server/dist/cli.js`. The `.bin/secure-mcp` executable is a convenience shim; launching the real entry point with the selected absolute Node path avoids host-shell version differences. Doctor prints a JSON configuration summary and exits. To run the server, the host uses the same command without `--doctor`.

Generate a client configuration containing your actual absolute paths:

```bash
"$MCP_NODE" -e '
console.log(JSON.stringify({mcpServers: {"secure-mcp-validation": {
  command: process.execPath,
  args: [process.argv[1], "--workspace", process.argv[2]]
}}}, null, 2))
' "$MCP_CLI" "$MCP_TRIAL/documents" > "$MCP_TRIAL/mcp-client-config.json"
```

Add that server entry to a separate test profile in your MCP host. The generated file is not installed into any existing host configuration automatically. The server uses stdin/stdout for MCP and stderr for audit. The current acceptance evidence includes actual Codex and Claude Code CLI hosts; record the exact host version you use. Do not enable unrelated shell or network tools for the trial.

Ask the host to list tools, read `welcome.txt`, and call `policy_status`. Confirm a traversal path such as `../outside.txt`, a hidden file, and a symlink to an outside file are rejected. Use a disposable outside file containing a unique harmless marker, and confirm the marker never appears in results. Files inside the workspace are trusted documents, not executable instructions or a guarantee of prompt-injection filtering.

## Optional repository package check

Bundle recipients can skip this section. If you have a repository checkout and want an automated SDK smoke check in addition to your actual host trial, run from that checkout:

```bash
npm ci --ignore-scripts
node scripts/package-smoke.mjs --artifact "$MCP_TARBALL" > "$MCP_TRIAL/package-check.json"
```

This installs that exact tarball in a temporary consumer directory with install scripts disabled. It tests silent import, both MCP protocol generations, tool discovery, an approved read, read-only policy, traversal/absolute/hidden/symlink/directory rejection, audit canaries, and stdin-EOF shutdown. The JSON result includes the package digest and per-protocol outcomes; it contains no tokens, fixture content, or machine paths. Temporary files are removed when the check finishes. This step needs npm registry access for dependencies and does not modify an existing MCP host configuration.

Keep the result with your feedback. This automated SDK check does not substitute for the trusted artifact handoff or your actual host trial.

## Optional remote trial

Use a separate test realm/client and the issuer's supported login flow. Follow [operations](../OPERATIONS.md) for exact audience, `at+jwt` token type, scopes, TLS proxy, Host/Origin rules, short token lifetimes, and the durable collector. Keep the runtime on loopback behind the TLS proxy. The Keycloak lab provides a reproducible browser integration example; it is not a managed identity deployment or an MFA acceptance test.

Confirm an authorized account can list/read, a policy-only account cannot discover or invoke document access, expired tokens receive 401, and audit records correlate transport and tool outcomes without token or document content. Exercise collector unavailability once in the disposable trial: readiness must become unhealthy and work must fail closed. Restore the collector, restart the server, and confirm readiness before continuing. Retain a content-free count/status summary rather than raw authentication traces.

## Feedback and exit criteria

Record the candidate commit and tarball SHA-256, Node/Linux/architecture and MCP host versions, transport, steps, expected result, actual result, and whether the behavior reproduced after a clean restart. Use the validation issue template for ordinary defects. Report suspected authorization bypass, data exposure, or token leakage through the repository's private vulnerability reporting channel; do not attach raw tokens, documents, config secrets, or unredacted logs.

Stop the trial for an unexpected file read, cross-user tool access, missing durable audit, recurring unbounded growth, or an unexplained crash. Shutdown the isolated server and collector and preserve sanitized evidence. Rollback is removal of these isolated install/config directories; there is no existing deployment or credential migration to undo.

Target at least three independent testers across two MCP hosts, with one remote issuer deployment. Advance only after their acceptance steps pass, blocker defects are fixed and retested, onboarding friction is documented, and the operator confirms audit capacity and retention. These user observations are the next gate; local lab results do not substitute for them.
