import test from 'node:test';
import assert from 'node:assert/strict';
import { createStaticHandler } from '../worker/static-handler.js';

const body = Buffer.from('Información local · 你好');
const assets = {
  '/': { base64: body.toString('base64'), bytes: body.length, mime: 'text/html; charset=utf-8', etag: '"test-revision"' },
  '/sw.js': { base64: Buffer.from('self.onda=true;').toString('base64'), bytes: 15, mime: 'text/javascript; charset=utf-8', etag: '"worker-revision"' },
};
const handle = createStaticHandler(assets);
const request = (path = '/', options) => new Request('https://onda.test' + path, options);

test('embedded assets preserve arbitrary UTF-8 bytes and permit offline GPS/microphone', async () => {
  const response = handle(request());
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), body);
  assert.equal(response.headers.get('Content-Type'), 'text/html; charset=utf-8');
  assert.equal(response.headers.get('Content-Length'), String(body.length));
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Permissions-Policy'), /geolocation=\(self\)/);
  assert.match(response.headers.get('Permissions-Policy'), /microphone=\(self\)/);
});

test('HEAD uses matching metadata without a response body', async () => {
  const response = handle(request('/', { method: 'HEAD' }));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), '');
  assert.equal(response.headers.get('Content-Length'), String(body.length));
});

test('conditional GET accepts strong, weak and wildcard ETags', async () => {
  for (const match of ['"test-revision"', 'W/"test-revision"', '"older", "test-revision"', '*']) {
    const response = handle(request('/', { headers: { 'If-None-Match': match } }));
    assert.equal(response.status, 304, match);
    assert.equal(await response.text(), '');
    assert.equal(response.headers.get('ETag'), '"test-revision"');
  }
  assert.equal(handle(request('/', { headers: { 'If-None-Match': '"different"' } })).status, 200);
});

test('only explicit own asset paths are served, with method and cache policies', async () => {
  for (const path of ['/missing', '/toString', '/__proto__', '/.openai/hosting.json', '/server/index.js']) {
    assert.equal(handle(request(path)).status, 404, path);
  }
  const rejected = handle(request('/', { method: 'POST' }));
  assert.equal(rejected.status, 405); assert.equal(rejected.headers.get('Allow'), 'GET, HEAD');
  const sw = handle(request('/sw.js'));
  assert.equal(sw.headers.get('Cache-Control'), 'no-cache');
  assert.equal(sw.headers.get('Service-Worker-Allowed'), '/');
  const missingHead = handle(request('/missing', { method: 'HEAD' }));
  assert.equal(missingHead.status, 404); assert.equal(await missingHead.text(), '');
});
