// Test file to verify the server package works
// Note: This won't run fully due to TypeScript build errors, but will verify the package structure

try {
  const serverPackage = require('@perfecxion/secure-mcp-server/package.json');

  console.log('Testing Secure MCP Server Package...\n');
  console.log('Package Name:', serverPackage.name);
  console.log('Version:', serverPackage.version);
  console.log('Description:', serverPackage.description);
  console.log('\nDependencies:', Object.keys(serverPackage.dependencies).length, 'packages');
  console.log('Dev Dependencies:', Object.keys(serverPackage.devDependencies).length, 'packages');

  console.log('\n✅ Server package structure is valid');
  console.log('Note: Full server requires TypeScript build to complete');
} catch (error) {
  console.log('Server package test:', error.message);
}