import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { generateKeyPair, exportJWK } from 'jose';
import { Provider, errors } from 'oidc-provider';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
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
  const redirectUri = issuer + '/client-callback';
  const interactions = [];
  const issuerApp = new Provider(issuer, {
    jwks: { keys: [key] },
    cookies: { keys: [randomBytes(32).toString('base64url')] },
    clients: [
      {
        client_id: clientId,
        grant_types: ['authorization_code'],
        response_types: ['code'],
        redirect_uris: [redirectUri],
        token_endpoint_auth_method: 'none',
        scope: 'documents:read policy:read',
      },
    ],
    scopes: ['openid', 'documents:read', 'policy:read'],
    pkce: { required: () => true },
    interactions: { url: (_ctx, interaction) => '/interaction/' + interaction.uid },
    findAccount: async (_ctx, id) => ({ accountId: id, claims: async () => ({ sub: id }) }),
    features: {
      devInteractions: { enabled: false },
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
  const issuerCallback = issuerApp.callback();
  issuerServer.on('request', (request, response) => {
    if (!request.url.startsWith('/interaction/')) return issuerCallback(request, response);
    void (async () => {
      const details = await issuerApp.interactionDetails(request, response);
      interactions.push(details.prompt.name);
      if (details.prompt.name === 'login') {
        await issuerApp.interactionFinished(
          request,
          response,
          { login: { accountId: 'lab-user' } },
          { mergeWithLastSubmission: false },
        );
      } else if (details.prompt.name === 'consent') {
        const grant = new issuerApp.Grant({ accountId: details.session.accountId, clientId });
        grant.addOIDCScope('openid documents:read policy:read');
        grant.addResourceScope(resource, 'documents:read policy:read');
        await issuerApp.interactionFinished(request, response, {
          consent: { grantId: await grant.save() },
        });
      } else throw new Error('Unexpected interaction');
    })().catch(() => {
      response.writeHead(500).end('Lab interaction failed');
    });
  });
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
  let tokens, verifier, authorizationUrl, discovery;
  const state = randomBytes(24).toString('base64url');
  const authProvider = {
    redirectUrl: redirectUri,
    clientMetadata: {
      client_name: 'PKCE lab',
      redirect_uris: [redirectUri],
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'documents:read policy:read',
    },
    state: () => state,
    clientInformation: () => ({ client_id: clientId, issuer }),
    tokens: () => tokens,
    saveTokens: (value) => {
      tokens = value;
    },
    saveCodeVerifier: (value) => {
      verifier = value;
    },
    codeVerifier: () => verifier,
    redirectToAuthorization: (value) => {
      authorizationUrl = value;
    },
    discoveryState: () => discovery,
    saveDiscoveryState: (value) => {
      discovery = value;
    },
  };
  const transport = new StreamableHTTPClientTransport(new URL(resource), { authProvider });
  client = new Client(
    { name: 'authorization-code-lab', version: '1' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await assert.rejects(client.connect(transport));
  assert.ok(authorizationUrl);
  assert.equal(authorizationUrl.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(authorizationUrl.searchParams.get('state'), state);
  const cookies = new Map();
  async function followAuthorization(url) {
    for (let hops = 0; hops < 12; hops++) {
      assert.equal(url.origin, issuer);
      if (url.pathname === '/client-callback') {
        assert.equal(url.searchParams.get('state'), state);
        assert.equal(url.searchParams.get('iss'), issuer);
        assert.ok(url.searchParams.get('code'));
        return url.searchParams;
      }
      const response = await fetch(url, {
        redirect: 'manual',
        headers: { cookie: [...cookies].map(([k, v]) => k + '=' + v).join('; ') },
      });
      await response.arrayBuffer();
      for (const cookie of response.headers.getSetCookie()) {
        const pair = cookie.split(';')[0];
        const split = pair.indexOf('=');
        cookies.set(pair.slice(0, split), pair.slice(split + 1));
      }
      assert.ok([302, 303].includes(response.status));
      const location = response.headers.get('location');
      assert.ok(location);
      url = new URL(location, url);
    }
    throw new Error('Authorization redirect limit exceeded');
  }
  const callback = await followAuthorization(authorizationUrl);
  await transport.finishAuth(callback);
  assert.ok(tokens.access_token);
  await client.close();
  client = new Client(
    { name: 'authorized-code-lab', version: '1' },
    { versionNegotiation: { mode: { pin: '2026-07-28' } } },
  );
  await client.connect(new StreamableHTTPClientTransport(new URL(resource), { authProvider }));
  assert.ok(interactions.includes('login') && interactions.includes('consent'));
  const replay = await fetch(issuer + '/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: callback.get('code'),
      code_verifier: verifier,
      redirect_uri: redirectUri,
      resource,
    }),
  });
  assert.equal(replay.status, 400);
  assert.equal((await replay.json()).error, 'invalid_grant');
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
  const secondCallback = await followAuthorization(new URL(authorizationUrl));
  const wrongVerifier = await fetch(issuer + '/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      client_id: clientId,
      code: secondCallback.get('code'),
      code_verifier: randomBytes(32).toString('base64url'),
      redirect_uri: redirectUri,
      resource,
    }),
  });
  assert.equal(wrongVerifier.status, 400);
  assert.equal((await wrongVerifier.json()).error, 'invalid_grant');
  console.log(
    JSON.stringify({
      issuer: 'oidc-provider 9.13.0',
      flow: 'authorization_code with S256 PKCE',
      discovery: 'protected resource and OIDC metadata',
      token: 'RFC 9068 JWT',
      mcp: '2026-07-28 HTTP',
      result: 'pass',
      credentialsPersisted: false,
      interaction: 'Scripted loopback login and consent; no browser UI',
      authorizationCodeReplay: 'rejected',
      wrongPkceVerifier: 'rejected',
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
