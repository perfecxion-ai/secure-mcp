# TLS reverse-proxy lab

This Linux lab starts the built CLI behind a digest-pinned NGINX container. It requires Docker and OpenSSL. All listeners bind to loopback. It creates a one-day certificate and temporary signing keys, trusts that certificate only in the client child process, and removes the container and fixtures afterward.

```bash
npm ci
npm run build
npm run test:proxy
```

The official SDK client exercises both supported protocol versions over verified HTTPS. Assertions cover canonical resource metadata and the authentication challenge, an approved document read, traversal denial, restricted-scope discovery and invocation, wrong-audience rejection, hostile Host and Origin rejection, and allowed CORS preflight. A separate request with an empty CA set must reject the lab certificate. TLS verification is never disabled.

The container runs as the invoking user, with a read-only filesystem, dropped capabilities, a temporary scratch filesystem, and CPU, memory, and process limits. Host networking lets it reach the loopback runtime; its own listener also binds only to loopback. The digest identifies NGINX 1.30.6 Alpine. Review and refresh that pin as part of dependency maintenance.

The template preserves the incoming Host header and disables request/response buffering, following the [NGINX proxy documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html) and [HTTPS configuration](https://nginx.org/en/docs/http/configuring_https_servers.html). Passing Host through allows the runtime to reject an unexpected hostname. A production proxy should also reject unknown virtual hosts and manage trusted certificates independently.

This validates a specific proxy path, not an internet deployment. The issuer is a local JWT fixture, access logging is disabled, and the lab does not test certificate renewal, a durable audit collector, browser login, or a production identity provider. Reports contain versions, assertions, and built-runtime hashes; they contain no tokens or private keys.
