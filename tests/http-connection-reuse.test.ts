import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import type { Socket } from 'node:net';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { SecureRuntime } from '../src/runtime.js';
import { serveHttp } from '../src/http.js';

for (const mode of ['modern', 'legacy'] as const)
  test(
    `HTTP rotates bounded connections without failed SDK calls (${mode})`,
    { timeout: 15_000 },
    async (t) => {
      const keys = await generateKeyPair('ES256');
      const key = { ...(await exportJWK(keys.publicKey)), kid: 'rotation', alg: 'ES256' };
      const jwks = createServer((_request, response) =>
        response.setHeader('content-type', 'application/json').end(JSON.stringify({ keys: [key] })),
      );
      await new Promise<void>((resolve) => jwks.listen(0, '127.0.0.1', resolve));
      t.after(() => {
        jwks.close();
        jwks.closeAllConnections();
      });
      const address = jwks.address();
      assert.ok(address && typeof address !== 'string');
      const issuer = `http://127.0.0.1:${address.port}`;
      const resource = 'http://127.0.0.1:3000/mcp';
      const runtime = await SecureRuntime.create({
        config: {
          transport: 'http',
          allowedTools: ['policy_status'],
          http: { port: 0, resource, issuer, jwksUrl: issuer + '/jwks', algorithms: ['ES256'] },
        },
        audit: () => {},
      });
      const handle = await serveHttp(runtime);
      t.after(() => handle.close());
      assert.equal(
        handle.server.maxRequestsPerSocket,
        1000,
        'Production connection budget stays finite',
      );
      // Exercise repeated rotation without making each regression perform 1000 calls.
      const limit = 8;
      handle.server.maxRequestsPerSocket = limit;
      const sockets = new Map<Socket, { requests: number; closed: Promise<void> }>();
      let dropped = 0;
      handle.server.on('connection', (socket) => {
        sockets.set(socket, {
          requests: 0,
          closed: new Promise((resolve) => socket.once('close', resolve)),
        });
      });
      handle.server.prependListener('request', (request) => {
        sockets.get(request.socket)!.requests++;
      });
      handle.server.on('dropRequest', () => {
        dropped++;
      });
      const bearer = await new SignJWT({ scope: 'policy:read' })
        .setProtectedHeader({ alg: 'ES256', typ: 'at+jwt', kid: 'rotation' })
        .setSubject('fixture')
        .setIssuer(issuer)
        .setAudience(resource)
        .setIssuedAt()
        .setExpirationTime('5m')
        .sign(keys.privateKey);
      const responses: { status: number; connection: string | null }[] = [];
      const client = new Client(
        { name: 'connection-rotation', version: '1' },
        {
          versionNegotiation: { mode: mode === 'modern' ? { pin: '2026-07-28' } : 'legacy' },
        },
      );
      t.after(() => client.close());
      await client.connect(
        new StreamableHTTPClientTransport(new URL(handle.url), {
          fetch: async (input, init) => {
            const headers = new Headers(input instanceof Request ? input.headers : undefined);
            new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
            headers.set('authorization', `Bearer ${bearer}`);
            const response = await fetch(input, { ...init, headers });
            responses.push({
              status: response.status,
              connection: response.headers.get('connection'),
            });
            return response;
          },
        }),
      );
      for (let call = 0; call < limit * 5; call++) {
        const result = await client.callTool({ name: 'policy_status', arguments: {} });
        assert.notEqual(result.isError, true);
        const text = result.content.find((item) => item.type === 'text');
        assert.ok(text && text.type === 'text');
        assert.deepEqual(JSON.parse(text.text).tools, ['policy_status']);
      }
      const rotated = [...sockets.values()].filter((socket) => socket.requests === limit);
      assert.ok(rotated.length >= 2, 'Several sockets must reach the limit and rotate');
      await Promise.all(rotated.map((socket) => socket.closed));
      assert.ok(sockets.size > rotated.length, 'Successful later requests must use new sockets');
      assert.ok([...sockets.values()].every((socket) => socket.requests <= limit));
      assert.ok(
        responses.filter((response) => response.status === 200 && response.connection === 'close')
          .length >= rotated.length,
      );
      assert.equal(dropped, 0, 'Node must not drop a request after unannounced socket exhaustion');
      assert.ok(responses.every((response) => response.status !== 503));
      assert.equal(runtime.audit.healthy, true);

      // A rejected Host still closes promptly without consuming an unfinished body.
      const rejected = await new Promise<{
        status: number | undefined;
        connection: string | undefined;
      }>((resolve, reject) => {
        const request = httpRequest(
          handle.url,
          {
            method: 'POST',
            headers: { host: 'localhost', 'content-length': '10000' },
          },
          (response) => {
            response.resume();
            response.once('end', () =>
              resolve({ status: response.statusCode, connection: response.headers.connection }),
            );
          },
        );
        t.after(() => request.destroy());
        request.on('error', reject);
        request.flushHeaders();
      });
      assert.deepEqual(rejected, { status: 403, connection: 'close' });
    },
  );
