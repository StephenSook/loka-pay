// Loads every compiled server module under plain Node ESM, the way production starts it.
// Vitest and tsx hide CommonJS named-export mistakes; this does not. Run after the build.
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('../dist/', import.meta.url).pathname;
const files = readdirSync(root, { recursive: true }).map(String)
  .filter(file => file.endsWith('.js') && file !== 'main.js');
if (files.length < 10) throw new Error(`Expected the compiled server in dist/, found ${files.length} modules`);
for (const file of files) await import(pathToFileURL(join(root, file)).href);
console.log(`${files.length} modules load under plain Node ESM (${relative(process.cwd(), root)})`);
