import test from 'node:test';
import assert from 'node:assert/strict';
import { pointInGeometry, rasterizeFeatureCollection, createLiveFeedClient, validateGridSpec } from '../src/live-feed.js';
import { parseSourceKeys, feedFromGeoJSON, buildFeatureUrl } from '../src/sources/senamhi.js';

const ring = (west, south, east, north) => [[west, south], [east, south], [east, north], [west, north], [west, south]];
const feature = (coordinates, nivel = 1) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates }, properties: { nivel, fecha1: '2026-10-17T22:00:00Z', fichero: 'nowcasting_20261017-1700_analysis_20261017-1700_web' } });
const collection = (features) => ({ type: 'FeatureCollection', features, totalFeatures: features.length });

test('polygon holes, closed rings, boundaries and multipolygons work across geographic regions', () => {
  const polygon = { type: 'Polygon', coordinates: [ring(10, 40, 20, 50), ring(12, 42, 14, 44)] };
  assert.equal(pointInGeometry(polygon, 11, 41), true);
  assert.equal(pointInGeometry(polygon, 13, 43), false);
  assert.equal(pointInGeometry(polygon, 12, 43), false);
  assert.equal(pointInGeometry(polygon, 10, 41), true);
  assert.equal(pointInGeometry(polygon, 0, 0), false);
  const multi = { type: 'MultiPolygon', coordinates: [[ring(-77, -12, -76, -11)], [ring(140, 35, 141, 36)]] };
  assert.equal(pointInGeometry(multi, -76.5, -11.5), true);
  assert.equal(pointInGeometry(multi, 140.5, 35.5), true);
  assert.equal(pointInGeometry(multi, 80, 28), false);
});

test('grid centres are sampled south to north and west to east, including overlap maximum', () => {
  const geo = collection([feature([ring(0, 0, 1, 1)], 1), feature([ring(1, 1, 2, 2)], 2), feature([ring(1, 1, 2, 2)], 3)]);
  assert.deepEqual(rasterizeFeatureCollection(geo, { bounds: [0, 0, 2, 2], cols: 2, rows: 2 }, { valueOf: (f) => f.properties.nivel }), [1, 255, 255, 3]);
  assert.throws(() => validateGridSpec({ bounds: [2, 0, 0, 2], cols: 2, rows: 2 }));
  assert.throws(() => validateGridSpec({ bounds: [0, 0, 2, 2], cols: 128, rows: 128 }));
});

test('source identifier discovery deduplicates, orders, validates dates and refuses injection', () => {
  const keys = parseSourceKeys(`<a data-fichero="nowcasting_20261017-1650_analysis_20261017-1650_web"></a><a data-fichero='nowcasting_20261017-1700_analysis_20261017-1700_web'></a><a data-fichero="nowcasting_20261017-1700_analysis_20261017-1700_web"></a><a data-fichero="nowcasting_20260231-1700_analysis_20260231-1700_web"></a>`);
  assert.equal(keys.length, 2);
  assert.match(keys[0], /-1700_/);
  assert.throws(() => buildFeatureUrl('x;other:stuff'));
  assert.equal(new URL(buildFeatureUrl(keys[0])).searchParams.get('viewparams'), `fichero:${keys[0]}`);
});

test('adapter preserves true observation date, labels replay and samples without inventing rainfall', () => {
  const feed = feedFromGeoJSON(collection([feature([ring(0, 0, 1, 1)], 2)]), {
    context: 'replay', grids: [{ id: 'test-area', bounds: [0, 0, 2, 2], cols: 2, rows: 2 }], fetchedAt: '2026-10-17T23:00:00Z',
  });
  assert.equal(feed.fields[0].observedAt, '2026-10-17T22:00:00.000Z');
  assert.equal(feed.fields[0].expiresAt, '2026-10-18T00:00:00.000Z');
  assert.equal(feed.fields[0].context, 'replay');
  assert.deepEqual(feed.fields[0].values, [2, 0, 0, 0]);
  assert.throws(() => feedFromGeoJSON({ ...collection([feature([ring(0, 0, 1, 1)])]), totalFeatures: 2 }));
  assert.throws(() => feedFromGeoJSON(collection([feature([ring(0, 0, 1, 1)], 4)])));
});

test('feed client retains last dated snapshot on errors, rejects rollback and distinguishes unchanged checks', async () => {
  const initial = feedFromGeoJSON(collection([feature([ring(0, 0, 1, 1)])]), { grids: [{ id: 'test-area', bounds: [0, 0, 2, 2], cols: 2, rows: 2 }] });
  let error = true;
  const client = createLiveFeedClient({ initialFeed: initial, load: async () => { if (error) throw new Error('network'); return initial; } });
  const failed = await client.refresh();
  assert.equal(failed.state, 'unavailable');
  assert.equal(failed.feed.sourceUpdatedAt, initial.sourceUpdatedAt);
  error = false;
  assert.equal((await client.refresh()).changed, false);
  const rollback = createLiveFeedClient({ initialFeed: initial, load: async () => ({ ...initial, sourceUpdatedAt: '2026-10-17T21:00:00Z' }) });
  assert.equal((await rollback.refresh()).state, 'unavailable');
});
