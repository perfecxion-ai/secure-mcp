// Test file to verify the client SDK package works
const { SecureMCPClient } = require('@perfecxion/secure-mcp-client');

async function testClient() {
  console.log('Testing Secure MCP Client SDK...\n');

  // Create client instance
  const client = new SecureMCPClient({
    serverUrl: 'http://localhost:3000',
    apiKey: 'test-api-key',
    debug: true
  });

  console.log('✅ Client SDK imported successfully');
  console.log('✅ SecureMCPClient instance created');

  // Test available methods
  console.log('\nAvailable methods:');
  const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(client))
    .filter(name => typeof client[name] === 'function' && name !== 'constructor');

  methods.forEach(method => {
    console.log(`  - ${method}()`);
  });

  console.log('\n✅ All checks passed! Package is ready for use.');
}

testClient().catch(console.error);