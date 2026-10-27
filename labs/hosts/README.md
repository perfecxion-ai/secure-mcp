# Assistant host acceptance

This optional lab exercises installed Codex or Claude Code as actual MCP clients. It requires an existing authenticated host and can consume the host's model quota. Claude Code has a $0.50 per-run budget. It is not part of unattended CI.

```bash
npm ci
npm run build
node labs/hosts/verify.mjs --host codex --output /tmp/codex-acceptance.json
node labs/hosts/verify.mjs --host claude --output /tmp/claude-acceptance.json
```

If an environment API key shadows an existing Claude login, explicitly select that login with `--claude-login`. The option removes `ANTHROPIC_API_KEY` only from the child process. It never reads or changes stored credentials.

The lab creates an approved document with an unpredictable marker and a synthetic file outside the workspace. It asks the host for exactly three MCP calls: the approved read, a denied traversal read, and policy status. Assertions inspect actual tool events rather than trusting the model's final answer. Built-in command execution is disabled. Configuration is supplied for this invocation; normal host settings are unchanged. Fixtures are removed afterward.

Reports contain only those tool results, host version, and hashes of the built runtime. They exclude host session IDs, account details, model reasoning, and credentials. They establish these specific stdio interactions, not universal client compatibility, browser OAuth support, or protection against malicious tool content.

Codex flags follow the [official MCP configuration](https://learn.chatgpt.com/docs/extend/mcp?surface=cli) and [configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference). Host CLI flags may change; record the actual version on every run.
