import test from 'node:test';
import assert from 'node:assert/strict';
import { createScreenAwake } from '../src/screen-awake.js';

const settle = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

function fixture({ pending = false, unsupported = false } = {}) {
  const document = new EventTarget();
  document.hidden = false;
  const acquisitions = [];
  const errors = [];
  const wakeLock = unsupported ? undefined : { request(type) {
    assert.equal(type, 'screen');
    const sentinel = new EventTarget();
    sentinel.released = false;
    sentinel.releases = 0;
    sentinel.release = () => {
      sentinel.releases++;
      sentinel.released = true;
      sentinel.dispatchEvent(new Event('release'));
      return Promise.resolve();
    };
    const result = deferred();
    acquisitions.push({ sentinel, ...result });
    return pending ? result.promise : Promise.resolve(sentinel);
  } };
  const awake = createScreenAwake({ document, wakeLock, onError: error => errors.push(error) });
  return { awake, acquisitions, errors, document,
    visibility(hidden) { document.hidden = hidden; document.dispatchEvent(new Event('visibilitychange')); },
  };
}

test('only active visible operations acquire a lock; repeated activity shares it', async () => {
  const f = fixture();
  assert.equal(f.acquisitions.length, 0);
  f.awake.setActive(true);
  assert.equal(f.acquisitions.length, 1, 'the request starts inside the initiating gesture');
  f.awake.setActive(true);
  await settle();
  f.awake.setActive(true);
  assert.equal(f.acquisitions.length, 1);
  f.awake.setActive(false);
  assert.equal(f.acquisitions[0].sentinel.releases, 1);
  f.awake.dispose();
  assert.equal(f.acquisitions[0].sentinel.releases, 1);
});

test('stop during pending acquisition releases the eventual lock', async () => {
  const f = fixture({ pending: true });
  f.awake.setActive(true);
  f.awake.setActive(false);
  f.acquisitions[0].resolve(f.acquisitions[0].sentinel);
  await settle();
  assert.equal(f.acquisitions[0].sentinel.releases, 1);
  assert.deepEqual(f.errors, []);
});

test('a restart during pending acquisition retains one lock for the current operation', async () => {
  const f = fixture({ pending: true });
  f.awake.setActive(true);
  f.awake.setActive(false);
  f.awake.setActive(true);
  f.acquisitions[0].resolve(f.acquisitions[0].sentinel);
  await settle();
  assert.equal(f.acquisitions.length, 1);
  assert.equal(f.acquisitions[0].sentinel.releases, 0);
  f.awake.dispose();
  assert.equal(f.acquisitions[0].sentinel.releases, 1);
});

test('visibility releases an active lock and reacquires on return while still active', async () => {
  const f = fixture();
  f.visibility(true);
  f.awake.setActive(true);
  assert.equal(f.acquisitions.length, 0);
  f.visibility(false);
  await settle();
  f.visibility(true);
  assert.equal(f.acquisitions[0].sentinel.releases, 1);
  f.visibility(false);
  await settle();
  assert.equal(f.acquisitions.length, 2);
  f.awake.setActive(false);
  f.visibility(true);
  f.visibility(false);
  assert.equal(f.acquisitions.length, 2, 'stopped operations do not resume merely by becoming visible');
});

test('hiding or disposing during pending acquisition releases it without reacquiring', async () => {
  for (const action of ['hide', 'dispose']) {
    const f = fixture({ pending: true });
    f.awake.setActive(true);
    if (action === 'hide') f.visibility(true); else f.awake.dispose();
    f.acquisitions[0].resolve(f.acquisitions[0].sentinel);
    await settle();
    assert.equal(f.acquisitions[0].sentinel.releases, 1);
    if (action === 'dispose') {
      f.awake.setActive(true);
      f.visibility(true); f.visibility(false);
      assert.equal(f.acquisitions.length, 1);
    }
  }
});

test('a delayed release event from an old lock cannot discard a newer lock', async () => {
  const f = fixture();
  f.awake.setActive(true);
  await settle();
  const old = f.acquisitions[0].sentinel;
  old.release = () => { old.releases++; return Promise.resolve(); };
  f.awake.setActive(false);
  f.awake.setActive(true);
  await settle();
  old.dispatchEvent(new Event('release'));
  f.awake.setActive(true);
  assert.equal(f.acquisitions.length, 2);
  f.awake.dispose();
  assert.equal(f.acquisitions[1].sentinel.releases, 1);
});

test('unsupported, denied and failed release requests are best-effort and do not reject callers', async () => {
  const missing = fixture({ unsupported: true });
  missing.awake.setActive(true); missing.awake.dispose();
  const errors = [];
  const failure = new Error('Power policy denied');
  const wakeLock = { request: () => Promise.reject(failure) };
  const awake = createScreenAwake({ wakeLock, onError: error => errors.push(error) });
  awake.setActive(true);
  await settle();
  assert.deepEqual(errors, [failure]);
  wakeLock.request = () => { throw failure; };
  awake.setActive(true);
  assert.deepEqual(errors, [failure, failure]);
  awake.dispose();
  const f = fixture();
  f.awake.setActive(true); await settle();
  f.acquisitions[0].sentinel.release = () => Promise.reject(failure);
  f.awake.setActive(false); await settle();
  assert.deepEqual(f.errors, [failure]);
});

let audioSequence = 0;
async function audioFixture(t, { captureError, pendingResume = false, holdPlayback = false } = {}) {
  const activity = [];
  const resume = deferred();
  const sources = [];
  const node = () => ({ connect() {}, disconnect() {} });
  class AudioContext {
    constructor() { this.state = 'running'; this.sampleRate = 48000; this.destination = {}; }
    resume() { return pendingResume ? resume.promise : Promise.resolve(); }
    close() { this.state = 'closed'; return Promise.resolve(); }
    createMediaStreamSource() { return node(); }
    createScriptProcessor() { return node(); }
    createGain() { return { ...node(), gain: { value: 1 } }; }
    createBuffer() { return { duration: 0, copyToChannel() {} }; }
    createBufferSource() {
      const source = { ...node(), stop() {}, start() { if (!holdPlayback) queueMicrotask(() => this.onended?.()); } };
      sources.push(source); return source;
    }
  }
  const track = { stop() {} };
  const module = { disableLog() {}, getDefaultParameters: () => ({}), init: () => 0, free() {},
    SampleFormat: { GGWAVE_SAMPLE_FORMAT_F32: 4 }, ProtocolId: { GGWAVE_PROTOCOL_AUDIBLE_FAST: 11 },
    encode: () => new Float32Array([0.1]),
  };
  for (const [key, value] of Object.entries({
    window: { AudioContext, isSecureContext: true, ggwave_factory: async () => module },
    navigator: { mediaDevices: { getUserMedia: async () => {
      if (captureError) throw captureError;
      return { getTracks: () => [track], getAudioTracks: () => [track] };
    } } },
  })) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  t.mock.method(globalThis, 'setTimeout', callback => { queueMicrotask(callback); return 0; });
  const { createAudioModem } = await import(`../src/audio.js?awake-test=${audioSequence++}`);
  const modem = await createAudioModem({ onActivity: event => activity.push(event) });
  return { modem, activity, resume, sources, track };
}

test('capture startup, listening, explicit stop and interruption publish the common activity contract', async t => {
  const f = await audioFixture(t);
  const listening = f.modem.listen();
  assert.deepEqual(f.activity, [{ mode: 'starting', active: true }]);
  await listening;
  await f.modem.stop();
  await f.modem.stop();
  assert.deepEqual(f.activity, [
    { mode: 'starting', active: true }, { mode: 'listening', active: true }, { mode: 'idle', active: false },
  ]);
  await f.modem.listen();
  f.track.onended();
  await settle();
  assert.deepEqual(f.activity.at(-1), { mode: 'idle', active: false });
});

test('failed microphone capture and cancelled startup clear active state', async t => {
  const f = await audioFixture(t, { captureError: new Error('Microphone unavailable') });
  await assert.rejects(f.modem.listen(), /Microphone unavailable/);
  assert.deepEqual(f.activity.map(event => event.active), [true, false]);
});

test('stop clears activity even if browser resume never settles', async t => {
  const f = await audioFixture(t, { pendingResume: true });
  const listening = f.modem.listen();
  const rejected = assert.rejects(listening, { name: 'AbortError' });
  await f.modem.stop();
  await rejected;
  assert.deepEqual(f.activity.map(event => event.active), [true, false]);
});

test('kept-alive transmitters are inactive between operations', async t => {
  const f = await audioFixture(t);
  await f.modem.prime();
  assert.deepEqual(f.activity, [], 'a primed context alone does not keep the screen awake');
  await f.modem.transmit([new Uint8Array([1])], { repeat: 1, keepAlive: true });
  await f.modem.transmit([new Uint8Array([2])], { repeat: 1, keepAlive: true });
  assert.deepEqual(f.activity.map(event => event.mode), ['transmitting', 'idle', 'transmitting', 'idle']);
  assert.deepEqual(f.activity.map(event => event.active), [true, false, true, false]);
  await f.modem.stop();
});

test('aborting playback clears activity without depending on a browser ended event', async t => {
  const f = await audioFixture(t, { holdPlayback: true });
  const controller = new AbortController();
  const transmission = f.modem.transmit([new Uint8Array([1])], { signal: controller.signal });
  const rejected = assert.rejects(transmission, { name: 'AbortError' });
  await settle();
  assert.equal(f.sources.length, 1);
  controller.abort();
  await rejected;
  assert.deepEqual(f.activity.map(event => event.active), [true, false]);
});
