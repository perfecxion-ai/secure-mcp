import { readFile, writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { configSchema } from '../src/config.js';

const output = JSON.stringify(z.toJSONSchema(configSchema, { io: 'input' }), null, 2) + '\n';
if (process.argv.includes('--check')) {
  if ((await readFile('config.schema.json', 'utf8')) !== output)
    throw new Error('Run npm run schema to refresh config.schema.json');
} else {
  await writeFile('config.schema.json', output);
}
