import nodeVault from 'node-vault';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import crypto from 'crypto';

export interface VaultSecret {
  [key: string]: any;
}

export interface VaultHealth {
  initialized: boolean;
  sealed: boolean;
  standby: boolean;
  performanceStandby: boolean;
  replicationPerformanceMode: string;
  replicationDrMode: string;
  serverTimeUtc: number;
  version: string;
}

export interface EncryptionResult {
  ciphertext: string;
  keyVersion: number;
}

export interface DecryptionResult {
  plaintext: string;
}

class VaultService {
  private client: any;
  private initialized: boolean = false;
  private transitKeyName: string = 'mcp-encryption-key';

  /**
   * Initialize Vault client
   */
  public async initialize(): Promise<void> {
    try {
      this.client = nodeVault({
        apiVersion: 'v1',
        endpoint: config.vault.url,
        token: config.vault.token,
        namespace: config.vault.namespace,
        requestOptions: {
          timeout: config.vault.timeout,
        },
      });

      // Test connection
      await this.health();

      // Initialize transit engine if not exists
      await this.initializeTransitEngine();

      // Create encryption key if not exists
      await this.createEncryptionKey();

      this.initialized = true;

      logger.info('Vault client initialized successfully', {
        endpoint: config.vault.url,
        namespace: config.vault.namespace,
        kvMount: config.vault.kvMount,
      });

    } catch (error) {
      logger.error('Failed to initialize Vault client', { error });
      throw new Error(`Vault initialization failed: ${error.message}`);
    }
  }

  /**
   * Check Vault health status
   */
  public async health(): Promise<VaultHealth> {
    try {
      const response = await this.client.health();
      return response;
    } catch (error) {
      logger.error('Vault health check failed', { error });
      throw new Error(`Vault health check failed: ${error.message}`);
    }
  }

  /**
   * Read secret from KV store
   */
  public async read(path: string): Promise<VaultSecret | null> {
    try {
      this.ensureInitialized();

      const fullPath = `${config.vault.kvMount}/data/${path}`;
      const response = await this.client.read(fullPath);

      if (!response || !response.data || !response.data.data) {
        return null;
      }

      logger.debug('Secret read from Vault', { path });
      return response.data.data;

    } catch (error) {
      if (error.response?.status === 404) {
        logger.debug('Secret not found in Vault', { path });
        return null;
      }

      logger.error('Failed to read secret from Vault', { error, path });
      throw new Error(`Failed to read secret: ${error.message}`);
    }
  }

  /**
   * Write secret to KV store
   */
  public async write(path: string, secret: VaultSecret): Promise<void> {
    try {
      this.ensureInitialized();

      const fullPath = `${config.vault.kvMount}/data/${path}`;
      await this.client.write(fullPath, {
        data: secret,
      });

      logger.info('Secret written to Vault', { path });

    } catch (error) {
      logger.error('Failed to write secret to Vault', { error, path });
      throw new Error(`Failed to write secret: ${error.message}`);
    }
  }

  /**
   * Delete secret from KV store
   */
  public async delete(path: string): Promise<void> {
    try {
      this.ensureInitialized();

      const fullPath = `${config.vault.kvMount}/data/${path}`;
      await this.client.delete(fullPath);

      logger.info('Secret deleted from Vault', { path });

    } catch (error) {
      logger.error('Failed to delete secret from Vault', { error, path });
      throw new Error(`Failed to delete secret: ${error.message}`);
    }
  }

  /**
   * List secrets at path
   */
  public async list(path: string): Promise<string[]> {
    try {
      this.ensureInitialized();

      const fullPath = `${config.vault.kvMount}/metadata/${path}`;
      const response = await this.client.list(fullPath);

      if (!response || !response.data || !response.data.keys) {
        return [];
      }

      return response.data.keys;

    } catch (error) {
      if (error.response?.status === 404) {
        return [];
      }

      logger.error('Failed to list secrets from Vault', { error, path });
      throw new Error(`Failed to list secrets: ${error.message}`);
    }
  }

  /**
   * Encrypt data using Vault's transit engine
   */
  public async encrypt(plaintext: string, context?: string): Promise<EncryptionResult> {
    try {
      this.ensureInitialized();

      const requestData: any = {
        plaintext: Buffer.from(plaintext).toString('base64'),
      };

      if (context) {
        requestData.context = Buffer.from(context).toString('base64');
      }

      const response = await this.client.write(
        `transit/encrypt/${this.transitKeyName}`,
        requestData
      );

      return {
        ciphertext: response.data.ciphertext,
        keyVersion: response.data.key_version,
      };

    } catch (error) {
      logger.error('Failed to encrypt data with Vault', { error });
      throw new Error(`Encryption failed: ${error.message}`);
    }
  }

  /**
   * Decrypt data using Vault's transit engine
   */
  public async decrypt(ciphertext: string, context?: string): Promise<DecryptionResult> {
    try {
      this.ensureInitialized();

      const requestData: any = {
        ciphertext,
      };

      if (context) {
        requestData.context = Buffer.from(context).toString('base64');
      }

      const response = await this.client.write(
        `transit/decrypt/${this.transitKeyName}`,
        requestData
      );

      return {
        plaintext: Buffer.from(response.data.plaintext, 'base64').toString(),
      };

    } catch (error) {
      logger.error('Failed to decrypt data with Vault', { error });
      throw new Error(`Decryption failed: ${error.message}`);
    }
  }

  /**
   * Generate random data using Vault
   */
  public async generateRandomData(bytes: number = 32): Promise<string> {
    try {
      this.ensureInitialized();

      const response = await this.client.write('sys/tools/random', {
        bytes,
        format: 'base64',
      });

      return response.data.random_bytes;

    } catch (error) {
      logger.error('Failed to generate random data from Vault', { error });
      throw new Error(`Random data generation failed: ${error.message}`);
    }
  }

  /**
   * Generate cryptographic hash using Vault
   */
  public async hash(input: string, algorithm: string = 'sha2-256'): Promise<string> {
    try {
      this.ensureInitialized();

      const response = await this.client.write('sys/tools/hash', {
        input: Buffer.from(input).toString('base64'),
        algorithm,
      });

      return response.data.sum;

    } catch (error) {
      logger.error('Failed to hash data with Vault', { error });
      throw new Error(`Hashing failed: ${error.message}`);
    }
  }

  /**
   * Create database credentials dynamically
   */
  public async createDatabaseCredentials(role: string, ttl: string = '1h'): Promise<{
    username: string;
    password: string;
    lease_id: string;
    lease_duration: number;
  }> {
    try {
      this.ensureInitialized();

      const response = await this.client.write(`database/creds/${role}`, {
        ttl,
      });

      return {
        username: response.data.username,
        password: response.data.password,
        lease_id: response.lease_id,
        lease_duration: response.lease_duration,
      };

    } catch (error) {
      logger.error('Failed to create database credentials', { error, role });
      throw new Error(`Database credential creation failed: ${error.message}`);
    }
  }

  /**
   * Revoke database credentials
   */
  public async revokeDatabaseCredentials(leaseId: string): Promise<void> {
    try {
      this.ensureInitialized();

      await this.client.write('sys/leases/revoke', {
        lease_id: leaseId,
      });

      logger.info('Database credentials revoked', { leaseId });

    } catch (error) {
      logger.error('Failed to revoke database credentials', { error, leaseId });
      throw new Error(`Credential revocation failed: ${error.message}`);
    }
  }

  /**
   * Renew database credentials lease
   */
  public async renewDatabaseCredentials(leaseId: string, increment?: string): Promise<{
    lease_id: string;
    lease_duration: number;
    renewable: boolean;
  }> {
    try {
      this.ensureInitialized();

      const requestData: any = { lease_id: leaseId };
      if (increment) {
        requestData.increment = increment;
      }

      const response = await this.client.write('sys/leases/renew', requestData);

      return {
        lease_id: response.lease_id,
        lease_duration: response.lease_duration,
        renewable: response.renewable,
      };

    } catch (error) {
      logger.error('Failed to renew database credentials', { error, leaseId });
      throw new Error(`Credential renewal failed: ${error.message}`);
    }
  }

  /**
   * Create PKI certificate
   */
  public async createCertificate(commonName: string, role: string, options?: {
    altNames?: string[];
    ipSans?: string[];
    ttl?: string;
    format?: 'pem' | 'der' | 'pem_bundle';
  }): Promise<{
    certificate: string;
    issuing_ca: string;
    ca_chain: string[];
    private_key: string;
    private_key_type: string;
    serial_number: string;
  }> {
    try {
      this.ensureInitialized();

      const requestData: any = {
        common_name: commonName,
        ...options,
      };

      if (options?.altNames) {
        requestData.alt_names = options.altNames.join(',');
      }

      if (options?.ipSans) {
        requestData.ip_sans = options.ipSans.join(',');
      }

      const response = await this.client.write(`pki/issue/${role}`, requestData);

      logger.info('Certificate created', { commonName, role });

      return response.data;

    } catch (error) {
      logger.error('Failed to create certificate', { error, commonName, role });
      throw new Error(`Certificate creation failed: ${error.message}`);
    }
  }

  /**
   * Revoke PKI certificate
   */
  public async revokeCertificate(serialNumber: string): Promise<void> {
    try {
      this.ensureInitialized();

      await this.client.write('pki/revoke', {
        serial_number: serialNumber,
      });

      logger.info('Certificate revoked', { serialNumber });

    } catch (error) {
      logger.error('Failed to revoke certificate', { error, serialNumber });
      throw new Error(`Certificate revocation failed: ${error.message}`);
    }
  }

  /**
   * Get Vault token information
   */
  public async getTokenInfo(): Promise<any> {
    try {
      this.ensureInitialized();

      const response = await this.client.read('auth/token/lookup-self');
      return response.data;

    } catch (error) {
      logger.error('Failed to get token info', { error });
      throw new Error(`Token info retrieval failed: ${error.message}`);
    }
  }

  /**
   * Renew Vault token
   */
  public async renewToken(increment?: string): Promise<void> {
    try {
      this.ensureInitialized();

      const requestData: any = {};
      if (increment) {
        requestData.increment = increment;
      }

      await this.client.write('auth/token/renew-self', requestData);

      logger.info('Vault token renewed', { increment });

    } catch (error) {
      logger.error('Failed to renew token', { error });
      throw new Error(`Token renewal failed: ${error.message}`);
    }
  }

  /**
   * Initialize transit encryption engine
   */
  private async initializeTransitEngine(): Promise<void> {
    try {
      // Check if transit engine is already enabled
      const mounts = await this.client.read('sys/mounts');

      if (!mounts.data['transit/']) {
        // Enable transit engine
        await this.client.write('sys/mounts/transit', {
          type: 'transit',
          description: 'Transit encryption engine for MCP server',
        });

        logger.info('Transit encryption engine enabled');
      }

    } catch (error) {
      // If we can't enable transit engine, log but don't fail
      // It might already be enabled or we might not have permissions
      logger.warn('Could not initialize transit engine', { error: error.message });
    }
  }

  /**
   * Create encryption key for transit engine
   */
  private async createEncryptionKey(): Promise<void> {
    try {
      // Try to read the key first
      try {
        await this.client.read(`transit/keys/${this.transitKeyName}`);
        return; // Key already exists
      } catch (error) {
        if (error.response?.status !== 404) {
          throw error;
        }
      }

      // Create the encryption key
      await this.client.write(`transit/keys/${this.transitKeyName}`, {
        type: 'aes256-gcm96',
        deletion_allowed: false,
        exportable: false,
      });

      logger.info('Transit encryption key created', { keyName: this.transitKeyName });

    } catch (error) {
      logger.warn('Could not create encryption key', { error: error.message });
    }
  }

  /**
   * Ensure Vault client is initialized
   */
  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new Error('Vault client not initialized');
    }
  }

  /**
   * Get Vault status
   */
  public async getStatus(): Promise<{
    initialized: boolean;
    sealed: boolean;
    clusterName?: string;
    clusterId?: string;
    version: string;
  }> {
    try {
      const health = await this.health();
      const status = await this.client.read('sys/seal-status');

      return {
        initialized: health.initialized,
        sealed: health.sealed,
        clusterName: status.data.cluster_name,
        clusterId: status.data.cluster_id,
        version: health.version,
      };

    } catch (error) {
      logger.error('Failed to get Vault status', { error });
      throw error;
    }
  }

  /**
   * Setup automatic token renewal
   */
  public async setupTokenRenewal(): Promise<void> {
    try {
      const tokenInfo = await this.getTokenInfo();
      const renewable = tokenInfo.renewable;
      const ttl = tokenInfo.ttl;

      if (renewable && ttl > 0) {
        // Renew token when it's 2/3 expired
        const renewInterval = (ttl * 2/3) * 1000;

        setInterval(async () => {
          try {
            await this.renewToken();
            logger.info('Vault token auto-renewed');
          } catch (error) {
            logger.error('Failed to auto-renew Vault token', { error });
          }
        }, renewInterval);

        logger.info('Automatic token renewal setup', { renewInterval: renewInterval / 1000 });
      }

    } catch (error) {
      logger.warn('Could not setup token renewal', { error: error.message });
    }
  }

  /**
   * Check if Vault is properly configured
   */
  public isConfigured(): boolean {
    return !!config.vault.url && !!config.vault.token;
  }

  /**
   * Check if Vault client is initialized
   */
  public isInitialized(): boolean {
    return this.initialized;
  }
}

// Create singleton instance
export const vault = new VaultService();

// Initialize Vault connection
export const initializeVault = async (): Promise<void> => {
  if (!vault.isConfigured()) {
    logger.warn('Vault not configured, skipping initialization');
    return;
  }

  try {
    await vault.initialize();
    await vault.setupTokenRenewal();
    logger.info('Vault initialization completed');
  } catch (error) {
    logger.error('Vault initialization failed', { error });
    throw error;
  }
};

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('Received SIGTERM, Vault client cleanup complete');
});

process.on('SIGINT', () => {
  logger.info('Received SIGINT, Vault client cleanup complete');
});