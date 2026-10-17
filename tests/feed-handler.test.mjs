import test from 'node:test';
import assert from 'node:assert/strict';
import { handleFeedRequest } from '../worker/feed-handler.js';
import { fetchSource } from '../src/live-feed.js';

const sourceKey = 'nowcasting_20261017-1700_analysis_20261017-1700_web';
const geojson = { type: 'FeatureCollection', totalFeatures: 1, features: [{
  type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-74, -5], [-72, -5], [-72, -3], [-74, -3], [-74, -5]]] },
  properties: { nivel: 1, fecha1: '2026-10-17T22:00:00Z', fichero: sourceKey },
}] };

function upstream() {
  const calls = [];
  return { calls, fetchImpl: async (url) => {
    calls.push(String(url));
    return String(url).includes('nowcasting-analisis.php')
      ? new Response(`<a data-fichero="${sourceKey}">registro</a>`)
      : new Response(JSON.stringify(geojson));
  } };
}

test('gateway gets only fixed official upstreams and caches real observation for 300 seconds', async () => {
  const { calls, fetchImpl } = upstream();
  let stored;
  const cache = {
    async match() { return stored?.clone(); },
    async put(key, response) { assert.equal(new URL(key.url).search, '?schema=1'); stored = response; },
  };
  const request = new Request('https://onda.example/api/feed');
  const first = await handleFeedRequest(request, { cache, fetchImpl });
  assert.equal(first.status, 200);
  assert.equal(first.headers.get('x-onda-cache'), 'miss');
  assert.equal(first.headers.get('cache-control'), 'no-store');
  assert.equal(stored.headers.get('cache-control'), 'public, max-age=300');
  const feed = await first.json();
  assert.equal(feed.sourceUpdatedAt, '2026-10-17T22:00:00.000Z');
  assert.equal(feed.fields.length, 2);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((url) => new URL(url).hostname), ['www.senamhi.gob.pe', 'idesep.senamhi.gob.pe']);
  const again = await handleFeedRequest(request, { cache, fetchImpl });
  assert.equal(again.headers.get('x-onda-cache'), 'hit');
  assert.equal((await again.json()).fetchedAt, feed.fetchedAt);
  assert.equal(calls.length, 2);
  const head = await handleFeedRequest(new Request(request.url, { method: 'HEAD' }), { cache, fetchImpl });
  assert.equal(await head.text(), '');
});

test('gateway rejects arbitrary URLs, query parameters and mutations without upstream requests', async () => {
  const { calls, fetchImpl } = upstream();
  assert.equal((await handleFeedRequest(new Request('https://onda.example/api/feed?url=https://attacker.example'), { fetchImpl })).status, 400);
  assert.equal((await handleFeedRequest(new Request('https://onda.example/api/other'), { fetchImpl })).status, 404);
  assert.equal((await handleFeedRequest(new Request('https://onda.example/api/feed', { method: 'POST' }), { fetchImpl })).status, 405);
  assert.equal(calls.length, 0);
});

test('source errors yield truthful JSON 503 and are never replaced by old bundled data', async () => {
  const failed = await handleFeedRequest(new Request('https://onda.example/api/feed'), { fetchImpl: async () => { throw new Error('offline'); } });
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get('cache-control'), 'no-store');
  const body = await failed.json();
  assert.equal(body.error, 'source_unavailable');
  assert.equal(body.fields, undefined);
  assert.ok(Date.parse(body.checkedAt));
});

test('upstream body length is bounded even when there is no Content-Length', async () => {
  await assert.rejects(fetchSource('https://source.example', { fetchImpl: async () => new Response('x'.repeat(200)), maxBytes: 100 }), /límite/);
  await assert.rejects(fetchSource('https://source.example', { fetchImpl: async () => new Response('x', { headers: { 'content-length': '201' } }), maxBytes: 100 }), /límite/);
});
