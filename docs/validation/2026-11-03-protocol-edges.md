# Protocol edge-case decisions

The independent November 3 review reported argument-key rewriting, zero clock tolerance, hostname confusion and transport differences for JSON-RPC batches. These observations do not establish an authentication or prototype-pollution bypass. The frozen alpha.2 bundle and its evidence remain unchanged.

## Reserved argument keys

The pinned SDK (`@modelcontextprotocol/server` 2.4.0) first parses the JSON-RPC envelope and later validates method-specific parameters. Its `tools/call` parameter schema uses `z.record(z.string(), z.unknown())`. Zod 4.6.7 deliberately skips an own `__proto__` key when producing that record. The generic envelope retains the key, so the skip occurs before the runtime's strict tool schema can reject it. A valid call with that extra key previously reached its handler. Direct strict-object validation rejected the same undeclared root key.

The development fix rejects an own `__proto__` argument key at the audited request boundary, before the SDK record parse. Nested occurrences are rejected by the runtime's existing bounded input walk before custom schema validation. Escaped JSON spellings of the key are treated identically after decoding. The wire response is a generic invalid-arguments error; failure to record that rejection still produces `audit_unavailable` and latches audit health.

Raw-byte tests cover stdio and HTTP under both `2026-07-28` and `2025-11-25`, including a positive request before and after the rejected inputs. Direct-runtime tests verify that neither custom validation nor the handler runs for reserved keys. Tests check missing required fields supplied only through `__proto__`, escaped names, nested occurrences, unchanged object prototypes, no injected property on `Object.prototype`, and content-free audit events. They also exercise a failed audit sink on the early stdio rejection.

This is an input-consistency correction, not a claim that prototype pollution was exploitable. `constructor` and `prototype` are not globally banned: custom schemas may deliberately declare those names. Strict built-in schemas continue to reject them when they are unknown fields. The literal string `"__proto__"` remains ordinary data.

## Clock synchronization

Keep the current zero clock-tolerance default. The verifier rejects future `iat` and `nbf`, expired tokens, excessive age and excessive lifetime. Adding a configurable grace period would broaden token acceptance and needs a separate decision; this interoperability review does not justify that change.

For intermittent 401 responses close to issuance or expiry, compare the issuer's and server's UTC clocks and confirm their configured time-synchronization service is healthy. On the Linux server, `date -u` and `node -p 'Math.floor(Date.now()/1000)'` show the current wall time. Compare token timing locally through the operator's issuer tooling, without putting bearer tokens in issue reports. Clock synchronization does not replace issuer, audience, signature, type or scope validation.

## Published hostname

If `http.resource` uses `http://127.0.0.1:3000/mcp`, a client using `http://localhost:3000/mcp` sends a different Host value and receives 403 even when both addresses reach the same listener. Use the published resource URL consistently in the host configuration, issuer audience and proxy configuration. A wildcard listening address such as `0.0.0.0` does not authorize arbitrary Host values. Browser Origin validation is a separate exact allowlist.

## One message per request

The separate HTTP admission fix handles the reported batch inconsistency. Send one MCP message per request. This work adds no batch support and makes no new claim about the frozen alpha.2 transport behavior.
