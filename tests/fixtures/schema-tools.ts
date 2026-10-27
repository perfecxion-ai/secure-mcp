import { z } from 'zod';
import { SecureRuntime } from '../../src/runtime.js';
import { defineTool, textResult } from '../../src/tools.js';

export async function schemaRuntime(config: Record<string, unknown> = {}) {
  let transforms = 0;
  return SecureRuntime.create({
    config: {
      allowedTools: ['transform_fixture', 'throw_fixture'],
      localScopes: ['fixture:read'],
      ...config,
    },
    audit: () => {},
    tools: [
      defineTool({
        name: 'transform_fixture',
        description: 'Schema ownership fixture',
        requiredScopes: ['fixture:read'],
        readOnly: true,
        inputSchema: z.strictObject({
          n: z
            .string()
            .regex(/^\d+$/)
            .transform(async (value) => {
              transforms++;
              await Promise.resolve();
              return Number(value);
            }),
          offset: z.coerce.number().default(2),
          label: z.string().default('fixture'),
        }),
        async invoke({ n, offset, label }) {
          return textResult(JSON.stringify({ sum: n + offset, label, transforms }));
        },
      }),
      defineTool({
        name: 'throw_fixture',
        description: 'Unsafe validator exception fixture',
        requiredScopes: ['fixture:read'],
        readOnly: true,
        inputSchema: z.strictObject({
          value: z.string().superRefine(() => {
            throw new Error('VALIDATOR_SECRET');
          }),
        }),
        async invoke() {
          throw new Error('Handler must not run');
        },
      }),
    ],
  });
}
