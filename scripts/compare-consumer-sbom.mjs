import { readFile, writeFile } from 'node:fs/promises';
import { compareProductionGraphs } from './lib/consumer-evidence.mjs';

const [buildPath, consumerPath, outputPath, ...extra] = process.argv.slice(2);
if (!buildPath || !consumerPath || !outputPath || extra.length)
  throw new Error('Usage: node scripts/compare-consumer-sbom.mjs BUILD_SBOM CONSUMER_SBOM OUTPUT');
const result = compareProductionGraphs(
  JSON.parse(await readFile(buildPath, 'utf8')),
  JSON.parse(await readFile(consumerPath, 'utf8')),
);
await writeFile(outputPath, JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
if (result.result !== 'match') process.exitCode = 1;
