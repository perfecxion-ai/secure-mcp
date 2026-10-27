export interface Principal {
  readonly subject: string;
  readonly issuer: string;
  readonly scopes: readonly string[];
  readonly expiresAt?: number;
}
export interface ToolPolicy {
  readonly name: string;
  readonly requiredScopes: readonly string[];
  readonly readOnly: boolean;
}
export interface PolicyOptions {
  readonly allowedTools: readonly string[];
  readonly readOnly: boolean;
}
export function mayInvoke(policy: PolicyOptions, principal: Principal, tool: ToolPolicy): boolean {
  return (
    !!principal.subject &&
    (principal.expiresAt === undefined || principal.expiresAt > Date.now() / 1000) &&
    policy.allowedTools.includes(tool.name) &&
    (!policy.readOnly || tool.readOnly) &&
    tool.requiredScopes.length > 0 &&
    tool.requiredScopes.every((scope) => principal.scopes.includes(scope))
  );
}
