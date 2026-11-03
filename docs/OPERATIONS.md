# Operating the alpha

Use Node `>=24.22.1 <25` on Linux. The CLI defaults to stdio. `--config FILE` reads strict JSON; relative workspaces in that file resolve relative to the file. `--workspace DIRECTORY` overrides that value relative to the current directory. `--doctor` validates configuration and workspace access without starting a listener and prints only a sanitized summary. It does not verify identity-provider or audit-collector availability.

Prepare the document workspace from trusted copies of approved files, then mount it read-only for the server. Do not preserve hard links from untrusted imports: read-only access does not hide an already linked file or prevent changes through another writable alias. Workspace preparation and local writers remain operator trust boundaries; see [the threat model](THREAT_MODEL.md).

## HTTP

After the [installed-package setup](../README.md), copy the packaged `examples/http.json` into an operator-owned directory outside the package. Select an approved absolute workspace and replace the example resource, issuer and JWKS URLs. The resource path must be `/mcp`. With the README session variables, run the edited configuration:

```bash
: "${MCP_HTTP_CONFIG:?Set the absolute path to the edited HTTP configuration}"
"$MCP_NODE" "$MCP_CLI" --config "$MCP_HTTP_CONFIG"
```

Terminate TLS in a reverse proxy and preserve the configured resource hostname in Host. The server ignores forwarded headers. Bind to loopback when the proxy is on the same host. HTTP URLs are accepted only for loopback lab endpoints; public issuer/resource/JWKS URLs must use HTTPS.

The identity provider must issue asymmetric JWT access tokens with `typ: at+jwt` or `typ: application/at+jwt` (case-insensitive), `sub`, `iss`, exact resource `aud`, `iat`, `exp`, and a space-separated `scope`. Parameters, surrounding whitespace, other media types and a missing type are rejected. Default algorithms: RS256. ES256 and EdDSA are explicit configuration choices. Default maximum token lifetime and age: 900 seconds. The resource server does not accept ID tokens as access tokens. Clock tolerance is zero; synchronize issuer and runtime clocks before investigating intermittent future-issued token failures.

JWKS keys are cached for up to five minutes, with a 30-second refresh cooldown and a three-second fetch timeout. Publish new keys before using them to sign tokens, and retain old public keys until their tokens expire. A newly introduced key can be rejected during cooldown; an issuer outage can be bridged by a fresh cache, but cold or stale caches fail closed. Removing a key from JWKS is not immediate revocation: the cached copy remains usable until refresh, subject to token expiry and maximum age. The regression suite exercises these transitions against a local JWKS endpoint with only wall time advanced.

Scopes: `documents:read` for approved documents, `policy:read` for policy diagnostics, `api:read` for the optional fixed API, and `metrics:read` for `/metrics`. Discovery filters tools using the same policy as invocation. A denied tool is absent from the caller's tool list.

OAuth protected resource metadata is available at `/.well-known/oauth-protected-resource/mcp` and its root alias. Missing or invalid tokens return a 401 challenge referring to that metadata. Login, client registration, consent, MFA, issuance, and refresh belong to the identity provider. The disposable `labs/oauth` flows cover client credentials and authorization code with S256 PKCE against an external issuer. The latter scripts a fixture login and consent. The separate [Keycloak browser lab](https://github.com/perfecxion-ai/secure-mcp/blob/6fec1886ca2e400694007819384105fdba9eb6a6/labs/keycloak/README.md) uses a real Chromium password/consent journey, PostgreSQL, provider HTTPS, and an NGINX TLS resource proxy. It tests both MCP protocols, scope isolation, key rotation/cooldown, outage/recovery, logout/refresh, expiry, and replay. Your own issuer policy, MFA, and production accounts still require operator validation. The [TLS proxy lab](https://github.com/perfecxion-ai/secure-mcp/blob/6fec1886ca2e400694007819384105fdba9eb6a6/labs/proxy/README.md) also verifies certificate, Host, and Origin rejection.

Browser origins are denied unless their exact scheme, hostname, and port appear in `allowedOrigins`. Native clients without Origin are permitted to attempt authentication. There is no wildcard CORS option. The configured Host hostname is checked independently.

## Limits and audit

Default tool limits: 16 concurrent operations, 10-second deadline, 64 KiB input, 1,024 input collection entries, 256 KiB output, and 5-second shutdown grace. `limits.maxInputElements` counts array entries and object keys across the complete arguments value. The SDK rejects excess entries before schema validation; direct library invocation applies the same budget before serialization and validation. HTTP verifies credentials from headers before buffering a body, with at most `limits.maxConcurrent` simultaneous verification attempts. Verified requests have a separate admission limit: the smaller of twice tool concurrency and `floor(audit.maxPending / 3)`. HTTP requires at least three audit slots. The default admission bound is 21 requests, not a throughput guarantee. Each admitted request retains capacity through its tool/adapter audit writes and terminal acknowledgement, including disconnects. Excess admission returns 503 with `Retry-After: 1` before tool execution. Document reads have a smaller byte limit to leave room for JSON framing; highly escaped text may still hit the total output limit and return an explicit error.

Only origin-form request targets are accepted. Absolute URLs, backslashes in paths, fragments and paths that normalize to a different route are rejected with 400 before the SDK adapter. Queries do not select routes. JSON-RPC batches are rejected with 400 before dispatch; batching was [removed from MCP in June 2025](https://modelcontextprotocol.io/specification/2025-06-18/changelog), before both supported protocol revisions.

HTTP connections retain the 1,000-request limit and use a five-second idle timeout. Node controls the connection headers so clients can rotate sockets before exceeding the request limit. The idle timeout leaves room for Node's bundled fetch client to retire a connection two seconds before the advertised deadline; advertising only two seconds prevents that client from reusing connections.

The explicit element budget addresses the SDK's [configuration-dependent input-validation advisory](https://github.com/modelcontextprotocol/typescript-sdk/security/advisories/GHSA-46jr-4wx8-v453). Installing a patched SDK alone does not enable this control. Keep both byte and element limits appropriate to the registered tools.

Audit is newline-delimited JSON on stderr by default. Route it to a durable collector for remote validation. Never redirect stdout logging into the stdio protocol stream. Events omit request content, tokens, paths, client-supplied IDs, and raw exceptions. HTTP records use fixed endpoint/method categories and status codes; only verified identities receive a hashed actor. Server-generated request IDs correlate HTTP, SDK protocol failures, and tool decisions. Unknown tool names are recorded as `unknown`.

Stdio requests dispatched to a server instance also receive a generated ID shared by their tool and SDK protocol records, including concurrent requests. With schema 1, a tool's `allowed` outcome means admission past policy and input validation; the handler can still deny a resource or fail. Count tool attempts using terminal `kind: "tool"` outcomes (all outcomes except `allowed`), and completed successful calls using `success`. Do not add admission records to terminal counts. SDK rejections before runtime invocation remain separate `kind: "protocol"` records (`tool_rejected` or `invalid_params`); a tool error already recorded by the runtime does not produce another `tool_rejected`. A response encoding or other protocol failure can still accompany a tool outcome, using the same generated ID. Delivery failure can prevent a terminal record, so an unmatched admission record is not proof of success; monitor audit health and failure counters.

Actor hashes are deterministic and unsalted, so treat audit records as pseudonymous identity data. They permit correlation and do not prevent guessing predictable issuer/subject pairs.

`audit.maxPending` defaults to 64 and `audit.timeoutMs` to 1,000 ms. There is no queue beyond pending sink writes. A timed-out write retains its slot until the underlying sink settles. Any failed, timed-out, or dropped write latches audit readiness unhealthy until restart; `/health` returns 503 and new work fails closed. Metrics and the library's `runtime.audit.state` expose pending writes, failures, and dropped records. Because HTTP admission itself requires audit, scrape failure is also an alert signal after sink failure.

Tool admission and completion and SDK error responses await sink acknowledgement. If auditing an error response fails, the caller receives only a generic `audit_unavailable` protocol error. Authenticated admitted HTTP requests also record receipt, response preparation and a socket-terminal outcome with one internal correlation ID. A known audit failure before headers returns 503; after an SSE response has started, its HTTP status cannot change and only a bounded protocol error or stream closure is possible. Terminal audit waits for the adapter and scoped audit writes to settle, and cannot gate a response already delivered.

Before admission, invalid targets, Host/Origin failures, missing/invalid credentials, unknown routes and capacity rejections increment fixed-category `secure_mcp_http_rejections_total` counters instead of performing a durable write per rejected request. This prevents unauthenticated traffic from filling the durable audit path. Counters contain no identity, path or token and reset on restart; they are not a durable per-request rejection history. `/health`, public metadata and CORS preflight do not append audit records. `/health` reports observed audit state, not a fresh collector connectivity probe. Collect credential-free status/rate evidence at the reverse proxy when the deployment requires coverage of the outer boundary. Authenticated admitted tool denials retain their audit records. Stderr acknowledgement means a stream write completed, not remote persistence. See [the threat model](THREAT_MODEL.md).

Keep a public deployment behind a TLS proxy with request-body buffering, size limits, header/body timeouts, and per-client rate and connection controls. Keep response buffering disabled for SSE. [NGINX request buffering](https://nginx.org/en/docs/http/ngx_http_proxy_module.html#proxy_request_buffering) holds an incoming body before forwarding it; the included proxy lab now enables it explicitly. Partial headers arrive before application authentication, so direct access can still exhaust finite socket capacity. [NGINX connection limits](https://nginx.org/en/docs/http/ngx_http_limit_conn_module.html) count requests only after complete headers; they do not replace header timeouts or edge connection controls. Tune limits for the deployment, including clients sharing an address. HTTP admission does not promise fairness against an attacker with valid credentials or arbitrary concurrent library calls sharing the same runtime.

For a fresh local validation deployment, create a private directory outside the document workspace and run the included collector as the same unprivileged user:

```bash
install -d -m 700 /tmp/secure-mcp-audit
"$MCP_NODE" "$MCP_TRIAL/install/node_modules/@perfecxion/secure-mcp-server/examples/audit-collector.mjs" --socket /tmp/secure-mcp-audit/collector.sock \
  --journal /tmp/secure-mcp-audit/events.jsonl
```

Set `audit.socketPath` to that absolute Unix socket path. The server uses a persistent Unix stream and requires one ordered acknowledgement byte per record after the corresponding append and `fsync`. The collector groups queued records into bounded writes and syncs before acknowledging them. This adds filesystem latency to requests. The collector bounds records to 4 KiB, connections to 64, pending records to 1,024, and the journal to 256 MiB by default (`--max-bytes` overrides the limit). The client also bounds outstanding records to 1,024; the runtime's configured audit capacity remains the tighter limit. Use the matching included collector with this client, since earlier collectors closed after one record.

There is no retry after a disconnect or timeout with outstanding records: delivery may already have happened, and replay would create ambiguous duplicates. A clean idle connection can be re-established for a later record. `runtime.close()` drains pending writes and closes its sink; a custom callable sink may provide an optional asynchronous `close()` owned by that runtime. Do not share an owned sink between independently closing runtimes.

Reaching the journal limit or losing delivery denies further work and latches the service unhealthy. Monitor capacity, stop the server before rotating the journal, preserve old files, restart the collector, then restart the server and check readiness. Paths and parent directories must remain operator-controlled. The collector rejects symlink journals, multiply linked files, public permissions, and incomplete final records. A crash can leave a socket path; remove it only after confirming its collector has stopped. A partial record requires preserving and repairing the journal before restart.

This local collector is a validation reference, with no automatic rotation, retention, remote replication, or tamper-resistant storage. File sync acknowledgements depend on the host filesystem and hardware. A privileged local attacker can alter the journal. Integrate and fault-test your production collector separately. `npm run test:audit` exercises the actual collector process, kill/restart persistence, journal limits, and blocked delivery.

SIGINT, SIGTERM, and stdio EOF initiate shutdown. HTTP stops accepting requests, cancels active tools, and closes sockets. The process exits nonzero if trusted handlers fail to settle within the deadline, audit readiness is unhealthy, or shutdown fails. Library users must call `close()`, handle errors and the remaining-work count, and inspect audit health.

## Container

The following commands require a source checkout; Docker build files are not part of the installed npm package. No container registry release is implied.

```bash
docker build -t secure-mcp:local .
docker run --rm -i --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --pids-limit 64 --memory 512m --cpus 2 \
  --mount type=bind,src="$(pwd)/examples/documents",dst=/workspace,readonly \
  secure-mcp:local --workspace /workspace
```

The image runs as the unprivileged `node` user. Mounted documents must be readable by that user. The command above is for stdio with network disabled. A remote HTTP deployment needs deliberate networking, a read-only config mount, and TLS routing. Never mount a Docker socket or a broad home directory.

## Verification and troubleshooting

These contributor checks require a source checkout and `npm ci` on the supported Node version. Installed consumers use the [trial guide](validation/REAL_USER_VALIDATION.md) and their retained lockfile instead.

```bash
npm run check
npm run test:package
npm run test:container
npm audit
BENCH_SECONDS=60 npm run benchmark
```

Startup rejects unknown configuration keys, missing HTTP issuer information, unknown allowlisted tools, and inaccessible workspaces. Tool errors are short stable codes: `denied`, `invalid_input`, `busy`, `timeout`, `cancelled`, `shutting_down`, `output_too_large`, `not_found`, `upstream_failed`, `audit_unavailable`, and `internal`. Filesystem errors intentionally do not reveal paths. Diagnose using operator-owned configuration and audit outcomes, never by logging raw access tokens.

For `documents_read`, `not_found` means the requested document could not be safely read. It covers missing or unreadable files, rejected symlink opens, and invalid UTF-8; it does not assert that the file is absent. Path-policy checks, such as traversal and hidden components, return `denied` before opening a file. A successfully opened object that is not a regular file also returns `denied`. This conservative mapping avoids exposing OS errors or distinguishing file existence from access failures. Operators can inspect the configured workspace through trusted local access without adding paths or file contents to protocol errors or audit records.

Configuration editor schema: `config.schema.json`, generated from the runtime schema with `npm run schema`. Custom URL and cross-field constraints are also enforced by the runtime. Registry metadata in `server.json` is prepared but unpublished.
