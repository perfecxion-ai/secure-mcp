# External issuer lab

This disposable lab uses `oidc-provider` as a separate authorization server and the official MCP SDK's client-credentials provider. It exercises the 401 challenge, protected resource discovery, OIDC metadata, token endpoint, JWKS verification, tool invocation, and a denied file read.

```bash
npm ci
npm run build
npm --prefix labs/oauth ci
node labs/oauth/verify.mjs
node labs/oauth/verify-code.mjs
```

All listeners bind to loopback on temporary ports. Signing keys, client credentials, and tokens are generated for the run and held in memory. Cleanup closes the servers and removes the document fixture. No credentials are printed or saved.

`verify.mjs` covers client credentials. `verify-code.mjs` covers authorization-code discovery, S256 PKCE, state and issuer binding, a scripted fixture login and consent, token exchange, code replay rejection, and rejection of an incorrect PKCE verifier. It follows redirects with an in-memory cookie jar and grants only the fixture account's fixed scopes. It is not a browser UI, password, MFA, registration, or refresh test.

The in-memory issuer adapter and automatic fixture login are deliberate for this disposable lab. Do not deploy this issuer configuration. Production identity belongs to an independently operated authorization server. `npm run test:oauth` runs both flows, including in CI after the lab's separate dependencies are installed.
