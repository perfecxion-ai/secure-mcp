import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { logger } from '../../utils/logger';

export interface IntegrityProtection {
  data: Buffer;
  hmac: Buffer;
  timestamp: number;
  algorithm: string;
  keyId?: string;
}

export interface TamperingResult {
  isTampered: boolean;
  integrityValid: boolean;
  timestampValid: boolean;
  algorithmSupported: boolean;
  errors: string[];
}

export interface HMACConfig {
  algorithm: string;
  keyLength: number;
  timestampWindow: number; // seconds
  maxAge: number; // seconds
}

export class CryptographicIntegrity {
  private readonly config: HMACConfig = {
    algorithm: 'sha256',
    keyLength: 32, // 256 bits
    timestampWindow: 300, // 5 minute tolerance
    maxAge: 86400 // 24 hour maximum age
  };

  private readonly supportedAlgorithms = ['sha256', 'sha384', 'sha512'];

  /**
   * Protect data with HMAC-based integrity verification
   */
  public async protectData(data: Buffer, key: Buffer, keyId?: string): Promise<IntegrityProtection> {
    try {
      this.validateKey(key);

      const timestamp = Date.now();
      const algorithm = this.config.algorithm;

      // Create message to authenticate (data + timestamp)
      const message = Buffer.concat([
        data,
        Buffer.from(timestamp.toString(), 'utf8')
      ]);

      // Generate HMAC
      const hmac = this.generateHMAC(message, key, algorithm);

      const protection: IntegrityProtection = {
        data,
        hmac,
        timestamp,
        algorithm,
        keyId
      };

      logger.debug('Data protected with integrity verification', {
        dataLength: data.length,
        algorithm,
        keyId,
        timestamp
      });

      return protection;

    } catch (error) {
      logger.error('Failed to protect data integrity', { error });
      throw new Error('Data integrity protection failed');
    }
  }

  /**
   * Verify data integrity and detect tampering
   */
  public async verifyIntegrity(protection: IntegrityProtection, key: Buffer): Promise<boolean> {
    try {
      const tamperingResult = await this.detectTampering(protection, key);
      return !tamperingResult.isTampered && tamperingResult.integrityValid;

    } catch (error) {
      logger.error('Integrity verification failed', { error });
      return false;
    }
  }

  /**
   * Comprehensive tampering detection with detailed analysis
   */
  public async detectTampering(protection: IntegrityProtection, key: Buffer): Promise<TamperingResult> {
    const errors: string[] = [];
    let integrityValid = false;
    let timestampValid = false;
    let algorithmSupported = false;

    try {
      this.validateKey(key);

      // Validate algorithm support
      algorithmSupported = this.supportedAlgorithms.includes(protection.algorithm);
      if (!algorithmSupported) {
        errors.push(`Unsupported HMAC algorithm: ${protection.algorithm}`);
      }

      // Validate timestamp
      const currentTime = Date.now();
      const age = (currentTime - protection.timestamp) / 1000; // Convert to seconds

      if (age < 0) {
        errors.push('Timestamp is in the future');
      } else if (age > this.config.maxAge) {
        errors.push(`Data too old (age: ${age}s, max: ${this.config.maxAge}s)`);
      } else if (Math.abs(age) > this.config.timestampWindow) {
        errors.push(`Timestamp outside acceptable window (age: ${age}s, window: ${this.config.timestampWindow}s)`);
      } else {
        timestampValid = true;
      }

      // Verify HMAC integrity
      if (algorithmSupported) {
        const message = Buffer.concat([
          protection.data,
          Buffer.from(protection.timestamp.toString(), 'utf8')
        ]);

        const expectedHMAC = this.generateHMAC(message, key, protection.algorithm);
        integrityValid = this.constantTimeEquals(protection.hmac, expectedHMAC);

        if (!integrityValid) {
          errors.push('HMAC verification failed - data may have been tampered with');
        }
      }

      const isTampered = errors.length > 0;

      const result: TamperingResult = {
        isTampered,
        integrityValid,
        timestampValid,
        algorithmSupported,
        errors
      };

      logger.debug('Tampering detection completed', {
        isTampered,
        integrityValid,
        timestampValid,
        algorithmSupported,
        errorCount: errors.length
      });

      return result;

    } catch (error) {
      logger.error('Tampering detection failed', { error });
      return {
        isTampered: true,
        integrityValid: false,
        timestampValid: false,
        algorithmSupported: false,
        errors: ['Tampering detection failed']
      };
    }
  }

  /**
   * Generate HMAC with specified algorithm
   */
  public generateHMAC(data: Buffer, key: Buffer, algorithm: string = this.config.algorithm): Buffer {
    try {
      if (!this.supportedAlgorithms.includes(algorithm)) {
        throw new Error(`Unsupported HMAC algorithm: ${algorithm}`);
      }

      const hmac = createHmac(algorithm, key);
      hmac.update(data);
      return hmac.digest();

    } catch (error) {
      logger.error('HMAC generation failed', { error });
      throw new Error('HMAC generation failed');
    }
  }

  /**
   * Verify HMAC with constant-time comparison
   */
  public verifyHMAC(data: Buffer, key: Buffer, expectedHMAC: Buffer, algorithm: string = this.config.algorithm): boolean {
    try {
      const computedHMAC = this.generateHMAC(data, key, algorithm);
      return this.constantTimeEquals(computedHMAC, expectedHMAC);

    } catch (error) {
      logger.error('HMAC verification failed', { error });
      return false;
    }
  }

  /**
   * Generate cryptographically secure key for HMAC operations
   */
  public generateSecureKey(length: number = this.config.keyLength): Buffer {
    if (length < 32) {
      throw new Error('Key length must be at least 32 bytes for security');
    }

    return randomBytes(length);
  }

  /**
   * Derive HMAC key from master key and context
   */
  public deriveHMACKey(masterKey: Buffer, context: string, length: number = this.config.keyLength): Buffer {
    try {
      // Use HMAC-based key derivation
      const info = Buffer.from(context, 'utf8');
      const hmac = createHmac('sha256', masterKey);
      hmac.update(info);

      const derivedKey = hmac.digest();

      // Truncate or extend to desired length
      if (derivedKey.length >= length) {
        return derivedKey.slice(0, length);
      } else {
        // For longer keys, use multiple rounds
        const rounds = Math.ceil(length / derivedKey.length);
        const keys: Buffer[] = [];

        for (let i = 0; i < rounds; i++) {
          const roundHmac = createHmac('sha256', masterKey);
          roundHmac.update(info);
          roundHmac.update(Buffer.from([i])); // Add round counter
          keys.push(roundHmac.digest());
        }

        return Buffer.concat(keys).slice(0, length);
      }

    } catch (error) {
      logger.error('HMAC key derivation failed', { error });
      throw new Error('HMAC key derivation failed');
    }
  }

  /**
   * Create integrity protection for sensitive MFA data
   */
  public async protectMFAData(
    secretData: string,
    userContext: string,
    masterKey: Buffer
  ): Promise<IntegrityProtection> {
    try {
      // Derive context-specific key
      const contextKey = this.deriveHMACKey(masterKey, `mfa:${userContext}`);

      // Convert string to buffer
      const dataBuffer = Buffer.from(secretData, 'utf8');

      // Protect with integrity verification
      const protection = await this.protectData(dataBuffer, contextKey);

      // Clear derived key from memory
      contextKey.fill(0);

      logger.debug('MFA data protected with integrity verification', {
        userContext,
        dataLength: dataBuffer.length
      });

      return protection;

    } catch (error) {
      logger.error('Failed to protect MFA data', { error });
      throw new Error('MFA data protection failed');
    }
  }

  /**
   * Verify integrity of MFA data
   */
  public async verifyMFAData(
    protection: IntegrityProtection,
    userContext: string,
    masterKey: Buffer
  ): Promise<{ isValid: boolean; data?: string }> {
    try {
      // Derive the same context-specific key
      const contextKey = this.deriveHMACKey(masterKey, `mfa:${userContext}`);

      // Verify integrity
      const isValid = await this.verifyIntegrity(protection, contextKey);

      // Clear derived key from memory
      contextKey.fill(0);

      if (isValid) {
        const data = protection.data.toString('utf8');
        return { isValid: true, data };
      } else {
        return { isValid: false };
      }

    } catch (error) {
      logger.error('Failed to verify MFA data', { error });
      return { isValid: false };
    }
  }

  /**
   * Constant-time buffer comparison to prevent timing attacks
   */
  private constantTimeEquals(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) {
      return false;
    }

    return timingSafeEqual(a, b);
  }

  /**
   * Validate HMAC key meets security requirements
   */
  private validateKey(key: Buffer): void {
    if (!key || key.length === 0) {
      throw new Error('HMAC key cannot be empty');
    }

    if (key.length < 32) {
      throw new Error('HMAC key must be at least 32 bytes for security');
    }

    // Check for weak keys (all zeros, all ones, etc.)
    const allZeros = key.every(byte => byte === 0);
    const allOnes = key.every(byte => byte === 255);

    if (allZeros || allOnes) {
      throw new Error('Weak HMAC key detected');
    }
  }

  /**
   * Get current configuration
   */
  public getConfig(): HMACConfig {
    return { ...this.config };
  }

  /**
   * Get supported algorithms
   */
  public getSupportedAlgorithms(): string[] {
    return [...this.supportedAlgorithms];
  }

  /**
   * Calculate HMAC strength based on algorithm and key length
   */
  public calculateHMACStrength(algorithm: string, keyLength: number): {
    strength: 'weak' | 'moderate' | 'strong' | 'very-strong';
    bitSecurity: number;
    recommendations: string[];
  } {
    const recommendations: string[] = [];
    let bitSecurity = 0;

    // Calculate bit security based on algorithm
    switch (algorithm) {
      case 'sha256':
        bitSecurity = Math.min(keyLength * 8, 256);
        break;
      case 'sha384':
        bitSecurity = Math.min(keyLength * 8, 384);
        break;
      case 'sha512':
        bitSecurity = Math.min(keyLength * 8, 512);
        break;
      default:
        bitSecurity = 0;
        recommendations.push('Use supported algorithm (sha256, sha384, sha512)');
    }

    // Check key length
    if (keyLength < 32) {
      recommendations.push('Increase key length to at least 32 bytes');
    }

    // Determine strength
    let strength: 'weak' | 'moderate' | 'strong' | 'very-strong';
    if (bitSecurity < 128) {
      strength = 'weak';
      recommendations.push('Insufficient security for production use');
    } else if (bitSecurity < 192) {
      strength = 'moderate';
    } else if (bitSecurity < 256) {
      strength = 'strong';
    } else {
      strength = 'very-strong';
    }

    return {
      strength,
      bitSecurity,
      recommendations
    };
  }
}

export const cryptographicIntegrity = new CryptographicIntegrity();