import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';

const image = 'nginx@sha256:970364228b1e4f932abc22d321932816782cca8a20b85a77552a7cfe9acfb3b5';

if (process.argv.includes('--client')) {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const { resource, bearer, restricted, wrongAudience } = JSON.parse(input);
  const base = new URL(resource).origin;
  const unauthorized = await fetch(resource, { method: 'POST' });
  assert.equal(unauthorized.status, 401);
  assert.equal(
    unauthorized.headers.get('www-authenticate'),
    `Bearer resource_metadata="${base}/.well-known/oauth-protected-resource/mcp"`,
  );
  await assert.rejects(
    new Promise((resolve, reject) => {
      const request = httpsRequest(resource, { ca: [] }, (response) => {
        response.resume();
        resolve(response.statusCode);
      });
      request.on('error', reject);
      request.end();
    }),
    { code: 'DEPTH_ZERO_SELF_SIGNED_CERT' },
  );
  const metadata = await fetch(base + '/.well-known/oauth-protected-resource/mcp').then((r) =>
    r.json(),
  );
  assert.equal(metadata.resource, resource);
  for (const mode of [{ pin: '2026-07-28' }, 'legacy']) {
    const client = new Client(
      { name: 'tls-proxy-lab', version: '1' },
      { versionNegotiation: { mode } },
    );
    try {
      await client.connect(
        new StreamableHTTPClientTransport(new URL(resource), {
          requestInit: { headers: { authorization: `Bearer ${bearer}` } },
        }),
      );
      assert.deepEqual((await client.listTools()).tools.map((t) => t.name).sort(), [
        'documents_read',
        'policy_status',
      ]);
      const read = await client.callTool({
        name: 'documents_read',
        arguments: { path: 'note.txt' },
      });
      assert.equal(read.isError, undefined);
      assert.equal(read.content[0].text, 'TLS proxy fixture');
      const denied = await client.callTool({
        name: 'documents_read',
        arguments: { path: '../outside.txt' },
      });
      assert.equal(denied.isError, true);
      assert.equal(denied.content[0].text, 'denied');
    } finally {
      await client.close();
    }
  }
  const limited = new Client({ name: 'tls-limited-client', version: '1' });
  try {
    await limited.connect(
      new StreamableHTTPClientTransport(new URL(resource), {
        requestInit: { headers: { authorization: `Bearer ${restricted}` } },
      }),
    );
    assert.deepEqual(
      (await limited.listTools()).tools.map((t) => t.name),
      ['policy_status'],
    );
    await assert.rejects(
      limited.callTool({ name: 'documents_read', arguments: { path: 'note.txt' } }),
    );
  } finally {
    await limited.close();
  }
  assert.equal(
    (
      await fetch(resource, {
        method: 'POST',
        headers: { authorization: `Bearer ${wrongAudience}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (await fetch(resource, { method: 'POST', headers: { origin: 'https://evil.example' } })).status,
    403,
  );
  const preflight = await fetch(resource, {
    method: 'OPTIONS',
    headers: { origin: 'https://trusted.example' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://trusted.example');
  const hostileHost = await new Promise((resolve, reject) => {
    const request = httpsRequest(
      resource,
      { method: 'POST', servername: '', headers: { host: 'attacker.example' } },
      (response) => {
        response.resume();
        resolve(response.statusCode);
      },
    );
    request.on('error', reject);
    request.end();
  });
  assert.equal(hostileHost, 403);
  process.stdout.write(
    JSON.stringify({
      result: 'pass',
      certificateVerification: true,
      protocols: ['2026-07-28', '2025-11-25'],
      checks: [
        'untrusted certificate rejection',
        'canonical HTTPS discovery and challenge',
        'permitted document read',
        'traversal denial',
        'scope-isolated discovery and invocation',
        'wrong audience rejection',
        'hostile Origin rejection',
        'allowed preflight',
        'hostile Host rejection',
      ],
    }) + '\n',
  );
} else {
  const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-tls-lab-'));
  const name = 'secure-mcp-tls-' + randomUUID();
  let runtime,
    exit,
    containerStarted = false;
  const keys = await generateKeyPair('ES256');
  const publicKey = { ...(await exportJWK(keys.publicKey)), kid: 'tls-lab', alg: 'ES256' };
  const issuerServer = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ keys: [publicKey] }));
  });
  async function freePort() {
    const server = createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise((resolve) => server.close(resolve));
    return port;
  }
  try {
    await new Promise((resolve) => issuerServer.listen(0, '127.0.0.1', resolve));
    const issuer = `http://127.0.0.1:${issuerServer.address().port}`;
    const runtimePort = await freePort(),
      tlsPort = await freePort();
    const resource = `https://127.0.0.1:${tlsPort}/mcp`;
    await mkdir(join(directory, 'documents'));
    await writeFile(join(directory, 'documents/note.txt'), 'TLS proxy fixture');
    await writeFile(
      join(directory, 'config.json'),
      JSON.stringify({
        transport: 'http',
        workspace: join(directory, 'documents'),
        http: {
          port: runtimePort,
          resource,
          issuer,
          jwksUrl: issuer + '/jwks',
          algorithms: ['ES256'],
          allowedOrigins: ['https://trusted.example'],
        },
      }),
    );
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '1',
        '-subj',
        '/CN=SecureMCP disposable lab',
        '-addext',
        'subjectAltName=IP:127.0.0.1',
        '-keyout',
        join(directory, 'key.pem'),
        '-out',
        join(directory, 'cert.pem'),
      ],
      { stdio: 'ignore' },
    );
    const template = await readFile('labs/proxy/nginx.conf', 'utf8');
    await writeFile(
      join(directory, 'nginx.conf'),
      template
        .replaceAll('TLS_PORT', String(tlsPort))
        .replaceAll('RUNTIME_PORT', String(runtimePort)),
    );
    runtime = spawn(
      process.execPath,
      [resolve('dist/cli.js'), '--config', join(directory, 'config.json')],
      { stdio: 'ignore' },
    );
    exit = new Promise((resolve, reject) => {
      runtime.once('error', reject);
      runtime.once('exit', resolve);
    });
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (runtime.exitCode !== null) throw new Error('Runtime exited during startup');
      try {
        ready = (await fetch(`http://127.0.0.1:${runtimePort}/health`)).ok;
      } catch {
        /* Await listener. */
      }
      if (ready) break;
      await delay(50);
    }
    assert.ok(ready, 'Runtime did not become ready');
    execFileSync(
      'docker',
      [
        'run',
        '-d',
        '--name',
        name,
        '--network',
        'host',
        '--user',
        `${process.getuid()}:${process.getgid()}`,
        '--read-only',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges',
        '--pids-limit',
        '32',
        '--memory',
        '128m',
        '--cpus',
        '1',
        '--tmpfs',
        '/tmp:rw,nosuid,noexec,size=16m',
        '--mount',
        `type=bind,src=${directory},dst=/lab,readonly`,
        '--entrypoint',
        'nginx',
        image,
        '-c',
        '/lab/nginx.conf',
        '-g',
        'daemon off;',
      ],
      { stdio: 'pipe' },
    );
    containerStarted = true;
    await delay(500);
    assert.equal(
      execFileSync('docker', ['inspect', '--format', '{{.State.Running}}', name], {
        encoding: 'utf8',
      }).trim(),
      'true',
      execFileSync('docker', ['logs', name], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
    const now = Math.floor(Date.now() / 1000);
    const token = (scope, audience = resource) =>
      new SignJWT({
        sub: 'proxy-fixture',
        iss: issuer,
        aud: audience,
        iat: now,
        exp: now + 120,
        scope,
      })
        .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'tls-lab' })
        .sign(keys.privateKey);
    const child = spawn(process.execPath, [resolve('labs/proxy/verify.mjs'), '--client'], {
      env: {
        ...process.env,
        NODE_EXTRA_CA_CERTS: join(directory, 'cert.pem'),
        NODE_TLS_REJECT_UNAUTHORIZED: '1',
      },
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    let output = '',
      diagnostics = '';
    child.stdout.on('data', (data) => (output += data));
    child.stderr.on('data', (data) => (diagnostics += data));
    child.stdin.end(
      JSON.stringify({
        resource,
        bearer: await token('documents:read policy:read'),
        restricted: await token('policy:read'),
        wrongAudience: await token('documents:read', 'https://other.example/mcp'),
      }),
    );
    const code = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(code, 0, diagnostics);
    const sha256 = {};
    for (const file of (await readdir('dist')).filter((name) => name.endsWith('.js')).sort())
      sha256[`dist/${file}`] = createHash('sha256')
        .update(await readFile(join('dist', file)))
        .digest('hex');
    process.stdout.write(
      JSON.stringify(
        {
          date: new Date().toISOString(),
          node: process.version,
          architecture: process.arch,
          proxyImage: image,
          listeners: 'Loopback only',
          issuer: 'Ephemeral local JWT fixture, not a production IdP',
          ...JSON.parse(output),
          sha256,
        },
        null,
        2,
      ) + '\n',
    );
  } finally {
    try {
      if (containerStarted) execFileSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    } finally {
      try {
        if (runtime && runtime.exitCode === null) runtime.kill('SIGTERM');
        if (exit) {
          const timer = setTimeout(() => runtime.kill('SIGKILL'), 6000);
          try {
            assert.equal(await exit, 0, 'Runtime did not shut down cleanly');
          } finally {
            clearTimeout(timer);
          }
        }
      } finally {
        await new Promise((resolve) => {
          issuerServer.close(resolve);
          issuerServer.closeAllConnections();
        });
        await rm(directory, { recursive: true, force: true });
      }
    }
  }
}
