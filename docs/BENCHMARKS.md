# Measuring the runtime

Build before measuring. Both scripts use a four-call workload and keep only the most recent 10,000 latency observations, so the reported percentiles are a rolling sample rather than percentiles over every call.

```bash
npm ci
npm run build
BENCH_SECONDS=60 npm run benchmark
BENCH_SECONDS=60 npm run benchmark:http
```

`benchmark` launches a separate stdio CLI and reads a 29-byte document with periodic denied traversal attempts. Its historical `startupMs` field measures SDK transport connection, not completion of a first tool call. Memory and file-descriptor samples come from the server process.

`benchmark:http` launches a separate HTTP CLI on loopback. Three clients can read the document; a fourth has only policy scope. Each worker attempts an expected denial every tenth call. Assertions check returned content and the restricted subject's policy visibility. `readyMs` includes listener startup, token setup, and successful tool discovery for all four clients. Server memory and descriptors are sampled every ten seconds.

The HTTP lab mints short-lived ES256 fixture tokens locally and renews them every two minutes. Verification uses the server's configured issuer, audience, scopes, and a real loopback JWKS endpoint. This is a resource-server load test, not an identity-provider capacity test or a TLS/proxy benchmark.

Both workloads execute authorization and generate JSON audit events, but send stderr to `/dev/null`. They do not measure a durable log collector. The HTTP report includes built-runtime hashes, token issuance count, JWKS request count, expected denial count, and unexpected failures. No access tokens, private keys, or document paths are written to the report. Fixtures are removed on normal completion.

Use a named source revision, an unchanged build, explicit duration, and a recorded host/runtime configuration when publishing results. Disclose overlapping workloads and background activity. A small-document run does not establish production capacity, performance for arbitrary handlers, or the roadmap's separate no-op overhead target.

For longer HTTP runs, set a driver heap limit and enable progress reporting:

```bash
BENCH_SECONDS=1800 BENCH_PROGRESS=1 node --max-old-space-size=256 scripts/http-benchmark.mjs > http-report.json 2> http-progress.jsonl
```

Progress reports appear once per minute. Memory samples distinguish server RSS from driver RSS and heap usage. The final report includes driver event-loop delay, bounded failure categories, and at most 20 failure samples with numeric error codes. It never includes raw exception messages or response bodies. A failed run exits nonzero and remains failed evidence even if a later run passes. Use these diagnostics to investigate load-generator stalls before attributing every timeout or memory trend to the server.
