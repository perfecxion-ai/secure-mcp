export type FailureCode =
  | 'denied'
  | 'invalid_input'
  | 'busy'
  | 'timeout'
  | 'cancelled'
  | 'shutting_down'
  | 'output_too_large'
  | 'not_found'
  | 'upstream_failed'
  | 'audit_unavailable'
  | 'internal';
export class RuntimeFailure extends Error {
  constructor(readonly code: FailureCode) {
    super(code);
    this.name = 'RuntimeFailure';
  }
}
export function failureCode(error: unknown): FailureCode {
  const codes: readonly string[] = [
    'denied',
    'invalid_input',
    'busy',
    'timeout',
    'cancelled',
    'shutting_down',
    'output_too_large',
    'not_found',
    'upstream_failed',
    'audit_unavailable',
    'internal',
  ];
  return error instanceof RuntimeFailure && codes.includes(error.code) ? error.code : 'internal';
}
