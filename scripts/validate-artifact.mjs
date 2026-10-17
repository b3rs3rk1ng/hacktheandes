import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const serverPath = path.join(root, 'dist/server/index.js');
const [source, manifestJSON] = await Promise.all([
  readFile(serverPath, 'utf8'), readFile(path.join(root, 'dist/.openai/hosting.json'), 'utf8'),
]);
const manifest = JSON.parse(manifestJSON);
assert.ok(manifest.project_id, 'The existing Site identity must survive a Worker migration.');
assert.equal(manifest.static, undefined, 'Worker deployment metadata cannot select static hosting.');
assert.equal(manifest.d1, null); assert.equal(manifest.r2, null);
// A data URL both parses ESM without filesystem context and proves every runtime
// import has been bundled. The resulting Worker cannot depend on source files.
const worker = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)).default;
assert.equal(typeof worker?.fetch, 'function');
const call = (url, options) => worker.fetch(new Request(`https://onda.test${url}`, options), {}, {});
const shell = await call('/');
assert.equal(shell.status, 200);
assert.match(shell.headers.get('content-type'), /^text\/html/);
assert.match(shell.headers.get('permissions-policy'), /microphone=\(self\)/);
assert.match(shell.headers.get('permissions-policy'), /geolocation=\(self\)/);
const html = await shell.text();
assert.match(html, /name="onda-shell-revision"/);
assert.equal(html, await readFile(path.join(root, 'dist/index.html'), 'utf8'));
for (const pathname of ['/src/app.js', '/src/map-view.js', '/public/data/basemap.json', '/public/data/localities.json', '/manifest.webmanifest', '/sw.js']) {
  const response = await call(pathname);
  assert.equal(response.status, 200, pathname);
  const expected = await readFile(path.join(root, 'dist', pathname.slice(1)));
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), expected, pathname + ' must preserve bytes');
}
const png = await call('/public/apple-touch-icon.png');
assert.equal(png.headers.get('content-type'), 'image/png');
assert.deepEqual(Buffer.from(await png.arrayBuffer()).subarray(0, 8), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
const sw = await call('/sw.js');
assert.equal(sw.headers.get('service-worker-allowed'), '/');
assert.equal(sw.headers.get('cache-control'), 'no-cache');
const swSource = await sw.text();
assert.ok(!swSource.includes('/public/data/initial-feed.json'), 'Receiver must not precache emitter payloads.');
assert.ok(!swSource.includes('/public/data/replay-feed.json'), 'Receiver must receive historical fields through audio.');
assert.ok(!swSource.includes('/server/index.js'), 'A server bundle must not enter the browser precache.');
assert.ok(!swSource.includes('/.openai/hosting.json'), 'Deployment metadata must not enter the browser precache.');
assert.equal((await call('/.openai/hosting.json')).status, 404);
assert.equal((await call('/server/index.js')).status, 404);
assert.equal((await call('/api/feed?source=https://invalid.test')).status, 400, 'Gateway rejects arbitrary upstream selectors.');
assert.equal((await call('/api/feed', { method: 'POST' })).status, 405);
console.log('Artefacto válido: Worker ESM autónomo, assets exactos, GPS/micrófono habilitados y API enrutable.');
