# Trust boundaries

The alpha runtime hosts approved tools. It is not a sandbox for hostile JavaScript, an upstream MCP proxy, or a prompt-injection detector.

## Trusted inputs

The operator controls configuration, installed code, the document workspace, the fixed API destination, and identity-provider settings. Library tool handlers and audit sinks run with process privileges and must be trusted. An attacker who controls a handler can bypass middleware by using Node APIs directly.

Local stdio clients inherit the authority of the launching process and its configured scopes. HTTP clients must provide an access token from the configured issuer for the exact configured resource. Token subjects and scopes come only from verified claims. Client arguments, request metadata, and protocol roots never select identity, scopes, workspace, or upstream destinations.

## Enforced controls

- Tool allowlist, all required scopes, token expiry, and read-only policy govern both discovery and invocation.
- Strict input schemas reject unknown fields instead of rewriting input. A collection-entry budget runs before schema validation in the SDK and before serialization/validation in direct library calls. Custom schema validation runs once inside the runtime execution limit, including asynchronous refinements. Error responses omit internal exception messages, including validator exceptions.
- The Linux document reader anchors access to an open workspace directory, opens each component without following symlinks, rejects hidden/absolute/traversal paths, accepts only regular files, and bounds reads. File descriptor operations prevent the usual check-then-open symlink substitution.
- A workspace must be operator-controlled. Hard links are not distinguishable from ordinary files, and the runtime does not defend against malicious local processes rewriting authorized files. Use a dedicated, read-only mount containing only data callers may read. The document tool currently requires Linux `/proc`.
- API reads use a single operator-selected URL, GET only, no caller parameters, no forwarded bearer token, and no redirects. The operator is responsible for selecting a trusted destination and DNS. There is no arbitrary-URL fetch tool.
- HTTP validates Host and exact Origin values before authentication. Missing Origin is allowed for native clients; every HTTP MCP call still requires a valid token. Tokens must use a configured asymmetric algorithm, carry `typ: at+jwt`, and satisfy issuer, audience, subject, issue-time, expiry, and maximum lifetime checks. JWKS lookup uses only the configured URL.
- HTTP body, header, connection, request, and tool concurrency limits bound accepted work. Stdio bounds frames. Tool deadlines and caller cancellation signal cooperative handlers.
- A timed-out handler retains its execution slot until it settles. Noncooperative synchronous JavaScript cannot be preempted inside the process. The CLI enforces a bounded shutdown and exits nonzero if work does not drain. Run untrusted code only in a separately designed execution service.

## Audit and privacy

Audit JSON goes to stderr by default, preserving stdio stdout for protocol messages. Events contain an internally generated request ID, a hash of issuer and subject, a registered tool name, outcome, timestamp, and duration. Arguments, file paths, tokens, contents, and internal exception messages are excluded. Subject hashes are pseudonymous, not anonymous; predictable subjects can be guessed.

A failed admission audit prevents the handler from running. An audit failure after a side effect cannot undo that side effect; callers must not assume retry safety. Audit delivery has its own finite deadline and capacity, independent of tool execution. Pending writes retain capacity until the sink settles; delivery loss latches readiness unhealthy until restart. Tool timeout, cancellation, saturation, and shutdown outcomes attempt terminal records outside execution slots. HTTP authentication, Host/Origin checks, route/status rejection, SDK errors, and disconnects have content-free records correlated by server-generated IDs. Socket terminal records happen after response delivery and cannot gate that response. Process crashes, failed storage, traffic rejected by Node before the runtime request handler runs (including unsupported upgrades or tunnels), and capacity exhausted during a flood can lose records; counters and readiness expose detected loss. Stderr is not durable storage. Acknowledged tool success means handler completion, not proof that the client received the result. Collect reverse-proxy access status without credentials to cover the outer network boundary.

Metrics require a verified token with `metrics:read`. No subject, URL, path, argument, or tool-supplied string becomes a metric label. `/health` and OAuth resource metadata are intentionally public and contain no credentials or workspace paths.

## Revocation and remaining assurance

This runtime does not issue, refresh, or revoke tokens. It verifies short-lived external access tokens on every HTTP request. An issuer-side logout does not immediately invalidate an already issued JWT. Expiry and the configured maximum age bound this window. Cached keys can remain usable for five minutes after issuer-side removal; a cold or stale cache fails closed when JWKS is unavailable. Key rotation and outage transitions are covered by deterministic HTTP-backed tests, but not yet by an operator-run production IdP exercise. Deployments needing immediate revocation require an introspection or revocation integration before adoption.

There are no accounts, passwords, MFA secrets, SAML assertions, refresh-token families, Redis sessions, or Vault key lifecycle in the new default runtime. V1 credentials must not be imported automatically.

This is experimental software. Tests establish the cases they exercise, not general resistance to prompt injection, all authorization attacks, or all resource exhaustion. OS isolation for untrusted tools, distributed quotas, immediate revocation, browser OAuth user-journey validation, external security review, and broader operator acceptance remain release gates. The versioned Codex and Claude Code lab reports cover the specific local stdio workflow only.
