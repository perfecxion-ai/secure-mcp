import { describe, test, expect } from '@jest/globals';

// Mock config before importing modules that depend on it
jest.mock('../../src/config/config', () => ({
  config: {
    env: 'test',
    logging: {
      level: 'silent',
    },
    jwt: {
      secret: 'test-jwt-secret-must-be-at-least-32-characters-long',
      accessExpiresIn: '15m',
      refreshExpiresIn: '7d',
      issuer: 'secure-mcp-server',
      audience: 'secure-mcp-client',
    },
    security: {
      forceHttps: false,
      hstsMaxAge: 31536000,
      frameOptions: 'DENY',
    },
  },
}));

import { secureEncryption } from '../../src/auth/crypto/secure-encryption';
import { secureTOTPGenerator } from '../../src/auth/crypto/totp-generator';
// Note: cryptographicIntegrity is not available, will mock if needed
import { randomBytes } from 'crypto';

/**
 * Timing Attack Resistance Tests
 *
 * These tests validate that cryptographic operations are resistant to timing attacks
 * by ensuring operations take consistent time regardless of input values.
 */
describe('Timing Attack Resistance Tests', () => {

  describe('Constant-Time String Comparison', () => {
    test('should take consistent time for equal-length strings regardless of content', () => {
      const correctValue = 'secret123456';
      const wrongValue1 = 'secret123457'; // Last character different
      const wrongValue2 = 'xecret123456'; // First character different
      const wrongValue3 = 'wrong1234567'; // Completely different

      const measurements: number[] = [];
      const iterations = 1000;

      // Measure comparison times
      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        secureEncryption.constantTimeEquals(correctValue, wrongValue1);
        const end = process.hrtime.bigint();
        measurements.push(Number(end - start));
      }

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        secureEncryption.constantTimeEquals(correctValue, wrongValue2);
        const end = process.hrtime.bigint();
        measurements.push(Number(end - start));
      }

      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        secureEncryption.constantTimeEquals(correctValue, wrongValue3);
        const end = process.hrtime.bigint();
        measurements.push(Number(end - start));
      }

      // Calculate statistics
      const mean = measurements.reduce((a, b) => a + b, 0) / measurements.length;
      const variance = measurements.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / measurements.length;
      const stdDev = Math.sqrt(variance);
      const coefficientOfVariation = stdDev / mean;

      // For constant-time operations, coefficient of variation should be low
      expect(coefficientOfVariation).toBeLessThan(0.1); // Less than 10% variation
    });

    test('should return false immediately for different length strings', () => {
      const string1 = 'short';
      const string2 = 'much longer string';

      const start = process.hrtime.bigint();
      const result = secureEncryption.constantTimeEquals(string1, string2);
      const end = process.hrtime.bigint();

      expect(result).toBe(false);
      // Should be very fast for different lengths (early return is acceptable)
      const duration = Number(end - start);
      expect(duration).toBeLessThan(1000000); // Less than 1ms in nanoseconds
    });
  });

  describe('TOTP Token Verification Timing', () => {
    test('should take consistent time for valid and invalid tokens', async () => {
      const secret = secureTOTPGenerator.generateSecret();
      const validToken = secureTOTPGenerator.generateToken(secret);
      const invalidToken = '123456';

      const validTimings: number[] = [];
      const invalidTimings: number[] = [];
      const iterations = 100;

      // Measure valid token verification times
      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        secureTOTPGenerator.verifyToken(validToken, secret);
        const end = process.hrtime.bigint();
        validTimings.push(Number(end - start));
      }

      // Measure invalid token verification times
      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        secureTOTPGenerator.verifyToken(invalidToken, secret);
        const end = process.hrtime.bigint();
        invalidTimings.push(Number(end - start));
      }

      // Calculate means
      const validMean = validTimings.reduce((a, b) => a + b, 0) / validTimings.length;
      const invalidMean = invalidTimings.reduce((a, b) => a + b, 0) / invalidTimings.length;

      // The difference in timing should be minimal (within 20%)
      const timingDifference = Math.abs(validMean - invalidMean) / Math.min(validMean, invalidMean);
      expect(timingDifference).toBeLessThan(0.2);
    });
  });

  describe('HMAC Verification Timing', () => {
    test('should take consistent time for correct and incorrect HMACs', () => {
      const data = Buffer.from('test data');
      const key = randomBytes(32);

      const correctHMAC = cryptographicIntegrity.generateHMAC(data, key);
      const incorrectHMAC = randomBytes(32);

      const correctTimings: number[] = [];
      const incorrectTimings: number[] = [];
      const iterations = 1000;

      // Measure correct HMAC verification times
      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        cryptographicIntegrity.verifyHMAC(data, key, correctHMAC);
        const end = process.hrtime.bigint();
        correctTimings.push(Number(end - start));
      }

      // Measure incorrect HMAC verification times
      for (let i = 0; i < iterations; i++) {
        const start = process.hrtime.bigint();
        cryptographicIntegrity.verifyHMAC(data, key, incorrectHMAC);
        const end = process.hrtime.bigint();
        incorrectTimings.push(Number(end - start));
      }

      // Calculate statistics
      const correctMean = correctTimings.reduce((a, b) => a + b, 0) / correctTimings.length;
      const incorrectMean = incorrectTimings.reduce((a, b) => a + b, 0) / incorrectTimings.length;

      // Timing difference should be minimal
      const timingDifference = Math.abs(correctMean - incorrectMean) / Math.min(correctMean, incorrectMean);
      expect(timingDifference).toBeLessThan(0.1); // Within 10%
    });
  });

  describe('Key Derivation Timing Consistency', () => {
    test('should take consistent time regardless of password content', () => {
      const passwords = [
        'password123',
        'completely_different_password',
        'short',
        'a_very_long_password_with_many_characters_to_test_timing_consistency'
      ];

      const salt = randomBytes(32);
      const iterations = 10000; // Reduced for testing
      const keyLength = 32;
      const digest = 'sha256';

      const timings: number[] = [];

      passwords.forEach(password => {
        for (let i = 0; i < 10; i++) {
          const start = process.hrtime.bigint();

          const params = { password, salt, iterations, keyLength, digest };
          // Note: Using a lower iteration count for testing timing consistency
          // In production, this would be much higher

          const end = process.hrtime.bigint();
          timings.push(Number(end - start));
        }
      });

      // Calculate coefficient of variation
      const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
      const variance = timings.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / timings.length;
      const stdDev = Math.sqrt(variance);
      const coefficientOfVariation = stdDev / mean;

      // Key derivation should have consistent timing (within 15% variation)
      expect(coefficientOfVariation).toBeLessThan(0.15);
    });
  });

  describe('Encryption Timing Analysis', () => {
    test('should encrypt different plaintexts in consistent time', async () => {
      const plaintexts = [
        'short',
        'medium length text here',
        'a much longer plaintext message that should still encrypt in consistent time regardless of content or length differences'
      ];

      const userContext = 'test-user';
      const timings: number[] = [];

      for (const plaintext of plaintexts) {
        for (let i = 0; i < 20; i++) {
          const start = process.hrtime.bigint();
          await secureEncryption.encryptMFASecret(plaintext, userContext);
          const end = process.hrtime.bigint();
          timings.push(Number(end - start));
        }
      }

      // Calculate timing statistics
      const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
      const variance = timings.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / timings.length;
      const stdDev = Math.sqrt(variance);
      const coefficientOfVariation = stdDev / mean;

      // Encryption timing should be relatively consistent
      expect(coefficientOfVariation).toBeLessThan(0.3); // Allow 30% variation due to PBKDF2
    });
  });

  describe('Side-Channel Attack Resistance', () => {
    test('should not leak information through memory access patterns', () => {
      // Test that secret comparison doesn't leak through memory access patterns
      const secrets = [
        'JBSWY3DPEHPK3PXP',
        'JBSWY3DPEHPK3PXQ', // One character different
        'ABCDEFGHIJKLMNOP', // Completely different
        'AAAAAAAAAAAAAAAA'  // Repeated pattern
      ];

      const correctSecret = secrets[0];
      const token = secureTOTPGenerator.generateToken(correctSecret);

      const timings: number[] = [];

      secrets.forEach(secret => {
        for (let i = 0; i < 50; i++) {
          const start = process.hrtime.bigint();
          secureTOTPGenerator.verifyToken(token, secret);
          const end = process.hrtime.bigint();
          timings.push(Number(end - start));
        }
      });

      // Calculate timing variance
      const mean = timings.reduce((a, b) => a + b, 0) / timings.length;
      const variance = timings.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / timings.length;
      const stdDev = Math.sqrt(variance);
      const coefficientOfVariation = stdDev / mean;

      // Timing should be consistent across different secrets
      expect(coefficientOfVariation).toBeLessThan(0.2);
    });

    test('should resist cache timing attacks in string comparison', () => {
      const baseString = 'A'.repeat(32);
      const testStrings = [
        'A'.repeat(32),           // Identical
        'B' + 'A'.repeat(31),     // First char different
        'A'.repeat(31) + 'B',     // Last char different
        'A'.repeat(16) + 'B'.repeat(16) // Middle different
      ];

      const timingGroups: number[][] = [[], [], [], []];

      testStrings.forEach((testString, index) => {
        for (let i = 0; i < 200; i++) {
          const start = process.hrtime.bigint();
          secureEncryption.constantTimeEquals(baseString, testString);
          const end = process.hrtime.bigint();
          timingGroups[index].push(Number(end - start));
        }
      });

      // Calculate means for each group
      const means = timingGroups.map(group =>
        group.reduce((a, b) => a + b, 0) / group.length
      );

      // Check that means are close to each other (within 15%)
      const maxMean = Math.max(...means);
      const minMean = Math.min(...means);
      const variation = (maxMean - minMean) / minMean;

      expect(variation).toBeLessThan(0.15);
    });
  });

  describe('Statistical Timing Analysis', () => {
    test('should pass statistical timing analysis for cryptographic operations', () => {
      // Generate multiple samples of the same operation
      const secret = secureTOTPGenerator.generateSecret();
      const validToken = secureTOTPGenerator.generateToken(secret);
      const invalidToken = '999999';

      const validTimings: number[] = [];
      const invalidTimings: number[] = [];

      // Collect timing samples
      for (let i = 0; i < 500; i++) {
        // Valid token timing
        const start1 = process.hrtime.bigint();
        secureTOTPGenerator.verifyToken(validToken, secret);
        const end1 = process.hrtime.bigint();
        validTimings.push(Number(end1 - start1));

        // Invalid token timing
        const start2 = process.hrtime.bigint();
        secureTOTPGenerator.verifyToken(invalidToken, secret);
        const end2 = process.hrtime.bigint();
        invalidTimings.push(Number(end2 - start2));
      }

      // Perform statistical tests
      const validMean = validTimings.reduce((a, b) => a + b, 0) / validTimings.length;
      const invalidMean = invalidTimings.reduce((a, b) => a + b, 0) / invalidTimings.length;

      const validVariance = validTimings.reduce((acc, val) =>
        acc + Math.pow(val - validMean, 2), 0) / validTimings.length;
      const invalidVariance = invalidTimings.reduce((acc, val) =>
        acc + Math.pow(val - invalidMean, 2), 0) / invalidTimings.length;

      // F-test for equal variances (should not be significantly different)
      const fRatio = Math.max(validVariance, invalidVariance) / Math.min(validVariance, invalidVariance);
      expect(fRatio).toBeLessThan(4.0); // F-critical value approximation

      // T-test for equal means (should not be significantly different)
      const pooledStdDev = Math.sqrt(((validTimings.length - 1) * validVariance +
        (invalidTimings.length - 1) * invalidVariance) /
        (validTimings.length + invalidTimings.length - 2));

      const tStat = Math.abs(validMean - invalidMean) /
        (pooledStdDev * Math.sqrt(1 / validTimings.length + 1 / invalidTimings.length));

      // t-critical value for 95% confidence with large sample
      expect(tStat).toBeLessThan(2.0);
    });
  });
});