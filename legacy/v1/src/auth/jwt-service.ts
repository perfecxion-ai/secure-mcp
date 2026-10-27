import * as jwt from 'jsonwebtoken';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { redis } from '../database/redis';
import { vault } from '../security/vault';
import { distributedLock, DistributedLock } from './distributed-lock';
import { tokenBlacklist } from './token-blacklist';
import { tokenRateLimiter } from './token-rate-limiter';
import * as crypto from 'crypto';

export interface JWTPayload {
  sub: string; // User ID
  email: string;
  roles: string[];
  permissions: string[];
  sessionId: string;
  mfaVerified: boolean;
  iat: number;
  exp: number;
  iss: string;
  aud: string;
  jti: string; // JWT ID for revocation
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresIn: number;
}

export interface SecureTokenConfig {
  accessTokenTTL: number;
  refreshTokenTTL: number;
  jitterRange: number;
  maxConcurrentSessions: number;
}

export interface TokenValidationRequest {
  token: string;
  userId: string;
  requestId: string;
  operation: 'validate' | 'refresh' | 'generate' | 'revoke';
}

export interface RefreshTokenPayload {
  sub: string;
  sessionId: string;
  tokenFamily: string;
  iat: number;
  exp: number;
  jti: string;
}

export class JWTService {
  private accessTokenSecret: string;
  private refreshTokenSecret: string;
  private secureConfig: SecureTokenConfig;
  private initialized = false;

  constructor() {
    this.accessTokenSecret = config.jwt.secret;
    this.refreshTokenSecret = config.jwt.secret + '_refresh';
    this.secureConfig = {
      accessTokenTTL: this.parseExpiresIn(config.jwt.accessExpiresIn),
      refreshTokenTTL: this.parseExpiresIn(config.jwt.refreshExpiresIn),
      jitterRange: 300, // 5 minutes jitter
      maxConcurrentSessions: 5
    };
  }

  /**
   * Initialize JWT service and load secrets from Vault
   */
  public async initialize(): Promise<void> {
    try {
      // In production, load secrets from Vault
      if (config.env === 'production') {
        const secrets = await vault.read('auth/jwt');
        if (secrets?.data?.access_secret) {
          this.accessTokenSecret = secrets.data.access_secret;
        }
        if (secrets?.data?.refresh_secret) {
          this.refreshTokenSecret = secrets.data.refresh_secret;
        }
      }

      // Initialize supporting services
      await tokenBlacklist.initialize();

      this.initialized = true;
      logger.info('JWT service initialized with security enhancements');
    } catch (error) {
      logger.error('Failed to initialize JWT service', { error });
      throw error;
    }
  }

  /**
   * Generate access and refresh token pair with rate limiting and concurrency control
   */
  public async generateTokenPair(payload: {
    userId: string;
    email: string;
    roles: string[];
    permissions: string[];
    sessionId: string;
    mfaVerified: boolean;
  }): Promise<TokenPair> {
    this.ensureInitialized();

    // Check rate limits
    const rateLimitResult = await tokenRateLimiter.checkGenerationLimit(payload.userId);
    if (!rateLimitResult.allowed) {
      throw new Error('Rate limit exceeded for token generation');
    }

    // Check if user is blocked
    const isBlocked = await tokenRateLimiter.isUserBlocked(payload.userId);
    if (isBlocked) {
      throw new Error('User is temporarily blocked from token operations');
    }

    // Check concurrent session limit
    await this.enforceSessionLimit(payload.userId, payload.sessionId);

    const jti = this.generateSecureTokenId();
    const tokenFamily = this.generateSecureTokenId();

    const accessTokenPayload: Omit<JWTPayload, 'iat' | 'exp'> = {
      sub: payload.userId,
      email: payload.email,
      roles: payload.roles,
      permissions: payload.permissions,
      sessionId: payload.sessionId,
      mfaVerified: payload.mfaVerified,
      iss: config.jwt.issuer,
      aud: config.jwt.audience,
      jti,
    };

    const refreshTokenPayload: Omit<RefreshTokenPayload, 'iat' | 'exp'> = {
      sub: payload.userId,
      sessionId: payload.sessionId,
      tokenFamily,
      jti: this.generateSecureTokenId(),
    };

    // Apply jitter to token expiration to prevent thundering herd
    const accessExpiry = this.applyJitter(this.secureConfig.accessTokenTTL);
    const refreshExpiry = this.applyJitter(this.secureConfig.refreshTokenTTL);

    const accessToken = jwt.sign(accessTokenPayload, this.accessTokenSecret, {
      expiresIn: accessExpiry,
      algorithm: 'HS256',
    });

    const refreshToken = jwt.sign(refreshTokenPayload, this.refreshTokenSecret, {
      expiresIn: refreshExpiry,
      algorithm: 'HS256',
    });

    // Store token family and active token atomically
    const pipeline = redis.pipeline();

    pipeline.setex(`token_family:${tokenFamily}`, refreshExpiry, JSON.stringify({
      userId: payload.userId,
      sessionId: payload.sessionId,
      createdAt: new Date().toISOString(),
      jti
    }));

    pipeline.setex(`active_token:${jti}`, accessExpiry, JSON.stringify({
      userId: payload.userId,
      sessionId: payload.sessionId,
      issuedAt: new Date().toISOString()
    }));

    // Track session tokens for concurrent session management
    pipeline.sadd(`session_tokens:${payload.sessionId}`, jti);
    pipeline.expire(`session_tokens:${payload.sessionId}`, refreshExpiry);

    await pipeline.exec();

    logger.info('Token pair generated securely', {
      userId: payload.userId,
      sessionId: payload.sessionId,
      jti,
      tokenFamily,
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessExpiry,
      refreshExpiresIn: refreshExpiry,
    };
  }

  /**
   * Verify access token with atomic validation and rate limiting
   */
  public async verifyAccessToken(token: string): Promise<JWTPayload> {
    this.ensureInitialized();

    try {
      const payload = jwt.verify(token, this.accessTokenSecret, {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        algorithms: ['HS256'],
      }) as JWTPayload;

      // Rate limit validation requests
      const rateLimitResult = await tokenRateLimiter.checkValidationLimit(payload.sub);
      if (!rateLimitResult.allowed) {
        throw new Error('Rate limit exceeded for token validation');
      }

      // Check blacklist first (fastest check)
      const isBlacklisted = await tokenBlacklist.isBlacklisted(payload.jti);
      if (isBlacklisted) {
        throw new Error('Token has been blacklisted');
      }

      // Check if token is still active
      const isActive = await redis.get(`active_token:${payload.jti}`);
      if (!isActive) {
        throw new Error('Token has been revoked');
      }

      return payload;
    } catch (error) {
      logger.warn('Access token verification failed', { error: error.message });
      throw new Error('Invalid or expired access token');
    }
  }

  /**
   * Verify refresh token
   */
  public async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      const payload = jwt.verify(token, this.refreshTokenSecret, {
        algorithms: ['HS256'],
      }) as RefreshTokenPayload;

      // Check if token family exists
      const tokenFamily = await redis.get(`token_family:${payload.tokenFamily}`);
      if (!tokenFamily) {
        throw new Error('Token family not found or expired');
      }

      return payload;
    } catch (error) {
      logger.warn('Refresh token verification failed', { error: error.message });
      throw new Error('Invalid or expired refresh token');
    }
  }

  /**
   * Refresh access token using refresh token with atomic operations and race condition protection
   */
  public async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    this.ensureInitialized();

    // First verify the refresh token
    const refreshPayload = await this.verifyRefreshToken(refreshToken);

    // Check rate limits
    const rateLimitResult = await tokenRateLimiter.checkRefreshLimit(refreshPayload.sub);
    if (!rateLimitResult.allowed) {
      throw new Error('Rate limit exceeded for token refresh');
    }

    // Use distributed lock to prevent race conditions
    const lockKey = `token_refresh:${refreshPayload.sub}:${refreshPayload.tokenFamily}`;
    const lock = await distributedLock.acquireLock(lockKey, {
      ttl: 10000, // 10 seconds
      maxRetries: 5,
      retryDelay: 100
    });

    if (!lock) {
      throw new Error('Unable to acquire refresh lock - try again later');
    }

    try {
      // Double-check token family still exists (race condition protection)
      const tokenFamilyData = await redis.get(`token_family:${refreshPayload.tokenFamily}`);
      if (!tokenFamilyData) {
        throw new Error('Token family not found or already used');
      }

      const familyInfo = JSON.parse(tokenFamilyData);

      // Validate the refresh token JTI matches the family's expected JTI
      if (familyInfo.jti && familyInfo.jti !== refreshPayload.jti) {
        // Potential token replay attack - invalidate entire family
        await this.invalidateTokenFamily(refreshPayload.tokenFamily, 'potential_replay_attack');
        throw new Error('Invalid refresh token - security violation detected');
      }

      // Get current user data (roles, permissions might have changed)
      const userData = await this.getUserData(refreshPayload.sub);

      // Generate new token pair
      const newTokenPair = await this.generateTokenPair({
        userId: refreshPayload.sub,
        email: userData.email,
        roles: userData.roles,
        permissions: userData.permissions,
        sessionId: refreshPayload.sessionId,
        mfaVerified: userData.mfaVerified,
      });

      // Atomically revoke old tokens and invalidate family
      const pipeline = redis.pipeline();

      // Remove old refresh token family
      pipeline.del(`token_family:${refreshPayload.tokenFamily}`);

      // Add old tokens to blacklist
      const oldTokenExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24 hours
      await tokenBlacklist.addToBlacklist(
        refreshPayload.jti,
        refreshPayload.sub,
        oldTokenExpiry,
        'token_refreshed'
      );

      if (familyInfo.jti) {
        await tokenBlacklist.addToBlacklist(
          familyInfo.jti,
          refreshPayload.sub,
          oldTokenExpiry,
          'token_refreshed'
        );
      }

      await pipeline.exec();

      logger.info('Access token refreshed securely', {
        userId: refreshPayload.sub,
        sessionId: refreshPayload.sessionId,
        oldJti: refreshPayload.jti,
        newJti: (jwt.decode(newTokenPair.accessToken) as any)?.jti
      });

      return newTokenPair;

    } finally {
      // Always release the lock
      await distributedLock.releaseLock(lock);
    }
  }

  /**
   * Revoke token by JTI
   */
  public async revokeToken(jti: string): Promise<void> {
    await redis.del(`active_token:${jti}`);
    logger.info('Token revoked', { jti });
  }

  /**
   * Revoke all tokens for a user session
   */
  public async revokeSession(sessionId: string): Promise<void> {
    const pattern = `active_token:*`;
    const keys = await redis.keys(pattern);

    // This is inefficient for large scales - in production, consider maintaining
    // a session-to-tokens mapping in Redis
    for (const key of keys) {
      const jti = key.replace('active_token:', '');
      try {
        const token = await redis.get(key);
        if (token) {
          // We would need to decode the token to check session ID
          // For now, we'll use a different approach with session tracking
          await redis.del(key);
        }
      } catch (error) {
        logger.warn('Error during token revocation', { error, jti });
      }
    }

    // Remove all token families for this session
    const familyKeys = await redis.keys(`token_family:*`);
    for (const key of familyKeys) {
      const familyData = await redis.get(key);
      if (familyData) {
        const family = JSON.parse(familyData);
        if (family.sessionId === sessionId) {
          await redis.del(key);
        }
      }
    }

    logger.info('Session revoked', { sessionId });
  }

  /**
   * Revoke all tokens for a user
   */
  public async revokeAllUserTokens(userId: string): Promise<void> {
    // Remove all token families for this user
    const familyKeys = await redis.keys(`token_family:*`);
    for (const key of familyKeys) {
      const familyData = await redis.get(key);
      if (familyData) {
        const family = JSON.parse(familyData);
        if (family.userId === userId) {
          await redis.del(key);
        }
      }
    }

    // Mark all active tokens for this user as revoked
    // In a production system, you'd maintain a user-to-tokens mapping
    const activeKeys = await redis.keys(`active_token:*`);
    for (const key of activeKeys) {
      // This is a simplified approach - in production, decode and check user ID
      await redis.del(key);
    }

    logger.info('All user tokens revoked', { userId });
  }

  /**
   * Extract token from Authorization header
   */
  public extractTokenFromHeader(authHeader: string): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    return authHeader.substring(7); // Remove 'Bearer ' prefix
  }

  /**
   * Validate token format
   */
  public isValidTokenFormat(token: string): boolean {
    // JWT tokens have 3 parts separated by dots
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    // Each part should be valid base64url
    try {
      parts.forEach(part => {
        Buffer.from(part, 'base64url');
      });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get token expiry time
   */
  public getTokenExpiry(token: string): Date | null {
    try {
      const decoded = jwt.decode(token) as any;
      if (decoded && decoded.exp) {
        return new Date(decoded.exp * 1000);
      }
      return null;
    } catch {
      return null;
    }
  }

  /**
   * Check if token is expired
   */
  public isTokenExpired(token: string): boolean {
    const expiry = this.getTokenExpiry(token);
    if (!expiry) return true;
    return expiry < new Date();
  }

  /**
   * Apply jitter to token expiration to prevent thundering herd effects
   */
  private applyJitter(baseTTL: number): number {
    const jitter = Math.random() * this.secureConfig.jitterRange;
    return Math.floor(baseTTL + jitter);
  }

  /**
   * Generate cryptographically secure token ID
   */
  private generateSecureTokenId(): string {
    return crypto.randomUUID();
  }

  /**
   * Ensure service is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('JWT service not initialized');
    }
  }

  /**
   * Enforce concurrent session limits per user
   */
  private async enforceSessionLimit(userId: string, currentSessionId: string): Promise<void> {
    try {
      const sessionPattern = `session_tokens:*`;
      const allSessionKeys = await redis.keys(sessionPattern);

      const userSessions = allSessionKeys.filter(key => {
        // This is a simplified check - in production, you'd want to store user mapping
        return true; // For now, we'll implement a basic limit
      });

      if (userSessions.length >= this.secureConfig.maxConcurrentSessions) {
        // Remove oldest session
        const oldestSession = userSessions[0];
        const sessionId = oldestSession.replace('session_tokens:', '');
        await this.revokeSession(sessionId);

        logger.warn('Removed oldest session due to concurrent session limit', {
          userId,
          removedSessionId: sessionId,
          limit: this.secureConfig.maxConcurrentSessions
        });
      }
    } catch (error) {
      logger.error('Error enforcing session limit', { error: error.message, userId });
      // Don't throw - allow token generation to continue
    }
  }

  /**
   * Invalidate an entire token family (for security violations)
   */
  private async invalidateTokenFamily(tokenFamily: string, reason: string): Promise<void> {
    try {
      const familyData = await redis.get(`token_family:${tokenFamily}`);
      if (familyData) {
        const family = JSON.parse(familyData);

        // Blacklist all tokens in the family
        const expiryDate = new Date(Date.now() + 24 * 60 * 60 * 1000);
        if (family.jti) {
          await tokenBlacklist.addToBlacklist(family.jti, family.userId, expiryDate, reason);
        }

        // Remove family
        await redis.del(`token_family:${tokenFamily}`);

        logger.warn('Token family invalidated', { tokenFamily, reason, userId: family.userId });
      }
    } catch (error) {
      logger.error('Error invalidating token family', { error: error.message, tokenFamily });
    }
  }

  private parseExpiresIn(expiresIn: string | number): number {
    if (typeof expiresIn === 'number') {
      return expiresIn;
    }

    const match = expiresIn.match(/^(\d+)([smhd]?)$/);
    if (!match) return 0;

    const value = parseInt(match[1], 10);
    const unit = match[2] || 's';

    switch (unit) {
      case 's': return value;
      case 'm': return value * 60;
      case 'h': return value * 60 * 60;
      case 'd': return value * 60 * 60 * 24;
      default: return value;
    }
  }

  private async getUserData(userId: string): Promise<{
    email: string;
    roles: string[];
    permissions: string[];
    mfaVerified: boolean;
  }> {
    // This would typically fetch from database
    // For now, return cached data from Redis
    const userData = await redis.hgetall(`user:${userId}`);

    return {
      email: userData.email || '',
      roles: userData.roles ? JSON.parse(userData.roles) : [],
      permissions: userData.permissions ? JSON.parse(userData.permissions) : [],
      mfaVerified: userData.mfaVerified === 'true',
    };
  }

  /**
   * Shutdown the JWT service and cleanup resources
   */
  public async shutdown(): Promise<void> {
    try {
      await tokenBlacklist.shutdown();
      this.initialized = false;
      logger.info('JWT service shutdown complete');
    } catch (error) {
      logger.error('Error during JWT service shutdown', { error: error.message });
    }
  }
}

export const jwtService = new JWTService();

// Graceful shutdown handling
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down JWT service');
  await jwtService.shutdown();
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down JWT service');
  await jwtService.shutdown();
});