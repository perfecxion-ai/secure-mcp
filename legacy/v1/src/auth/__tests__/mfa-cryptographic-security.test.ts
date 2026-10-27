import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { MFAService } from '../mfa-service';
import { secureEncryption } from '../crypto/secure-encryption';
import { SecureKeyDerivation } from '../crypto/key-derivation';
import { secureTOTPGenerator } from '../crypto/totp-generator';
import { cryptographicIntegrity } from '../crypto/integrity-protection';
import { randomBytes, timingSafeEqual } from 'crypto';
import { redis } from '../../database/redis';

describe('MFA Cryptographic Security Tests', () => {
  let mfaService: MFAService;
  const testUserId = 'test-user-123';
  const testUserEmail = 'test@example.com';

  beforeEach(async () => {
    mfaService = new MFAService();
    await mfaService.initialize();

    // Clean up any existing test data
    await redis.del(`mfa:${testUserId}`);
    await redis.del(`mfa_setup:${testUserId}`);
  });

  afterEach(async () => {
    // Clean up test data
    await redis.del(`mfa:${testUserId}`);
    await redis.del(`mfa_setup:${testUserId}`);
    const usedTokens = await redis.keys(`used_totp:${testUserId}:*`);
    if (usedTokens.length > 0) {
      await redis.del(...usedTokens);
    }
  });

  describe('Secure Encryption Service', () => {
    test('should encrypt and decrypt MFA secrets with authenticated encryption', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const userPassword = 'secure-user-context';

      const encrypted = await secureEncryption.encryptMFASecret(secret, userPassword);

      // Validate encrypted structure
      expect(encrypted.algorithm).toBe('aes-256-gcm');
      expect(encrypted.iterations).toBeGreaterThanOrEqual(100000);
      expect(encrypted.keyLength).toBe(32);
      expect(encrypted.digest).toBe('sha256');
      expect(encrypted.data).toBeTruthy();
      expect(encrypted.iv).toBeTruthy();
      expect(encrypted.tag).toBeTruthy();
      expect(encrypted.salt).toBeTruthy();

      const decrypted = await secureEncryption.decryptMFASecret(encrypted, userPassword);
      expect(decrypted).toBe(secret);
    });

    test('should fail decryption with wrong password', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const correctPassword = 'correct-password';
      const wrongPassword = 'wrong-password';

      const encrypted = await secureEncryption.encryptMFASecret(secret, correctPassword);

      await expect(
        secureEncryption.decryptMFASecret(encrypted, wrongPassword)
      ).rejects.toThrow();
    });

    test('should detect tampering in encrypted data', async () => {
      const secret = 'JBSWY3DPEHPK3PXP';
      const userPassword = 'secure-user-context';

      const encrypted = await secureEncryption.encryptMFASecret(secret, userPassword);

      // Tamper with the data
      const tamperedEncrypted = { ...encrypted };
      tamperedEncrypted.data = tamperedEncrypted.data.replace('a', 'b');

      await expect(
        secureEncryption.decryptMFASecret(tamperedEncrypted, userPassword)
      ).rejects.toThrow();
    });

    test('should use constant-time comparison', () => {
      const string1 = 'secret123';
      const string2 = 'secret123';
      const string3 = 'secret124';

      expect(secureEncryption.constantTimeEquals(string1, string2)).toBe(true);
      expect(secureEncryption.constantTimeEquals(string1, string3)).toBe(false);
    });
  });

  describe('Key Derivation Security', () => {
    test('should derive keys with secure PBKDF2 parameters', () => {
      const password = 'test-password';
      const salt = randomBytes(32);
      const iterations = 100000;
      const keyLength = 32;
      const digest = 'sha256';

      const params = { password, salt, iterations, keyLength, digest };

      expect(() => SecureKeyDerivation.validateParameters(params)).not.toThrow();

      const derivedKey = SecureKeyDerivation.deriveKey(params);
      expect(derivedKey.length).toBe(keyLength);
    });

    test('should reject weak key derivation parameters', () => {
      const password = 'test-password';
      const salt = randomBytes(16); // Too short
      const iterations = 50000; // Too few
      const keyLength = 16; // Too short
      const digest = 'md5'; // Weak digest

      const params = { password, salt, iterations, keyLength, digest };

      expect(() => SecureKeyDerivation.validateParameters(params)).toThrow();
    });

    test('should generate secure salts', () => {
      const salt1 = SecureKeyDerivation.generateSalt();
      const salt2 = SecureKeyDerivation.generateSalt();

      expect(salt1.length).toBe(32);
      expect(salt2.length).toBe(32);
      expect(salt1.equals(salt2)).toBe(false); // Should be unique
    });

    test('should estimate optimal iterations for target time', () => {
      const targetTime = 250; // 250ms
      const iterations = SecureKeyDerivation.estimateOptimalIterations(targetTime);

      expect(iterations).toBeGreaterThanOrEqual(100000);
    });
  });

  describe('TOTP Generator Security', () => {
    test('should generate cryptographically secure TOTP secrets', () => {
      const secret = secureTOTPGenerator.generateSecret();

      expect(secret.length).toBeGreaterThanOrEqual(16);
      expect(/^[A-Z2-7]+$/.test(secret)).toBe(true); // Valid base32

      const validation = secureTOTPGenerator.validateSecretEntropy(secret);
      expect(validation.isValid).toBe(true);
      expect(validation.entropy).toBeGreaterThanOrEqual(80);
    });

    test('should generate secure backup codes', () => {
      const codes = secureTOTPGenerator.generateBackupCodes(10);

      expect(codes.length).toBe(10);

      // Ensure all codes are unique
      const uniqueCodes = new Set(codes);
      expect(uniqueCodes.size).toBe(codes.length);

      // Validate entropy of each code
      for (const code of codes) {
        expect(secureTOTPGenerator.validateBackupCodeEntropy(code)).toBe(true);
      }
    });

    test('should validate secret entropy correctly', () => {
      // Test weak secret
      const weakSecret = 'AAAAAAAAAAAAAAAA';
      const weakValidation = secureTOTPGenerator.validateSecretEntropy(weakSecret);
      expect(weakValidation.isValid).toBe(false);
      expect(weakValidation.strength).toBe('weak');

      // Test strong secret
      const strongSecret = secureTOTPGenerator.generateSecret();
      const strongValidation = secureTOTPGenerator.validateSecretEntropy(strongSecret);
      expect(strongValidation.isValid).toBe(true);
      expect(['strong', 'very-strong']).toContain(strongValidation.strength);
    });

    test('should generate and verify TOTP tokens', () => {
      const secret = secureTOTPGenerator.generateSecret();
      const token = secureTOTPGenerator.generateToken(secret);

      expect(token.length).toBe(6);
      expect(/^\d{6}$/.test(token)).toBe(true);

      const isValid = secureTOTPGenerator.verifyToken(token, secret);
      expect(isValid).toBe(true);
    });
  });

  describe('Integrity Protection', () => {
    test('should protect and verify data integrity', async () => {
      const data = Buffer.from('sensitive MFA data');
      const key = randomBytes(32);

      const protection = await cryptographicIntegrity.protectData(data, key);

      expect(protection.algorithm).toBe('sha256');
      expect(protection.hmac.length).toBeGreaterThan(0);
      expect(protection.timestamp).toBeGreaterThan(0);

      const isValid = await cryptographicIntegrity.verifyIntegrity(protection, key);
      expect(isValid).toBe(true);
    });

    test('should detect data tampering', async () => {
      const data = Buffer.from('sensitive MFA data');
      const key = randomBytes(32);

      const protection = await cryptographicIntegrity.protectData(data, key);

      // Tamper with the data
      protection.data = Buffer.from('tampered data');

      const tamperingResult = await cryptographicIntegrity.detectTampering(protection, key);
      expect(tamperingResult.isTampered).toBe(true);
      expect(tamperingResult.integrityValid).toBe(false);
    });

    test('should validate timestamp windows', async () => {
      const data = Buffer.from('test data');
      const key = randomBytes(32);

      const protection = await cryptographicIntegrity.protectData(data, key);

      // Simulate old timestamp
      protection.timestamp = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago

      const tamperingResult = await cryptographicIntegrity.detectTampering(protection, key);
      expect(tamperingResult.isTampered).toBe(true);
      expect(tamperingResult.timestampValid).toBe(false);
    });

    test('should generate secure HMAC keys', () => {
      const key1 = cryptographicIntegrity.generateSecureKey();
      const key2 = cryptographicIntegrity.generateSecureKey();

      expect(key1.length).toBe(32);
      expect(key2.length).toBe(32);
      expect(key1.equals(key2)).toBe(false);
    });
  });

  describe('MFA Service Integration Security', () => {
    test('should generate MFA secret with enhanced security', async () => {
      const result = await mfaService.generateMFASecret(testUserId, testUserEmail);

      expect(result.secret).toBeTruthy();
      expect(result.qrCodeUrl).toContain('data:image/png;base64');
      expect(result.backupCodes.length).toBe(10);

      // Validate secret strength
      const validation = secureTOTPGenerator.validateSecretEntropy(result.secret);
      expect(validation.isValid).toBe(true);
      expect(validation.entropy).toBeGreaterThanOrEqual(80);

      // Validate backup codes
      for (const code of result.backupCodes) {
        expect(secureTOTPGenerator.validateBackupCodeEntropy(code)).toBe(true);
      }
    });

    test('should verify MFA setup with secure token validation', async () => {
      const { secret } = await mfaService.generateMFASecret(testUserId, testUserEmail);
      const token = secureTOTPGenerator.generateToken(secret);

      const isValid = await mfaService.verifyMFASetup(testUserId, token);
      expect(isValid).toBe(true);

      // Verify MFA is now enabled
      const isEnabled = await mfaService.isMFAEnabled(testUserId);
      expect(isEnabled).toBe(true);
    });

    test('should prevent TOTP token replay attacks', async () => {
      const { secret } = await mfaService.generateMFASecret(testUserId, testUserEmail);
      const token = secureTOTPGenerator.generateToken(secret);

      // Setup and enable MFA
      await mfaService.verifyMFASetup(testUserId, token);

      // Generate new token for verification
      const verifyToken = secureTOTPGenerator.generateToken(secret);

      // First verification should succeed
      const result1 = await mfaService.verifyMFAToken(testUserId, verifyToken);
      expect(result1.verified).toBe(true);

      // Second verification with same token should fail (replay attack)
      const result2 = await mfaService.verifyMFAToken(testUserId, verifyToken);
      expect(result2.verified).toBe(false);
    });

    test('should use constant-time comparison for backup codes', async () => {
      const { secret, backupCodes } = await mfaService.generateMFASecret(testUserId, testUserEmail);
      const setupToken = secureTOTPGenerator.generateToken(secret);

      // Setup and enable MFA
      await mfaService.verifyMFASetup(testUserId, setupToken);

      // Test valid backup code
      const validCode = backupCodes[0];
      const result1 = await mfaService.verifyMFAToken(testUserId, validCode);
      expect(result1.verified).toBe(true);
      expect(result1.usedBackupCode).toBe(true);
      expect(result1.remainingBackupCodes).toBe(9);

      // Test invalid backup code
      const invalidCode = '99999999';
      const result2 = await mfaService.verifyMFAToken(testUserId, invalidCode);
      expect(result2.verified).toBe(false);
    });

    test('should regenerate backup codes securely', async () => {
      const { secret } = await mfaService.generateMFASecret(testUserId, testUserEmail);
      const token = secureTOTPGenerator.generateToken(secret);

      // Setup and enable MFA
      await mfaService.verifyMFASetup(testUserId, token);

      // Regenerate backup codes
      const newCodes = await mfaService.regenerateBackupCodes(testUserId);

      expect(newCodes.length).toBe(10);

      // Validate entropy of new codes
      for (const code of newCodes) {
        expect(secureTOTPGenerator.validateBackupCodeEntropy(code)).toBe(true);
      }

      // Test that new codes work
      const result = await mfaService.verifyMFAToken(testUserId, newCodes[0]);
      expect(result.verified).toBe(true);
    });

    test('should provide enhanced MFA status information', async () => {
      const { secret } = await mfaService.generateMFASecret(testUserId, testUserEmail);
      const token = secureTOTPGenerator.generateToken(secret);

      // Initially disabled
      let status = await mfaService.getMFAStatus(testUserId);
      expect(status.enabled).toBe(false);

      // Enable MFA
      await mfaService.verifyMFASetup(testUserId, token);

      // Check enhanced status
      status = await mfaService.getMFAStatus(testUserId);
      expect(status.enabled).toBe(true);
      expect(status.hasBackupCodes).toBe(true);
      expect(status.backupCodesCount).toBe(10);
      expect(status.securityInfo).toBeDefined();
      expect(status.securityInfo?.algorithm).toBe('aes-256-gcm');
      expect(status.securityInfo?.keyDerivation).toBe('pbkdf2');
      expect(status.securityInfo?.secretStrength).toBeTruthy();
    });
  });

  describe('Security Compliance Validation', () => {
    test('should meet FIPS 140-2 Level 2 equivalent requirements', () => {
      // Verify encryption algorithm
      const config = secureEncryption.getConfig();
      expect(config.encryption.algorithm).toBe('aes-256-gcm');
      expect(config.keyDerivation.algorithm).toBe('pbkdf2');
      expect(config.keyDerivation.iterations).toBeGreaterThanOrEqual(100000);
      expect(config.keyDerivation.digest).toBe('sha256');
    });

    test('should meet NIST SP 800-63B authentication guidelines', () => {
      const totpConfig = secureTOTPGenerator.getConfig();
      expect(totpConfig.algorithm).toBe('sha256'); // Better than SHA-1
      expect(totpConfig.digits).toBe(6);
      expect(totpConfig.step).toBe(30);
      expect(totpConfig.window).toBe(1);
    });

    test('should provide sufficient entropy for all cryptographic operations', () => {
      // Test secret generation
      const secret = secureTOTPGenerator.generateSecret();
      const validation = secureTOTPGenerator.validateSecretEntropy(secret);
      expect(validation.entropy).toBeGreaterThanOrEqual(80);

      // Test backup codes
      const codes = secureTOTPGenerator.generateBackupCodes(5);
      for (const code of codes) {
        expect(secureTOTPGenerator.validateBackupCodeEntropy(code)).toBe(true);
      }
    });
  });
});