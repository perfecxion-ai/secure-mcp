import { randomBytes, pbkdf2Sync, createCipheriv, createDecipheriv, timingSafeEqual } from 'crypto';
import { logger } from '../../utils/logger';

export interface EncryptedSecret {
  data: string;
  iv: string;
  tag: string;
  salt: string;
  algorithm: string;
  iterations: number;
  keyLength: number;
  digest: string;
  timestamp: number;
}

export interface SecureMFAConfig {
  keyDerivation: {
    algorithm: 'pbkdf2';
    iterations: number;
    keyLength: number;
    digest: string;
  };
  encryption: {
    algorithm: string;
    ivLength: number;
    tagLength: number;
    saltLength: number;
  };
  totp: {
    secretLength: number;
    window: number;
    step: number;
  };
}

export class SecureEncryption {
  private readonly config: SecureMFAConfig = {
    keyDerivation: {
      algorithm: 'pbkdf2',
      iterations: 100000, // NIST recommended minimum
      keyLength: 32, // 256 bits
      digest: 'sha256'
    },
    encryption: {
      algorithm: 'aes-256-gcm',
      ivLength: 16, // 128 bits
      tagLength: 16, // 128 bits
      saltLength: 32 // 256 bits
    },
    totp: {
      secretLength: 32,
      window: 1,
      step: 30
    }
  };

  /**
   * Encrypt MFA secret using authenticated encryption with PBKDF2 key derivation
   */
  public async encryptMFASecret(secret: string, userPassword: string): Promise<EncryptedSecret> {
    try {
      // Generate cryptographically secure salt
      const salt = this.generateSecureSalt();

      // Derive encryption key using PBKDF2
      const derivedKey = this.deriveKey(userPassword, salt);

      // Generate IV for GCM mode
      const iv = randomBytes(this.config.encryption.ivLength);

      // Create GCM cipher with IV
      const cipher = createCipheriv(this.config.encryption.algorithm, derivedKey, iv) as any;

      // Encrypt the secret
      let encrypted = cipher.update(secret, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // Get authentication tag
      const tag = cipher.getAuthTag();

      const result: EncryptedSecret = {
        data: encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        salt: salt.toString('hex'),
        algorithm: this.config.encryption.algorithm,
        iterations: this.config.keyDerivation.iterations,
        keyLength: this.config.keyDerivation.keyLength,
        digest: this.config.keyDerivation.digest,
        timestamp: Date.now()
      };

      // Clear sensitive data from memory
      derivedKey.fill(0);

      logger.debug('MFA secret encrypted with authenticated encryption');
      return result;

    } catch (error) {
      logger.error('Failed to encrypt MFA secret', { error });
      throw new Error('Encryption failed');
    }
  }

  /**
   * Decrypt MFA secret with integrity verification
   */
  public async decryptMFASecret(encrypted: EncryptedSecret, userPassword: string): Promise<string> {
    try {
      // Validate encrypted data structure
      this.validateEncryptedData(encrypted);

      // Parse components
      const salt = Buffer.from(encrypted.salt, 'hex');
      const iv = Buffer.from(encrypted.iv, 'hex');
      const tag = Buffer.from(encrypted.tag, 'hex');
      const data = encrypted.data;

      // Derive the same key using stored parameters
      const derivedKey = this.deriveKey(
        userPassword,
        salt,
        encrypted.iterations,
        encrypted.keyLength,
        encrypted.digest
      );

      // Create GCM decipher with IV
      const decipher = createDecipheriv(encrypted.algorithm, derivedKey, iv) as any;
      decipher.setAuthTag(tag);

      // Decrypt and verify integrity
      let decrypted = decipher.update(data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      // Clear sensitive data from memory
      derivedKey.fill(0);

      logger.debug('MFA secret decrypted and verified');
      return decrypted;

    } catch (error) {
      logger.error('Failed to decrypt MFA secret', { error });
      throw new Error('Decryption failed or data corrupted');
    }
  }

  /**
   * Encrypt data with additional authenticated data (AAD)
   */
  public encryptWithAAD(data: string, key: Buffer, aad: string): EncryptedSecret {
    try {
      const iv = randomBytes(this.config.encryption.ivLength);
      const cipher = createCipheriv(this.config.encryption.algorithm, key, iv) as any;
      cipher.setAAD(Buffer.from(aad, 'utf8'));

      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      const tag = cipher.getAuthTag();

      return {
        data: encrypted,
        iv: iv.toString('hex'),
        tag: tag.toString('hex'),
        salt: '', // Not used for direct key encryption
        algorithm: this.config.encryption.algorithm,
        iterations: 0, // Not used for direct key encryption
        keyLength: key.length,
        digest: 'n/a',
        timestamp: Date.now()
      };

    } catch (error) {
      logger.error('Failed to encrypt with AAD', { error });
      throw new Error('AAD encryption failed');
    }
  }

  /**
   * Decrypt data with additional authenticated data (AAD) verification
   */
  public decryptWithAAD(encrypted: EncryptedSecret, key: Buffer, aad: string): string {
    try {
      const iv = Buffer.from(encrypted.iv, 'hex');
      const tag = Buffer.from(encrypted.tag, 'hex');

      const decipher = createDecipheriv(encrypted.algorithm, key, iv) as any;
      decipher.setAuthTag(tag);
      decipher.setAAD(Buffer.from(aad, 'utf8'));

      let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;

    } catch (error) {
      logger.error('Failed to decrypt with AAD', { error });
      throw new Error('AAD decryption failed or authentication failed');
    }
  }

  /**
   * Generate cryptographically secure salt
   */
  private generateSecureSalt(): Buffer {
    return randomBytes(this.config.encryption.saltLength);
  }

  /**
   * Derive key using PBKDF2 with secure parameters
   */
  private deriveKey(
    password: string,
    salt: Buffer,
    iterations?: number,
    keyLength?: number,
    digest?: string
  ): Buffer {
    const iter = iterations || this.config.keyDerivation.iterations;
    const len = keyLength || this.config.keyDerivation.keyLength;
    const dig = digest || this.config.keyDerivation.digest;

    // Validate parameters meet security requirements
    if (iter < 100000) {
      throw new Error('Insufficient PBKDF2 iterations for security');
    }

    if (len < 32) {
      throw new Error('Insufficient key length for security');
    }

    return pbkdf2Sync(password, salt, iter, len, dig);
  }

  /**
   * Validate encrypted data structure and integrity
   */
  private validateEncryptedData(encrypted: EncryptedSecret): void {
    const required = ['data', 'iv', 'tag', 'salt', 'algorithm', 'iterations', 'keyLength', 'digest'];

    for (const field of required) {
      if (!(field in encrypted) || encrypted[field as keyof EncryptedSecret] === undefined) {
        throw new Error(`Missing required field: ${field}`);
      }
    }

    // Validate algorithm
    if (encrypted.algorithm !== this.config.encryption.algorithm) {
      throw new Error('Unsupported encryption algorithm');
    }

    // Validate key derivation parameters
    if (encrypted.iterations < 100000) {
      throw new Error('Insufficient iterations for security');
    }

    if (encrypted.keyLength < 32) {
      throw new Error('Insufficient key length for security');
    }

    // Validate hex encoding
    const hexFields = ['data', 'iv', 'tag', 'salt'];
    for (const field of hexFields) {
      const value = encrypted[field as keyof EncryptedSecret] as string;
      if (!/^[a-f0-9]*$/i.test(value)) {
        throw new Error(`Invalid hex encoding in field: ${field}`);
      }
    }
  }

  /**
   * Constant-time comparison for cryptographic operations
   */
  public constantTimeEquals(a: string, b: string): boolean {
    if (a.length !== b.length) {
      return false;
    }

    const bufferA = Buffer.from(a, 'utf8');
    const bufferB = Buffer.from(b, 'utf8');

    return timingSafeEqual(bufferA, bufferB);
  }

  /**
   * Secure memory clear for sensitive data
   */
  public clearSensitiveData(buffer: Buffer): void {
    buffer.fill(0);
  }

  /**
   * Get configuration for external validation
   */
  public getConfig(): SecureMFAConfig {
    return { ...this.config }; // Return copy to prevent modification
  }
}

export const secureEncryption = new SecureEncryption();