# Operating the alpha

Use Node 24 on Linux. The CLI defaults to stdio. `--config FILE` reads strict JSON; relative workspaces in that file resolve relative to the file. `--workspace DIRECTORY` overrides that value relative to the current directory. `--doctor` validates configuration and workspace access without starting a listener and prints only a sanitized summary. It does not verify identity-provider or audit-collector availability.

Prepare the document workspace from trusted copies of approved files, then mount it read-only for the server. Do not preserve hard links from untrusted imports: read-only access does not hide an already linked file or prevent changes through another writable alias. Workspace preparation and local writers remain operator trust boundaries; see [the threat model](THREAT_MODEL.md).

## HTTP

Copy `examples/http.json`, select an approved workspace, and replace the example resource, issuer, and JWKS URLs. The resource path must be `/mcp`. Run:

```bash
npm ci
npm run build
node dist/cli.js --config examples/http.json
```

Terminate TLS in a reverse proxy and preserve the configured resource hostname in Host. The server ignores forwarded headers. Bind to loopback when the proxy is on the same host. HTTP URLs are accepted only for loopback lab endpoints; public issuer/resource/JWKS URLs must use HTTPS.

The identity provider must issue asymmetric JWT access tokens with `typ: at+jwt`, `sub`, `iss`, exact resource `aud`, `iat`, `exp`, and a space-separated `scope`. Default algorithms: RS256. ES256 and EdDSA are explicit configuration choices. Default maximum token lifetime and age: 900 seconds. The resource server does not accept ID tokens as access tokens.

JWKS keys are cached for up to five minutes, with a 30-second refresh cooldown and a three-second fetch timeout. Publish new keys before using them to sign tokens, and retain old public keys until their tokens expire. A newly introduced key can be rejected during cooldown; an issuer outage can be bridged by a fresh cache, but cold or stale caches fail closed. Removing a key from JWKS is not immediate revocation: the cached copy remains usable until refresh, subject to token expiry and maximum age. The regression suite exercises these transitions against a local JWKS endpoint with only wall time advanced.

Scopes: `documents:read` for approved documents, `policy:read` for policy diagnostics, `api:read` for the optional fixed API, and `metrics:read` for `/metrics`. Discovery filters tools using the same policy as invocation. A denied tool is absent from the caller's tool list.

OAuth protected resource metadata is available at `/.well-known/oauth-protected-resource/mcp` and its root alias. Missing or invalid tokens return a 401 challenge referring to that metadata. Login, client registration, consent, MFA, issuance, and refresh belong to the identity provider. The disposable `labs/oauth` flows cover client credentials and authorization code with S256 PKCE against an external issuer. The latter scripts a fixture login and consent. The separate [Keycloak browser lab](../labs/keycloak/README.md) uses a real Chromium password/consent journey, PostgreSQL, provider HTTPS, and an NGINX TLS resource proxy. It tests both MCP protocols, scope isolation, key rotation/cooldown, outage/recovery, logout/refresh, expiry, and replay. Your own issuer policy, MFA, and production accounts still require operator validation. The [TLS proxy lab](../labs/proxy/README.md) also verifies certificate, Host, and Origin rejection.

Browser origins are denied unless their exact scheme, hostname, and port appear in `allowedOrigins`. Native clients without Origin are permitted to attempt authentication. There is no wildcard CORS option. The configured Host hostname is checked independently.

## Limits and audit

Default tool limits: 16 concurrent operations, 10-second deadline, 64 KiB input, 1,024 input collection entries, 256 KiB output, and 5-second shutdown grace. `limits.maxInputElements` counts array entries and object keys across the complete arguments value. The SDK rejects excess entries before schema validation; direct library invocation applies the same budget before serialization and validation. HTTP admits at most twice the configured tool concurrency, with finite connection/header/body timeouts. Document reads have a smaller byte limit to leave room for JSON framing; highly escaped text may still hit the total output limit and return an explicit error.

The explicit element budget addresses the SDK's [configuration-dependent input-validation advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453). Installing a patched SDK alone does not enable this control. Keep both byte and element limits appropriate to the registered tools.

Audit is newline-delimited JSON on stderr by default. Route it to a durable collector for remote validation. Never redirect stdout logging into the stdio protocol stream. Events omit request content, tokens, paths, client-supplied IDs, and raw exceptions. HTTP records use fixed endpoint/method categories and status codes; only verified identities receive a hashed actor. Server-generated request IDs correlate HTTP, SDK protocol failures, and tool decisions. Unknown tool names are recorded as `unknown`.

Actor hashes are deterministic and unsalted, so treat audit records as pseudonymous identity data. They permit correlation and do not prevent guessing predictable issuer/subject pairs.

`audit.maxPending` defaults to 64 and `audit.timeoutMs` to 1,000 ms. There is no queue beyond pending sink writes. A timed-out write retains its slot until the underlying sink settles. Any failed, timed-out, or dropped write latches audit readiness unhealthy until restart; `/health` returns 503 and new work fails closed. Metrics and the library's `runtime.audit.state` expose pending writes, failures, and dropped records. Because HTTP admission itself requires audit, scrape failure is also an alert signal after sink failure.

Tool admission and completion and SDK error responses await sink acknowledgement. If auditing an error response fails, the caller receives only a generic `audit_unavailable` protocol error. Requests reaching the HTTP fetch handler also await a response-preparation record. Host, Origin, admission, and adapter-level rejections have admission and socket-terminal records; the terminal record is necessarily asynchronous and cannot gate a response already sent. Denials are audited independently of tool capacity. Stderr acknowledgement means a stream write completed, not that a remote collector persisted the record. See [the threat model](THREAT_MODEL.md) for unavoidable loss boundaries.

For a fresh local validation deployment, create a private directory outside the document workspace and run the included collector as the same unprivileged user:

```bash
install -d -m 700 /tmp/secure-mcp-audit
node examples/audit-collector.mjs --socket /tmp/secure-mcp-audit/collector.sock \
  --journal /tmp/secure-mcp-audit/events.jsonl
```

Set `audit.socketPath` to that absolute Unix socket path. The server then requires a one-byte acknowledgement after each journal write and `fsync`. This adds filesystem latency to requests. The collector bounds records to 4 KiB, connections and pending records to 64, and the journal to 256 MiB by default (`--max-bytes` overrides the limit). Reaching the limit denies further work. Monitor capacity, stop the server before rotating the journal, preserve old files, restart the collector, then restart the server and check readiness. Paths and parent directories must remain operator-controlled. The collector rejects symlink journals, multiply linked files, public permissions, and incomplete final records. A crash can leave a socket path; remove it only after confirming its collector has stopped. A partial record requires preserving and repairing the journal before restart.

This local collector is a validation reference, with no automatic rotation, retention, remote replication, or tamper-resistant storage. File sync acknowledgements depend on the host filesystem and hardware. A privileged local attacker can alter the journal. Integrate and fault-test your production collector separately. `npm run test:audit` exercises the actual collector process, kill/restart persistence, journal limits, and blocked delivery.

SIGINT, SIGTERM, and stdio EOF initiate shutdown. HTTP stops accepting requests, cancels active tools, and closes sockets. The process exits nonzero if trusted handlers fail to settle within the deadline. Library users must call `close()` and handle its remaining-work count.

## Container

```bash
docker build -t secure-mcp:local .
docker run --rm -i --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 64 --memory 512m --cpus 2 \
  --mount type=bind,src="$(pwd)/examples/documents",dst=/workspace,readonly \
  secure-mcp:local --workspace /workspace
```

The image runs as the unprivileged `node` user. Mounted documents must be readable by that user. The command above is for stdio with network disabled. A remote HTTP deployment needs deliberate networking, a read-only config mount, and TLS routing. Never mount a Docker socket or a broad home directory.

## Verification and troubleshooting

```bash
npm run check
npm run test:package
npm run test:container
npm audit
BENCH_SECONDS=60 npm run benchmark
```

Startup rejects unknown configuration keys, missing HTTP issuer information, unknown allowlisted tools, and inaccessible workspaces. Tool errors are short stable codes: `denied`, `invalid_input`, `busy`, `timeout`, `cancelled`, `shutting_down`, `output_too_large`, `not_found`, `upstream_failed`, `audit_unavailable`, and `internal`. Filesystem errors intentionally do not reveal paths. Diagnose using operator-owned configuration and audit outcomes, never by logging raw access tokens.

Configuration editor schema: `config.schema.json`, generated from the runtime schema with `npm run schema`. Custom URL and cross-field constraints are also enforced by the runtime. Registry metadata in `server.json` is prepared but unpublished.
