import { test } from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { deserializeMessage } from '@modelcontextprotocol/server';
import { hasReservedToolArgumentKey, withinInputElementLimit } from '../src/input.js';
import { defineTool, textResult } from '../src/tools.js';
import { fixture, text } from './helpers.js';

test('the SDK envelope retains the reserved argument key until its record parser', () => {
  const request = deserializeMessage(
    '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"inspect","arguments":{"__proto__":{"reservedKeyCanary":true}}}}',
  );
  assert.ok('params' in request);
  assert.ok(hasReservedToolArgumentKey(request.params?.arguments));
  // Pinned SDK method schemas use this record shape for arguments. Zod safely
  // drops the reserved own key, which previously concealed it from strict tools.
  const parsed = z.record(z.string(), z.unknown()).parse(request.params?.arguments);
  assert.deepEqual(Object.keys(parsed), []);
  assert.equal(Object.getPrototypeOf(parsed), Object.prototype);
  assert.ok(!Object.hasOwn(Object.prototype, 'reservedKeyCanary'));
});

test('reserved argument keys fail before custom validation and handler execution', async (t) => {
  let validations = 0;
  let calls = 0;
  const tool = defineTool({
    name: 'inspect',
    description: 'reserved-key regression fixture',
    requiredScopes: ['inspect:read'],
    readOnly: true,
    inputSchema: z
      .strictObject({
        data: z.unknown().optional(),
        constructor: z.string().optional(),
        prototype: z.string().optional(),
      })
      .superRefine(() => {
        validations++;
      }),
    async invoke() {
      calls++;
      return textResult('accepted');
    },
  });
  const { runtime, principal, events } = await fixture(t, {
    tools: [tool],
    config: { allowedTools: ['inspect'], localScopes: ['inspect:read'] },
  });
  for (const source of [
    '{"__proto__":{"reservedKeyCanary":true}}',
    String.raw`{"\u005f\u005fproto\u005f\u005f":{"reservedKeyCanary":true}}`,
    '{"data":{"__proto__":{"reservedKeyCanary":true}}}',
    '{"data":[{"__proto__":{"reservedKeyCanary":true}}]}',
  ]) {
    const args = JSON.parse(source) as Record<string, unknown>;
    assert.equal(withinInputElementLimit(args, 1024), false);
    assert.equal(text(await runtime.invoke(principal, 'inspect', args)), 'invalid_input');
  }
  assert.equal(validations, 0);
  assert.equal(calls, 0);
  assert.ok(!Object.hasOwn(Object.prototype, 'reservedKeyCanary'));
  assert.ok(!JSON.stringify(events).includes('reservedKeyCanary'));
  const valid = { data: ['__proto__'], constructor: 'declared field', prototype: 'declared field' };
  assert.equal(withinInputElementLimit(valid, 1024), true);
  assert.equal(text(await runtime.invoke(principal, 'inspect', valid)), 'accepted');
  assert.equal(validations, 1);
  assert.equal(calls, 1);
});
