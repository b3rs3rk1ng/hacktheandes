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

function fixture(t, { fetchImpl, prime, stop, transmit, previewChannel, busy = false, modemReady = true } = {}) {
  const nodes = new Map();
  const classes = new Set();
  const defaults = { 'station-context': 'live', 'station-speed': 'fast', 'station-channel': 'radio' };
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const document = {
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, {
        value: defaults[id] ?? '', disabled: false, textContent: '',
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
  const previews = [];
  const audioOrder = [];
  const busyChanges = [];
  let primeCount = 0, stopCount = 0;
  const modem = {
    prime() { primeCount++; audioOrder.push('prime'); return prime ? prime() : Promise.resolve(); },
    stop() { stopCount++; return stop ? stop() : Promise.resolve(); },
    previewChannel(options) {
      previews.push(options);
      audioOrder.push('preview');
      return previewChannel ? previewChannel(options) : Promise.resolve();
    },
    transmit(frames, options) {
      transmissions.push({ frames, options });
      audioOrder.push('transmit');
      if (transmit) return transmit(frames, options);
      return new Promise((resolve, reject) => {
        if (options.signal.aborted) { reject(options.signal.reason); return; }
        options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      });
    },
  };
  const station = createStation({
    getModem: () => modemReady ? modem : null, isBusy: () => busy,
    onBusy: value => busyChanges.push(value),
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (fetchImpl) return fetchImpl(url, options);
      return response(url.endsWith('initial-feed.json') ? feed() : url.endsWith('replay-feed.json') ? replay() : feed('live', newerAt));
    },
  });
  return {
    station, requests, transmissions, previews, audioOrder, busyChanges, classes, node: document.getElementById,
    start: () => document.getElementById('station-start').events.get('click')(),
    preview: () => document.getElementById('station-preview').events.get('click')(),
    changeChannel: value => { const node = document.getElementById('station-channel'); node.value = value; node.events.get('change')(); },
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
  assert.equal(options.channel, 'radio');
  assert.equal(options.repeat, 2);
  assert.equal(f.node('station-channel').disabled, true);
  assert.equal(f.node('station-preview').disabled, true);
  assert.equal(f.node('station-start').disabled, false);
  assert.deepEqual(f.audioOrder, ['prime', 'preview', 'transmit']);
  assert.equal(f.previews.length, 1);
  assert.equal(f.previews[0].keepAlive, true);
  assert.equal(f.previews[0].seconds, 5);
  assert.equal(f.previews[0].channel, options.channel);
  assert.match(f.node('station-state').textContent, /Radio simulada · estable/);
  assert.ok(f.requests.every(request => request.options.credentials === 'same-origin'));
  f.station.stop();
  await running;
  assert.equal(f.station.running, false);
  assert.deepEqual(f.busyChanges, [true, false]);
  assert.equal(f.stopCount, 1);
  assert.equal(f.classes.size, 0);
  assert.equal(f.node('station-channel').disabled, false);
  assert.equal(f.node('station-preview').disabled, false);
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
  assert.equal(f.previews.length, 0);
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
  assert.equal(f.previews.length, 0);
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
  assert.equal(f.node('station-channel').disabled, false);
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
  f.node('station-speed').value = 'fastest';
  f.changeChannel('weak');
  await f.start();
  assert.equal(f.transmissions.length, 2);
  const fields = await Promise.all(f.transmissions.map(transmission => decode(transmission.frames)));
  assert.deepEqual(fields.map(field => field.observedAt), [initialAt, newerAt]);
  assert.ok(fields.every(field => field.context === 'replay'));
  assert.ok(f.transmissions.every(transmission => transmission.options.keepAlive));
  assert.ok(f.transmissions.every(transmission => transmission.options.channel === 'weak' && transmission.options.speed === 'fastest'));
  assert.equal(f.previews.length, 1, 'the five-second introduction plays once across successive snapshots');
  assert.equal(f.previews[0].channel, 'weak');
  assert.deepEqual(f.audioOrder, ['prime', 'preview', 'transmit', 'transmit']);
  assert.equal(f.primeCount, 1);
  assert.equal(f.stopCount, 1);
  assert.deepEqual(f.busyChanges, [true, false]);
  assert.equal(f.node('station-channel').disabled, false);
});

test('direct sound reaches every grid transmission and progress retains the selected channel', async t => {
  const states = [], progress = [];
  const multiFeed = () => {
    const value = feed('live', newerAt);
    value.fields.push({ ...value.fields[0], id: 'another-field', values: [3, 2, 1, 0] });
    return value;
  };
  let f;
  f = fixture(t, {
    fetchImpl: async url => response(url.endsWith('replay-feed.json') ? replay() : multiFeed()),
    transmit: async (_frames, options) => {
      states.push(f.node('station-state').textContent);
      options.onProgress({ sent: 2 });
      progress.push(f.node('station-progress-text').textContent);
      assert.equal(f.node('station-channel').disabled, true);
      if (f.transmissions.length === 2) f.station.stop();
    },
  });
  f.changeChannel('direct');
  await f.start();
  assert.equal(f.transmissions.length, 2);
  assert.equal(f.previews.length, 1, 'the introduction is shared by all grids in one emission');
  assert.equal(f.previews[0].channel, 'direct');
  assert.ok(f.transmissions.every(transmission => transmission.options.channel === 'direct'));
  assert.ok(states.every(state => state.includes('Emitiendo análisis') && state.includes('Sonido directo')));
  assert.ok(progress.every(state => state.includes('Sonido directo')));
  assert.deepEqual((await Promise.all(f.transmissions.map(transmission => decode(transmission.frames)))).map(field => field.id), ['regional-field', 'another-field']);
  assert.equal(f.node('station-channel').disabled, false);
});

test('channel descriptions identify the simulation and distinguish direct, stable and variable sound', t => {
  const f = fixture(t);
  assert.equal(f.node('station-channel').value, 'radio');
  assert.match(f.node('station-channel-info').textContent, /Simulación de una radio estable/);
  f.changeChannel('weak');
  assert.match(f.node('station-channel-info').textContent, /señal variable/);
  assert.match(f.node('station-channel-info').textContent, /Puede perder fragmentos/);
  f.changeChannel('direct');
  assert.match(f.node('station-channel-info').textContent, /sin efectos de radio/);
  for (const value of ['direct', 'radio', 'weak']) {
    f.changeChannel(value);
    const description = f.node('station-channel-info').textContent;
    assert.match(description, /siseo, banda reducida y desvanecimiento/);
    assert.match(description, /micrófono/);
    assert.match(description, /[Nn]o prueba una emisora real/);
  }
});

test('transmission errors unlock the channel and a later emission may use a different profile', async t => {
  const f = fixture(t, { transmit: async () => { throw new Error('Audio output failed'); } });
  await f.start();
  assert.equal(f.node('station-state').textContent, 'Audio output failed');
  assert.equal(f.node('station-channel').disabled, false);
  assert.equal(f.station.running, false);
  f.changeChannel('weak');
  await f.start();
  assert.deepEqual(f.transmissions.map(transmission => transmission.options.channel), ['radio', 'weak']);
  assert.equal(f.node('station-channel').disabled, false);
  assert.deepEqual(f.busyChanges, [true, false, true, false]);
});

test('an unsupported channel cannot silently transmit direct sound', async t => {
  const f = fixture(t);
  f.changeChannel('unknown');
  await f.start();
  assert.equal(f.transmissions.length, 0);
  assert.equal(f.previews.length, 0);
  assert.equal(f.node('station-state').textContent, 'Canal de sonido no válido.');
  assert.equal(f.node('station-channel').disabled, false);
  assert.equal(f.station.running, false);
});

test('the sound preview primes within the gesture and never fetches or emits source data', async t => {
  const f = fixture(t, { fetchImpl: () => { throw new Error('Preview must not fetch source data'); } });
  const first = f.preview();
  assert.equal(f.primeCount, 1);
  await first;
  assert.equal(f.previews.length, 1);
  assert.equal(f.previews[0].channel, 'radio');
  assert.equal(f.previews[0].seconds, 5);
  assert.equal(f.previews[0].keepAlive, false);
  assert.ok(f.previews[0].signal instanceof AbortSignal);
  assert.deepEqual(Object.keys(f.previews[0]).sort(), ['channel', 'keepAlive', 'seconds', 'signal'], 'voice playback carries no fields or transport payload');
  assert.equal(f.requests.length, 0);
  assert.equal(f.transmissions.length, 0);
  assert.deepEqual(f.audioOrder, ['prime', 'preview']);
  assert.deepEqual(f.busyChanges, [true, false]);
  assert.equal(f.stopCount, 1);
  assert.equal(f.station.running, false);
  assert.equal(f.node('station-start').disabled, false);
  assert.equal(f.node('station-preview').disabled, false);
  assert.equal(f.node('station-channel').disabled, false);
  assert.match(f.node('station-state').textContent, /No se enviaron datos/);
  f.changeChannel('weak');
  f.node('station-context').value = 'replay';
  f.node('station-speed').value = 'fastest';
  await f.preview();
  assert.equal(f.previews[1].channel, 'weak');
  assert.equal(f.requests.length, 0);
  assert.equal(f.transmissions.length, 0);
});

test('a preview owns the shared audio controls and either its button or station stop can cancel it', async t => {
  const pending = deferred();
  const f = fixture(t, { previewChannel: () => pending.promise });
  const running = f.preview();
  await waitFor(() => f.previews.length === 1);
  assert.equal(f.node('station-start').disabled, true);
  assert.equal(f.node('station-preview').disabled, false);
  assert.equal(f.node('station-preview').textContent, 'Detener escucha de prueba');
  for (const id of ['station-context', 'station-speed', 'station-channel']) assert.equal(f.node(id).disabled, true);
  await f.start();
  assert.equal(f.station.running, true, 'the other disabled control cannot replace the active preview');
  assert.equal(f.primeCount, 1);
  await f.preview();
  await running;
  assert.equal(f.previews[0].signal.aborted, true);
  assert.equal(f.requests.length, 0);
  assert.equal(f.transmissions.length, 0);
  assert.equal(f.node('station-start').disabled, false);
  assert.equal(f.node('station-preview').textContent, 'Escuchar radio · 5 segundos');
  for (const id of ['station-context', 'station-speed', 'station-channel']) assert.equal(f.node(id).disabled, false);
  const restarted = f.preview();
  await waitFor(() => f.previews.length === 2);
  f.station.stop();
  await restarted;
  assert.equal(f.station.running, false);
  assert.equal(f.stopCount, 2);
  pending.resolve();
});

test('stopping a prepared station during its introduction emits no data and preserves a restart', async t => {
  const pending = deferred();
  let f;
  f = fixture(t, { previewChannel: () => f.previews.length === 1 ? pending.promise : Promise.resolve() });
  await f.station.prepare();
  const sourceRequests = f.requests.length;
  const running = f.start();
  await waitFor(() => f.previews.length === 1);
  assert.equal(f.node('station-start').textContent, 'Detener emisión continua');
  assert.equal(f.node('station-preview').disabled, true);
  assert.match(f.node('station-state').textContent, /locutor y sintonía · 5 segundos/);
  assert.equal(f.transmissions.length, 0);
  await f.preview();
  assert.equal(f.station.running, true, 'preview cannot interrupt or overlap the station introduction');
  await f.start();
  await running;
  assert.equal(f.previews[0].signal.aborted, true);
  assert.equal(f.transmissions.length, 0);
  assert.equal(f.station.running, false);
  const restarted = f.start();
  await waitFor(() => f.transmissions.length === 1);
  assert.equal(f.previews.length, 2);
  assert.equal(f.requests.length, sourceRequests);
  f.station.stop();
  await restarted;
  pending.resolve();
});

test('a sound preview pending audio resume cancels without fetching or playing an introduction', async t => {
  const primed = deferred();
  const f = fixture(t, { prime: () => primed.promise });
  const running = f.preview();
  f.station.stop();
  await running;
  assert.equal(f.requests.length, 0);
  assert.equal(f.previews.length, 0);
  assert.equal(f.transmissions.length, 0);
  assert.equal(f.node('station-start').disabled, false);
  assert.equal(f.node('station-preview').disabled, false);
  assert.equal(f.node('station-channel').disabled, false);
  primed.resolve();
});

test('an introduction failure restores the preview and sender controls without sending data', async t => {
  const f = fixture(t, { previewChannel: () => { throw new Error('Voice unavailable'); } });
  await f.preview();
  assert.equal(f.node('station-state').textContent, 'Voice unavailable');
  assert.equal(f.requests.length, 0);
  assert.equal(f.transmissions.length, 0);
  assert.equal(f.station.running, false);
  for (const id of ['station-start', 'station-preview', 'station-context', 'station-speed', 'station-channel']) assert.equal(f.node(id).disabled, false);
  assert.deepEqual(f.busyChanges, [true, false]);
});

test('a preview cannot prime while another audio owner is busy', async t => {
  const f = fixture(t, { busy: true });
  await f.preview();
  assert.equal(f.primeCount, 0);
  assert.equal(f.previews.length, 0);
  assert.equal(f.stopCount, 0);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.busyChanges, []);
});

test('a preview waits for an available modem without claiming audio ownership', async t => {
  const f = fixture(t, { modemReady: false });
  await f.preview();
  assert.equal(f.primeCount, 0);
  assert.equal(f.previews.length, 0);
  assert.equal(f.requests.length, 0);
  assert.deepEqual(f.busyChanges, []);
  assert.equal(f.station.running, false);
});
