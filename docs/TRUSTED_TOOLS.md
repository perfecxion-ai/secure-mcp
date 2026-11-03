# Add a trusted tool from an external application

SecureMCP hosts trusted in-process handlers. It does not sandbox their Node privileges. Start with the shipped [triage example](DEMO.md), which uses only public package exports. No internal source imports, repository build scripts, database or paid service are required.

## Create a separate consumer

Start from a fresh directory, select Linux and Node `>=24.22.1 <25`, and obtain the candidate tarball and trusted digest as described in [installation](../README.md). Copy the example into your own project so you can edit it without modifying installed package files:

```bash
: "${MCP_TARBALL:?Absolute path to the verified candidate}"
npm init -y
npm install --save-exact --ignore-scripts "$MCP_TARBALL"
npm install --save-exact --ignore-scripts zod@4.6.7 @modelcontextprotocol/server@2.4.0
mkdir triage
cp -R node_modules/@perfecxion/secure-mcp-server/examples/triage/. triage/
node triage/verify.mjs
node triage/server.mjs
```

The final command waits for an MCP stdio client. Configure your test host to launch that command using absolute Node and script paths. Stop it with the host, stdin EOF or SIGTERM. Keep the consumer lockfile. The SDK and Zod are direct dependencies here because the example imports them; do not depend on transitive hoisting in an external application.

The `.mjs` example is executable JavaScript with strict runtime input validation. For a TypeScript application, `defineTool` infers validated input types from the Zod schema. Use NodeNext module resolution and the public exports; the example does not require TypeScript or tsx to run.

## Understand the boundary before changing the connector

Read `triage/tool.mjs` in order:

1. `defineTool` names an operation, declares required scopes and provides a strict input schema. Unknown input fields fail. Read-only describes behavior the maintainer has reviewed, not enforced containment of arbitrary code.
2. The handler obtains `principal` and `signal` from its context. Transport authentication or trusted local configuration supplies identity. An argument, prompt or returned document must never select the principal.
3. The handler authorizes the resource before opening it. Both issuer and subject identify an allowlist entry. Adding a scope does not grant a caller every record or tenant. Denied resources return a stable error without reading their content.
4. A fixed ID map selects the destination. The example accepts no file path, URL, headers or credential from the caller. Fixture directories are trusted operator-owned data, not a replacement for the document tool's confinement controls.
5. The handler bounds reads, checks cancellation and returns bounded text. Runtime schemas are applied once; asynchronous schema work shares execution capacity and deadlines. Do not put side effects in refinements.
6. `server.mjs` owns the transport and closes the runtime and transport on termination. The embedding application is responsible for lifecycle, audit failure and recovery; importing a package does not start a server.

For a remote API integration, inject a narrowly scoped credential from operator configuration. Authorize the specific resource before network I/O, use a fixed or allowlisted destination, explicitly handle redirects and address restrictions, bound request/response sizes and forward the cancellation signal. Do not forward caller tokens to an unrelated upstream. Keep credentials and response content out of diagnostics and audit events. The reference `api_read` tool is a fixed GET example, not a complete authenticated connector.

For HTTP exposure, replace the fixture identity grant with your verified issuer/subject resource policy and use the supported authenticated HTTP transport. Never assign the local fixture principal to incoming HTTP callers. Review the JWT contract and revocation limits in [operations](OPERATIONS.md).

If you supply a custom callable audit sink, its optional `close()` hook is owned by the runtime and runs once after the bounded drain. Both drain and hook have separate `audit.timeoutMs` budgets; a failed or hung hook makes audit unhealthy and rejects shutdown. Do not share that owned sink between independently closing runtimes. Handle shutdown errors and a nonzero remaining-work count in your embedding; closing the transport alone does not close the runtime.

## Validate the integration

Run the verifier before modifying the example, then adapt its checks to the real resources. Exercise allowed work, a same-scope caller denied a different resource, malformed input, cancellation, oversized output, upstream failure, audit delivery failure and clean restart. Keep stdout reserved for MCP when serving. Use the [trial receipt](validation/TRIAL_RECEIPT.md) to record the exact installed digest and environment.

An external developer should be able to complete this journey using these public files alone. Record missing instructions and changes needed to build a useful tool, and contribute a focused PR when appropriate. Our example and agent checks do not establish an externally authored integration or independent repeat use.
