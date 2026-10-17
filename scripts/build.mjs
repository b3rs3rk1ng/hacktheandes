import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'styles.css', 'manifest.webmanifest', 'src', 'public']) {
  await cp(path.join(root, name), path.join(output, name), { recursive: true });
}
async function files(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (await Promise.all(entries.map(e => e.isDirectory() ? files(path.join(dir, e.name)) : path.join(dir, e.name)))).flat();
}
const list = (await files(output)).sort();
const hash = createHash('sha256');
for (const file of list) hash.update(await readFile(file));
const version = hash.digest('hex').slice(0, 12);
const assets = ['/', ...list.map(file => '/' + path.relative(output, file).split(path.sep).join('/'))];
const worker = `const CACHE = 'onda-${version}';
const ASSETS = ${JSON.stringify(assets)};
self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS.map(url => new Request(url, {cache:'reload'})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('onda-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('message', event => {
  if (event.data?.type === 'OFFLINE_STATUS') event.ports[0]?.postMessage({ready:true,version:CACHE});
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  const pathname = new URL(event.request.url).pathname;
  if (event.request.mode === 'navigate') {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match('/index.html')) || fetch(event.request)));
  } else if (ASSETS.includes(pathname)) {
    event.respondWith(caches.open(CACHE).then(async cache => (await cache.match(pathname)) || fetch(event.request)));
  }
});
`;
await writeFile(path.join(output, 'sw.js'), worker);
await writeFile(path.join(output, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: microphone=(self), camera=(), geolocation=()\n/sw.js\n  Cache-Control: no-cache\n');
console.log(`Onda lista: ${list.length} archivos, versión ${version}.`);
