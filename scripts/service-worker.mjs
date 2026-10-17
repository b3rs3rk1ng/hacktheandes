import { createHash } from 'node:crypto';

// Keep the worker self-contained so its actual runtime code also versions the cache.
function serviceWorkerRuntime({ cacheName, assets }) {
  const shell = '/index.html';
  const ownURL = value => new URL(value, self.location.origin);

  async function verifiedResponse(pathname) {
    const response = await fetch(new Request(ownURL(pathname), {
      cache: 'reload', credentials: 'same-origin', redirect: 'follow',
    }));
    if (response.status !== 200 || response.type === 'opaque' || response.type === 'opaqueredirect' ||
        (response.url && ownURL(response.url).origin !== self.location.origin)) {
      throw new Error('Offline asset is not a readable same-origin success: ' + pathname);
    }
    const body = await response.arrayBuffer();
    const expected = assets[pathname];
    if (expected.shellMarker) {
      // HTML can contain hosting-injected content, but must still be our shell.
      const html = new TextDecoder().decode(body);
      if (!/^text\/html(?:;|$)/i.test(response.headers.get('Content-Type') || '') || !html.includes(expected.shellMarker)) {
        throw new Error('Offline HTML is not this app shell: ' + pathname);
      }
    } else {
      const digest = await crypto.subtle.digest('SHA-256', body);
      const checksum = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (checksum !== expected.sha256) throw new Error('Offline asset content differs from this build: ' + pathname);
    }

    // A followed redirect keeps an internal URL list even after Cache.put().
    // Safari rejects that response for navigation. A fresh Response clears only
    // that metadata; the verified body, HTTP status, MIME and headers survive.
    return new Response(body, {
      status: response.status, statusText: response.statusText, headers: response.headers,
    });
  }

  self.addEventListener('install', event => {
    event.waitUntil((async () => {
      const cache = await caches.open(cacheName);
      try {
        // Verify every asset before writing any. Authentication HTML returned
        // with HTTP 200 must never become an offline copy of an app asset.
        const entries = await Promise.all(Object.keys(assets).map(async pathname => [pathname, await verifiedResponse(pathname)]));
        await Promise.all(entries.map(([pathname, response]) => cache.put(pathname, response)));
        await self.skipWaiting();
      } catch (error) {
        await caches.delete(cacheName);
        throw error;
      }
    })());
  });
  self.addEventListener('activate', event => {
    event.waitUntil(caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('onda-') && key !== cacheName).map(key => caches.delete(key))))
      .then(() => self.clients.claim()));
  });
  self.addEventListener('message', event => {
    if (event.data?.type !== 'OFFLINE_STATUS' || !event.ports[0]) return;
    const reply = ready => event.ports[0].postMessage({ ready, version: cacheName });
    event.waitUntil((async () => {
      const cache = await caches.open(cacheName);
      const stored = await Promise.all(Object.keys(assets).map(pathname => cache.match(pathname)));
      reply(stored.every(Boolean));
    })().catch(() => reply(false)));
  });
  self.addEventListener('fetch', event => {
    if (event.request.method !== 'GET' || ownURL(event.request.url).origin !== self.location.origin) return;
    const pathname = ownURL(event.request.url).pathname;
    // Leave authentication callbacks and other non-app URLs to the network.
    const navigation = event.request.mode === 'navigate' && (pathname === '/' || pathname === shell);
    if (navigation || Object.hasOwn(assets, pathname)) {
      const key = navigation ? shell : pathname;
      event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(key)) || verifiedResponse(key)));
    }
  });
}

export function createServiceWorker(assets) {
  const runtime = serviceWorkerRuntime.toString();
  const version = createHash('sha256').update(JSON.stringify(assets)).update(runtime).digest('hex').slice(0, 12);
  const cacheName = 'onda-' + version;
  return { version, cacheName, worker: `(${runtime})(${JSON.stringify({ cacheName, assets })});\n` };
}
