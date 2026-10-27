# External issuer lab

This disposable lab uses `oidc-provider` as a separate authorization server and the official MCP SDK's client-credentials provider. It exercises the 401 challenge, protected resource discovery, OIDC metadata, token endpoint, JWKS verification, tool invocation, and a denied file read.

```bash
npm ci
npm run build
npm --prefix labs/oauth ci
node labs/oauth/verify.mjs
```

All listeners bind to loopback on temporary ports. Signing keys, client credentials, and tokens are generated for the run and held in memory. Cleanup closes the servers and removes the document fixture. No credentials are printed or saved.

The in-memory issuer adapter is deliberate for this lab. This is machine authentication, not a test of browser login, consent, MFA, registration, or refresh. Do not deploy this issuer configuration. Production identity belongs to an independently operated authorization server.
