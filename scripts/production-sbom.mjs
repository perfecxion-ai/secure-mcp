import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// npm 11.19.1's --omit=dev selector drops packages shared by production and
// development paths (including jose, zod and the MCP core in this project).
// Install the unchanged lockfile into a separate production-only tree instead.
const directory = await mkdtemp(join(tmpdir(), 'secure-mcp-build-production-'));
try {
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  await copyFile('package.json', join(directory, 'package.json'));
  await copyFile('package-lock.json', join(directory, 'package-lock.json'));
  const run = (args) =>
    execFileSync('npm', args, {
      cwd: directory,
      encoding: 'utf8',
      timeout: 120_000,
      maxBuffer: 16 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  run(['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund']);
  // Only after locked installation, remove dev declarations from this temporary
  // manifest so npm's SBOM missing-dependency check does not require absent dev tools.
  delete pkg.devDependencies;
  await writeFile(join(directory, 'package.json'), JSON.stringify(pkg));
  const sbom = JSON.parse(run(['sbom', '--sbom-format=cyclonedx']));
  const listing = JSON.parse(run(['ls', '--all', '--json']));
  const identities = new Set();
  const walk = (dependencies = {}) => {
    for (const [name, entry] of Object.entries(dependencies)) {
      assert.ok(entry.version, `Missing installed version: ${name}`);
      identities.add(`${name}@${entry.version}`);
      walk(entry.dependencies);
    }
  };
  walk(listing.dependencies);
  const actual = new Set(
    sbom.components.map((component) => decodeURIComponent(component.purl.slice('pkg:npm/'.length))),
  );
  assert.deepEqual(actual, identities, 'SBOM differs from installed production inventory');
  console.log(JSON.stringify(sbom, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
