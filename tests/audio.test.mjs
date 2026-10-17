import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;

async function fixture(t, { holdPlayback = false, holdResume = false, encodingError = false } = {}) {
  const contexts = [];
  const encoded = [];
  const freed = [];
  const sources = [];
  let nextInstance = 0;
  let finishResume;
  let trackStops = 0;
  let microphoneRequests = 0;
  const node = () => ({ connect() {}, disconnect() { this.disconnected = true; } });
  class AudioContext {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.destination = {}; this.resumes = 0; this.closes = 0; contexts.push(this); }
    resume() {
      this.resumes++;
      this.state = 'running';
      return holdResume ? new Promise(resolve => { finishResume = resolve; }) : Promise.resolve();
    }
    close() { this.closes++; this.state = 'closed'; return Promise.resolve(); }
    createBuffer(channels, length, rate) { return { duration: length / rate, copyToChannel() {} }; }
    createBufferSource() {
      const source = { ...node(), start() { if (!holdPlayback) queueMicrotask(() => this.onended?.()); }, stop() { this.stopped = true; queueMicrotask(() => this.onended?.()); } };
      sources.push(source);
      return source;
    }
    createMediaStreamSource() { return node(); }
    createScriptProcessor() { return node(); }
    createGain() { return { ...node(), gain: { value: 1 } }; }
  }
  const track = { stop() { trackStops++; } };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const module = {
    disableLog() {}, getDefaultParameters: () => ({}), init: () => nextInstance++,
    SampleFormat: { GGWAVE_SAMPLE_FORMAT_F32: 4 },
    ProtocolId: { GGWAVE_PROTOCOL_AUDIBLE_FAST: 11, GGWAVE_PROTOCOL_AUDIBLE_FASTEST: 12 },
    free(instance) { freed.push(instance); },
    encode(instance, frame, protocol) {
      if (encodingError) throw new Error('Encoder failed');
      encoded.push({ instance, frame: [...frame], protocol });
      return new Float32Array([0.1, 0.2, 0.3, 0.4]);
    },
  };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { AudioContext, ggwave_factory: async () => module, isSecureContext: true } });
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: { getUserMedia: async () => { microphoneRequests++; return stream; } } } });
  t.after(() => {
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
    if (previousNavigator) Object.defineProperty(globalThis, 'navigator', previousNavigator); else delete globalThis.navigator;
  });
  t.mock.method(globalThis, 'setTimeout', callback => { queueMicrotask(callback); return 0; });
  const { createAudioModem } = await import(`../src/audio.js?lifecycle-test=${sequence++}`);
  const modem = await createAudioModem();
  return { modem, contexts, sources, encoded, freed, finishResume: () => finishResume?.(), get trackStops() { return trackStops; }, get microphoneRequests() { return microphoneRequests; } };
}

test('priming unlocks synchronously and consecutive kept-alive transmissions reuse one context and modem', async t => {
  const f = await fixture(t);
  const priming = f.modem.prime();
  assert.equal(f.contexts.length, 1);
  assert.equal(f.contexts[0].resumes, 1, 'resume happens inside the initiating gesture, before an await');
  assert.equal(f.microphoneRequests, 0);
  await priming;
  const statuses = [];
  await f.modem.transmit([new Uint8Array([1, 2])], { repeat: 1, keepAlive: true, onStatus: status => statuses.push(status) });
  await f.modem.transmit([new Uint8Array([3, 4])], { repeat: 1, keepAlive: true, speed: 'fastest', onStatus: status => statuses.push(status) });
  assert.equal(f.contexts.length, 1);
  assert.equal(f.contexts[0].closes, 0);
  assert.equal(f.freed.length, 0);
  assert.deepEqual(f.encoded.map(call => call.protocol), [11, 12]);
  assert.deepEqual(f.encoded.map(call => call.instance), [0, 0]);
  assert.deepEqual(statuses, ['transmitting', 'idle', 'transmitting', 'idle']);
  assert.ok(f.sources.every(source => source.disconnected));
  await f.modem.stop();
  assert.equal(f.contexts[0].closes, 1);
  assert.deepEqual(f.freed, [0]);
  assert.equal(statuses.at(-1), 'stopped');
});

test('default transmission preserves fast speed, two repetitions and full cleanup', async t => {
  const f = await fixture(t);
  await f.modem.transmit([new Uint8Array([42])]);
  assert.deepEqual(f.encoded.map(call => call.protocol), [11, 11]);
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.freed.length, 1);
  await f.modem.transmit([new Uint8Array([43])], { repeat: 1 });
  assert.equal(f.contexts.length, 2, 'the default does not retain a closed context');
});

test('abort interrupts an active kept-alive transmission and closes resources', async t => {
  const f = await fixture(t, { holdPlayback: true });
  const controller = new AbortController();
  const transmission = f.modem.transmit([new Uint8Array([1])], { keepAlive: true, signal: controller.signal });
  await Promise.resolve();
  assert.equal(f.sources.length, 1);
  controller.abort();
  await assert.rejects(transmission, { name: 'AbortError' });
  assert.equal(f.sources[0].stopped, true);
  assert.equal(f.sources[0].disconnected, true);
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.freed.length, 1);
});

test('stop during pending resume prevents later transmission or microphone capture', async t => {
  const f = await fixture(t, { holdResume: true });
  const transmission = f.modem.transmit([new Uint8Array([1])], { keepAlive: true });
  await f.modem.stop();
  f.finishResume();
  await assert.rejects(transmission, { name: 'AbortError' });
  assert.equal(f.encoded.length, 0);
  const listening = f.modem.listen();
  await f.modem.stop();
  f.finishResume();
  await assert.rejects(listening, { name: 'AbortError' });
  assert.equal(f.microphoneRequests, 0);
});

test('a retained emitter context can become a receiver and stop closes the microphone', async t => {
  const f = await fixture(t);
  await f.modem.transmit([new Uint8Array([1])], { repeat: 1, keepAlive: true });
  await f.modem.listen();
  assert.equal(f.contexts.length, 1);
  assert.equal(f.microphoneRequests, 1);
  await assert.rejects(f.modem.transmit([new Uint8Array([2])]), /Detén/);
  await f.modem.stop();
  assert.equal(f.trackStops, 1);
  assert.equal(f.contexts[0].closes, 1);
});

test('invalid options never open audio and encoding failure closes even with keepAlive', async t => {
  const f = await fixture(t, { encodingError: true });
  await assert.rejects(f.modem.transmit([new Uint8Array([1])], { speed: 'ultrasonic' }), /Velocidad/);
  await assert.rejects(f.modem.transmit([new Uint8Array([1])], { keepAlive: 'yes' }), /keepAlive/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.modem.transmit([new Uint8Array([1])], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.contexts.length, 0);
  await assert.rejects(f.modem.transmit([new Uint8Array([1])], { keepAlive: true }), /Encoder failed/);
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.freed.length, 1);
});
