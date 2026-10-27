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
export const configSchema = z
  .strictObject({
    transport: z.enum(['stdio', 'http']).default('stdio'),
    workspace: z.string().min(1).default('.'),
    allowedTools: z.array(name).max(128).default(['documents_read', 'policy_status']),
    readOnly: z.boolean().default(true),
    audit: z
      .strictObject({
        maxPending: z.number().int().min(1).max(1024).default(64),
        timeoutMs: z.number().int().min(10).max(5000).default(1000),
      })
      .prefault({}),
    localScopes: z.array(scope).max(128).default(['documents:read', 'policy:read']),
    limits: z
      .strictObject({
        maxConcurrent: z.number().int().min(1).max(256).default(16),
        timeoutMs: z.number().int().min(10).max(300_000).default(10_000),
        maxInputBytes: z.number().int().min(1024).max(4_194_304).default(65_536),
        maxInputElements: z.number().int().min(1).max(10_000).default(1024),
        maxOutputBytes: z.number().int().min(1024).max(4_194_304).default(262_144),
        shutdownMs: z.number().int().min(10).max(30_000).default(5_000),
      })
      .prefault({}),
    http: z
      .strictObject({
        host: z.enum(['127.0.0.1', '::1', '0.0.0.0', '::']).default('127.0.0.1'),
        port: z.number().int().min(0).max(65535).default(3000),
        resource: url,
        issuer: url,
        jwksUrl: url,
        allowedOrigins: z
          .array(
            z
              .string()
              .url()
              .refine((v) => new URL(v).origin === v),
          )
          .max(32)
          .default([]),
        algorithms: z
          .array(z.enum(['RS256', 'ES256', 'EdDSA']))
          .min(1)
          .max(3)
          .default(['RS256']),
        maxTokenAgeSeconds: z.number().int().min(1).max(3600).default(900),
      })
      .optional(),
    api: z
      .strictObject({ url, maxBytes: z.number().int().min(1).max(262_144).default(65_536) })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (value.transport === 'http' && !value.http)
      ctx.addIssue({
        code: 'custom',
        path: ['http'],
        message: 'HTTP requires an external issuer, JWKS URL, and resource URL',
      });
    if (value.http && new URL(value.http.resource).pathname !== '/mcp')
      ctx.addIssue({
        code: 'custom',
        path: ['http', 'resource'],
        message: 'Resource URL must end with /mcp',
      });
  });
export type RuntimeConfig = z.infer<typeof configSchema>;
export function parseConfig(value: unknown): RuntimeConfig {
  const parsed = configSchema.parse(value);
  parsed.workspace = resolve(parsed.workspace);
  return parsed;
}
