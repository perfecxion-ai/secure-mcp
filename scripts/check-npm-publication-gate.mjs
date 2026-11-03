import assert from 'node:assert/strict';
import { validateInputs, validateContext } from './lib/npm-preflight.mjs';
import { command, verifySettings } from './lib/npm-publication-io.mjs';
const [source, digest, run, ...extra] = process.argv.slice(2);
assert.equal(extra.length, 0);
validateInputs(source, digest, run);
validateContext(process.env, source, command('git', ['rev-parse', 'HEAD']).trim(), 'publish.yml');
const { environment } = await verifySettings(source, digest);
console.log(
  JSON.stringify({
    environmentId: environment.id,
    publication: 'not performed',
    gate: 'configured',
  }),
);
