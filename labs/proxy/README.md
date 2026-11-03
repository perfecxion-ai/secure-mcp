# TLS reverse-proxy lab

This Linux lab starts the built CLI behind a digest-pinned NGINX container. It requires Docker and OpenSSL. All listeners bind to loopback. It creates a one-day certificate and temporary signing keys, trusts that certificate only in the client child process, and removes the container and fixtures afterward.

```bash
npm ci
npm run build
npm run test:proxy
```

The official SDK client exercises both supported protocol versions over verified HTTPS. Assertions cover canonical resource metadata and the authentication challenge, an approved document read, traversal denial, restricted-scope discovery and invocation, wrong-audience rejection, hostile Host and Origin rejection, and allowed CORS preflight. A separate request with an empty CA set must reject the lab certificate. TLS verification is never disabled.

The lab also holds four authenticated request bodies incomplete against a runtime with four admission slots. Ten complete tool calls must still succeed while the proxy buffers those uploads. Stalled uploads must time out or close within the bounded window, and runtime health must remain good. Disabling request buffering makes this regression fail because the incomplete uploads occupy runtime admission.

The container runs as the invoking user, with a read-only filesystem, dropped capabilities, a temporary scratch filesystem, and CPU, memory, and process limits. Host networking lets it reach the loopback runtime; its own listener also binds only to loopback. The digest identifies NGINX 1.30.6 Alpine. Review and refresh that pin as part of dependency maintenance.

The template preserves the incoming Host header, enables request-body buffering and disables response buffering for SSE, following the [NGINX proxy documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) and [HTTPS configuration](https://nginx.org/en/docs/http/configuring_https_servers.html). It sets finite body/header timeouts, request size, per-address request rate and concurrent-request limits. Passing Host through allows the runtime to reject an unexpected hostname. A production proxy should reject unknown virtual hosts, manage trusted certificates independently and apply edge connection controls for incomplete headers. The lab limits are not a capacity recommendation, especially for clients sharing an address.

This validates a specific proxy path, not an internet deployment. The issuer is a local JWT fixture, access logging is disabled, and the lab does not test certificate renewal, a durable audit collector, browser login, or a production identity provider. Reports contain versions, assertions, and built-runtime hashes; they contain no tokens or private keys.
