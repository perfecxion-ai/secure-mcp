import { Router, Request, Response } from 'express';
import { body, validationResult } from 'express-validator';
import argon2 from 'argon2';
import { jwtService, mfaService, authMiddleware } from './middleware';
import { SSOService } from './sso-service';
import { logger } from '../utils/logger';
import { redis } from '../database/redis';
import { SecurityMiddleware } from '../security/middleware';
import passport from 'passport';
import crypto from 'crypto';

export const authRouter = Router();

// Initialize SSO service
const ssoService = new SSOService(jwtService);

/**
 * POST /auth/login
 * Login with email and password
 */
authRouter.post('/login', [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }),
  SecurityMiddleware.validateInput,
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { email, password } = req.body;

    // Get user by email
    const userId = await redis.get(`user_email:${email}`);
    if (!userId) {
      logger.warn('Login attempt with invalid email', { email });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const userData = await redis.hgetall(`user:${userId}`);
    if (!userData.passwordHash) {
      logger.warn('Login attempt for user without password', { userId, email });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Verify password
    const isValidPassword = await argon2.verify(userData.passwordHash, password);
    if (!isValidPassword) {
      logger.warn('Invalid password attempt', { userId, email });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check if account is locked
    const lockKey = `account_lock:${userId}`;
    const isLocked = await redis.get(lockKey);
    if (isLocked) {
      logger.warn('Login attempt on locked account', { userId, email });
      return res.status(423).json({ error: 'Account locked' });
    }

    // Check if MFA is enabled
    const mfaEnabled = await mfaService.isMFAEnabled(userId);

    if (mfaEnabled) {
      // Create temporary auth token for MFA verification
      const tempToken = crypto.randomUUID();
      await redis.setex(`temp_auth:${tempToken}`, 300, JSON.stringify({
        userId,
        email: userData.email,
        roles: JSON.parse(userData.roles || '[]'),
        permissions: JSON.parse(userData.permissions || '[]'),
        timestamp: Date.now(),
      }));

      return res.json({
        success: true,
        mfaRequired: true,
        tempToken,
        message: 'MFA verification required',
      });
    }

    // Create session
    const session = await authMiddleware.createSession(userId, req.ip, req.get('User-Agent') || '');

    // Generate JWT tokens
    const tokenPair = await jwtService.generateTokenPair({
      userId,
      email: userData.email,
      roles: JSON.parse(userData.roles || '[]'),
      permissions: JSON.parse(userData.permissions || '[]'),
      sessionId: session.id,
      mfaVerified: false,
    });

    // Update last login
    await redis.hset(`user:${userId}`, 'lastLogin', new Date().toISOString());

    logger.info('User logged in successfully', { userId, email, sessionId: session.id });

    res.json({
      success: true,
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      user: {
        id: userId,
        email: userData.email,
        displayName: userData.displayName,
        roles: JSON.parse(userData.roles || '[]'),
      },
    });

  } catch (error) {
    logger.error('Login error', { error, ip: req.ip });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/mfa/verify
 * Verify MFA token and complete login
 */
authRouter.post('/mfa/verify', [
  body('tempToken').isUUID(),
  body('token').matches(/^\d{6,8}$/),
  SecurityMiddleware.validateInput,
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { tempToken, token } = req.body;

    // Get temporary auth data
    const tempAuthData = await redis.get(`temp_auth:${tempToken}`);
    if (!tempAuthData) {
      return res.status(401).json({ error: 'Invalid or expired temporary token' });
    }

    const authData = JSON.parse(tempAuthData);

    // Verify MFA token
    const mfaResult = await mfaService.verifyMFAToken(authData.userId, token);
    if (!mfaResult.verified) {
      logger.warn('Invalid MFA token', { userId: authData.userId });
      return res.status(401).json({ error: 'Invalid MFA token' });
    }

    // Delete temporary token
    await redis.del(`temp_auth:${tempToken}`);

    // Create session
    const session = await authMiddleware.createSession(
      authData.userId,
      req.ip,
      req.get('User-Agent') || ''
    );

    // Generate JWT tokens with MFA verified
    const tokenPair = await jwtService.generateTokenPair({
      userId: authData.userId,
      email: authData.email,
      roles: authData.roles,
      permissions: authData.permissions,
      sessionId: session.id,
      mfaVerified: true,
    });

    // Update last login
    await redis.hset(`user:${authData.userId}`, 'lastLogin', new Date().toISOString());

    logger.info('MFA verification successful', {
      userId: authData.userId,
      sessionId: session.id,
      usedBackupCode: mfaResult.usedBackupCode,
    });

    res.json({
      success: true,
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
      mfaVerified: true,
      ...(mfaResult.usedBackupCode && {
        warning: `Backup code used. ${mfaResult.remainingBackupCodes} codes remaining.`
      }),
    });

  } catch (error) {
    logger.error('MFA verification error', { error });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/refresh
 * Refresh access token
 */
authRouter.post('/refresh', [
  body('refreshToken').isString(),
  SecurityMiddleware.validateInput,
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { refreshToken } = req.body;

    const tokenPair = await jwtService.refreshAccessToken(refreshToken);

    res.json({
      success: true,
      accessToken: tokenPair.accessToken,
      refreshToken: tokenPair.refreshToken,
      expiresIn: tokenPair.expiresIn,
    });

  } catch (error) {
    logger.warn('Token refresh failed', { error: error.message });
    res.status(401).json({ error: 'Invalid refresh token' });
  }
});

/**
 * POST /auth/logout
 * Logout user and revoke tokens
 */
authRouter.post('/logout', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    // Revoke session
    if (req.session) {
      await authMiddleware.deleteSession(req.session.id);
    }

    // Revoke JWT tokens
    await jwtService.revokeSession(req.user!.sessionId);

    logger.info('User logged out', { userId: req.user!.id });

    res.json({ success: true, message: 'Logged out successfully' });

  } catch (error) {
    logger.error('Logout error', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/logout-all
 * Logout from all sessions
 */
authRouter.post('/logout-all', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    // Revoke all sessions
    await authMiddleware.deleteAllUserSessions(req.user!.id);

    // Revoke all JWT tokens
    await jwtService.revokeAllUserTokens(req.user!.id);

    logger.info('User logged out from all sessions', { userId: req.user!.id });

    res.json({ success: true, message: 'Logged out from all sessions' });

  } catch (error) {
    logger.error('Logout all error', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /auth/me
 * Get current user information
 */
authRouter.get('/me', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const userData = await redis.hgetall(`user:${req.user!.id}`);

    res.json({
      id: req.user!.id,
      email: req.user!.email,
      displayName: userData.displayName,
      roles: req.user!.roles,
      permissions: req.user!.permissions,
      mfaEnabled: await mfaService.isMFAEnabled(req.user!.id),
      lastLogin: userData.lastLogin,
    });

  } catch (error) {
    logger.error('Get user info error', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/mfa/setup
 * Setup MFA for user
 */
authRouter.post('/mfa/setup', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const mfaEnabled = await mfaService.isMFAEnabled(req.user!.id);
    if (mfaEnabled) {
      return res.status(400).json({ error: 'MFA already enabled' });
    }

    const mfaSecret = await mfaService.generateMFASecret(req.user!.id, req.user!.email);

    res.json({
      success: true,
      secret: mfaSecret.secret,
      qrCode: mfaSecret.qrCodeUrl,
      backupCodes: mfaSecret.backupCodes,
    });

  } catch (error) {
    logger.error('MFA setup error', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/mfa/confirm
 * Confirm MFA setup
 */
authRouter.post('/mfa/confirm', [
  authMiddleware.authenticate,
  body('token').matches(/^\d{6}$/),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { token } = req.body;

    const isValid = await mfaService.verifyMFASetup(req.user!.id, token);
    if (!isValid) {
      return res.status(400).json({ error: 'Invalid token' });
    }

    logger.info('MFA enabled for user', { userId: req.user!.id });

    res.json({ success: true, message: 'MFA enabled successfully' });

  } catch (error) {
    logger.error('MFA confirmation error', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/mfa/disable
 * Disable MFA for user
 */
authRouter.post('/mfa/disable', [
  authMiddleware.authenticate,
  authMiddleware.requireMFA,
  body('password').isLength({ min: 8 }),
], async (req: Request, res: Response) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    const { password } = req.body;

    // Verify password
    const userData = await redis.hgetall(`user:${req.user!.id}`);
    const isValidPassword = await argon2.verify(userData.passwordHash, password);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    await mfaService.disableMFA(req.user!.id);

    logger.info('MFA disabled for user', { userId: req.user!.id });

    res.json({ success: true, message: 'MFA disabled successfully' });

  } catch (error) {
    logger.error('MFA disable error', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * POST /auth/mfa/backup-codes
 * Generate new backup codes
 */
authRouter.post('/mfa/backup-codes', [
  authMiddleware.authenticate,
  authMiddleware.requireMFA,
], async (req: Request, res: Response) => {
  try {
    const backupCodes = await mfaService.regenerateBackupCodes(req.user!.id);

    logger.info('Backup codes regenerated', { userId: req.user!.id });

    res.json({
      success: true,
      backupCodes,
      message: 'New backup codes generated',
    });

  } catch (error) {
    logger.error('Backup codes generation error', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /auth/sessions
 * Get user's active sessions
 */
authRouter.get('/sessions', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const sessions = await authMiddleware.getUserSessions(req.user!.id);

    res.json({
      sessions: sessions.map(session => ({
        id: session.id,
        createdAt: session.createdAt,
        lastActivity: session.lastActivity,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        current: session.id === req.user!.sessionId,
      })),
    });

  } catch (error) {
    logger.error('Get sessions error', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /auth/sessions/:sessionId
 * Revoke specific session
 */
authRouter.delete('/sessions/:sessionId', authMiddleware.authenticate, async (req: Request, res: Response) => {
  try {
    const { sessionId } = req.params;

    // Verify session belongs to user
    const session = await authMiddleware.getSession(sessionId);
    if (!session || session.userId !== req.user!.id) {
      return res.status(404).json({ error: 'Session not found' });
    }

    await authMiddleware.deleteSession(sessionId);

    logger.info('Session revoked', { sessionId, userId: req.user!.id });

    res.json({ success: true, message: 'Session revoked' });

  } catch (error) {
    logger.error('Session revocation error', { error, userId: req.user?.id });
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * SAML SSO Routes
 */
if (ssoService.isInitialized()) {
  /**
   * GET /auth/saml
   * Initiate SAML SSO
   */
  authRouter.get('/saml', passport.authenticate('saml'));

  /**
   * POST /auth/saml/callback
   * SAML SSO callback
   */
  authRouter.post('/saml/callback', passport.authenticate('saml'), async (req: Request, res: Response) => {
    try {
      const samlUser = req.user as any;

      // Create session
      const session = await authMiddleware.createSession(
        samlUser.id,
        req.ip,
        req.get('User-Agent') || ''
      );

      // Generate JWT tokens
      const tokenPair = await jwtService.generateTokenPair({
        userId: samlUser.id,
        email: samlUser.email,
        roles: samlUser.roles,
        permissions: samlUser.permissions,
        sessionId: session.id,
        mfaVerified: false, // SAML users still need MFA if enabled
      });

      logger.info('SAML SSO login successful', { userId: samlUser.id });

      // Redirect to frontend with tokens
      const redirectUrl = new URL(process.env.FRONTEND_URL || 'http://localhost:3000/auth/callback');
      redirectUrl.searchParams.set('token', tokenPair.accessToken);
      redirectUrl.searchParams.set('refresh', tokenPair.refreshToken);

      res.redirect(redirectUrl.toString());

    } catch (error) {
      logger.error('SAML callback error', { error });
      res.redirect(`${process.env.FRONTEND_URL || 'http://localhost:3000'}/auth/error`);
    }
  });

  /**
   * POST /auth/saml/logout
   * Initiate SAML logout
   */
  authRouter.post('/saml/logout', authMiddleware.authenticate, async (req: Request, res: Response) => {
    try {
      const logoutUrl = await ssoService.initiateSAMLLogout(req.user!.id);

      if (logoutUrl) {
        res.json({ success: true, logoutUrl });
      } else {
        res.json({ success: true, message: 'No active SAML session found' });
      }

    } catch (error) {
      logger.error('SAML logout error', { error, userId: req.user?.id });
      res.status(500).json({ error: 'Internal server error' });
    }
  });
}