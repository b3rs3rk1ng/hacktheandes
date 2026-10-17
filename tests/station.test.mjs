import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate as nextTurn } from 'node:timers/promises';
import { createStation } from '../src/station.js';
import { createAssembler } from '../src/protocol.js';

const initialAt = '2026-10-17T15:00:00.000Z';
const newerAt = '2026-10-17T15:10:00.000Z';
function feed(context = 'live', observedAt = initialAt) {
  return {
    version: 1, fetchedAt: observedAt, sourceUpdatedAt: observedAt,
    fields: [{
      version: 1, type: 'grid', id: 'regional-field', variable: 'rain-category', observedAt,
      expiresAt: '2026-10-17T18:00:00.000Z', context,
      bounds: [130, 30, 134, 34], cols: 2, rows: 2, values: [0, 1, 2, 255],
      source: { name: 'Example meteorological service', url: 'https://example.org/observations' },
    }],
  };
}
const replay = () => ({ version: 1, context: 'replay', frames: [feed('replay')] });
const response = value => new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

function fixture(t, { fetchImpl, prime, stop, transmit, busy = false } = {}) {
  const nodes = new Map();
  const classes = new Set();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {
        value: id === 'station-context' ? 'live' : 'fast', disabled: false, textContent: '',
        events: new Map(), addEventListener(event, callback) { this.events.set(event, callback); },
      });
      return nodes.get(id);
    },
    body: { classList: { add: value => classes.add(value), remove: value => classes.delete(value) } },
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document; });
  const requests = [];
  const transmissions = [];
  const busyChanges = [];
  let primeCount = 0, stopCount = 0;
  const modem = {
    prime() { primeCount++; return prime ? prime() : Promise.resolve(); },
    stop() { stopCount++; return stop ? stop() : Promise.resolve(); },
    transmit(frames, options) {
      transmissions.push({ frames, options });
      if (transmit) return transmit(frames, options);
      return new Promise((resolve, reject) => {
        if (options.signal.aborted) { reject(options.signal.reason); return; }
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    },
  };
  const station = createStation({
    getModem: () => modem, isBusy: () => busy,
    onBusy: value => busyChanges.push(value),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (fetchImpl) return fetchImpl(url, options);
      return response(url.endsWith('initial-feed.json') ? feed() : url.endsWith('replay-feed.json') ? replay() : feed('live', newerAt));
    },
  });
  return {
    station, requests, transmissions, busyChanges, classes, node: document.getElementById,
    start: () => document.getElementById('station-start').events.get('click')(),
    get primeCount() { return primeCount; }, get stopCount() { return stopCount; },
  };
}

async function waitFor(predicate) {
  for (let index = 0; index < 30; index++) { if (predicate()) return; await nextTurn(); }
  assert.fail('Operation did not reach the expected state.');
}
async function decode(frames) {
  const assembler = createAssembler();
  let result;
  for (const frame of frames) result = await assembler.accept(frame);
  return result.field;
}

test('concurrent preparation deduplicates source work and repeat visits preserve newer observations', async t => {
  const f = fixture(t);
  await Promise.all([f.station.prepare(), f.station.prepare(), f.station.prepare()]);
  assert.deepEqual(f.requests.map(request => request.url).sort(), ['/api/feed', '/public/data/initial-feed.json', '/public/data/replay-feed.json']);
  await f.station.prepare();
  assert.equal(f.requests.length, 3, 'idempotent preparation never reinstalls the older bundled snapshot');
  const running = f.start();
  assert.equal(f.primeCount, 1, 'priming happens synchronously in the click handler');
  await waitFor(() => f.transmissions.length === 1);
  const { frames, options } = f.transmissions[0];
  assert.equal((await decode(frames)).observedAt, newerAt);
  assert.equal(options.keepAlive, true);
  assert.equal(options.speed, 'fast');
  assert.equal(options.repeat, 2);
  assert.ok(f.requests.every(request => request.options.credentials === 'same-origin'));
  f.station.stop();
  await running;
  assert.equal(f.station.running, false);
  assert.deepEqual(f.busyChanges, [true, false]);
  assert.equal(f.stopCount, 1);
  assert.equal(f.classes.size, 0);
});

test('a rapid second click stops pending preparation immediately while shared warmup remains reusable', { timeout: 2000 }, async t => {
  const pending = deferred();
  const f = fixture(t, { fetchImpl: async url => {
    if (url.endsWith('initial-feed.json')) return pending.promise;
    return response(url.endsWith('replay-feed.json') ? replay() : feed('live', newerAt));
  } });
  const preparing = f.station.prepare();
  t.after(async () => { pending.resolve(response(feed())); await preparing; });
  const running = f.start();
  await Promise.resolve();
  await f.start();
  await running;
  assert.equal(f.station.running, false);
  assert.equal(f.transmissions.length, 0);
  assert.equal(f.stopCount, 1);
  assert.deepEqual(f.busyChanges, [true, false]);
  pending.resolve(response(feed()));
  assert.equal(await preparing, true);
  const restarted = f.start();
  await waitFor(() => f.transmissions.length === 1);
  assert.equal((await decode(f.transmissions[0].frames)).observedAt, newerAt);
  f.station.stop();
  await restarted;
  assert.equal(f.requests.filter(request => request.url.endsWith('initial-feed.json')).length, 1);
});

test('stopping during a pending audio resume cleans up without starting source work', async t => {
  const primed = deferred();
  const f = fixture(t, { prime: () => primed.promise });
  const running = f.start();
  f.station.stop();
  await running;
  assert.equal(f.station.running, false);
  assert.equal(f.stopCount, 1);
  assert.equal(f.requests.length, 0);
  assert.equal(f.transmissions.length, 0);
  primed.resolve();
});

test('synchronous prime failure and cleanup rejection both release sender ownership', async t => {
  const f = fixture(t, {
    prime: () => { throw new Error('Audio unavailable'); },
    stop: () => Promise.reject(new Error('Already closed')),
  });
  await f.start();
  assert.equal(f.station.running, false);
  assert.equal(f.transmissions.length, 0);
  assert.deepEqual(f.busyChanges, [true, false]);
  assert.equal(f.node('station-context').disabled, false);
  assert.equal(f.node('station-speed').disabled, false);
  assert.equal(f.classes.size, 0);
});

test('historical fields cannot enter the live feed or overwrite the prepared live snapshot', async t => {
  const f = fixture(t, { fetchImpl: async url => response(
    url.endsWith('initial-feed.json') ? feed() : url.endsWith('replay-feed.json') ? replay() : feed('replay', newerAt),
  ) });
  await f.station.prepare();
  const running = f.start();
  await waitFor(() => f.transmissions.length === 1);
  const field = await decode(f.transmissions[0].frames);
  assert.equal(field.context, 'live');
  assert.equal(field.observedAt, initialAt);
  f.station.stop();
  await running;
});

test('corrupt historical setup never starts emission', async t => {
  const f = fixture(t, { fetchImpl: async url => response(
    url.endsWith('replay-feed.json') ? { ...replay(), frames: [feed('live')] } : feed(),
  ) });
  assert.equal(await f.station.prepare(), false);
  await f.start();
  assert.equal(f.transmissions.length, 0);
  assert.equal(f.station.running, false);
  assert.equal(f.stopCount, 1);
});

test('another audio owner blocks priming and leaves its busy state untouched', async t => {
  const f = fixture(t, { busy: true });
  await f.start();
  assert.equal(f.primeCount, 0);
  assert.equal(f.stopCount, 0);
  assert.equal(f.station.running, false);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.busyChanges, []);
});

test('continuous replay advances dated snapshots while retaining audio until the station stops', { timeout: 2000 }, async t => {
  const nativeTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, 'setTimeout', (callback, ms, ...args) => nativeTimeout(callback, ms === 2500 ? 0 : ms, ...args));
  let f;
  f = fixture(t, {
    fetchImpl: async url => response(url.endsWith('replay-feed.json')
      ? { version: 1, context: 'replay', frames: [feed('replay'), feed('replay', newerAt)] }
      : feed()),
    transmit: async () => { if (f.transmissions.length === 2) f.station.stop(); },
  });
  await f.station.prepare();
  f.node('station-context').value = 'replay';
  await f.start();
  assert.equal(f.transmissions.length, 2);
  const fields = await Promise.all(f.transmissions.map(transmission => decode(transmission.frames)));
  assert.deepEqual(fields.map(field => field.observedAt), [initialAt, newerAt]);
  assert.ok(fields.every(field => field.context === 'replay'));
  assert.ok(f.transmissions.every(transmission => transmission.options.keepAlive));
  assert.equal(f.primeCount, 1);
  assert.equal(f.stopCount, 1);
  assert.deepEqual(f.busyChanges, [true, false]);
});
