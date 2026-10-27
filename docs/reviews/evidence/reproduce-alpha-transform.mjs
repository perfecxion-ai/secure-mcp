// Regression probe for the former repeated-transform defect. Run after npm ci and npm run build.
import assert from 'node:assert/strict';
import { z } from 'zod';
import { SecureRuntime, defineTool, textResult } from '../../../dist/index.js';

let handlerCalls = 0;
const runtime = await SecureRuntime.create({
  config: { allowedTools: ['transform_fixture'], localScopes: ['fixture:read'] },
  audit: () => {},
  tools: [
    defineTool({
      name: 'transform_fixture',
      description: 'Demonstrate repeated parsing of a type-changing transform',
      requiredScopes: ['fixture:read'],
      readOnly: true,
      inputSchema: z.strictObject({ n: z.string().transform(Number) }),
      async invoke({ n }) {
        handlerCalls++;
        return textResult(String(n + 1));
      },
    }),
  ],
});
try {
  const result = await runtime.invoke(runtime.localPrincipal(), 'transform_fixture', { n: '1' });
  console.log(JSON.stringify({ expectedText: '2', actual: result, handlerCalls }));
  assert.equal(result.content[0]?.text, '2');
  assert.equal(handlerCalls, 1);
} finally {
  await runtime.close();
}
