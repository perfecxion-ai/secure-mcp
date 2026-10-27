import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { mkdtemp, mkdir, chmod, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { once } from 'node:events';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { decodeJwt, decodeProtectedHeader, createRemoteJWKSet, jwtVerify } from 'jose';
import { SecureRuntime, serveHttp } from '../../dist/index.js';

const images = {
  keycloak:
    'quay.io/keycloak/keycloak@sha256:a78d6b79572168cb25886b80a8b5b8d4ed4390743e3eecb810538683e209dd6b',
  postgres: 'postgres@sha256:2d2b8998d31037bf721cfdf764d76ba74171b4fab3431b7f72c27c56ddbdf9e3',
  nginx: 'nginx@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5',
  chromium:
    'selenium/standalone-chromium@sha256:c7c17cd79c62819a8329df00e610dbc4073c279da034a6f37135d454eb0d8870',
};
async function freePort() {
  const server = createServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}
async function until(operation, timeout = 60_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const value = await operation();
      if (value) return value;
    } catch {}
    await delay(100);
  }
  throw new Error('Lab readiness deadline exceeded');
}

if (process.argv.includes('--client')) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const {
    issuer,
    resource,
    callbackPort,
    browserPort,
    password,
    adminPassword,
    runtimePort,
    directory,
  } = JSON.parse(input);
  const discovery = await until(async () => {
    const r = await fetch(issuer + '/.well-known/openid-configuration');
    return r.ok && r.json();
  });
  assert.equal(discovery.issuer, issuer);
  const debuggerInfo = await until(async () => {
    const r = await fetch(`http://127.0.0.1:${browserPort}/json/new?about:blank`, {
      method: 'PUT',
    });
    return r.ok && r.json();
  });
  const browser = new WebSocket(debuggerInfo.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    browser.onopen = resolve;
    browser.onerror = reject;
  });
  let sequence = 0;
  const pending = new Map();
  browser.onmessage = ({ data }) => {
    const message = JSON.parse(data);
    if (message.id) {
      const entry = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) entry.reject(new Error('Browser command failed'));
      else entry.resolve(message.result);
    }
  };
  function command(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      browser.send(JSON.stringify({ id, method, params }));
    });
  }
  const evaluate = async (expression) =>
    (await command('Runtime.evaluate', { expression, returnByValue: true })).result.value;
  await command('Page.enable');
  const browserVersion = (await command('Browser.getVersion')).product;
  const events = [];
  const runtime = await SecureRuntime.create({
    config: {
      transport: 'http',
      workspace: join(directory, 'documents'),
      http: {
        port: runtimePort,
        resource,
        issuer,
        jwksUrl: discovery.jwks_uri,
        algorithms: ['RS256'],
        maxTokenAgeSeconds: 120,
      },
    },
    audit: (event) => events.push(event),
  });
  const handle = await serveHttp(runtime);
  let callbackResolve;
  const callbacks = createServer((request, response) => {
    const url = new URL(request.url, `http://127.0.0.1:${callbackPort}`);
    response
      .writeHead(200, { 'content-type': 'text/plain', 'cache-control': 'no-store' })
      .end('Login complete. Return to the validation client.');
    if (url.pathname === '/callback') callbackResolve?.(url);
  });
  await new Promise((resolve) => callbacks.listen(callbackPort, '127.0.0.1', resolve));
  const checks = [];
  try {
    async function login(clientId, checkPassword) {
      const verifier = randomBytes(48).toString('base64url'),
        state = randomBytes(24).toString('hex'),
        nonce = randomBytes(24).toString('hex');
      const redirect = `http://127.0.0.1:${callbackPort}/callback`;
      const authorization = new URL(discovery.authorization_endpoint);
      authorization.search = new URLSearchParams({
        client_id: clientId,
        response_type: 'code',
        scope: 'openid',
        redirect_uri: redirect,
        state,
        nonce,
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
        code_challenge_method: 'S256',
      }).toString();
      let received;
      const callback = new Promise((resolve) => {
        callbackResolve = (url) => {
          received = url;
          resolve(url);
        };
      });
      await command('Page.navigate', { url: authorization.href });
      if (checkPassword) {
        await until(() => evaluate("!!document.querySelector('#username')"));
        await evaluate(
          `document.querySelector('#username').value = 'validation-user'; document.querySelector('#password').value = 'incorrect-fixture-password'; document.querySelector('#kc-login').click(); true`,
        );
        await until(() => evaluate("!!document.querySelector('#input-error-username')"));
        checks.push('real browser rejects incorrect password');
      }
      const form = await until(() =>
        received
          ? 'complete'
          : evaluate(
              "document.querySelector('#username') ? 'login' : document.querySelector('#kc-oauth') ? 'consent' : false",
            ),
      );
      if (form === 'login')
        await evaluate(
          `document.querySelector('#username').value = 'validation-user'; document.querySelector('#password').value = ${JSON.stringify(password)}; document.querySelector('#kc-login').click(); true`,
        );
      const consent = await until(() =>
        received ? 'complete' : evaluate("document.querySelector('#kc-oauth') ? 'consent' : false"),
      );
      if (consent === 'consent')
        await evaluate("document.querySelector('#kc-oauth #kc-login').click(); true");
      const url = await Promise.race([
        callback,
        delay(15_000).then(() => {
          throw new Error('OAuth callback deadline exceeded');
        }),
      ]);
      assert.equal(url.searchParams.get('state'), state);
      assert.equal(url.searchParams.get('iss'), issuer);
      assert.equal(url.searchParams.get('error'), null);
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: clientId,
        redirect_uri: redirect,
        code: url.searchParams.get('code'),
        code_verifier: verifier,
      });
      const response = await fetch(discovery.token_endpoint, { method: 'POST', body });
      assert.equal(response.status, 200);
      const tokens = await response.json();
      assert.equal(decodeProtectedHeader(tokens.access_token).typ, 'at+jwt');
      const claims = decodeJwt(tokens.access_token);
      assert.equal(typeof claims.sub, 'string', 'Access token needs a subject claim');
      assert.equal(typeof claims.scope, 'string', 'Access token needs scopes');
      assert.ok(
        claims.aud === resource || claims.aud?.includes(resource),
        'Resource audience required',
      );
      const id = await jwtVerify(tokens.id_token, createRemoteJWKSet(new URL(discovery.jwks_uri)), {
        issuer,
        audience: clientId,
      });
      assert.equal(id.payload.nonce, nonce);
      return { ...tokens, exchangeBody: body };
    }
    const tokens = await login('validation-native', true);
    checks.push(
      'browser login and explicit consent with S256 PKCE, state, issuer, and verified nonce',
    );
    for (const mode of [{ pin: '2026-07-28' }, 'legacy']) {
      const client = new Client(
        { name: 'keycloak-browser', version: '1' },
        { versionNegotiation: { mode } },
      );
      try {
        await client.connect(
          new StreamableHTTPClientTransport(new URL(resource), {
            requestInit: { headers: { authorization: `Bearer ${tokens.access_token}` } },
          }),
        );
        assert.equal((await client.listTools()).tools.length, 2);
        const result = await client.callTool({
          name: 'documents_read',
          arguments: { path: 'note.txt' },
        });
        assert.equal(result.isError, undefined);
        assert.equal(result.content[0].text, 'Keycloak browser fixture');
        assert.equal(
          (await client.callTool({ name: 'documents_read', arguments: { path: '../outside' } }))
            .isError,
          true,
        );
      } finally {
        await client.close();
      }
    }
    checks.push('Keycloak access tokens accepted by both MCP protocols with traversal denied');
    assert.equal(
      (
        await fetch(resource, {
          method: 'POST',
          headers: { authorization: `Bearer ${tokens.id_token}` },
        })
      ).status,
      401,
    );
    const limited = await login('validation-policy', false);
    const client = new Client({ name: 'keycloak-policy', version: '1' });
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(resource), {
          requestInit: { headers: { authorization: `Bearer ${limited.access_token}` } },
        }),
      );
      assert.deepEqual(
        (await client.listTools()).tools.map((tool) => tool.name),
        ['policy_status'],
      );
      await assert.rejects(
        client.callTool({ name: 'documents_read', arguments: { path: 'note.txt' } }),
      );
    } finally {
      await client.close();
    }
    checks.push(
      'scope-restricted client cannot discover or invoke document tool; ID token rejected',
    );
    const adminResponse = await fetch(
      new URL('/realms/master/protocol/openid-connect/token', issuer),
      {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'password',
          client_id: 'admin-cli',
          username: 'lab-admin',
          password: adminPassword,
        }),
      },
    );
    assert.equal(adminResponse.status, 200);
    const adminToken = (await adminResponse.json()).access_token;
    const adminHeaders = {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    };
    const realmResponse = await fetch(new URL('/admin/realms/secure-mcp-lab', issuer), {
      headers: adminHeaders,
    });
    assert.equal(realmResponse.status, 200);
    const realmId = (await realmResponse.json()).id;
    const rotated = await fetch(new URL('/admin/realms/secure-mcp-lab/components', issuer), {
      method: 'POST',
      headers: adminHeaders,
      body: JSON.stringify({
        name: 'rotated-rsa',
        parentId: realmId,
        providerId: 'rsa-generated',
        providerType: 'org.keycloak.keys.KeyProvider',
        config: {
          priority: ['200'],
          enabled: ['true'],
          active: ['true'],
          algorithm: ['RS256'],
          keySize: ['2048'],
        },
      }),
    });
    assert.equal(rotated.status, 201);
    const refreshed = await fetch(discovery.token_endpoint, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: 'validation-policy',
        refresh_token: limited.refresh_token,
      }),
    });
    assert.equal(refreshed.status, 200);
    const fresh = await refreshed.json();
    assert.notEqual(
      decodeProtectedHeader(fresh.access_token).kid,
      decodeProtectedHeader(tokens.access_token).kid,
    );
    const valid = async (token, url = resource) =>
      (await fetch(new URL('/metrics', url), { headers: { authorization: `Bearer ${token}` } }))
        .status;
    assert.equal(await valid(fresh.access_token), 401);
    await delay(31_000);
    assert.equal(await valid(fresh.access_token), 403);
    assert.equal(await valid(tokens.access_token), 403);
    checks.push('real Keycloak key rotation respects refresh cooldown and overlapping keys');
    const control = async (action) => {
      const reply = once(process, 'message');
      process.send({ action });
      const [message] = await reply;
      assert.equal(message.action, action);
      assert.equal(message.ok, true, 'Issuer lifecycle operation failed');
    };
    await control('stop-issuer');
    assert.equal(await valid(fresh.access_token), 403);
    const cold = await SecureRuntime.create({
      config: {
        transport: 'http',
        allowedTools: ['policy_status'],
        http: {
          port: 0,
          resource,
          issuer,
          jwksUrl: discovery.jwks_uri,
          algorithms: ['RS256'],
          maxTokenAgeSeconds: 120,
        },
      },
      audit: () => {},
    });
    const coldHandle = await serveHttp(cold);
    try {
      assert.equal(await valid(fresh.access_token, coldHandle.url), 401);
    } finally {
      await coldHandle.close();
    }
    await control('start-issuer');
    await until(async () => (await fetch(issuer + '/.well-known/openid-configuration')).ok);
    assert.equal(await valid(fresh.access_token), 403);
    checks.push(
      'issuer outage permits fresh cached keys, rejects cold cache, and recovers after restart',
    );
    const logout = await fetch(discovery.end_session_endpoint, {
      method: 'POST',
      body: new URLSearchParams({
        client_id: 'validation-native',
        refresh_token: tokens.refresh_token,
      }),
    });
    assert.equal(logout.status, 204);
    assert.equal(
      (
        await fetch(discovery.token_endpoint, {
          method: 'POST',
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: 'validation-native',
            refresh_token: tokens.refresh_token,
          }),
        })
      ).status,
      400,
    );
    const expiry = decodeJwt(tokens.access_token).exp * 1000;
    if (Date.now() < expiry) {
      const live = await fetch(resource.replace('/mcp', '/metrics'), {
        headers: { authorization: `Bearer ${tokens.access_token}` },
      });
      assert.equal(live.status, 403); // Valid token, but no metrics scope; logout is not JWT revocation.
      await delay(Math.max(0, expiry - Date.now() + 1100));
    }
    assert.equal(
      (
        await fetch(resource, {
          method: 'POST',
          headers: { authorization: `Bearer ${tokens.access_token}` },
        })
      ).status,
      401,
    );
    checks.push('logout invalidates refresh; issued JWT expires at its original deadline');
    const replay = await login('validation-native', false);
    assert.equal(
      (await fetch(discovery.token_endpoint, { method: 'POST', body: replay.exchangeBody })).status,
      400,
    );
    checks.push('authorization code replay rejected');
    const serialized = JSON.stringify(events);
    for (const secret of [
      password,
      adminPassword,
      adminToken,
      tokens.access_token,
      tokens.refresh_token,
      'validation-user',
      'note.txt',
    ])
      assert.ok(!serialized.includes(secret));
    checks.push('audit omits credentials, tokens, identity text, and document paths');
    const sha256 = {};
    for (const name of (await readdir('dist')).filter((name) => name.endsWith('.js')).sort())
      sha256[`dist/${name}`] = createHash('sha256')
        .update(await readFile(join('dist', name)))
        .digest('hex');
    console.log(
      JSON.stringify({
        result: 'pass',
        node: process.version,
        browserVersion,
        sha256,
        images,
        keycloakMode: 'production start with PostgreSQL and HTTPS',
        browserTrust: 'ephemeral certificate SPKI pin',
        checks,
      }),
    );
  } finally {
    browser.close();
    process.disconnect?.();
    await handle.close();
    await new Promise((resolve) => {
      callbacks.close(resolve);
      callbacks.closeAllConnections();
    });
  }
} else {
  const directory = await mkdtemp(join(tmpdir(), 'mcp-keycloak-'));
  const prefix = 'mcp-keycloak-' + randomBytes(6).toString('hex');
  const started = [];
  let network = false;
  const docker = (...args) =>
    execFileSync('docker', args, { stdio: 'pipe', timeout: 120_000 }).toString().trim();
  try {
    const kcPort = await freePort(),
      callbackPort = await freePort(),
      browserPort = await freePort(),
      resourcePort = await freePort(),
      runtimePort = await freePort();
    const issuer = `https://127.0.0.1:${kcPort}/realms/secure-mcp-lab`,
      resource = `https://127.0.0.1:${resourcePort}/mcp`;
    const password = randomBytes(24).toString('hex'),
      databasePassword = randomBytes(24).toString('hex'),
      adminPassword = randomBytes(24).toString('hex');
    for (const name of ['certs', 'import', 'documents']) await mkdir(join(directory, name));
    await writeFile(join(directory, 'documents/note.txt'), 'Keycloak browser fixture');
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(directory, 'certs/key.pem'),
        '-out',
        join(directory, 'certs/cert.pem'),
        '-days',
        '1',
        '-subj',
        '/CN=127.0.0.1',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
      ],
      { stdio: 'ignore' },
    );
    await chmod(join(directory, 'certs/key.pem'), 0o600);
    const cert = await readFile(join(directory, 'certs/cert.pem'));
    const { X509Certificate } = await import('node:crypto');
    const spki = createHash('sha256')
      .update(new X509Certificate(cert).publicKey.export({ type: 'spki', format: 'der' }))
      .digest('base64');
    const scopes = ['documents:read', 'policy:read'].map((name) => ({
      name,
      protocol: 'openid-connect',
      attributes: {
        'include.in.token.scope': 'true',
        'display.on.consent.screen': 'true',
        'consent.screen.text': name,
      },
    }));
    scopes.push({
      name: 'basic',
      protocol: 'openid-connect',
      attributes: { 'include.in.token.scope': 'false', 'display.on.consent.screen': 'false' },
      protocolMappers: [
        {
          name: 'sub',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-sub-mapper',
          config: { 'access.token.claim': 'true', 'introspection.token.claim': 'true' },
        },
      ],
    });
    const clients = ['validation-native', 'validation-policy'].map((clientId) => ({
      clientId,
      enabled: true,
      publicClient: true,
      standardFlowEnabled: true,
      directAccessGrantsEnabled: false,
      consentRequired: true,
      redirectUris: [`http://127.0.0.1:${callbackPort}/callback`],
      defaultClientScopes:
        clientId === 'validation-native'
          ? ['basic', 'documents:read', 'policy:read']
          : ['basic', 'policy:read'],
      attributes: {
        'pkce.code.challenge.method': 'S256',
        'access.token.header.type.rfc9068': 'true',
        'access.token.lifespan': '120',
      },
      protocolMappers: [
        {
          name: 'mcp-audience',
          protocol: 'openid-connect',
          protocolMapper: 'oidc-audience-mapper',
          config: {
            'included.custom.audience': resource,
            'access.token.claim': 'true',
            'id.token.claim': 'false',
          },
        },
      ],
    }));
    await writeFile(
      join(directory, 'import/realm.json'),
      JSON.stringify({
        realm: 'secure-mcp-lab',
        enabled: true,
        sslRequired: 'external',
        accessTokenLifespan: 120,
        registrationAllowed: false,
        clients,
        clientScopes: scopes,
        users: [
          {
            username: 'validation-user',
            firstName: 'Validation',
            lastName: 'User',
            email: 'validation@example.invalid',
            emailVerified: true,
            enabled: true,
            credentials: [{ type: 'password', value: password, temporary: false }],
          },
        ],
      }),
      { mode: 0o600 },
    );
    await writeFile(
      join(directory, 'database.env'),
      `POSTGRES_DB=keycloak\nPOSTGRES_USER=keycloak\nPOSTGRES_PASSWORD=${databasePassword}\n`,
      { mode: 0o600 },
    );
    await writeFile(
      join(directory, 'keycloak.env'),
      `KC_BOOTSTRAP_ADMIN_USERNAME=lab-admin\nKC_BOOTSTRAP_ADMIN_PASSWORD=${adminPassword}\nKC_DB=postgres\nKC_DB_URL=jdbc:postgresql://${prefix}-db/keycloak\nKC_DB_USERNAME=keycloak\nKC_DB_PASSWORD=${databasePassword}\nKC_HOSTNAME=https://127.0.0.1:${kcPort}\nKC_HTTPS_CERTIFICATE_FILE=/certs/cert.pem\nKC_HTTPS_CERTIFICATE_KEY_FILE=/certs/key.pem\n`,
      { mode: 0o600 },
    );
    docker('network', 'create', prefix);
    network = true;
    docker(
      'run',
      '-d',
      '--name',
      prefix + '-db',
      '--network',
      prefix,
      '--memory',
      '512m',
      '--cpus',
      '2',
      '--env-file',
      join(directory, 'database.env'),
      '--tmpfs',
      '/var/lib/postgresql/data:rw,size=512m',
      images.postgres,
    );
    started.push(prefix + '-db');
    docker(
      'run',
      '-d',
      '--name',
      prefix + '-idp',
      '--network',
      prefix,
      '--memory',
      '2g',
      '--cpus',
      '2',
      '--user',
      `${process.getuid()}:0`,
      '--env-file',
      join(directory, 'keycloak.env'),
      '-p',
      `127.0.0.1:${kcPort}:8443`,
      '-v',
      `${directory}/certs:/certs:ro`,
      '-v',
      `${directory}/import:/opt/keycloak/data/import:ro`,
      images.keycloak,
      'start',
      '--import-realm',
    );
    started.push(prefix + '-idp');
    docker(
      'run',
      '-d',
      '--name',
      prefix + '-browser',
      '--network',
      'host',
      '--memory',
      '2g',
      '--cpus',
      '2',
      '--shm-size',
      '512m',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--entrypoint',
      '/usr/bin/chromium',
      images.chromium,
      '--headless',
      '--no-sandbox',
      '--disable-gpu',
      '--no-first-run',
      `--ignore-certificate-errors-spki-list=${spki}`,
      '--remote-debugging-address=127.0.0.1',
      `--remote-debugging-port=${browserPort}`,
      '--user-data-dir=/tmp/mcp-browser-profile',
      'about:blank',
    );
    started.push(prefix + '-browser');
    const proxyConfig = (await readFile(resolve('labs/proxy/nginx.conf'), 'utf8'))
      .replace('TLS_PORT', String(resourcePort))
      .replace('RUNTIME_PORT', String(runtimePort));
    await writeFile(join(directory, 'certs/nginx.conf'), proxyConfig);
    docker(
      'run',
      '-d',
      '--name',
      prefix + '-proxy',
      '--network',
      'host',
      '--read-only',
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges',
      '--memory',
      '128m',
      '--cpus',
      '1',
      '--tmpfs',
      '/tmp:rw,size=16m',
      '-v',
      `${directory}/certs:/lab:ro`,
      '--entrypoint',
      'nginx',
      images.nginx,
      '-c',
      '/lab/nginx.conf',
      '-g',
      'daemon off;',
    );
    started.push(prefix + '-proxy');
    const child = spawn(process.execPath, [resolve('labs/keycloak/verify.mjs'), '--client'], {
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: join(directory, 'certs/cert.pem'),
        NODE_TLS_REJECT_UNAUTHORIZED: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
    });
    child.on('message', ({ action }) => {
      if (action === 'stop-issuer' || action === 'start-issuer') {
        try {
          docker(action === 'stop-issuer' ? 'stop' : 'start', prefix + '-idp');
          child.send({ action, ok: true });
        } catch {
          child.send({ action, ok: false });
        }
      }
    });
    let output = '',
      errors = '';
    child.stdout.on('data', (data) => (output = (output + data).slice(-64_000)));
    child.stderr.on('data', (data) => (errors = (errors + data).slice(-8000)));
    child.stdin.end(
      JSON.stringify({
        issuer,
        resource,
        callbackPort,
        browserPort,
        password,
        adminPassword,
        runtimePort,
        directory,
      }),
    );
    const deadline = setTimeout(() => child.kill('SIGTERM'), 300_000);
    const [code] = await once(child, 'exit');
    clearTimeout(deadline);
    if (code !== 0) {
      process.stderr.write(
        errors
          .replaceAll(password, '[redacted]')
          .replaceAll(adminPassword, '[redacted]')
          .slice(-4000),
      );
      throw new Error('Keycloak browser acceptance failed');
    }
    const report = JSON.parse(output);
    if (process.argv[2]) await writeFile(process.argv[2], JSON.stringify(report, null, 2) + '\n');
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const name of started.reverse()) {
      try {
        docker('rm', '-f', name);
      } catch {}
    }
    if (network) {
      try {
        docker('network', 'rm', prefix);
      } catch {}
    }
    await rm(directory, { recursive: true, force: true });
  }
}
