import passport from 'passport';
import { Strategy as SamlStrategy } from 'passport-saml';
import { Strategy as JwtStrategy, ExtractJwt } from 'passport-jwt';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { JWTService } from './jwt-service';
import { redis } from '../database/redis';
import crypto from 'crypto';

export interface SAMLUser {
  nameID: string;
  email: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  groups?: string[];
  attributes?: Record<string, any>;
}

export interface SSOSession {
  userId: string;
  provider: 'saml' | 'oidc';
  nameID: string;
  sessionIndex?: string;
  createdAt: string;
  expiresAt: string;
}

export class SSOService {
  private jwtService: JWTService;
  private initialized: boolean = false;

  constructor(jwtService: JWTService) {
    this.jwtService = jwtService;
  }

  /**
   * Initialize SSO service with configured strategies
   */
  public async initialize(): Promise<void> {
    try {
      if (config.saml.enabled) {
        await this.initializeSAML();
      }

      await this.initializeJWT();

      this.initialized = true;
      logger.info('SSO service initialized', {
        samlEnabled: config.saml.enabled,
      });

    } catch (error) {
      logger.error('Failed to initialize SSO service', { error });
      throw error;
    }
  }

  /**
   * Initialize SAML strategy
   */
  private async initializeSAML(): Promise<void> {
    if (!config.saml.entryPoint || !config.saml.callbackUrl) {
      throw new Error('SAML configuration incomplete');
    }

    const samlOptions = {
      entryPoint: config.saml.entryPoint,
      issuer: config.saml.issuer || 'secure-mcp-server',
      callbackUrl: config.saml.callbackUrl,
      cert: config.saml.cert,
      privateKey: config.saml.privateKey,
      decryptionPvk: config.saml.privateKey,
      signatureAlgorithm: 'sha256',
      digestAlgorithm: 'sha256',
      validateInResponseTo: true,
      disableRequestedAuthnContext: false,
      authnContext: 'http://schemas.microsoft.com/ws/2008/06/identity/authenticationmethod/password',
      forceAuthn: false,
      skipRequestCompression: false,
      attributeConsumingServiceIndex: false,
      disableRequestArtifactResolution: true,
      logoutUrl: config.saml.entryPoint,
      logoutCallbackUrl: `${config.saml.callbackUrl}/logout`,
      additionalParams: {},
      additionalAuthorizeParams: {},
      identifierFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      racComparison: 'exact',
      signMetadata: false,
      requestIdExpirationPeriodMs: 28800000, // 8 hours
      cacheProvider: {
        saveAsync: async (key: string, value: string) => {
          await redis.setex(`saml_cache:${key}`, 28800, value); // 8 hours
        },
        getAsync: async (key: string) => {
          return await redis.get(`saml_cache:${key}`);
        },
        removeAsync: async (key: string) => {
          await redis.del(`saml_cache:${key}`);
        },
      },
    };

    (passport as any).use('saml', new SamlStrategy(samlOptions as any, async (profile: any, done: any) => {
      try {
        const user = await this.processSAMLProfile(profile);
        done(null, user);
      } catch (error) {
        logger.error('SAML profile processing failed', { error, profile });
        done(error, null);
      }
    }));

    logger.info('SAML strategy initialized');
  }

  /**
   * Initialize JWT strategy for API authentication
   */
  private async initializeJWT(): Promise<void> {
    const jwtOptions = {
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.jwt.secret,
      issuer: config.jwt.issuer,
      audience: config.jwt.audience,
      algorithms: ['HS256'],
    };

    passport.use('jwt', new JwtStrategy(jwtOptions, async (payload: any, done: any) => {
      try {
        // Verify token is still active (not revoked)
        const tokenPayload = await this.jwtService.verifyAccessToken(
          ExtractJwt.fromAuthHeaderAsBearerToken()(
            { headers: { authorization: `Bearer ${payload}` } } as any
          ) || ''
        );

        // Get current user data
        const user = await this.getUserById(tokenPayload.sub);
        if (!user) {
          return done(null, false);
        }

        done(null, user);
      } catch (error) {
        logger.warn('JWT authentication failed', { error: error.message });
        done(null, false);
      }
    }));

    logger.info('JWT strategy initialized');
  }

  /**
   * Process SAML profile and create/update user
   */
  private async processSAMLProfile(profile: any): Promise<SAMLUser> {
    const samlUser: SAMLUser = {
      nameID: profile.nameID,
      email: profile.email || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress'],
      firstName: profile.firstName || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname'],
      lastName: profile.lastName || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname'],
      displayName: profile.displayName || profile['http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name'],
      groups: profile.groups || profile['http://schemas.microsoft.com/ws/2008/06/identity/claims/groups'] || [],
      attributes: profile.attributes || {},
    };

    // Validate required fields
    if (!samlUser.email) {
      throw new Error('Email is required from SAML response');
    }

    // Create or update user in the system
    const user = await this.createOrUpdateSAMLUser(samlUser);

    // Create SSO session
    await this.createSSOSession(user.id, 'saml', samlUser.nameID, profile.sessionIndex);

    logger.info('SAML user processed', {
      nameID: samlUser.nameID,
      email: samlUser.email,
      userId: user.id,
    });

    return samlUser;
  }

  /**
   * Create or update user from SAML profile
   */
  private async createOrUpdateSAMLUser(samlUser: SAMLUser): Promise<any> {
    // This would typically interact with your user database
    // For now, we'll store in Redis for demonstration

    const userId = await this.findUserByEmail(samlUser.email) || crypto.randomUUID();

    const userData = {
      id: userId,
      email: samlUser.email,
      firstName: samlUser.firstName || '',
      lastName: samlUser.lastName || '',
      displayName: samlUser.displayName || `${samlUser.firstName} ${samlUser.lastName}`.trim(),
      provider: 'saml',
      nameID: samlUser.nameID,
      groups: JSON.stringify(samlUser.groups || []),
      roles: JSON.stringify(this.mapGroupsToRoles(samlUser.groups || [])),
      permissions: JSON.stringify(this.mapRolesToPermissions(this.mapGroupsToRoles(samlUser.groups || []))),
      lastLogin: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Store user data
    await redis.hset(`user:${userId}`, userData);
    await redis.set(`user_email:${samlUser.email}`, userId);

    logger.info('SAML user created/updated', { userId, email: samlUser.email });

    return { id: userId, ...userData };
  }

  /**
   * Create SSO session
   */
  private async createSSOSession(
    userId: string,
    provider: 'saml' | 'oidc',
    nameID: string,
    sessionIndex?: string
  ): Promise<void> {
    const sessionId = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000); // 8 hours

    const session: SSOSession = {
      userId,
      provider,
      nameID,
      sessionIndex,
      createdAt: new Date().toISOString(),
      expiresAt: expiresAt.toISOString(),
    };

    await redis.setex(`sso_session:${sessionId}`, 28800, JSON.stringify(session));
    await redis.sadd(`user_sso_sessions:${userId}`, sessionId);

    logger.info('SSO session created', { sessionId, userId, provider });
  }

  /**
   * Initiate SAML logout
   */
  public async initiateSAMLLogout(userId: string): Promise<string | null> {
    try {
      // Find active SAML sessions for user
      const sessionIds = await redis.smembers(`user_sso_sessions:${userId}`);

      for (const sessionId of sessionIds) {
        const sessionData = await redis.get(`sso_session:${sessionId}`);
        if (sessionData) {
          const session: SSOSession = JSON.parse(sessionData);
          if (session.provider === 'saml') {
            // Generate SAML logout request
            const strategy = (passport as any)._strategy('saml') as any;

            return new Promise((resolve, reject) => {
              strategy.logout(
                { nameID: session.nameID, sessionIndex: session.sessionIndex } as any,
                (err: any, url: string) => {
                  if (err) {
                    logger.error('SAML logout failed', { error: err, userId });
                    reject(err);
                  } else {
                    resolve(url);
                  }
                }
              );
            });
          }
        }
      }

      return null;

    } catch (error) {
      logger.error('Failed to initiate SAML logout', { error, userId });
      throw error;
    }
  }

  /**
   * Handle SAML logout response
   */
  public async handleSAMLLogoutResponse(userId: string): Promise<void> {
    try {
      // Remove all SSO sessions for user
      const sessionIds = await redis.smembers(`user_sso_sessions:${userId}`);

      for (const sessionId of sessionIds) {
        await redis.del(`sso_session:${sessionId}`);
      }

      await redis.del(`user_sso_sessions:${userId}`);

      // Revoke all JWT tokens for user
      await this.jwtService.revokeAllUserTokens(userId);

      logger.info('SAML logout completed', { userId });

    } catch (error) {
      logger.error('Failed to handle SAML logout', { error, userId });
      throw error;
    }
  }

  /**
   * Get SSO sessions for user
   */
  public async getUserSSOSessions(userId: string): Promise<SSOSession[]> {
    try {
      const sessionIds = await redis.smembers(`user_sso_sessions:${userId}`);
      const sessions: SSOSession[] = [];

      for (const sessionId of sessionIds) {
        const sessionData = await redis.get(`sso_session:${sessionId}`);
        if (sessionData) {
          const session: SSOSession = JSON.parse(sessionData);
          // Check if session is still valid
          if (new Date(session.expiresAt) > new Date()) {
            sessions.push(session);
          } else {
            // Clean up expired session
            await redis.del(`sso_session:${sessionId}`);
            await redis.srem(`user_sso_sessions:${userId}`, sessionId);
          }
        }
      }

      return sessions;

    } catch (error) {
      logger.error('Failed to get user SSO sessions', { error, userId });
      return [];
    }
  }

  /**
   * Validate SSO session
   */
  public async validateSSOSession(sessionId: string): Promise<SSOSession | null> {
    try {
      const sessionData = await redis.get(`sso_session:${sessionId}`);
      if (!sessionData) return null;

      const session: SSOSession = JSON.parse(sessionData);

      // Check expiration
      if (new Date(session.expiresAt) <= new Date()) {
        await redis.del(`sso_session:${sessionId}`);
        await redis.srem(`user_sso_sessions:${session.userId}`, sessionId);
        return null;
      }

      return session;

    } catch (error) {
      logger.error('Failed to validate SSO session', { error, sessionId });
      return null;
    }
  }

  /**
   * Find user by email
   */
  private async findUserByEmail(email: string): Promise<string | null> {
    try {
      return await redis.get(`user_email:${email}`);
    } catch (error) {
      logger.error('Failed to find user by email', { error, email });
      return null;
    }
  }

  /**
   * Get user by ID
   */
  private async getUserById(userId: string): Promise<any | null> {
    try {
      const userData = await redis.hgetall(`user:${userId}`);
      if (!userData.id) return null;

      return {
        id: userData.id,
        email: userData.email,
        firstName: userData.firstName,
        lastName: userData.lastName,
        displayName: userData.displayName,
        roles: JSON.parse(userData.roles || '[]'),
        permissions: JSON.parse(userData.permissions || '[]'),
        lastLogin: userData.lastLogin,
      };
    } catch (error) {
      logger.error('Failed to get user by ID', { error, userId });
      return null;
    }
  }

  /**
   * Map SAML groups to application roles
   */
  private mapGroupsToRoles(groups: string[]): string[] {
    const roleMapping: Record<string, string[]> = {
      'MCP_Administrators': ['admin'],
      'MCP_Users': ['user'],
      'MCP_Readonly': ['readonly'],
      'MCP_Developers': ['developer'],
    };

    const roles: string[] = [];
    for (const group of groups) {
      const mappedRoles = roleMapping[group];
      if (mappedRoles) {
        roles.push(...mappedRoles);
      }
    }

    // Default role if no mappings found
    if (roles.length === 0) {
      roles.push('user');
    }

    // Remove duplicates
    return [...new Set(roles)];
  }

  /**
   * Map roles to permissions
   */
  private mapRolesToPermissions(roles: string[]): string[] {
    const permissionMapping: Record<string, string[]> = {
      'admin': ['*'], // All permissions
      'developer': ['tools:*', 'resources:read', 'resources:write', 'debug'],
      'user': ['tools:read', 'tools:execute', 'resources:read'],
      'readonly': ['tools:read', 'resources:read'],
    };

    const permissions: string[] = [];
    for (const role of roles) {
      const rolePermissions = permissionMapping[role];
      if (rolePermissions) {
        permissions.push(...rolePermissions);
      }
    }

    // Remove duplicates
    return [...new Set(permissions)];
  }

  /**
   * Check if SSO service is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
}