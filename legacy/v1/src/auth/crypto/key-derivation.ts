import { randomBytes, pbkdf2Sync, scryptSync, timingSafeEqual } from 'crypto';
import { logger } from '../../utils/logger';

export interface KeyDerivationParams {
  password: string;
  salt: Buffer;
  iterations: number;
  keyLength: number;
  digest: string;
}

export interface KeyDerivationResult {
  key: Buffer;
  salt: Buffer;
  iterations: number;
  keyLength: number;
  digest: string;
  derivationTime: number;
}

export interface ScryptParams {
  password: string;
  salt: Buffer;
  keyLength: number;
  options: {
    cost: number;
    blockSize: number;
    parallelization: number;
    maxmem?: number;
  };
}

export class SecureKeyDerivation {
  // NIST SP 800-63B compliant minimum parameters
  private static readonly MIN_PBKDF2_ITERATIONS = 100000;
  private static readonly MIN_KEY_LENGTH = 32; // 256 bits
  private static readonly MIN_SALT_LENGTH = 32; // 256 bits
  private static readonly RECOMMENDED_DIGEST = 'sha256';

  // Scrypt parameters (RFC 7914 recommendations)
  private static readonly SCRYPT_PARAMS = {
    cost: 32768, // N parameter (CPU/memory cost)
    blockSize: 8, // r parameter (block size)
    parallelization: 1, // p parameter (parallelization)
    maxmem: 128 * 1024 * 1024 // 128MB memory limit
  };

  /**
   * Derive key using PBKDF2 with secure parameters and timing validation
   */
  public static deriveKey(params: KeyDerivationParams): Buffer {
    try {
      // Validate parameters
      this.validateParameters(params);

      const startTime = performance.now();

      // Perform PBKDF2 key derivation
      const derivedKey = pbkdf2Sync(
        params.password,
        params.salt,
        params.iterations,
        params.keyLength,
        params.digest
      );

      const endTime = performance.now();
      const derivationTime = endTime - startTime;

      logger.debug('PBKDF2 key derivation completed', {
        iterations: params.iterations,
        keyLength: params.keyLength,
        digest: params.digest,
        derivationTime: `${derivationTime.toFixed(2)}ms`
      });

      // Validate minimum derivation time for security
      if (derivationTime < 100) {
        logger.warn('Key derivation completed too quickly - may indicate weak parameters', {
          derivationTime,
          iterations: params.iterations
        });
      }

      return derivedKey;

    } catch (error) {
      logger.error('Key derivation failed', { error });
      throw new Error('Key derivation failed');
    }
  }

  /**
   * Derive key with automatic parameter tuning for target derivation time
   */
  public static deriveKeyWithTiming(
    password: string,
    salt: Buffer,
    targetTime: number = 250, // Target 250ms derivation time
    keyLength: number = 32,
    digest: string = 'sha256'
  ): KeyDerivationResult {
    try {
      // Start with minimum secure iterations
      let iterations = this.MIN_PBKDF2_ITERATIONS;
      let derivationTime = 0;

      // Benchmark to find optimal iterations for target time
      const testParams: KeyDerivationParams = {
        password,
        salt,
        iterations,
        keyLength,
        digest
      };

      const startTime = performance.now();
      const derivedKey = this.deriveKey(testParams);
      const endTime = performance.now();
      derivationTime = endTime - startTime;

      // Adjust iterations if derivation is too fast
      if (derivationTime < targetTime) {
        const scaleFactor = targetTime / derivationTime;
        iterations = Math.floor(iterations * scaleFactor);

        // Ensure we don't go below minimum
        iterations = Math.max(iterations, this.MIN_PBKDF2_ITERATIONS);

        // Re-derive with adjusted parameters
        testParams.iterations = iterations;
        const adjustedStartTime = performance.now();
        const finalKey = this.deriveKey(testParams);
        const adjustedEndTime = performance.now();
        derivationTime = adjustedEndTime - adjustedStartTime;

        // Clear the test key
        derivedKey.fill(0);

        return {
          key: finalKey,
          salt,
          iterations,
          keyLength,
          digest,
          derivationTime
        };
      }

      return {
        key: derivedKey,
        salt,
        iterations,
        keyLength,
        digest,
        derivationTime
      };

    } catch (error) {
      logger.error('Timed key derivation failed', { error });
      throw new Error('Timed key derivation failed');
    }
  }

  /**
   * Derive key using scrypt (alternative to PBKDF2 for memory-hard derivation)
   */
  public static deriveKeyScrypt(params: ScryptParams): Buffer {
    try {
      this.validateScryptParams(params);

      const startTime = performance.now();

      const derivedKey = scryptSync(
        params.password,
        params.salt,
        params.keyLength,
        params.options
      );

      const endTime = performance.now();
      const derivationTime = endTime - startTime;

      logger.debug('Scrypt key derivation completed', {
        keyLength: params.keyLength,
        cost: params.options.cost,
        blockSize: params.options.blockSize,
        parallelization: params.options.parallelization,
        derivationTime: `${derivationTime.toFixed(2)}ms`
      });

      return derivedKey;

    } catch (error) {
      logger.error('Scrypt key derivation failed', { error });
      throw new Error('Scrypt key derivation failed');
    }
  }

  /**
   * Generate cryptographically secure salt
   */
  public static generateSalt(length: number = this.MIN_SALT_LENGTH): Buffer {
    if (length < this.MIN_SALT_LENGTH) {
      throw new Error(`Salt length must be at least ${this.MIN_SALT_LENGTH} bytes`);
    }

    return randomBytes(length);
  }

  /**
   * Validate PBKDF2 parameters meet security requirements
   */
  public static validateParameters(params: KeyDerivationParams): boolean {
    const errors: string[] = [];

    // Validate iterations
    if (params.iterations < this.MIN_PBKDF2_ITERATIONS) {
      errors.push(`Iterations must be at least ${this.MIN_PBKDF2_ITERATIONS}`);
    }

    // Validate key length
    if (params.keyLength < this.MIN_KEY_LENGTH) {
      errors.push(`Key length must be at least ${this.MIN_KEY_LENGTH} bytes`);
    }

    // Validate salt length
    if (params.salt.length < this.MIN_SALT_LENGTH) {
      errors.push(`Salt length must be at least ${this.MIN_SALT_LENGTH} bytes`);
    }

    // Validate digest algorithm
    const supportedDigests = ['sha256', 'sha384', 'sha512'];
    if (!supportedDigests.includes(params.digest)) {
      errors.push(`Digest must be one of: ${supportedDigests.join(', ')}`);
    }

    // Validate password is not empty
    if (!params.password || params.password.length === 0) {
      errors.push('Password cannot be empty');
    }

    if (errors.length > 0) {
      throw new Error(`Invalid key derivation parameters: ${errors.join(', ')}`);
    }

    return true;
  }

  /**
   * Validate scrypt parameters
   */
  private static validateScryptParams(params: ScryptParams): boolean {
    const errors: string[] = [];

    // Validate key length
    if (params.keyLength < this.MIN_KEY_LENGTH) {
      errors.push(`Key length must be at least ${this.MIN_KEY_LENGTH} bytes`);
    }

    // Validate salt length
    if (params.salt.length < this.MIN_SALT_LENGTH) {
      errors.push(`Salt length must be at least ${this.MIN_SALT_LENGTH} bytes`);
    }

    // Validate scrypt parameters
    if (params.options.cost < 16384) {
      errors.push('Scrypt cost parameter too low (minimum 16384)');
    }

    if (params.options.blockSize < 8) {
      errors.push('Scrypt block size too low (minimum 8)');
    }

    if (params.options.parallelization < 1) {
      errors.push('Scrypt parallelization must be at least 1');
    }

    // Validate password is not empty
    if (!params.password || params.password.length === 0) {
      errors.push('Password cannot be empty');
    }

    if (errors.length > 0) {
      throw new Error(`Invalid scrypt parameters: ${errors.join(', ')}`);
    }

    return true;
  }

  /**
   * Compare derived keys in constant time to prevent timing attacks
   */
  public static constantTimeCompare(a: Buffer, b: Buffer): boolean {
    if (a.length !== b.length) {
      return false;
    }

    return timingSafeEqual(a, b);
  }

  /**
   * Estimate optimal PBKDF2 iterations for target derivation time
   */
  public static estimateOptimalIterations(
    targetTime: number = 250,
    password: string = 'test',
    keyLength: number = 32,
    digest: string = 'sha256'
  ): number {
    try {
      const testSalt = this.generateSalt();
      const testIterations = 10000; // Baseline test

      const startTime = performance.now();
      pbkdf2Sync(password, testSalt, testIterations, keyLength, digest);
      const endTime = performance.now();

      const testTime = endTime - startTime;
      const scaleFactor = targetTime / testTime;
      const estimatedIterations = Math.floor(testIterations * scaleFactor);

      // Ensure minimum security requirements
      return Math.max(estimatedIterations, this.MIN_PBKDF2_ITERATIONS);

    } catch (error) {
      logger.error('Failed to estimate optimal iterations', { error });
      return this.MIN_PBKDF2_ITERATIONS;
    }
  }

  /**
   * Get recommended scrypt parameters for different security levels
   */
  public static getScryptParams(securityLevel: 'standard' | 'high' | 'maximum' = 'standard') {
    const params = {
      standard: {
        cost: 16384,
        blockSize: 8,
        parallelization: 1,
        maxmem: 64 * 1024 * 1024 // 64MB
      },
      high: {
        cost: 32768,
        blockSize: 8,
        parallelization: 1,
        maxmem: 128 * 1024 * 1024 // 128MB
      },
      maximum: {
        cost: 65536,
        blockSize: 8,
        parallelization: 2,
        maxmem: 256 * 1024 * 1024 // 256MB
      }
    };

    return params[securityLevel];
  }
}

export default SecureKeyDerivation;