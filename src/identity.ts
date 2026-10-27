import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { RuntimeConfig } from './config.js';
import type { Principal } from './policy.js';

export function createTokenVerifier(
  config: NonNullable<RuntimeConfig['http']>,
): (token: string) => Promise<Principal> {
  const keys = createRemoteJWKSet(new URL(config.jwksUrl), {
    timeoutDuration: 3000,
    cooldownDuration: 30_000,
    cacheMaxAge: 300_000,
  });
  return async (token) => {
    const { payload, protectedHeader } = await jwtVerify(token, keys, {
      issuer: config.issuer,
      audience: config.resource,
      algorithms: config.algorithms,
      requiredClaims: ['sub', 'exp', 'iat'],
      maxTokenAge: config.maxTokenAgeSeconds,
      clockTolerance: 0,
    });
    if (
      protectedHeader.typ !== 'at+jwt' ||
      typeof payload.sub !== 'string' ||
      !payload.sub ||
      payload.sub.length > 256 ||
      typeof payload.scope !== 'string' ||
      payload.scope.length > 4096 ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number' ||
      payload.exp - payload.iat > config.maxTokenAgeSeconds ||
      payload.iat > Date.now() / 1000
    )
      throw new Error('Invalid access token');
    const scopes = payload.scope.split(' ').filter(Boolean);
    if (scopes.length > 128 || scopes.some((scope) => !/^[a-zA-Z0-9:._/-]{1,128}$/.test(scope)))
      throw new Error('Invalid scopes');
    return { subject: payload.sub, issuer: config.issuer, scopes, expiresAt: payload.exp };
  };
}
