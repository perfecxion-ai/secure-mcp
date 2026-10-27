# Operating the alpha

Use Node 24 on Linux. The CLI defaults to stdio. `--config FILE` reads strict JSON; relative workspaces in that file resolve relative to the file. `--workspace DIRECTORY` overrides that value relative to the current directory. `--doctor` validates configuration and workspace access without starting a listener and prints only a sanitized summary. It does not verify an identity provider's availability.

## HTTP

Copy `examples/http.json`, select an approved workspace, and replace the example resource, issuer, and JWKS URLs. The resource path must be `/mcp`. Run:

```bash
npm ci
npm run build
node dist/cli.js --config examples/http.json
```

Terminate TLS in a reverse proxy and preserve the configured resource hostname in Host. The server ignores forwarded headers. Bind to loopback when the proxy is on the same host. HTTP URLs are accepted only for loopback lab endpoints; public issuer/resource/JWKS URLs must use HTTPS.

The identity provider must issue asymmetric JWT access tokens with `typ: at+jwt`, `sub`, `iss`, exact resource `aud`, `iat`, `exp`, and a space-separated `scope`. Default algorithms: RS256. ES256 and EdDSA are explicit configuration choices. Default maximum token lifetime and age: 900 seconds. The resource server does not accept ID tokens as access tokens.

Scopes: `documents:read` for approved documents, `policy:read` for policy diagnostics, `api:read` for the optional fixed API, and `metrics:read` for `/metrics`. Discovery filters tools using the same policy as invocation. A denied tool is absent from the caller's tool list.

OAuth protected resource metadata is available at `/.well-known/oauth-protected-resource/mcp` and its root alias. Missing or invalid tokens return a 401 challenge referring to that metadata. Login, client registration, consent, MFA, issuance, and refresh belong to the identity provider. The disposable `labs/oauth` machine-authentication flow is tested against an external issuer. Interactive browser OAuth flows remain an external integration gate.

Browser origins are denied unless their exact scheme, hostname, and port appear in `allowedOrigins`. Native clients without Origin are permitted to attempt authentication. There is no wildcard CORS option. The configured Host hostname is checked independently.

## Limits and audit

Default tool limits: 16 concurrent operations, 10-second deadline, 64 KiB input, 256 KiB output, and 5-second shutdown grace. HTTP admits at most twice the configured tool concurrency, with finite connection/header/body timeouts. Oversized or invalid wire input fails before dispatch. Document reads have a smaller byte limit to leave room for JSON framing; highly escaped text may still hit the total output limit and return an explicit error.

Audit is newline-delimited JSON on stderr. Route it to a bounded, monitored log collector. Never redirect stdout logging into the stdio protocol stream. Audit events omit request content. If a sink fails before execution, the operation is denied. See [the threat model](THREAT_MODEL.md) for failure and coverage limits.

SIGINT, SIGTERM, and stdio EOF initiate shutdown. HTTP stops accepting requests, cancels active tools, and closes sockets. The process exits nonzero if trusted handlers fail to settle within the deadline. Library users must call `close()` and handle its remaining-work count.

## Verification and troubleshooting

```bash
npm run check
npm run test:package
npm audit
```

Startup rejects unknown configuration keys, missing HTTP issuer information, unknown allowlisted tools, and inaccessible workspaces. Tool errors are short stable codes: `denied`, `invalid_input`, `busy`, `timeout`, `cancelled`, `shutting_down`, `output_too_large`, `not_found`, `upstream_failed`, `audit_unavailable`, and `internal`. Filesystem errors intentionally do not reveal paths. Diagnose using operator-owned configuration and audit outcomes, never by logging raw access tokens.
