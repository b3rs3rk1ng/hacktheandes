import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createServiceWorker } from './service-worker.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'styles.css', 'manifest.webmanifest', 'src', 'public']) {
  await cp(path.join(root, name), path.join(output, name), { recursive: true });
}
// Hosting may add dynamic HTML (for example an access layer). An explicit shell
// revision identifies our document without depending on provider login markup.
const shellPath = path.join(output, 'index.html');
const shellHTML = await readFile(shellPath, 'utf8');
const shellRevision = createHash('sha256').update(shellHTML).digest('hex');
const shellMarker = `<meta name="onda-shell-revision" content="${shellRevision}">`;
if (!/<head\b[^>]*>/i.test(shellHTML)) throw new Error('The app shell needs an HTML head for its offline revision.');
await writeFile(shellPath, shellHTML.replace(/<head\b[^>]*>/i, match => match + '\n' + shellMarker));
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(dir, e.name)) : path.join(dir, e.name)))).flat();
}
const list = (await files(output)).sort();
const assets = {};
for (const file of list) {
  const pathname = '/' + path.relative(output, file).split(path.sep).join('/');
  assets[pathname] = pathname === '/index.html'
    ? { shellMarker }
    : { sha256: createHash('sha256').update(await readFile(file)).digest('hex') };
}
assets['/'] = assets['/index.html'];
const { version, worker } = createServiceWorker(assets);
await writeFile(path.join(output, 'sw.js'), worker);
await writeFile(path.join(output, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: microphone=(self), camera=(), geolocation=()\n/sw.js\n  Cache-Control: no-cache\n');
console.log(`Onda lista: ${list.length} archivos, versión ${version}.`);
