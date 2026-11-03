export const SUPPORTED_NODE_RANGE = '>=24.22.1 <25';

export class UnsupportedRuntimeError extends Error {
  readonly code = 'unsupported_runtime';

  constructor(version: string) {
    super(
      `Unsupported Node.js ${version}; SecureMCP requires Node.js ${SUPPORTED_NODE_RANGE}. Select a supported Node 24 binary and restart.`,
    );
    this.name = 'UnsupportedRuntimeError';
  }
}

export function assertSupportedNode(version = process.versions.node): void {
  const parts = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.exec(version);
  if (parts) {
    const [major, minor, patch] = parts.slice(1).map(Number);
    if (major === 24 && (minor! > 22 || (minor === 22 && patch! >= 1))) return;
  }
  throw new UnsupportedRuntimeError(version);
}
