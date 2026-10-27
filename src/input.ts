import { z } from 'zod';
import type { StandardSchemaWithJSON } from '@modelcontextprotocol/server';

// Count collection entries before schema validation or recursive serialization.
// The bounded iterative walk also terminates for cyclic embedding inputs.
export function withinInputElementLimit(value: unknown, maximum: number): boolean {
  const pending: unknown[] = [value];
  let count = 0;
  while (pending.length) {
    const current = pending.pop();
    if (current === null || typeof current !== 'object') continue;
    if (Array.isArray(current)) {
      for (const child of current as unknown[]) {
        if (++count > maximum) return false;
        if (child !== null && typeof child === 'object') pending.push(child);
      }
    } else {
      for (const key in current) {
        if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
        if (++count > maximum) return false;
        const child = (current as Record<string, unknown>)[key];
        if (child !== null && typeof child === 'object') pending.push(child);
      }
    }
  }
  return true;
}

// Advertise the real wire schema, but leave custom validation to the runtime's
// policy, capacity, deadline, audit, and safe-error boundary. No transforms run here.
export function deferredInputSchema(
  schema: z.ZodObject,
): StandardSchemaWithJSON<Record<string, unknown>> {
  const json = () => z.toJSONSchema(schema, { io: 'input' });
  return {
    '~standard': {
      version: 1,
      vendor: 'secure-mcp',
      jsonSchema: { input: json, output: json },
      validate(value) {
        return value !== null && typeof value === 'object' && !Array.isArray(value)
          ? { value: value as Record<string, unknown> }
          : { issues: [{ message: 'invalid_input' }] };
      },
    },
  };
}
