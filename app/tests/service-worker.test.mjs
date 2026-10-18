import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { createServiceWorker } from '../scripts/service-worker.mjs';

const marker = '<meta name="onda-shell-revision" content="test-build">';
const html = '<!doctype html><head>' + marker + '</head><body>App</body>';
const css = 'body { color: blue; }';
const assets = {
  '/': { shellMarker: marker },
  '/index.html': { shellMarker: marker },
  '/styles.css': { sha256: createHash('sha256').update(css).digest('hex') },
};

async function serverFor(t, handler) {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  return 'http://127.0.0.1:' + server.address().port;
}

function runWorker(origin) {
  const listeners = new Map();
  const stores = new Map();
  let offline = false;
  let skipped = false;
  let claimed = false;
  const generated = createServiceWorker(assets);
  const keyFor = key => new URL(typeof key === 'string' ? key : key.url, origin).href;
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(key) { return store.get(keyFor(key))?.clone(); },
        async put(key, response) { store.set(keyFor(key), response.clone()); },
      };
    },
    async keys() { return [...stores.keys()]; },
    async delete(name) { return stores.delete(name); },
  };
  vm.runInNewContext(generated.worker, {
    URL, Request, Response, TextDecoder, Uint8Array, crypto: webcrypto, caches,
    fetch: (...args) => offline ? Promise.reject(new Error('Network offline')) : fetch(...args),
    self: {
      location: { origin },
      addEventListener: (name, listener) => listeners.set(name, listener),
      skipWaiting: async () => { skipped = true; },
      clients: { claim: async () => { claimed = true; } },
    },
  });
  return {
    ...generated, stores, caches,
    goOffline() { offline = true; },
    get skipped() { return skipped; },
    get claimed() { return claimed; },
    async lifecycle(name) {
      let pending;
      listeners.get(name)({ waitUntil(promise) { pending = promise; } });
      return pending;
    },
    async status() {
      let pending;
      let reply;
      listeners.get('message')({
        data: { type: 'OFFLINE_STATUS' },
        ports: [{ postMessage(message) { reply = message; } }],
        waitUntil(promise) { pending = promise; },
      });
      await pending;
      return reply;
    },
    response(pathname, mode = 'navigate') {
      let response;
      listeners.get('fetch')({
        request: { method: 'GET', url: new URL(pathname, origin).href, mode },
        respondWith(promise) { response = promise; },
      });
      return response;
    },
  };
}

test('redirected HTML becomes a navigable offline response while preserving its body and headers', async t => {
  const servedHTML = html.replace('</head>', '<script>/* dynamic hosting content */</script></head>');
  const origin = await serverFor(t, (request, response) => {
    if (request.url === '/index.html') {
      response.writeHead(302, { Location: '/' });
      response.end();
    } else if (request.url === '/') {
      response.writeHead(200, 'App shell', { 'Content-Type': 'text/html; charset=utf-8', 'X-App-Test': 'preserved' });
      response.end(servedHTML);
    } else {
      response.writeHead(200, { 'Content-Type': 'text/css' });
      response.end(css);
    }
  });
  const redirected = await fetch(origin + '/index.html');
  assert.equal(redirected.redirected, true, 'reproduce the redirected response that Safari rejects');
  const worker = runWorker(origin);
  await worker.caches.open('onda-old-contaminated');
  await worker.caches.open('unrelated-cache');
  await worker.lifecycle('install');
  assert.equal(worker.skipped, true);
  await worker.lifecycle('activate');
  assert.equal(worker.claimed, true);
  assert.equal(worker.stores.has('onda-old-contaminated'), false);
  assert.equal(worker.stores.has('unrelated-cache'), true);
  assert.equal((await worker.status()).ready, true);

  worker.goOffline();
  for (const pathname of ['/', '/?mode=send', '/index.html']) {
    const response = await worker.response(pathname);
    assert.equal(response.redirected, false);
    assert.equal(response.url, '');
    assert.equal(response.status, 200);
    assert.equal(response.statusText, 'App shell');
    assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
    assert.equal(response.headers.get('X-App-Test'), 'preserved');
    assert.equal(await response.text(), servedHTML);
  }
  assert.equal(await (await worker.response('/styles.css', 'same-origin')).text(), css);
  assert.equal(worker.response('/authentication/callback'), undefined, 'non-app navigation stays outside the worker');
  worker.stores.get(worker.cacheName).delete(origin + '/styles.css');
  assert.equal((await worker.status()).ready, false, 'cache eviction must revoke the offline-ready status');
});

test('HTTP 200 sign-in HTML cannot replace the app shell or activate an incomplete offline cache', async t => {
  const origin = await serverFor(t, (request, response) => {
    response.writeHead(200, { 'Content-Type': request.url === '/styles.css' ? 'text/css' : 'text/html' });
    response.end(request.url === '/styles.css' ? css : '<!doctype html><head></head><body>Sign in</body>');
  });
  const worker = runWorker(origin);
  await worker.caches.open('onda-previous-working');
  await assert.rejects(worker.lifecycle('install'), /Offline HTML is not this app shell/);
  assert.equal(worker.skipped, false);
  assert.equal(worker.stores.has(worker.cacheName), false);
  assert.equal(worker.stores.has('onda-previous-working'), true);
});

test('a transformed or authentication response for a static asset fails its content checksum', async t => {
  const origin = await serverFor(t, (request, response) => {
    response.writeHead(200, { 'Content-Type': 'text/html' });
    response.end(request.url === '/styles.css' ? '<html>Authentication required</html>' : html);
  });
  const worker = runWorker(origin);
  await assert.rejects(worker.lifecycle('install'), /Offline asset content differs from this build: \/styles.css/);
  assert.equal(worker.skipped, false);
  assert.equal(worker.stores.has(worker.cacheName), false);
});
