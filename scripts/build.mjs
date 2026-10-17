import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { createServiceWorker } from './service-worker.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'dist');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const name of ['index.html', 'styles.css', 'manifest.webmanifest', 'src', 'public']) {
  await cp(path.join(root, name), path.join(output, name), { recursive: true });
}
// Keep static files for the local preview. Hosted responses come from the same
// byte-for-byte files embedded in one self-contained Sites Worker ESM bundle.
const shellPath = path.join(output, 'index.html');
const shellHTML = await readFile(shellPath, 'utf8');
const shellRevision = createHash('sha256').update(shellHTML).digest('hex');
const shellMarker = `<meta name="onda-shell-revision" content="${shellRevision}">`;
if (!/<head\b[^>]*>/i.test(shellHTML)) throw new Error('The app shell needs an HTML head for its offline revision.');
await writeFile(shellPath, shellHTML.replace(/<head\b[^>]*>/i, match => match + '\n' + shellMarker));

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? files(path.join(directory, entry.name)) : path.join(directory, entry.name)))).flat();
}
const assetFiles = (await files(output)).sort();
const integrity = {};
for (const file of assetFiles) {
  const pathname = '/' + path.relative(output, file).split(path.sep).join('/');
  integrity[pathname] = pathname === '/index.html'
    ? { shellMarker }
    : { sha256: createHash('sha256').update(await readFile(file)).digest('hex') };
}
integrity['/'] = integrity['/index.html'];
const { version, worker } = createServiceWorker(integrity);
const swPath = path.join(output, 'sw.js');
await writeFile(swPath, worker);

const mimeTypes = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.wasm': 'application/wasm',
  '.wav': 'audio/wav', '.md': 'text/plain; charset=utf-8', '.txt': 'text/plain; charset=utf-8',
};
const embedded = {};
for (const file of [...assetFiles, swPath]) {
  const pathname = '/' + path.relative(output, file).split(path.sep).join('/');
  const bytes = await readFile(file);
  embedded[pathname] = {
    base64: bytes.toString('base64'),
    bytes: bytes.length,
    mime: mimeTypes[path.extname(file).toLowerCase()] || 'application/octet-stream',
    etag: `"${createHash('sha256').update(bytes).digest('hex')}"`,
  };
}
embedded['/'] = embedded['/index.html'];
await mkdir(path.join(output, 'server'), { recursive: true });
await mkdir(path.join(output, '.openai'), { recursive: true });
const hosting = JSON.parse(await readFile(path.join(root, '.openai/hosting.json'), 'utf8'));
if (hosting.static) throw new Error('A Worker deployment cannot retain a static hosting manifest.');
await writeFile(path.join(output, '.openai/hosting.json'), JSON.stringify(hosting, null, 2) + '\n');
await build({
  entryPoints: [path.join(root, 'worker/index.js')],
  outfile: path.join(output, 'server/index.js'),
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  sourcemap: false, legalComments: 'inline',
  plugins: [{
    name: 'embedded-public-assets',
    setup(builder) {
      builder.onResolve({ filter: /^onda:assets$/ }, () => ({ path: 'assets', namespace: 'onda-embedded' }));
      builder.onLoad({ filter: /^assets$/, namespace: 'onda-embedded' }, () => ({
        contents: `export default ${JSON.stringify(embedded)};`, loader: 'js',
      }));
    },
  }],
});
// This file documents equivalent headers for a static local/file preview only.
// It is not embedded, precached or used as a hosting configuration.
await writeFile(path.join(output, '_headers'), '/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin\n  Permissions-Policy: microphone=(self), geolocation=(self), camera=()\n/sw.js\n  Cache-Control: no-cache\n');
console.log(`Onda lista: ${assetFiles.length} archivos offline, versión ${version}; Worker ESM con ${Object.keys(embedded).length} rutas.`);
