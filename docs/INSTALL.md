# Connect the installed package

Complete the [README install steps](../README.md) first. Keep using the same Bash session so `MCP_NODE`, `MCP_CLI` and `MCP_TRIAL` name the selected Node executable, installed `dist/cli.js` and isolated trial directory. These paths must exist on the Linux machine running the server. Native macOS and Windows package installations are unsupported.

## Generate host configuration

This writes two new example files in the trial directory. It does not modify an existing editor profile. Both contain absolute paths and handle spaces without shell quoting inside JSON:

```bash
"$MCP_NODE" --input-type=module - "$MCP_CLI" "$MCP_TRIAL" <<'JS'
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
const [cli, trial] = process.argv.slice(2);
const server = {
  command: process.execPath,
  args: [cli, '--workspace', join(trial, 'documents')]
};
writeFileSync(join(trial, 'cursor-mcp.json'), JSON.stringify({
  mcpServers: { 'secure-mcp-validation': server }
}, null, 2) + '\n', { flag: 'wx' });
writeFileSync(join(trial, 'vscode-mcp.json'), JSON.stringify({
  servers: { 'secure-mcp-validation': { type: 'stdio', ...server } }
}, null, 2) + '\n', { flag: 'wx' });
JS
```

For Cursor, copy the entry from `cursor-mcp.json` into a disposable project's `.cursor/mcp.json` or a separate test profile. Check the [Cursor MCP configuration guide](https://cursor.com/docs/mcp) for your version.

For VS Code, `vscode-mcp.json` uses the `servers` format for a workspace `.vscode/mcp.json`. Current VS Code also supports portable `mcpServers` configurations for some harnesses, so record the exact host version, selected harness and configuration destination. Use the portable file only where that format is expected. See [VS Code's configuration destinations](https://code.visualstudio.com/docs/agent-customization/mcp-servers#_choose-a-configuration-destination). Do not overwrite an existing configuration file.

For a macOS or Windows desktop, keep Node, the installation and documents on Linux. A VS Code Remote-SSH workspace is a candidate path: configure the server in the remote Linux workspace and confirm its process and paths resolve there. A remote window alone is not evidence of where a selected harness launches MCP. Alternatively, use Streamable HTTP with a Linux operator's issuer/TLS setup described in [operations](OPERATIONS.md). Record and validate that exact desktop-to-Linux combination before calling it supported. Neither path implies native desktop package support.

The JSON generation and server launch can be tested automatically. Actual VS Code/Cursor versions, harness behavior and repeat use need independent [trial receipts](validation/TRIAL_RECEIPT.md); they have not been established for alpha.2 yet.

## Complete a useful first session

Use the host's MCP tool view or ask it to perform these calls explicitly, with unrelated shell and network tools disabled for the isolated trial:

1. Discover `documents_read` and `policy_status`.
2. Call `documents_read` with `{"path":"welcome.txt"}`. Confirm the response contains `Approved example runbook.`
3. Call `documents_read` with `{"path":"../outside.txt"}`. Confirm an error/denial and no outside content. A missing path can report `not_found`; the security outcome is that content is not returned.
4. Call `policy_status` and confirm read-only policy and the intended allowlist.
5. Inspect the host's server stderr/output panel. Audit records should describe decisions and outcomes without workspace paths, filenames or document contents. Stderr is not durable audit storage.
6. Stop this MCP server through the host, start it again, and repeat the approved read. Record the restart result.

For a complete fixture workflow, follow the [alert-triage demo](DEMO.md). Then replace the harmless fixture with approved copies of two short runbooks and complete a real comparison or triage task. Return for a second session and record whether the result was useful and what required manual help. An automated smoke test does not establish this usage evidence.

Doctor reports local configuration/workspace checks only. If the host cannot start, verify the absolute Node path and supported version on the server machine, the CLI path, and workspace permissions. If serving appears idle in a terminal, stdio is waiting for an MCP client. If audit delivery has latched unhealthy, follow the recovery procedure in [operations](OPERATIONS.md) before restarting; a restart alone does not repair the underlying delivery failure.

## Keep the trial evidence

Retain the original tarball, independently checked digest, manifest, consumer `package.json` and `package-lock.json`, generated configuration, and a completed [receipt](validation/TRIAL_RECEIPT.md). Remove secrets and private paths before sharing. Follow the [fresh-install validation guide](validation/REAL_USER_VALIDATION.md) for denial cases, optional SDK checks and remote operator work.
