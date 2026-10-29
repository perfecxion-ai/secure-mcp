import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { verifyBundle } from './lib/validation-artifact.mjs';

const [sha, directory, ...extra] = process.argv.slice(2);
assert.ok(
  directory && extra.length === 0,
  'Usage: node scripts/verify-validation.mjs EXPECTED_COMMIT BUNDLE_DIRECTORY',
);
console.log(JSON.stringify(await verifyBundle(resolve(directory), sha), null, 2));
