import { authenticator, totp } from 'otplib';
import * as QRCode from 'qrcode';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { redis } from '../database/redis';
import { vault } from '../security/vault';
import crypto from 'crypto';

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
  private encryptionKey: string;

  constructor() {
    this.encryptionKey = config.jwt.secret;
  }

  /**
   * Initialize MFA service
   */
  public async initialize(): Promise<void> {
    try {
      // In production, load encryption key from Vault
      if (config.env === 'production') {
        const secrets = await vault.read('auth/mfa');
        if (secrets?.data?.encryption_key) {
          this.encryptionKey = secrets.data.encryption_key;
        }
      }

      // Configure TOTP
      authenticator.options = {
        window: config.mfa.window,
        step: 30,
        digits: 6,
        algorithm: 'sha1',
        encoding: 'base32',
      };

      logger.info('MFA service initialized');
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
      const secret = authenticator.generateSecret();
      const service = config.mfa.issuer;
      const otpauth = authenticator.keyuri(userEmail, service, secret);

      // Generate QR code
      const qrCodeUrl = await QRCode.toDataURL(otpauth);

      // Generate backup codes
      const backupCodes = this.generateBackupCodes();

      // Encrypt and store the secret temporarily (for verification before enabling)
      const encryptedSecret = this.encrypt(secret);
      const encryptedBackupCodes = backupCodes.map(code => this.encrypt(code));

      await redis.hset(`mfa_setup:${userId}`, {
        secret: encryptedSecret,
        backupCodes: JSON.stringify(encryptedBackupCodes),
        createdAt: new Date().toISOString(),
      });

      // Expire the setup data after 10 minutes
      await redis.expire(`mfa_setup:${userId}`, 600);

      logger.info('MFA secret generated for user', { userId });

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
      const setupData = await redis.hgetall(`mfa_setup:${userId}`);
      if (!setupData.secret) {
        throw new Error('MFA setup not found or expired');
      }

      const secret = this.decrypt(setupData.secret);
      const isValid = authenticator.check(token, secret);

      if (isValid) {
        // Move from setup to active MFA
        await this.enableMFA(userId, secret, JSON.parse(setupData.backupCodes));
        await redis.del(`mfa_setup:${userId}`);

        logger.info('MFA setup verified and enabled', { userId });
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
      const mfaData = await redis.hgetall(`mfa:${userId}`);
      if (!mfaData.secret) {
        throw new Error('MFA not enabled for user');
      }

      const secret = this.decrypt(mfaData.secret);

      // First try TOTP verification
      const isValidTOTP = authenticator.check(token, secret);
      if (isValidTOTP) {
        // Check if token was already used (replay attack protection)
        const tokenKey = `used_totp:${userId}:${token}`;
        const wasUsed = await redis.get(tokenKey);

        if (wasUsed) {
          logger.warn('TOTP token replay attempt', { userId, token });
          return { verified: false };
        }

        // Mark token as used (expires in 90 seconds - token window)
        await redis.setex(tokenKey, 90, 'used');

        logger.info('MFA TOTP verified', { userId });
        return { verified: true };
      }

      // If TOTP fails, try backup codes
      const backupCodes = JSON.parse(mfaData.backupCodes || '[]');
      const hashedToken = this.hashBackupCode(token);

      const codeIndex = backupCodes.findIndex((encryptedCode: string) => {
        const decryptedCode = this.decrypt(encryptedCode);
        const hashedDecrypted = this.hashBackupCode(decryptedCode);
        return hashedDecrypted === hashedToken;
      });

      if (codeIndex !== -1) {
        // Remove used backup code
        backupCodes.splice(codeIndex, 1);
        await redis.hset(`mfa:${userId}`, 'backupCodes', JSON.stringify(backupCodes));

        logger.info('MFA backup code used', {
          userId,
          remainingCodes: backupCodes.length
        });

        return {
          verified: true,
          usedBackupCode: true,
          remainingBackupCodes: backupCodes.length,
        };
      }

      logger.warn('Invalid MFA token', { userId });
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
      const mfaData = await redis.hgetall(`mfa:${userId}`);
      if (!mfaData.secret) {
        throw new Error('MFA not enabled for user');
      }

      const backupCodes = this.generateBackupCodes();
      const encryptedBackupCodes = backupCodes.map(code => this.encrypt(code));

      await redis.hset(`mfa:${userId}`, 'backupCodes', JSON.stringify(encryptedBackupCodes));

      logger.info('Backup codes regenerated', { userId });

      return backupCodes;

    } catch (error) {
      logger.error('Failed to regenerate backup codes', { error, userId });
      throw new Error('Failed to regenerate backup codes');
    }
  }

  /**
   * Get MFA status for user
   */
  public async getMFAStatus(userId: string): Promise<{
    enabled: boolean;
    hasBackupCodes: boolean;
    backupCodesCount?: number;
    lastUsed?: string;
  }> {
    try {
      const mfaData = await redis.hgetall(`mfa:${userId}`);

      if (!mfaData.secret) {
        return { enabled: false, hasBackupCodes: false };
      }

      const backupCodes = JSON.parse(mfaData.backupCodes || '[]');

      return {
        enabled: true,
        hasBackupCodes: backupCodes.length > 0,
        backupCodesCount: backupCodes.length,
        lastUsed: mfaData.lastUsed,
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
   * Generate random backup codes
   */
  private generateBackupCodes(count: number = 10): string[] {
    const codes: string[] = [];
    for (let i = 0; i < count; i++) {
      // Generate 8-digit backup codes
      const code = crypto.randomInt(10000000, 99999999).toString();
      codes.push(code);
    }
    return codes;
  }

  /**
   * Enable MFA for user (internal method)
   */
  private async enableMFA(userId: string, secret: string, encryptedBackupCodes: string[]): Promise<void> {
    await redis.hset(`mfa:${userId}`, {
      secret: this.encrypt(secret),
      backupCodes: JSON.stringify(encryptedBackupCodes),
      enabledAt: new Date().toISOString(),
    });
  }

  /**
   * Encrypt sensitive data
   */
  private encrypt(text: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);
    const iv = crypto.randomBytes(16);

    const cipher = crypto.createCipher(algorithm, key);
    cipher.setAAD(Buffer.from('mfa'));

    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
  }

  /**
   * Decrypt sensitive data
   */
  private decrypt(encryptedText: string): string {
    const algorithm = 'aes-256-gcm';
    const key = crypto.scryptSync(this.encryptionKey, 'salt', 32);

    const parts = encryptedText.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(parts[0], 'hex');
    const authTag = Buffer.from(parts[1], 'hex');
    const encrypted = parts[2];

    const decipher = crypto.createDecipher(algorithm, key);
    decipher.setAuthTag(authTag);
    decipher.setAAD(Buffer.from('mfa'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Hash backup code for comparison
   */
  private hashBackupCode(code: string): string {
    return crypto.createHash('sha256').update(code + this.encryptionKey).digest('hex');
  }
}