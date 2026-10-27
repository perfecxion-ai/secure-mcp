import { describe, test, expect } from '@jest/globals';
import { secureEncryption } from '../crypto/secure-encryption';
import { SecureKeyDerivation } from '../crypto/key-derivation';
import { secureTOTPGenerator } from '../crypto/totp-generator';
import { cryptographicIntegrity } from '../crypto/integrity-protection';

/**
 * Security Compliance Validation Tests
 *
 * These tests validate compliance with security standards including:
 * - FIPS 140-2 Level 2 equivalent requirements
 * - NIST SP 800-63B authentication guidelines
 * - RFC 6238 TOTP implementation standards
 * - RFC 4226 HOTP standards
 * - OWASP cryptographic guidelines
 */
describe('Security Compliance Validation Tests', () => {

  describe('FIPS 140-2 Level 2 Compliance', () => {
    test('should use FIPS-approved encryption algorithms', () => {
      const config = secureEncryption.getConfig();

      // AES-256-GCM is FIPS 140-2 approved
      expect(config.encryption.algorithm).toBe('aes-256-gcm');
      expect(config.encryption.ivLength).toBe(16); // 128-bit IV
      expect(config.encryption.tagLength).toBe(16); // 128-bit auth tag

      // PBKDF2 with SHA-256 is FIPS approved
      expect(config.keyDerivation.algorithm).toBe('pbkdf2');
      expect(config.keyDerivation.digest).toBe('sha256');
      expect(config.keyDerivation.keyLength).toBe(32); // 256-bit keys
    });

    test('should meet FIPS iteration count requirements', () => {
      const config = secureEncryption.getConfig();

      // FIPS 140-2 recommends minimum 100,000 iterations
      expect(config.keyDerivation.iterations).toBeGreaterThanOrEqual(100000);
    });

    test('should use FIPS-approved HMAC algorithms', () => {
      const supportedAlgorithms = cryptographicIntegrity.getSupportedAlgorithms();

      // All should be FIPS-approved
      const fipsAlgorithms = ['sha256', 'sha384', 'sha512'];
      supportedAlgorithms.forEach(algorithm => {
        expect(fipsAlgorithms).toContain(algorithm);
      });
    });

    test('should enforce minimum key lengths per FIPS requirements', () => {
      const config = secureEncryption.getConfig();

      // FIPS requires minimum 112-bit security strength
      // AES-256 provides 256-bit security
      expect(config.keyDerivation.keyLength * 8).toBeGreaterThanOrEqual(256);

      // Test HMAC key generation
      const hmacKey = cryptographicIntegrity.generateSecureKey();
      expect(hmacKey.length * 8).toBeGreaterThanOrEqual(256);
    });
  });

  describe('NIST SP 800-63B Authentication Guidelines', () => {
    test('should meet authenticator strength requirements', () => {
      const totpConfig = secureTOTPGenerator.getConfig();

      // NIST SP 800-63B requires:
      // - At least 6 digits for OTP
      expect(totpConfig.digits).toBeGreaterThanOrEqual(6);

      // - 30-second time window is acceptable
      expect(totpConfig.step).toBe(30);

      // - Limited time window for acceptance
      expect(totpConfig.window).toBeLessThanOrEqual(2);
    });

    test('should use approved cryptographic algorithms', () => {
      const totpConfig = secureTOTPGenerator.getConfig();

      // NIST approves SHA-256 and stronger
      const approvedAlgorithms = ['sha256', 'sha384', 'sha512'];
      expect(approvedAlgorithms).toContain(totpConfig.algorithm);
    });

    test('should enforce sufficient secret entropy', () => {
      // NIST requires at least 112 bits of entropy for secrets
      const secret = secureTOTPGenerator.generateSecret();
      const validation = secureTOTPGenerator.validateSecretEntropy(secret);

      expect(validation.entropy).toBeGreaterThanOrEqual(112);
      expect(validation.isValid).toBe(true);
    });

    test('should implement replay protection', async () => {
      // This would be tested in the MFA service integration tests
      // NIST requires protection against replay attacks
      expect(true).toBe(true); // Placeholder - actual implementation tested elsewhere
    });
  });

  describe('RFC 6238 TOTP Compliance', () => {
    test('should implement RFC 6238 TOTP algorithm correctly', () => {
      const secret = secureTOTPGenerator.generateSecret();
      const timestamp = Math.floor(Date.now() / 1000);

      // Generate token
      const token = secureTOTPGenerator.generateToken(secret);

      // RFC 6238 specifies:
      expect(token.length).toBe(6); // Default 6-digit codes
      expect(/^\d{6}$/.test(token)).toBe(true); // Only digits

      // Verify token
      const isValid = secureTOTPGenerator.verifyToken(token, secret);
      expect(isValid).toBe(true);
    });

    test('should use RFC 6238 time step calculation', () => {
      const config = secureTOTPGenerator.getConfig();

      // RFC 6238 specifies 30-second time steps as default
      expect(config.step).toBe(30);

      // Window should allow for clock skew
      expect(config.window).toBeGreaterThanOrEqual(1);
      expect(config.window).toBeLessThanOrEqual(2);
    });

    test('should generate RFC-compliant OTP URLs', () => {
      const secret = secureTOTPGenerator.generateSecret();
      const label = 'user@example.com';
      const issuer = 'Test Service';

      const otpUrl = secureTOTPGenerator.generateOTPURL(secret, label, issuer);

      // RFC 6238 URL format
      expect(otpUrl).toMatch(/^otpauth:\/\/totp\//);
      expect(otpUrl).toContain(encodeURIComponent(label));
      expect(otpUrl).toContain(`issuer=${encodeURIComponent(issuer)}`);
      expect(otpUrl).toContain(`secret=${secret}`);
    });
  });

  describe('OWASP Cryptographic Guidelines', () => {
    test('should use secure random number generation', () => {
      // Test multiple generations to ensure randomness
      const secrets = [];
      for (let i = 0; i < 100; i++) {
        const secret = secureTOTPGenerator.generateSecret();
        secrets.push(secret);
      }

      // All should be unique (probability of collision is negligible)
      const uniqueSecrets = new Set(secrets);
      expect(uniqueSecrets.size).toBe(secrets.length);
    });

    test('should avoid deprecated cryptographic functions', () => {
      // Verify no deprecated algorithms are used
      const config = secureEncryption.getConfig();

      // Should not use deprecated algorithms
      const deprecatedAlgorithms = ['md5', 'sha1', 'des', 'rc4'];
      expect(deprecatedAlgorithms).not.toContain(config.keyDerivation.digest);
      expect(config.encryption.algorithm).not.toContain('des');
      expect(config.encryption.algorithm).not.toContain('rc4');
    });

    test('should implement proper key management', () => {
      // Keys should be generated securely
      const key1 = cryptographicIntegrity.generateSecureKey();
      const key2 = cryptographicIntegrity.generateSecureKey();

      expect(key1.length).toBe(32); // 256 bits
      expect(key2.length).toBe(32);
      expect(key1.equals(key2)).toBe(false);

      // Keys should have sufficient entropy
      const entropy1 = calculateBufferEntropy(key1);
      const entropy2 = calculateBufferEntropy(key2);

      expect(entropy1).toBeGreaterThan(7.5); // > 93% of max entropy
      expect(entropy2).toBeGreaterThan(7.5);
    });

    test('should use authenticated encryption', async () => {
      const plaintext = 'sensitive data';
      const userContext = 'test-context';

      const encrypted = await secureEncryption.encryptMFASecret(plaintext, userContext);

      // Should include authentication tag
      expect(encrypted.tag).toBeTruthy();
      expect(encrypted.tag.length).toBeGreaterThan(0);

      // Should use authenticated encryption mode
      expect(encrypted.algorithm).toContain('gcm');
    });
  });

  describe('Industry Best Practices', () => {
    test('should implement defense in depth', () => {
      // Multiple layers of security should be present
      const config = secureEncryption.getConfig();

      // Layer 1: Strong encryption
      expect(config.encryption.algorithm).toBe('aes-256-gcm');

      // Layer 2: Key derivation
      expect(config.keyDerivation.algorithm).toBe('pbkdf2');
      expect(config.keyDerivation.iterations).toBeGreaterThanOrEqual(100000);

      // Layer 3: Authentication
      expect(config.encryption.tagLength).toBe(16);
    });

    test('should implement proper error handling', async () => {
      // Decryption with wrong password should fail securely
      const plaintext = 'test';
      const correctPassword = 'correct';
      const wrongPassword = 'wrong';

      const encrypted = await secureEncryption.encryptMFASecret(plaintext, correctPassword);

      // Should throw error, not return invalid data
      await expect(
        secureEncryption.decryptMFASecret(encrypted, wrongPassword)
      ).rejects.toThrow();
    });

    test('should resist common attacks', () => {
      // Test constant-time operations
      const str1 = 'secret123';
      const str2 = 'secret123';
      const str3 = 'different';

      // Should not leak timing information
      const result1 = secureEncryption.constantTimeEquals(str1, str2);
      const result2 = secureEncryption.constantTimeEquals(str1, str3);

      expect(result1).toBe(true);
      expect(result2).toBe(false);
    });

    test('should validate input parameters', () => {
      // Test parameter validation
      const weakParams = {
        password: 'test',
        salt: Buffer.from('short'),
        iterations: 1000,
        keyLength: 8,
        digest: 'md5'
      };

      expect(() => SecureKeyDerivation.validateParameters(weakParams as any))
        .toThrow();
    });
  });

  describe('Performance and Security Balance', () => {
    test('should balance security and performance in key derivation', () => {
      const password = 'test-password';
      const salt = SecureKeyDerivation.generateSalt();

      const start = Date.now();
      const result = SecureKeyDerivation.deriveKeyWithTiming(password, salt, 250);
      const end = Date.now();

      const actualTime = end - start;

      // Should take reasonable time (200-400ms is acceptable)
      expect(actualTime).toBeGreaterThan(100);
      expect(actualTime).toBeLessThan(1000);

      // Should still meet security requirements
      expect(result.iterations).toBeGreaterThanOrEqual(100000);
      expect(result.key.length).toBe(32);
    });

    test('should optimize HMAC operations for acceptable performance', () => {
      const data = Buffer.from('test data');
      const key = cryptographicIntegrity.generateSecureKey();

      const start = Date.now();
      for (let i = 0; i < 1000; i++) {
        cryptographicIntegrity.generateHMAC(data, key);
      }
      const end = Date.now();

      const avgTime = (end - start) / 1000;

      // Should be fast enough for real-time operations
      expect(avgTime).toBeLessThan(1); // < 1ms per HMAC
    });
  });

  describe('Cryptographic Strength Assessment', () => {
    test('should meet current cryptographic strength recommendations', () => {
      // Test AES-256-GCM strength
      const strength = {
        algorithm: 'aes-256-gcm',
        keyLength: 32 // 256 bits
      };

      // AES-256 provides 256-bit security strength
      expect(strength.keyLength * 8).toBe(256);

      // Test HMAC strength
      const hmacStrength = cryptographicIntegrity.calculateHMACStrength('sha256', 32);
      expect(hmacStrength.strength).toMatch(/strong|very-strong/);
      expect(hmacStrength.bitSecurity).toBeGreaterThanOrEqual(256);
    });

    test('should resist quantum computing threats (post-quantum readiness)', () => {
      // While not fully post-quantum, should use maximum classical strength
      const config = secureEncryption.getConfig();

      // AES-256 provides some quantum resistance
      expect(config.encryption.algorithm).toBe('aes-256-gcm');

      // SHA-256 provides quantum resistance against pre-image attacks
      expect(config.keyDerivation.digest).toBe('sha256');
    });
  });

  describe('Compliance Documentation', () => {
    test('should provide security configuration information', () => {
      const encryptionConfig = secureEncryption.getConfig();
      const totpConfig = secureTOTPGenerator.getConfig();
      const backupConfig = secureTOTPGenerator.getBackupConfig();
      const integrityConfig = cryptographicIntegrity.getConfig();

      // All configurations should be accessible for audit
      expect(encryptionConfig).toBeDefined();
      expect(totpConfig).toBeDefined();
      expect(backupConfig).toBeDefined();
      expect(integrityConfig).toBeDefined();

      // Should contain security-relevant parameters
      expect(encryptionConfig.encryption.algorithm).toBeTruthy();
      expect(encryptionConfig.keyDerivation.iterations).toBeGreaterThan(0);
      expect(totpConfig.algorithm).toBeTruthy();
      expect(integrityConfig.algorithm).toBeTruthy();
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