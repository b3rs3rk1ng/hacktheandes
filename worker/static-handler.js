const RESPONSE_POLICY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'microphone=(self), geolocation=(self), camera=()',
};

function decodeBase64(value) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/** Immutable public asset table; no request-scoped state is retained globally. */
export function createStaticHandler(assets) {
  return function handleStaticRequest(request) {
    const pathname = new URL(request.url).pathname;
    if (!['GET', 'HEAD'].includes(request.method)) {
      return new Response('Método no permitido', {
        status: 405, headers: { ...RESPONSE_POLICY, Allow: 'GET, HEAD', 'Cache-Control': 'no-store' },
      });
    }
    const asset = Object.hasOwn(assets, pathname) ? assets[pathname] : null;
    if (!asset) return new Response(request.method === 'HEAD' ? null : 'No encontrado', {
      status: 404, headers: { ...RESPONSE_POLICY, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
    const headers = new Headers({
      ...RESPONSE_POLICY,
      'Content-Type': asset.mime,
      'Cache-Control': 'no-cache',
      ETag: asset.etag,
    });
    if (pathname === '/sw.js') headers.set('Service-Worker-Allowed', '/');
    const match = request.headers.get('If-None-Match');
    if (match && match.split(',').some((value) => value.trim() === '*' || value.trim().replace(/^W\//, '') === asset.etag)) {
      return new Response(null, { status: 304, headers });
    }
    headers.set('Content-Length', String(asset.bytes));
    return new Response(request.method === 'HEAD' ? null : decodeBase64(asset.base64), { headers });
  };
}
