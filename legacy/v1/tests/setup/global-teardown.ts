export default async function globalTeardown(): Promise<void> {
  console.log('Tearing down test environment...');

  try {
    // Stop Redis container
    if (global.__REDIS_CONTAINER__) {
      console.log('Stopping Redis container...');
      await global.__REDIS_CONTAINER__.stop();
    }

    // Stop PostgreSQL container
    if (global.__POSTGRES_CONTAINER__) {
      console.log('Stopping PostgreSQL container...');
      await global.__POSTGRES_CONTAINER__.stop();
    }

    // Stop Vault container
    if (global.__VAULT_CONTAINER__) {
      console.log('Stopping Vault container...');
      await global.__VAULT_CONTAINER__.stop();
    }

    console.log('Test environment teardown complete!');

  } catch (error) {
    console.error('Failed to tear down test environment:', error);
    // Don't throw - let tests complete even if cleanup fails
  }
}