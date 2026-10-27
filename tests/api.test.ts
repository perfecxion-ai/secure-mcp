import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fixture, text } from './helpers.js';

test('fixed-destination API tool refuses redirects, arbitrary URL arguments, and oversized output', async (t) => {
  let mode = 'normal';
  let calls = 0;
  const upstream = createServer((request, response) => {
    calls++;
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.authorization, undefined);
    if (mode === 'redirect') {
      response.writeHead(302, { location: '/secret' }).end();
      return;
    }
    response.end(mode === 'large' ? 'x'.repeat(2048) : '{"status":"ok"}');
  });
  await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        upstream.close(() => resolve());
        upstream.closeAllConnections();
      }),
  );
  const address = upstream.address();
  assert.ok(address && typeof address !== 'string');
  const { runtime, principal } = await fixture(t, {
    config: {
      allowedTools: ['api_read'],
      localScopes: ['api:read'],
      api: { url: `http://127.0.0.1:${address.port}/status`, maxBytes: 1024 },
    },
  });
  assert.equal(text(await runtime.invoke(principal, 'api_read', {})), '{"status":"ok"}');
  assert.equal(
    text(await runtime.invoke(principal, 'api_read', { url: 'http://169.254.169.254/' })),
    'invalid_input',
  );
  assert.equal(calls, 1);
  mode = 'redirect';
  assert.equal(text(await runtime.invoke(principal, 'api_read', {})), 'upstream_failed');
  assert.equal(calls, 2);
  mode = 'large';
  assert.equal(text(await runtime.invoke(principal, 'api_read', {})), 'output_too_large');
});
