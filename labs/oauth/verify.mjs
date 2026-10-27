import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPair, exportJWK } from 'jose';
import { Provider, errors } from 'oidc-provider';
import {
  Client,
  ClientCredentialsProvider,
  StreamableHTTPClientTransport,
} from '@modelcontextprotocol/client';
import { SecureRuntime, serveHttp } from '../../dist/index.js';

// Disposable external authorization server. No accounts, keys, or tokens are persisted.
const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-oauth-'));
const issuerServer = createServer();
let runtime, endpoint, client;
try {
  const signing = await generateKeyPair('RS256', { extractable: true });
  const key = {
    ...(await exportJWK(signing.privateKey)),
    kid: 'lab-key',
    alg: 'RS256',
    use: 'sig',
  };
  await new Promise((resolve) => issuerServer.listen(0, '127.0.0.1', resolve));
  const issuer = `http://127.0.0.1:${issuerServer.address().port}`;
  // Reserve then release a loopback port so discovery uses the actual resource URI.
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const resource = `http://127.0.0.1:${port}/mcp`;
  const clientId = 'secure-mcp-lab';
  const clientSecret = randomBytes(32).toString('base64url');
  const issuerApp = new Provider(issuer, {
    jwks: { keys: [key] },
    cookies: { keys: [randomBytes(32).toString('base64url')] },
    clients: [
      {
        client_id: clientId,
        client_secret: clientSecret,
        grant_types: ['client_credentials'],
        response_types: [],
        redirect_uris: [],
        token_endpoint_auth_method: 'client_secret_basic',
        scope: 'documents:read policy:read',
      },
    ],
    scopes: ['documents:read', 'policy:read'],
    features: {
      devInteractions: { enabled: false },
      clientCredentials: { enabled: true },
      resourceIndicators: {
        enabled: true,
        getResourceServerInfo(_context, indicator, registeredClient) {
          if (indicator !== resource || registeredClient.clientId !== clientId)
            throw new errors.InvalidTarget();
          return {
            scope: 'documents:read policy:read',
            audience: resource,
            accessTokenTTL: 300,
            accessTokenFormat: 'jwt',
            jwt: { sign: { alg: 'RS256' } },
          };
        },
      },
    },
  });
  issuerServer.on('request', issuerApp.callback());
  await writeFile(join(directory, 'document.txt'), 'External issuer lab passed.');
  runtime = await SecureRuntime.create({
    config: {
      workspace: directory,
      transport: 'http',
      http: { port, resource, issuer, jwksUrl: issuer + '/jwks' },
    },
    audit: () => {},
  });
  endpoint = await serveHttp(runtime);
  const authProvider = new ClientCredentialsProvider({
    clientId,
    clientSecret,
    expectedIssuer: issuer,
    scope: 'documents:read policy:read',
  });
  client = new Client(
    { name: 'external-issuer-lab', version: '1' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(resource), { authProvider }));
  assert.equal((await client.listTools()).tools.length, 2);
  const result = await client.callTool({
    name: 'documents_read',
    arguments: { path: 'document.txt' },
  });
  assert.equal(result.content[0].text, 'External issuer lab passed.');
  assert.equal(result.isError, undefined);
  assert.equal(
    (await client.callTool({ name: 'documents_read', arguments: { path: '../secret' } })).isError,
    true,
  );
  console.log(
    JSON.stringify({
      issuer: 'oidc-provider 9.13.0',
      flow: 'client_credentials',
      discovery: 'protected resource and OIDC metadata',
      token: 'RFC 9068 JWT',
      mcp: '2026-07-28 HTTP',
      result: 'pass',
      credentialsPersisted: false,
    }),
  );
} finally {
  await client?.close();
  if (endpoint) await endpoint.close();
  else await runtime?.close();
  await new Promise((resolve) => {
    issuerServer.close(() => resolve());
    issuerServer.closeAllConnections();
  });
  await rm(directory, { recursive: true, force: true });
}
