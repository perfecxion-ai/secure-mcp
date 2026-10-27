import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { VERSION } from '../dist/index.js';

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const server = JSON.parse(await readFile('server.json', 'utf8'));
assert.equal(pkg.version, VERSION);
assert.equal(server.version, pkg.version);
assert.equal(server.name, pkg.mcpName);
assert.equal(server.packages.length, 1);
assert.equal(server.packages[0].identifier, pkg.name);
assert.equal(server.packages[0].version, pkg.version);
assert.equal(server.packages[0].transport.type, 'stdio');
assert.equal(server.packages[0].packageArguments[0].name, '--workspace');
assert.equal(server.packages[0].packageArguments[0].isRequired, true);
assert.equal(pkg.license, 'AGPL-3.0-or-later');
assert.equal(pkg.publishConfig.tag, 'alpha');
assert.deepEqual(pkg.os, ['linux']);
await access(pkg.bin['secure-mcp']);
const publication = await readFile('.github/workflows/publish.yml', 'utf8');
assert.ok(!publication.includes('npm publish'));
assert.match(publication, /exit 1/);
console.log(
  'Package, runtime, registry metadata, and publication hold agree. No artifact published.',
);
