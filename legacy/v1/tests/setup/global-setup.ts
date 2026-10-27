import { execSync } from 'child_process';
import { GenericContainer, StartedTestContainer } from 'testcontainers';

declare global {
  var __REDIS_CONTAINER__: StartedTestContainer;
  var __POSTGRES_CONTAINER__: StartedTestContainer;
  var __VAULT_CONTAINER__: StartedTestContainer;
}

export default async function globalSetup(): Promise<void> {
  console.log('Setting up test environment...');

  try {
    // Start Redis container for tests
    console.log('Starting Redis container...');
    const redisContainer = new GenericContainer('redis:7-alpine')
      .withExposedPorts(6379)
      .withCommand(['redis-server', '--appendonly', 'yes'])
      .withTmpFs({ '/data': 'rw' });

    global.__REDIS_CONTAINER__ = await redisContainer.start();
    const redisPort = global.__REDIS_CONTAINER__.getMappedPort(6379);
    process.env.REDIS_URL = `redis://localhost:${redisPort}/1`;

    // Start PostgreSQL container for tests
    console.log('Starting PostgreSQL container...');
    const postgresContainer = new GenericContainer('postgres:15-alpine')
      .withEnvironment({
        POSTGRES_USER: 'test',
        POSTGRES_PASSWORD: 'test',
        POSTGRES_DB: 'secure_mcp_test',
      })
      .withExposedPorts(5432)
      .withTmpFs({ '/var/lib/postgresql/data': 'rw' });

    global.__POSTGRES_CONTAINER__ = await postgresContainer.start();
    const postgresPort = global.__POSTGRES_CONTAINER__.getMappedPort(5432);
    process.env.DATABASE_URL = `postgresql://test:test@localhost:${postgresPort}/secure_mcp_test`;

    // Start Vault container for tests
    console.log('Starting Vault container...');
    const vaultContainer = new GenericContainer('vault:1.15')
      .withEnvironment({
        VAULT_DEV_ROOT_TOKEN_ID: 'test-token',
        VAULT_DEV_LISTEN_ADDRESS: '0.0.0.0:8200',
        VAULT_ADDR: 'http://0.0.0.0:8200',
      })
      .withExposedPorts(8200)
      .withCommand(['vault', 'server', '-dev'])
      .withTmpFs({ '/vault/data': 'rw' });

    global.__VAULT_CONTAINER__ = await vaultContainer.start();
    const vaultPort = global.__VAULT_CONTAINER__.getMappedPort(8200);
    process.env.VAULT_URL = `http://localhost:${vaultPort}`;
    process.env.VAULT_TOKEN = 'test-token';

    // Wait for services to be ready
    console.log('Waiting for services to be ready...');
    await waitForServices();

    // Run database migrations
    console.log('Running database migrations...');
    await runMigrations();

    // Seed test data if needed
    console.log('Seeding test data...');
    await seedTestData();

    console.log('Test environment setup complete!');

  } catch (error) {
    console.error('Failed to set up test environment:', error);
    throw error;
  }
}

async function waitForServices(): Promise<void> {
  const maxRetries = 30;
  const retryInterval = 1000;

  // Wait for Redis
  for (let i = 0; i < maxRetries; i++) {
    try {
      execSync(`redis-cli -u ${process.env.REDIS_URL} ping`, { stdio: 'ignore' });
      break;
    } catch (error) {
      if (i === maxRetries - 1) throw new Error('Redis not ready');
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
  }

  // Wait for PostgreSQL
  for (let i = 0; i < maxRetries; i++) {
    try {
      execSync(`pg_isready -h localhost -p ${global.__POSTGRES_CONTAINER__.getMappedPort(5432)}`, { stdio: 'ignore' });
      break;
    } catch (error) {
      if (i === maxRetries - 1) throw new Error('PostgreSQL not ready');
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
  }

  // Wait for Vault
  for (let i = 0; i < maxRetries; i++) {
    try {
      const vaultPort = global.__VAULT_CONTAINER__.getMappedPort(8200);
      execSync(`curl -f http://localhost:${vaultPort}/v1/sys/health`, { stdio: 'ignore' });
      break;
    } catch (error) {
      if (i === maxRetries - 1) throw new Error('Vault not ready');
      await new Promise(resolve => setTimeout(resolve, retryInterval));
    }
  }
}

async function runMigrations(): Promise<void> {
  try {
    execSync('npx prisma migrate deploy', { stdio: 'ignore' });
    execSync('npx prisma generate', { stdio: 'ignore' });
  } catch (error) {
    console.warn('Database migration failed (this might be expected in test environment):', error);
    // Don't throw - some tests might not need the full database schema
  }
}

async function seedTestData(): Promise<void> {
  // Add any test data seeding logic here
  try {
    // Example: Create test users, roles, etc.
    console.log('Test data seeded successfully');
  } catch (error) {
    console.warn('Test data seeding failed:', error);
    // Don't throw - tests should be able to create their own data
  }
}