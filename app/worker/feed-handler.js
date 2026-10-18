import { getLiveFeed } from '../src/live-feed.js';

const TTL_SECONDS = 300;
const DEADLINE_MS = 15000;

function jsonResponse(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function clientResponse(response, method, cacheState) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control', 'no-store');
  headers.set('X-Onda-Cache', cacheState);
  return new Response(method === 'HEAD' ? null : response.body, { status: response.status, headers });
}

/** Fixed official adapter; request parameters can never choose an upstream URL. */
export async function handleFeedRequest(request, { cache = globalThis.caches?.default, fetchImpl = globalThis.fetch } = {}) {
  const url = new URL(request.url);
  if (url.pathname !== '/api/feed') return jsonResponse({ error: 'not_found' }, 404);
  if (url.search) return jsonResponse({ error: 'unsupported_parameters', message: 'Este flujo no acepta parámetros.' }, 400);
  if (!['GET', 'HEAD'].includes(request.method)) {
    return jsonResponse({ error: 'method_not_allowed' }, 405, { Allow: 'GET, HEAD' });
  }
  const cacheKey = new Request(new URL('/api/feed?schema=1', url.origin).href);
  if (cache) {
    try {
      const found = await cache.match(cacheKey);
      if (found?.ok) return clientResponse(found, request.method, 'hit');
    } catch { /* Cache availability never changes source truth or prevents a fresh lookup. */ }
  }
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  if (request.signal.aborted) abort();
  else request.signal.addEventListener('abort', abort, { once: true });
  const deadline = setTimeout(() => controller.abort(new Error('source_timeout')), DEADLINE_MS);
  try {
    const feed = await getLiveFeed({ signal: controller.signal, fetchImpl, timeoutMs: DEADLINE_MS });
    const response = jsonResponse(feed, 200, { 'Cache-Control': `public, max-age=${TTL_SECONDS}` });
    if (cache) {
      try { await cache.put(cacheKey, response.clone()); }
      catch { /* A cache failure must not discard a successfully fetched observation. */ }
    }
    return clientResponse(response, request.method, 'miss');
  } catch {
    return jsonResponse({
      error: controller.signal.aborted ? 'source_timeout' : 'source_unavailable',
      message: 'No se pudo consultar SENAMHI. El emisor conserva su último registro con la fecha original.',
      checkedAt: new Date().toISOString(),
    }, 503, { 'Retry-After': String(TTL_SECONDS) });
  } finally {
    clearTimeout(deadline);
    request.signal.removeEventListener('abort', abort);
  }
}
