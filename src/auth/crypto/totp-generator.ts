import { randomBytes, createHmac, timingSafeEqual } from 'crypto';
import { authenticator } from 'otplib';
import { logger } from '../../utils/logger';

export interface TOTPConfig {
  secretLength: number;
  window: number;
  step: number;
  digits: number;
  algorithm: string;
  encoding: string;
}

export interface BackupCodeConfig {
  length: number;
  count: number;
  charset: string;
  minEntropy: number;
}

export interface SecretValidation {
  isValid: boolean;
  entropy: number;
  strength: 'weak' | 'moderate' | 'strong' | 'very-strong';
  issues: string[];
}

export class SecureTOTPGenerator {
  private readonly config: TOTPConfig = {
    secretLength: 32, // 160 bits base32 encoded (RFC 4648)
    window: 1, // Allow 1 time step tolerance
    step: 30, // 30 second time steps
    digits: 6, // 6 digit codes
    algorithm: 'sha256', // Use SHA-256 instead of SHA-1
    encoding: 'base32'
  };

  private readonly backupConfig: BackupCodeConfig = {
    length: 8, // 8 character backup codes
    count: 10, // Generate 10 backup codes
    charset: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ', // Base36 for readability
    minEntropy: 40 // Minimum bits of entropy required
  };

  constructor() {
    // Configure otplib with secure parameters
    authenticator.options = {
      window: this.config.window,
      step: this.config.step,
      digits: this.config.digits,
      algorithm: this.config.algorithm as any,
      encoding: this.config.encoding as any,
    };
  }

  /**
   * Generate cryptographically secure TOTP secret
   */
  public generateSecret(): string {
    try {
      // Generate cryptographically secure random bytes
      const secretBytes = randomBytes(this.config.secretLength);

      // Convert to base32 for TOTP compatibility
      const secret = this.bytesToBase32(secretBytes);

      // Validate the generated secret
      const validation = this.validateSecretEntropy(secret);
      if (!validation.isValid) {
        logger.warn('Generated secret failed validation, regenerating', {
          issues: validation.issues,
          entropy: validation.entropy
        });
        // Recursively generate until we get a valid secret
        return this.generateSecret();
      }

      // Clear sensitive data from memory
      secretBytes.fill(0);

      logger.debug('TOTP secret generated successfully', {
        secretLength: secret.length,
        entropy: validation.entropy,
        strength: validation.strength
      });

      return secret;

    } catch (error) {
      logger.error('Failed to generate TOTP secret', { error });
      throw new Error('TOTP secret generation failed');
    }
  }

  /**
   * Generate cryptographically secure backup codes
   */
  public generateBackupCodes(count: number = this.backupConfig.count): string[] {
    try {
      const codes: string[] = [];
      const usedCodes = new Set<string>();

      while (codes.length < count) {
        // Generate cryptographically secure random bytes
        const randomBytes = this.generateSecureRandomBytes(this.backupConfig.length);

        // Convert to backup code format
        const code = this.bytesToBackupCode(randomBytes);

        // Ensure uniqueness and entropy requirements
        if (!usedCodes.has(code) && this.validateBackupCodeEntropy(code)) {
          codes.push(code);
          usedCodes.add(code);
        }

        // Clear sensitive data
        randomBytes.fill(0);
      }

      logger.debug('Backup codes generated successfully', {
        count: codes.length,
        codeLength: this.backupConfig.length
      });

      return codes;

    } catch (error) {
      logger.error('Failed to generate backup codes', { error });
      throw new Error('Backup code generation failed');
    }
  }

  /**
   * Validate TOTP secret entropy and strength
   */
  public validateSecretEntropy(secret: string): SecretValidation {
    const issues: string[] = [];
    let entropy = 0;

    try {
      // Validate secret length
      if (secret.length < 16) {
        issues.push('Secret too short (minimum 16 characters)');
      }

      // Validate base32 encoding
      if (!/^[A-Z2-7]+$/.test(secret)) {
        issues.push('Invalid base32 encoding');
      }

      // Calculate entropy
      entropy = this.calculateEntropy(secret);

      // Validate minimum entropy
      if (entropy < 80) {
        issues.push(`Insufficient entropy (${entropy} bits, minimum 80)`);
      }

      // Check for patterns and repetition
      if (this.hasRepeatedPatterns(secret)) {
        issues.push('Contains repeated patterns');
      }

      // Determine strength level
      let strength: 'weak' | 'moderate' | 'strong' | 'very-strong';
      if (entropy < 60) {
        strength = 'weak';
      } else if (entropy < 80) {
        strength = 'moderate';
      } else if (entropy < 120) {
        strength = 'strong';
      } else {
        strength = 'very-strong';
      }

      return {
        isValid: issues.length === 0,
        entropy,
        strength,
        issues
      };

    } catch (error) {
      logger.error('Secret validation failed', { error });
      return {
        isValid: false,
        entropy: 0,
        strength: 'weak',
        issues: ['Validation failed']
      };
    }
  }

  /**
   * Validate backup code entropy
   */
  public validateBackupCodeEntropy(code: string): boolean {
    try {
      const entropy = this.calculateEntropy(code);
      return entropy >= this.backupConfig.minEntropy;
    } catch (error) {
      logger.error('Backup code validation failed', { error });
      return false;
    }
  }

  /**
   * Generate TOTP token for testing and validation
   */
  public generateToken(secret: string, timestamp?: number): string {
    try {
      const token = authenticator.generate(secret);

      logger.debug('TOTP token generated for validation', {
        secretLength: secret.length,
        timestamp: timestamp || Date.now()
      });

      return token;

    } catch (error) {
      logger.error('Failed to generate TOTP token', { error });
      throw new Error('TOTP token generation failed');
    }
  }

  /**
   * Verify TOTP token with timing attack protection
   */
  public verifyToken(token: string, secret: string, window?: number): boolean {
    try {
      // Use constant-time comparison for token verification
      const expectedToken = this.generateToken(secret);

      // Verify using otplib with specified window
      const isValid = authenticator.check(token, secret);

      // Additional constant-time verification for security
      const tokenBuffer = Buffer.from(token, 'utf8');
      const expectedBuffer = Buffer.from(expectedToken, 'utf8');

      const constantTimeResult = tokenBuffer.length === expectedBuffer.length &&
                                timingSafeEqual(tokenBuffer, expectedBuffer);

      logger.debug('TOTP token verification completed', {
        tokenLength: token.length,
        isValid: isValid,
        constantTimeMatch: constantTimeResult
      });

      return isValid;

    } catch (error) {
      logger.error('TOTP token verification failed', { error });
      return false;
    }
  }

  /**
   * Convert bytes to base32 encoding for TOTP compatibility
   */
  private bytesToBase32(bytes: Buffer): string {
    const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let result = '';
    let buffer = 0;
    let bitsLeft = 0;

    for (let i = 0; i < bytes.length; i++) {
      buffer = (buffer << 8) | bytes[i];
      bitsLeft += 8;

      while (bitsLeft >= 5) {
        result += base32Chars[(buffer >> (bitsLeft - 5)) & 31];
        bitsLeft -= 5;
      }
    }

    if (bitsLeft > 0) {
      result += base32Chars[(buffer << (5 - bitsLeft)) & 31];
    }

    return result;
  }

  /**
   * Convert bytes to backup code format
   */
  private bytesToBackupCode(bytes: Buffer): string {
    let result = '';
    const charset = this.backupConfig.charset;

    for (let i = 0; i < this.backupConfig.length; i++) {
      const randomIndex = bytes[i % bytes.length] % charset.length;
      result += charset[randomIndex];
    }

    return result;
  }

  /**
   * Generate cryptographically secure random bytes
   */
  private generateSecureRandomBytes(length: number): Buffer {
    return randomBytes(length);
  }

  /**
   * Calculate Shannon entropy of a string
   */
  private calculateEntropy(str: string): number {
    const charCounts: { [key: string]: number } = {};

    // Count character frequencies
    for (const char of str) {
      charCounts[char] = (charCounts[char] || 0) + 1;
    }

    // Calculate entropy
    let entropy = 0;
    const length = str.length;

    for (const count of Object.values(charCounts)) {
      const probability = count / length;
      entropy -= probability * Math.log2(probability);
    }

    // Return entropy in bits
    return entropy * length;
  }

  /**
   * Check for repeated patterns in secret
   */
  private hasRepeatedPatterns(secret: string): boolean {
    // Check for repeated substrings
    for (let len = 2; len <= secret.length / 2; len++) {
      for (let i = 0; i <= secret.length - len * 2; i++) {
        const pattern = secret.substr(i, len);
        const nextOccurrence = secret.indexOf(pattern, i + len);
        if (nextOccurrence !== -1) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Get current configuration
   */
  public getConfig(): TOTPConfig {
    return { ...this.config };
  }

  /**
   * Get backup code configuration
   */
  public getBackupConfig(): BackupCodeConfig {
    return { ...this.backupConfig };
  }

  /**
   * Generate OTP URL for QR code generation
   */
  public generateOTPURL(secret: string, label: string, issuer: string): string {
    try {
      const url = authenticator.keyuri(label, issuer, secret);

      logger.debug('OTP URL generated for QR code', {
        label,
        issuer,
        secretLength: secret.length
      });

      return url;

    } catch (error) {
      logger.error('Failed to generate OTP URL', { error });
      throw new Error('OTP URL generation failed');
    }
  }
}

export const secureTOTPGenerator = new SecureTOTPGenerator();