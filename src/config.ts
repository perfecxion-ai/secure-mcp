import { resolve } from 'node:path';
import { z } from 'zod';
const name = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const scope = z.string().regex(/^[a-zA-Z0-9:._/-]{1,128}$/);
const url = z
  .string()
  .url()
  .refine((value) => {
    const parsed = new URL(value);
    return (
      !parsed.username &&
      !parsed.password &&
      !parsed.hash &&
      !parsed.search &&
      (parsed.protocol === 'https:' ||
        (parsed.protocol === 'http:' &&
          ['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)))
    );
  }, 'Use HTTPS, or HTTP on loopback for a local lab; no credentials, query, or fragment');
export const configSchema = z.strictObject({
  transport: z.literal('stdio').default('stdio'),
  workspace: z.string().min(1).default('.'),
  allowedTools: z.array(name).max(128).default(['documents_read', 'policy_status']),
  readOnly: z.boolean().default(true),
  localScopes: z.array(scope).max(128).default(['documents:read', 'policy:read']),
  limits: z
    .strictObject({
      maxConcurrent: z.number().int().min(1).max(256).default(16),
      timeoutMs: z.number().int().min(10).max(300_000).default(10_000),
      maxInputBytes: z.number().int().min(1024).max(4_194_304).default(65_536),
      maxOutputBytes: z.number().int().min(1024).max(4_194_304).default(262_144),
      shutdownMs: z.number().int().min(10).max(30_000).default(5_000),
    })
    .prefault({}),
  api: z
    .strictObject({ url, maxBytes: z.number().int().min(1).max(262_144).default(65_536) })
    .optional(),
});
export type RuntimeConfig = z.infer<typeof configSchema>;
export function parseConfig(value: unknown): RuntimeConfig {
  const parsed = configSchema.parse(value);
  parsed.workspace = resolve(parsed.workspace);
  return parsed;
}
