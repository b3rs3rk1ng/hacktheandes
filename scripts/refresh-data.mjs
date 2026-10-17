#!/usr/bin/env node
import { writeFile, readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getLiveFeed } from '../src/live-feed.js';
import { feedFromGeoJSON } from '../src/sources/senamhi.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const replayAt = args.indexOf('--replay');
const outputAt = args.indexOf('--output');
const output = outputAt >= 0 ? resolve(args[outputAt + 1])
  : resolve(root, 'public/data', replayAt >= 0 ? 'replay-feed.json' : 'initial-feed.json');
let result;
if (replayAt >= 0) {
  const files = args.slice(replayAt + 1).filter((arg) => !arg.startsWith('--'));
  if (!files.length || outputAt > replayAt) throw new Error('Uso: node scripts/refresh-data.mjs [--output archivo] --replay archivo-geojson ...');
  const frames = [];
  for (const path of files) {
    const collection = JSON.parse(await readFile(resolve(path), 'utf8'));
    frames.push(feedFromGeoJSON(collection, { context: 'replay' }));
  }
  frames.sort((a, b) => Date.parse(a.sourceUpdatedAt) - Date.parse(b.sourceUpdatedAt));
  result = {
    version: 1, context: 'replay', label: 'Reproducción de observaciones reales anteriores; no es información en vivo.',
    frames,
  };
} else {
  result = await getLiveFeed();
}
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(result)}\n`);
console.log(JSON.stringify({ output, bytes: Buffer.byteLength(JSON.stringify(result)), snapshots: result.frames?.length || 1, sourceUpdatedAt: result.sourceUpdatedAt || result.frames.at(-1).sourceUpdatedAt }));
