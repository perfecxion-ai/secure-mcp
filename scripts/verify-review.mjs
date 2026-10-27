import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
const report = JSON.parse(await readFile('docs/reviews/evidence/2026-10-26-summary.json', 'utf8'));
assert.equal(report.baseline_commit, '1df0af55bd2cebde48d643e3d3c852e64d37ce18');
assert.equal(report.checks.find(check => check.command.startsWith('npm run test:unit')).tests_failed, 52);
for (const file of ['package.json', 'packages/client-sdk/package.json']) {
  assert.equal(JSON.parse(await readFile(file, 'utf8')).license, 'AGPL-3.0-or-later');
}
assert.match(await readFile('LICENSE', 'utf8'), /GNU AFFERO GENERAL PUBLIC LICENSE/);
const release = await readFile('.github/workflows/publish.yml', 'utf8');
assert.ok(!release.includes('npm publish'));
assert.match(release, /exit 1/);
const documents = ['README.md', 'docs/ROADMAP.md', 'docs/reviews/2026-10-26-assessment.md', 'docs/reviews/evidence/README.md'];
for (const file of documents) {
  const contents = await readFile(file, 'utf8');
  assert.ok(!/[\u2013\u2014]/u.test(contents), file);
  for (const match of contents.matchAll(/\]\(([^)]+)\)/g)) {
    const target = match[1];
    if (!target.includes('://') && !target.startsWith('#')) await access(resolve(dirname(file), target.split('#')[0]));
  }
}
console.log('Review evidence, relative links, license metadata, and publication hold verified.');
