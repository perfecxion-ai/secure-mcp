import { describe, test, expect } from '@jest/globals';
import { secureTOTPGenerator } from '../crypto/totp-generator';
import { SecureKeyDerivation } from '../crypto/key-derivation';
import { cryptographicIntegrity } from '../crypto/integrity-protection';
import { randomBytes } from 'crypto';

/**
 * Entropy Validation Tests
 *
 * These tests validate that all random number generation and cryptographic
 * operations provide sufficient entropy for security purposes.
 */
describe('Entropy Validation Tests', () => {

  describe('TOTP Secret Entropy', () => {
    test('should generate secrets with high entropy', () => {
      const secrets: string[] = [];
      const iterations = 100;

      // Generate multiple secrets
      for (let i = 0; i < iterations; i++) {
        const secret = secureTOTPGenerator.generateSecret();
        secrets.push(secret);
      }

      // Ensure all secrets are unique
      const uniqueSecrets = new Set(secrets);
      expect(uniqueSecrets.size).toBe(secrets.length);

      // Validate entropy of each secret
      secrets.forEach(secret => {
        const validation = secureTOTPGenerator.validateSecretEntropy(secret);
        expect(validation.isValid).toBe(true);
        expect(validation.entropy).toBeGreaterThanOrEqual(80); // Minimum 80 bits
        expect(['strong', 'very-strong']).toContain(validation.strength);
      });
    });

    test('should detect low entropy secrets', () => {
      const lowEntropySecrets = [
        'AAAAAAAAAAAAAAAA', // All same character
        'ABCDEFGHIJKLMNOP', // Sequential pattern
        'ABABABABABABAB',   // Repeated pattern
        'A2A2A2A2A2A2A2A2', // Simple alternating
      ];

      lowEntropySecrets.forEach(secret => {
        const validation = secureTOTPGenerator.validateSecretEntropy(secret);
        expect(validation.isValid).toBe(false);
        expect(validation.entropy).toBeLessThan(80);
        expect(validation.issues.length).toBeGreaterThan(0);
      });
    });

    test('should calculate Shannon entropy correctly', () => {
      // Test known entropy values
      const testCases = [
        { input: 'AAAAAAAA', expectedRange: [0, 10] }, // Very low entropy
        { input: 'ABABABAB', expectedRange: [8, 16] }, // Low entropy
        { input: 'ABCDEFGH', expectedRange: [20, 30] }, // Medium entropy
      ];

      testCases.forEach(({ input, expectedRange }) => {
        const validation = secureTOTPGenerator.validateSecretEntropy(input);
        expect(validation.entropy).toBeGreaterThanOrEqual(expectedRange[0]);
        expect(validation.entropy).toBeLessThanOrEqual(expectedRange[1]);
      });
    });

    test('should detect repeated patterns', () => {
      const patterned = 'ABCABC'; // Repeated pattern
      const random = secureTOTPGenerator.generateSecret();

      const patternedValidation = secureTOTPGenerator.validateSecretEntropy(patterned);
      const randomValidation = secureTOTPGenerator.validateSecretEntropy(random);

      expect(patternedValidation.issues).toContain('Contains repeated patterns');
      expect(randomValidation.issues).not.toContain('Contains repeated patterns');
    });
  });

  describe('Backup Code Entropy', () => {
    test('should generate backup codes with sufficient entropy', () => {
      const codes = secureTOTPGenerator.generateBackupCodes(50);

      // Ensure all codes are unique
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);

      // Validate entropy of each code
      codes.forEach(code => {
        expect(secureTOTPGenerator.validateBackupCodeEntropy(code)).toBe(true);
      });
    });

    test('should have good distribution across character set', () => {
      const codes = secureTOTPGenerator.generateBackupCodes(1000);
      const charCounts: { [key: string]: number } = {};

      // Count character frequencies
      codes.forEach(code => {
        for (const char of code) {
          charCounts[char] = (charCounts[char] || 0) + 1;
        }
      });

      const charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
      const expectedFreq = (codes.length * 8) / charset.length; // 8 chars per code

      // Check that character distribution is reasonably uniform
      Object.keys(charCounts).forEach(char => {
        const frequency = charCounts[char];
        const deviation = Math.abs(frequency - expectedFreq) / expectedFreq;
        expect(deviation).toBeLessThan(0.3); // Within 30% of expected frequency
      });

      // Ensure all characters in charset are used
      expect(Object.keys(charCounts).length).toBeGreaterThan(charset.length * 0.8);
    });

    test('should resist brute force attacks', () => {
      const config = secureTOTPGenerator.getBackupConfig();
      const entropyPerCode = Math.log2(Math.pow(config.charset.length, config.length));

      // Each backup code should have at least 40 bits of entropy
      expect(entropyPerCode).toBeGreaterThanOrEqual(40);

      // With 10 codes, total search space should be massive
      const totalSearchSpace = Math.pow(config.charset.length, config.length * config.count);
      expect(Math.log2(totalSearchSpace)).toBeGreaterThan(400); // > 2^400 combinations
    });
  });

  describe('Key Derivation Entropy', () => {
    test('should generate cryptographically secure salts', () => {
      const salts: Buffer[] = [];
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const salt = SecureKeyDerivation.generateSalt();
        salts.push(salt);
      }

      // Ensure all salts are unique
      const saltStrings = salts.map(s => s.toString('hex'));
      const uniqueSalts = new Set(saltStrings);
      expect(uniqueSalts.size).toBe(salts.length);

      // Calculate entropy of salt generation
      const combinedSalt = Buffer.concat(salts);
      const entropy = calculateBufferEntropy(combinedSalt);

      // Should be close to maximum entropy (8 bits per byte)
      expect(entropy).toBeGreaterThan(7.5); // > 93% of maximum entropy
    });

    test('should produce uniform distribution in derived keys', () => {
      const password = 'test-password';
      const keys: Buffer[] = [];

      for (let i = 0; i < 100; i++) {
        const salt = SecureKeyDerivation.generateSalt();
        const params = {
          password,
          salt,
          iterations: 10000, // Reduced for testing
          keyLength: 32,
          digest: 'sha256'
        };
        const key = SecureKeyDerivation.deriveKey(params);
        keys.push(key);
      }

      // Analyze byte distribution across all keys
      const byteCounts = new Array(256).fill(0);
      keys.forEach(key => {
        for (let i = 0; i < key.length; i++) {
          byteCounts[key[i]]++;
        }
      });

      const totalBytes = keys.length * 32;
      const expectedFreq = totalBytes / 256;

      // Check for uniform distribution (chi-square test approximation)
      let chiSquare = 0;
      byteCounts.forEach(count => {
        chiSquare += Math.pow(count - expectedFreq, 2) / expectedFreq;
      });

      // For 255 degrees of freedom, critical value at 95% confidence ≈ 293
      expect(chiSquare).toBeLessThan(350); // Allow some variance
    });
  });

  describe('HMAC Key Entropy', () => {
    test('should generate secure HMAC keys', () => {
      const keys: Buffer[] = [];
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        const key = cryptographicIntegrity.generateSecureKey();
        keys.push(key);
      }

      // Ensure all keys are unique
      const keyStrings = keys.map(k => k.toString('hex'));
      const uniqueKeys = new Set(keyStrings);
      expect(uniqueKeys.size).toBe(keys.length);

      // Calculate entropy
      const combinedKeys = Buffer.concat(keys);
      const entropy = calculateBufferEntropy(combinedKeys);
      expect(entropy).toBeGreaterThan(7.5);
    });

    test('should derive contextual keys with good entropy', () => {
      const masterKey = randomBytes(32);
      const contexts = [
        'user:123:mfa',
        'user:456:backup',
        'user:789:session',
        'admin:auth:token'
      ];

      const derivedKeys = contexts.map(context =>
        cryptographicIntegrity.deriveHMACKey(masterKey, context)
      );

      // Ensure all derived keys are unique
      const keyStrings = derivedKeys.map(k => k.toString('hex'));
      const uniqueKeys = new Set(keyStrings);
      expect(uniqueKeys.size).toBe(derivedKeys.length);

      // Validate entropy of derived keys
      derivedKeys.forEach(key => {
        const entropy = calculateBufferEntropy(key);
        expect(entropy).toBeGreaterThan(7.0); // Good entropy
      });
    });
  });

  describe('Random Number Generation Quality', () => {
    test('should pass basic randomness tests', () => {
      const randomData = randomBytes(10000); // 10KB of random data

      // Test 1: Frequency test (monobit test)
      let ones = 0;
      for (let i = 0; i < randomData.length; i++) {
        ones += popCount(randomData[i]);
      }
      const totalBits = randomData.length * 8;
      const ratio = ones / totalBits;

      // Should be close to 0.5 (within 1%)
      expect(Math.abs(ratio - 0.5)).toBeLessThan(0.01);

      // Test 2: Runs test (consecutive identical bits)
      let runs = 0;
      let lastBit = (randomData[0] & 0x80) ? 1 : 0;

      for (let i = 0; i < randomData.length; i++) {
        for (let bit = 7; bit >= 0; bit--) {
          const currentBit = (randomData[i] >> bit) & 1;
          if (currentBit !== lastBit) {
            runs++;
            lastBit = currentBit;
          }
        }
      }

      // Expected runs should be approximately totalBits/2
      const expectedRuns = totalBits / 2;
      const runsRatio = runs / expectedRuns;
      expect(runsRatio).toBeGreaterThan(0.9);
      expect(runsRatio).toBeLessThan(1.1);
    });

    test('should have no detectable patterns in random generation', () => {
      const samples: Buffer[] = [];

      // Generate multiple random samples
      for (let i = 0; i < 100; i++) {
        samples.push(randomBytes(32));
      }

      // Check for autocorrelation (patterns between samples)
      let correlationSum = 0;
      for (let i = 0; i < samples.length - 1; i++) {
        let correlation = 0;
        for (let j = 0; j < 32; j++) {
          correlation += (samples[i][j] ^ samples[i + 1][j]) ? 0 : 1;
        }
        correlationSum += correlation;
      }

      const avgCorrelation = correlationSum / ((samples.length - 1) * 32);
      // Should be close to 0.5 for random data
      expect(Math.abs(avgCorrelation - 0.5)).toBeLessThan(0.1);
    });
  });

  describe('Entropy Pool Validation', () => {
    test('should maintain entropy under high-frequency generation', () => {
      const secrets: string[] = [];
      const batchSizes = [10, 50, 100, 200];

      batchSizes.forEach(batchSize => {
        const batchSecrets: string[] = [];

        // Generate secrets rapidly
        for (let i = 0; i < batchSize; i++) {
          const secret = secureTOTPGenerator.generateSecret();
          batchSecrets.push(secret);
          secrets.push(secret);
        }

        // Validate uniqueness within batch
        const uniqueBatch = new Set(batchSecrets);
        expect(uniqueBatch.size).toBe(batchSize);

        // Validate entropy doesn't degrade
        batchSecrets.forEach(secret => {
          const validation = secureTOTPGenerator.validateSecretEntropy(secret);
          expect(validation.entropy).toBeGreaterThanOrEqual(80);
        });
      });

      // Overall uniqueness
      const uniqueSecrets = new Set(secrets);
      expect(uniqueSecrets.size).toBe(secrets.length);
    });
  });
});

/**
 * Helper function to calculate Shannon entropy of a buffer
 */
function calculateBufferEntropy(buffer: Buffer): number {
  const frequencies = new Array(256).fill(0);

  // Count byte frequencies
  for (let i = 0; i < buffer.length; i++) {
    frequencies[buffer[i]]++;
  }

  // Calculate Shannon entropy
  let entropy = 0;
  const length = buffer.length;

  for (let i = 0; i < 256; i++) {
    if (frequencies[i] > 0) {
      const probability = frequencies[i] / length;
      entropy -= probability * Math.log2(probability);
    }
  }

  return entropy;
}

/**
 * Helper function to count set bits in a byte
 */
function popCount(byte: number): number {
  let count = 0;
  while (byte) {
    count += byte & 1;
    byte >>= 1;
  }
  return count;
}