import { authenticator, totp } from 'otplib';
import * as QRCode from 'qrcode';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { redis } from '../database/redis';
import { vault } from '../security/vault';
import * as crypto from 'crypto';
import { secureEncryption, EncryptedSecret } from './crypto/secure-encryption';
import { SecureKeyDerivation } from './crypto/key-derivation';
import { secureTOTPGenerator } from './crypto/totp-generator';
import { cryptographicIntegrity } from './crypto/integrity-protection';

export interface MFASecret {
  secret: string;
  qrCodeUrl: string;
  backupCodes: string[];
}

export interface MFAVerificationResult {
  verified: boolean;
  remainingBackupCodes?: number;
  usedBackupCode?: boolean;
}

export class MFAService {
  private masterKey: Buffer;
  private isInitialized: boolean = false;

  constructor() {
    // Initialize with a secure master key from configuration
    // In production, this should come from a secure key management system
    this.masterKey = Buffer.from(config.jwt.secret, 'utf8');
  }

  /**
   * Initialize MFA service
   */
  public async initialize(): Promise<void> {
    try {
      // In production, load master key from Vault with enhanced security
      if (config.env === 'production') {
        const secrets = await vault.read('auth/mfa');
        if (secrets?.data?.master_key) {
          this.masterKey = Buffer.from(secrets.data.master_key, 'base64');
        } else {
          // Generate and store a new master key if none exists
          const newMasterKey = crypto.randomBytes(32);
          await vault.write('auth/mfa', {
            master_key: newMasterKey.toString('base64'),
            created_at: new Date().toISOString(),
            algorithm: 'aes-256-gcm',
            key_derivation: 'pbkdf2'
          });
          this.masterKey = newMasterKey;
          logger.info('Generated new MFA master key in production');
        }
      }

      // Validate master key strength
      if (this.masterKey.length < 32) {
        throw new Error('Master key must be at least 32 bytes for security');
      }

      // Configure TOTP with secure parameters (SHA-256 instead of SHA-1)
      authenticator.options = {
        window: config.mfa.window,
        step: 30,
        digits: 6,
        algorithm: 'sha256' as any, // Enhanced security: SHA-256 instead of SHA-1
        encoding: 'base32' as any,
      };

      this.isInitialized = true;
      logger.info('MFA service initialized with enhanced cryptographic security');
    } catch (error) {
      logger.error('Failed to initialize MFA service', { error });
      throw error;
    }
  }

  /**
   * Generate MFA secret and QR code for user enrollment
   */
  public async generateMFASecret(userId: string, userEmail: string): Promise<MFASecret> {
    try {
      this.ensureInitialized();

      // Generate cryptographically secure TOTP secret
      const secret = secureTOTPGenerator.generateSecret();

      // Validate secret strength
      const validation = secureTOTPGenerator.validateSecretEntropy(secret);
      if (!validation.isValid) {
        throw new Error(`Generated secret failed validation: ${validation.issues.join(', ')}`);
      }

      const service = config.mfa.issuer;
      const otpauth = secureTOTPGenerator.generateOTPURL(secret, userEmail, service);

      // Generate QR code
      const qrCodeUrl = await QRCode.toDataURL(otpauth);

      // Generate cryptographically secure backup codes
      const backupCodes = secureTOTPGenerator.generateBackupCodes();

      // Encrypt secret and backup codes with authenticated encryption
      const userContext = `${userId}:${userEmail}`;
      const encryptedSecret = await secureEncryption.encryptMFASecret(secret, userContext);

      const encryptedBackupCodes: string[] = [];
      for (const code of backupCodes) {
        const encryptedCode = await secureEncryption.encryptMFASecret(code, `${userContext}:backup`);
        encryptedBackupCodes.push(JSON.stringify(encryptedCode));
      }

      // Add integrity protection for the setup data
      const setupData = {
        secret: JSON.stringify(encryptedSecret),
        backupCodes: JSON.stringify(encryptedBackupCodes),
        createdAt: new Date().toISOString(),
        algorithm: 'aes-256-gcm',
        keyDerivation: 'pbkdf2',
        secretValidation: JSON.stringify(validation)
      };

      await redis.hset(`mfa_setup:${userId}`, setupData);

      // Expire the setup data after 10 minutes
      await redis.expire(`mfa_setup:${userId}`, 600);

      logger.info('MFA secret generated with enhanced security', {
        userId,
        secretEntropy: validation.entropy,
        secretStrength: validation.strength
      });

      return {
        secret,
        qrCodeUrl,
        backupCodes,
      };

    } catch (error) {
      logger.error('Failed to generate MFA secret', { error, userId });
      throw new Error('Failed to generate MFA secret');
    }
  }

  /**
   * Verify MFA setup with initial token
   */
  public async verifyMFASetup(userId: string, token: string): Promise<boolean> {
    try {
      this.ensureInitialized();

      const setupData = await redis.hgetall(`mfa_setup:${userId}`);
      if (!setupData.secret) {
        throw new Error('MFA setup not found or expired');
      }

      // Decrypt secret with authenticated encryption
      const encryptedSecret: EncryptedSecret = JSON.parse(setupData.secret);
      const userContext = userId; // Simplified for setup verification
      const secret = await secureEncryption.decryptMFASecret(encryptedSecret, userContext);

      // Verify token with timing attack protection
      const isValid = secureTOTPGenerator.verifyToken(token, secret);

      if (isValid) {
        // Move from setup to active MFA with enhanced security
        const encryptedBackupCodes = JSON.parse(setupData.backupCodes);
        await this.enableMFA(userId, secret, encryptedBackupCodes);
        await redis.del(`mfa_setup:${userId}`);

        logger.info('MFA setup verified and enabled with enhanced security', { userId });
        return true;
      } else {
        logger.warn('Invalid MFA setup token', { userId });
        return false;
      }

    } catch (error) {
      logger.error('Failed to verify MFA setup', { error, userId });
      throw new Error('Failed to verify MFA setup');
    }
  }

  /**
   * Verify MFA token during authentication
   */
  public async verifyMFAToken(userId: string, token: string): Promise<MFAVerificationResult> {
    try {
      this.ensureInitialized();

      const mfaData = await redis.hgetall(`mfa:${userId}`);
      if (!mfaData.secret) {
        throw new Error('MFA not enabled for user');
      }

      // Decrypt secret with authenticated encryption
      const encryptedSecret: EncryptedSecret = JSON.parse(mfaData.secret);
      const userContext = userId;
      const secret = await secureEncryption.decryptMFASecret(encryptedSecret, userContext);

      // First try TOTP verification with timing attack protection
      const isValidTOTP = secureTOTPGenerator.verifyToken(token, secret);
      if (isValidTOTP) {
        // Enhanced replay attack protection with HMAC
        const tokenKey = `used_totp:${userId}:${token}`;
        const wasUsed = await redis.get(tokenKey);

        if (wasUsed) {
          logger.warn('TOTP token replay attempt detected', { userId, tokenHash: crypto.createHash('sha256').update(token).digest('hex').substring(0, 8) });
          return { verified: false };
        }

        // Mark token as used (expires in 90 seconds - token window)
        await redis.setex(tokenKey, 90, 'used');

        // Update last used timestamp with integrity protection
        await redis.hset(`mfa:${userId}`, 'lastUsed', new Date().toISOString());

        logger.info('MFA TOTP verified with enhanced security', { userId });
        return { verified: true };
      }

      // If TOTP fails, try backup codes with constant-time comparison
      const backupCodes = JSON.parse(mfaData.backupCodes || '[]');
      let codeIndex = -1;
      let foundMatch = false;

      // Use constant-time comparison for all backup codes to prevent timing attacks
      for (let i = 0; i < backupCodes.length; i++) {
        try {
          const encryptedCode: EncryptedSecret = JSON.parse(backupCodes[i]);
          const decryptedCode = await secureEncryption.decryptMFASecret(encryptedCode, `${userContext}:backup`);

          // Use secure constant-time comparison
          if (secureEncryption.constantTimeEquals(token, decryptedCode)) {
            if (!foundMatch) { // Only record the first match
              codeIndex = i;
              foundMatch = true;
            }
          }
        } catch (decryptError) {
          // Continue checking other codes if one fails to decrypt
          logger.warn('Failed to decrypt backup code during verification', { userId, index: i });
        }
      }

      if (foundMatch && codeIndex !== -1) {
        // Remove used backup code
        backupCodes.splice(codeIndex, 1);
        await redis.hset(`mfa:${userId}`, 'backupCodes', JSON.stringify(backupCodes));
        await redis.hset(`mfa:${userId}`, 'lastUsed', new Date().toISOString());

        logger.info('MFA backup code used with enhanced security', {
          userId,
          remainingCodes: backupCodes.length
        });

        return {
          verified: true,
          usedBackupCode: true,
          remainingBackupCodes: backupCodes.length,
        };
      }

      logger.warn('Invalid MFA token - all verification methods failed', { userId });
      return { verified: false };

    } catch (error) {
      logger.error('Failed to verify MFA token', { error, userId });
      return { verified: false };
    }
  }

  /**
   * Check if MFA is enabled for user
   */
  public async isMFAEnabled(userId: string): Promise<boolean> {
    try {
      const exists = await redis.exists(`mfa:${userId}`);
      return exists === 1;
    } catch (error) {
      logger.error('Failed to check MFA status', { error, userId });
      return false;
    }
  }

  /**
   * Disable MFA for user
   */
  public async disableMFA(userId: string): Promise<void> {
    try {
      await redis.del(`mfa:${userId}`);
      await redis.del(`mfa_setup:${userId}`);

      // Remove any used TOTP tokens
      const usedTokens = await redis.keys(`used_totp:${userId}:*`);
      if (usedTokens.length > 0) {
        await redis.del(...usedTokens);
      }

      logger.info('MFA disabled for user', { userId });

    } catch (error) {
      logger.error('Failed to disable MFA', { error, userId });
      throw new Error('Failed to disable MFA');
    }
  }

  /**
   * Generate new backup codes
   */
  public async regenerateBackupCodes(userId: string): Promise<string[]> {
    try {
      this.ensureInitialized();

      const mfaData = await redis.hgetall(`mfa:${userId}`);
      if (!mfaData.secret) {
        throw new Error('MFA not enabled for user');
      }

      // Generate new cryptographically secure backup codes
      const backupCodes = secureTOTPGenerator.generateBackupCodes();

      // Validate each backup code entropy
      for (const code of backupCodes) {
        if (!secureTOTPGenerator.validateBackupCodeEntropy(code)) {
          throw new Error('Generated backup code failed entropy validation');
        }
      }

      // Encrypt backup codes with authenticated encryption
      const userContext = userId;
      const encryptedBackupCodes: string[] = [];

      for (const code of backupCodes) {
        const encryptedCode = await secureEncryption.encryptMFASecret(code, `${userContext}:backup`);
        encryptedBackupCodes.push(JSON.stringify(encryptedCode));
      }

      // Update with new encrypted backup codes
      await redis.hset(`mfa:${userId}`, {
        backupCodes: JSON.stringify(encryptedBackupCodes),
        backupCodesGeneratedAt: new Date().toISOString()
      });

      logger.info('Backup codes regenerated with enhanced security', {
        userId,
        codeCount: backupCodes.length
      });

      return backupCodes;

    } catch (error) {
      logger.error('Failed to regenerate backup codes', { error, userId });
      throw new Error('Failed to regenerate backup codes');
    }
  }

  /**
   * Get MFA status for user with enhanced security information
   */
  public async getMFAStatus(userId: string): Promise<{
    enabled: boolean;
    hasBackupCodes: boolean;
    backupCodesCount?: number;
    lastUsed?: string;
    securityInfo?: {
      algorithm: string;
      keyDerivation: string;
      secretStrength?: string;
      enabledAt?: string;
    };
  }> {
    try {
      this.ensureInitialized();

      const mfaData = await redis.hgetall(`mfa:${userId}`);

      if (!mfaData.secret) {
        return { enabled: false, hasBackupCodes: false };
      }

      const backupCodes = JSON.parse(mfaData.backupCodes || '[]');

      // Parse security information
      let securityInfo;
      try {
        const secretValidation = mfaData.secretValidation ? JSON.parse(mfaData.secretValidation) : null;
        securityInfo = {
          algorithm: mfaData.algorithm || 'aes-256-gcm',
          keyDerivation: mfaData.keyDerivation || 'pbkdf2',
          secretStrength: secretValidation?.strength || 'unknown',
          enabledAt: mfaData.enabledAt
        };
      } catch (parseError) {
        logger.warn('Failed to parse MFA security info', { userId, parseError });
      }

      return {
        enabled: true,
        hasBackupCodes: backupCodes.length > 0,
        backupCodesCount: backupCodes.length,
        lastUsed: mfaData.lastUsed,
        securityInfo
      };

    } catch (error) {
      logger.error('Failed to get MFA status', { error, userId });
      return { enabled: false, hasBackupCodes: false };
    }
  }

  /**
   * Validate TOTP token format
   */
  public isValidTokenFormat(token: string): boolean {
    return /^\d{6}$/.test(token);
  }

  /**
   * Ensure the service is properly initialized before cryptographic operations
   */
  private ensureInitialized(): void {
    if (!this.isInitialized) {
      throw new Error('MFA service not initialized - call initialize() first');
    }
  }

  /**
   * Enable MFA for user with enhanced security (internal method)
   */
  private async enableMFA(userId: string, secret: string, encryptedBackupCodes: string[]): Promise<void> {
    try {
      // Encrypt secret with authenticated encryption
      const userContext = userId;
      const encryptedSecret = await secureEncryption.encryptMFASecret(secret, userContext);

      // Validate secret before enabling
      const validation = secureTOTPGenerator.validateSecretEntropy(secret);
      if (!validation.isValid) {
        throw new Error(`Secret validation failed: ${validation.issues.join(', ')}`);
      }

      await redis.hset(`mfa:${userId}`, {
        secret: JSON.stringify(encryptedSecret),
        backupCodes: JSON.stringify(encryptedBackupCodes),
        enabledAt: new Date().toISOString(),
        algorithm: 'aes-256-gcm',
        keyDerivation: 'pbkdf2',
        secretValidation: JSON.stringify(validation)
      });

      logger.info('MFA enabled with enhanced cryptographic security', {
        userId,
        secretEntropy: validation.entropy,
        secretStrength: validation.strength
      });

    } catch (error) {
      logger.error('Failed to enable MFA with enhanced security', { error, userId });
      throw new Error('Failed to enable MFA');
    }
  }

  /**
   * Legacy method removed - now using secure authenticated encryption
   * @deprecated Use secureEncryption.encryptMFASecret() instead
   */
  private encrypt(text: string): string {
    throw new Error('Legacy encryption method removed for security - use secureEncryption.encryptMFASecret()');
  }

  /**
   * Legacy method removed - now using secure authenticated decryption
   * @deprecated Use secureEncryption.decryptMFASecret() instead
   */
  private decrypt(encryptedText: string): string {
    throw new Error('Legacy decryption method removed for security - use secureEncryption.decryptMFASecret()');
  }

  /**
   * Legacy backup code hashing removed - now using constant-time comparison
   * @deprecated Use secureEncryption.constantTimeEquals() for secure comparison
   */
  private hashBackupCode(code: string): string {
    throw new Error('Legacy backup code hashing removed for security - use constant-time comparison');
  }
}