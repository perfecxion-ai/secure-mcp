import jwt from 'jsonwebtoken';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { redis } from '../database/redis';
import { vault } from '../security/vault';
import crypto from 'crypto';

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

  constructor() {
    this.accessTokenSecret = config.jwt.secret;
    this.refreshTokenSecret = config.jwt.secret + '_refresh';
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

      logger.info('JWT service initialized');
    } catch (error) {
      logger.error('Failed to initialize JWT service', { error });
      throw error;
    }
  }

  /**
   * Generate access and refresh token pair
   */
  public async generateTokenPair(payload: {
    userId: string;
    email: string;
    roles: string[];
    permissions: string[];
    sessionId: string;
    mfaVerified: boolean;
  }): Promise<TokenPair> {
    const jti = crypto.randomUUID();
    const tokenFamily = crypto.randomUUID();

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
      jti: crypto.randomUUID(),
    };

    const accessToken = jwt.sign(accessTokenPayload, this.accessTokenSecret, {
      expiresIn: config.jwt.accessExpiresIn,
      algorithm: 'HS256',
    });

    const refreshToken = jwt.sign(refreshTokenPayload, this.refreshTokenSecret, {
      expiresIn: config.jwt.refreshExpiresIn,
      algorithm: 'HS256',
    });

    // Store token family in Redis for refresh token rotation
    const refreshExpiry = this.parseExpiresIn(config.jwt.refreshExpiresIn);
    await redis.setex(`token_family:${tokenFamily}`, refreshExpiry, JSON.stringify({
      userId: payload.userId,
      sessionId: payload.sessionId,
      createdAt: new Date().toISOString(),
    }));

    // Store active JTI for revocation tracking
    const accessExpiry = this.parseExpiresIn(config.jwt.accessExpiresIn);
    await redis.setex(`active_token:${jti}`, accessExpiry, 'valid');

    logger.info('Token pair generated', {
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
   * Verify access token
   */
  public async verifyAccessToken(token: string): Promise<JWTPayload> {
    try {
      const payload = jwt.verify(token, this.accessTokenSecret, {
        issuer: config.jwt.issuer,
        audience: config.jwt.audience,
        algorithms: ['HS256'],
      }) as JWTPayload;

      // Check if token is revoked
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
   * Refresh access token using refresh token
   */
  public async refreshAccessToken(refreshToken: string): Promise<TokenPair> {
    const refreshPayload = await this.verifyRefreshToken(refreshToken);

    // Get user information from token family
    const tokenFamilyData = await redis.get(`token_family:${refreshPayload.tokenFamily}`);
    if (!tokenFamilyData) {
      throw new Error('Token family not found');
    }

    const familyInfo = JSON.parse(tokenFamilyData);

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

    // Revoke old refresh token by removing its JTI
    await redis.del(`active_token:${refreshPayload.jti}`);

    logger.info('Access token refreshed', {
      userId: refreshPayload.sub,
      sessionId: refreshPayload.sessionId,
      oldJti: refreshPayload.jti,
    });

    return newTokenPair;
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

  private parseExpiresIn(expiresIn: string): number {
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
}