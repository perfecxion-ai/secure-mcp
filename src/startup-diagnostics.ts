import type { z } from 'zod';

export class StartupDiagnostic extends Error {}

const fields = new Set([
  'transport',
  'workspace',
  'allowedTools',
  'readOnly',
  'localScopes',
  'audit',
  'audit.socketPath',
  'audit.maxPending',
  'audit.timeoutMs',
  'limits',
  'limits.maxConcurrent',
  'limits.timeoutMs',
  'limits.maxInputBytes',
  'limits.maxInputElements',
  'limits.maxOutputBytes',
  'limits.shutdownMs',
  'http',
  'http.host',
  'http.port',
  'http.resource',
  'http.issuer',
  'http.jwksUrl',
  'http.allowedOrigins',
  'http.algorithms',
  'http.maxTokenAgeSeconds',
  'api',
  'api.url',
  'api.maxBytes',
]);
const customReasons = new Map([
  [
    'HTTP requires an external issuer, JWKS URL, and resource URL',
    'requires an HTTP configuration block with resource, issuer and jwksUrl',
  ],
  ['Resource URL must end with /mcp', 'resource URL path must be /mcp'],
  [
    'Use HTTPS, or HTTP on loopback for a local lab; no credentials, query, or fragment',
    'use HTTPS (or loopback HTTP), without credentials, query or fragment',
  ],
]);

export function configurationDiagnostic(issues: readonly z.core.$ZodIssue[]): StartupDiagnostic {
  const messages = new Set<string>();
  for (const issue of issues.slice(0, 8)) {
    // Only schema-owned field names can reach stderr. Unknown keys and values
    // may contain secrets, control characters or arbitrary operator input.
    const path = issue.path.filter((part) => typeof part !== 'number').join('.');
    const field = fields.has(path) ? path : 'config';
    let reason = 'invalid setting; check the configuration reference';
    switch (issue.code) {
      case 'unrecognized_keys':
        reason = 'contains an unknown setting; check the supported field names';
        break;
      case 'invalid_type':
        reason = 'has the wrong type or is missing a required value';
        break;
      case 'invalid_value':
        reason = 'must use a documented supported option';
        break;
      case 'too_small':
      case 'too_big':
        reason = 'is outside the supported size or numeric range';
        break;
      case 'invalid_format':
        reason = 'has an invalid format; check the configuration reference';
        break;
      case 'custom':
        reason = customReasons.get(issue.message) ?? reason;
        break;
    }
    messages.add(`${field}: ${reason}`);
  }
  return new StartupDiagnostic([...messages].join('; ') || 'config: invalid configuration');
}

export function filesystemDiagnostic(
  area: 'config' | 'workspace',
  error: unknown,
): StartupDiagnostic {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  const reason =
    code === 'ENOENT'
      ? 'does not exist; check the selected path'
      : code === 'EACCES' || code === 'EPERM'
        ? 'is not accessible; check directory and file permissions'
        : code === 'ENOTDIR'
          ? 'requires a directory; check the selected path'
          : code === 'EISDIR'
            ? 'must be a readable JSON file, not a directory'
            : 'could not be opened; check the selected path and permissions';
  return new StartupDiagnostic(`${area}: ${reason}`);
}
