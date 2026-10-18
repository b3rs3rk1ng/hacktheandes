import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { handleFeedRequest } from '../worker/feed-handler.js';
const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json', '.webmanifest':'application/manifest+json', '.svg':'image/svg+xml', '.woff2':'font/woff2', '.wasm':'application/wasm', '.wav':'audio/wav' };
// Dev-only implementation of the standard Cache interface; bounded to one public feed.
let feedCache = null;
const cache = {
  async match(request) {
    if (!feedCache || feedCache.key !== request.url || feedCache.expiresAt <= Date.now()) return undefined;
    return new Response(feedCache.body, feedCache.options);
  },
  async put(request, response) {
    const ttl = Number(/max-age=(\d+)/.exec(response.headers.get('cache-control'))?.[1] || 0);
    feedCache = { key: request.url, body: await response.text(), expiresAt: Date.now() + ttl * 1000,
      options: { status: response.status, headers: Object.fromEntries(response.headers) } };
  },
};
http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/api/feed') {
      const response = await handleFeedRequest(new Request(new URL(req.url, `http://localhost:${port}`), { method: req.method }), { cache });
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
      return;
    }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root) || !(await stat(file)).isFile()) throw new Error('missing');
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control':'no-cache' });
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end('No encontrado'); }
}).listen(port, '127.0.0.1', () => console.log(`Onda: http://localhost:${port}`));
