import test from 'node:test';
import assert from 'node:assert/strict';

let sequence = 0;
async function until(predicate) {
  for (let turn=0;turn<20;turn++) {if(predicate())return;await Promise.resolve();}
  assert.ok(predicate(),'Expected audio lifecycle event did not occur');
}

async function fixture(t, { holdPlayback = false, holdResume = false, suppressStoppedEvent = false, encodingError = false, onActivity } = {}) {
  const contexts = [];
  const encoded = [];
  const freed = [];
  const sources = [];
  const processors = [];
  let nextInstance = 0;
  let finishResume;
  let trackStops = 0;
  let microphoneRequests = 0;
  const node = () => ({ connections: [], connect(target) { this.connections.push(target); }, disconnect() { this.disconnected = true; } });
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
      const source = { ...node(), start() { this.started = true; if (!holdPlayback && !this.loop) queueMicrotask(() => this.onended?.()); }, stop() { this.stopped = true; if (!suppressStoppedEvent) queueMicrotask(() => this.onended?.()); } };
      sources.push(source);
      return source;
    }
    createMediaStreamSource() { return node(); }
    createScriptProcessor() { const processor = node(); processors.push(processor); return processor; }
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
  const modem = await createAudioModem({ onActivity });
  return { modem, contexts, sources, processors, encoded, freed, finishResume: () => finishResume?.(), get trackStops() { return trackStops; }, get microphoneRequests() { return microphoneRequests; } };
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
  await until(()=>f.sources.length===1);
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
  await assert.rejects(f.modem.transmit([new Uint8Array([1])], { channel: 'unknown' }), /Canal/);
  await assert.rejects(f.modem.transmit([new Uint8Array([1])], { keepAlive: 'yes' }), /keepAlive/);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(f.modem.transmit([new Uint8Array([1])], { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(f.contexts.length, 0);
  await assert.rejects(f.modem.transmit([new Uint8Array([1])], { keepAlive: true }), /Encoder failed/);
  assert.equal(f.contexts[0].closes, 1);
  assert.equal(f.freed.length, 1);
});


test('stop settles active playback even when closing the context suppresses the ended event', async t => {
  const f=await fixture(t,{holdPlayback:true,suppressStoppedEvent:true});
  const transmission=f.modem.transmit([new Uint8Array([1])],{keepAlive:true});
  await until(()=>f.sources.length===1);
  const rejected=assert.rejects(transmission,{name:'AbortError'});
  await f.modem.stop();
  await rejected;
  assert.equal(f.sources[0].disconnected,true);
  assert.equal(f.contexts[0].closes,1);
  const restarted=f.modem.transmit([new Uint8Array([2])]);
  await Promise.resolve();
  const restartedRejected=assert.rejects(restarted,{name:'AbortError'});
  await f.modem.stop();await restartedRejected;
  assert.equal(f.contexts.length,2);
});

test('audio interruption settles playback and releases the context without an ended event', async t => {
  const f=await fixture(t,{holdPlayback:true,suppressStoppedEvent:true});
  const transmission=f.modem.transmit([new Uint8Array([1])],{keepAlive:true});
  await until(()=>f.sources.length===1);
  const rejected=assert.rejects(transmission,{name:'AbortError'});
  f.contexts[0].state='interrupted';f.contexts[0].onstatechange();
  await rejected;
  assert.equal(f.contexts[0].closes,1);
});


test('stop rejects pending priming even if the browser never settles resume', async t=>{
  const f=await fixture(t,{holdResume:true});
  const pending=f.modem.prime();const rejected=assert.rejects(pending,{name:'AbortError'});
  await f.modem.stop();await rejected;
  assert.equal(f.contexts[0].closes,1);
});

test('radio processing receives every waveform and remains clocked through packet and feed gaps', async t => {
  const activity = [];
  const f = await fixture(t, { onActivity: event => activity.push(event) });
  await f.modem.transmit([new Uint8Array([1]), new Uint8Array([2])], { channel: 'radio', keepAlive: true });
  const processor = f.processors[0];
  assert.equal(f.processors.length, 1);
  const clock = f.sources.find(source => source.loop);
  assert.equal(clock.started, true);
  assert.deepEqual(clock.connections, [processor]);
  assert.ok(f.sources.filter(source => !source.loop).every(source => source.connections[0] === processor));
  assert.deepEqual(processor.connections, [f.contexts[0].destination]);
  const input = new Float32Array(4096), output = new Float32Array(4096);
  const render = () => processor.onaudioprocess({ inputBuffer: { getChannelData: () => input }, outputBuffer: { getChannelData: () => output } });
  render();
  assert.ok(output.some(sample => sample !== 0), 'silence between packets contains real output hiss');
  const first = output.slice(); render();
  assert.notDeepEqual(output, first, 'noise and channel state continue across callbacks');
  assert.deepEqual(activity.at(-1), { mode: 'idle', active: true }, 'continuous audio keeps activity while waiting for another field');
  await f.modem.transmit([new Uint8Array([3])], { channel: 'radio', keepAlive: true });
  assert.equal(f.processors.length, 1, 'the same channel also spans separate field transmissions');
  assert.equal(f.microphoneRequests, 0);
  await f.modem.stop();
  assert.equal(clock.stopped, true);
  assert.equal(processor.onaudioprocess, null);
  assert.equal(processor.disconnected, true);
  assert.deepEqual(activity.at(-1), { mode: 'idle', active: false });
});

test('changing channel or starting reception releases the previous simulated output', async t => {
  const f = await fixture(t);
  await f.modem.transmit([new Uint8Array([1])], { channel: 'radio', keepAlive: true });
  const first = f.processors[0];
  await f.modem.transmit([new Uint8Array([2])], { channel: 'weak', keepAlive: true });
  assert.equal(first.onaudioprocess, null);
  const second = f.processors[1];
  await f.modem.transmit([new Uint8Array([3])], { channel: 'direct', keepAlive: true });
  assert.equal(second.onaudioprocess, null);
  assert.equal(f.sources.at(-1).connections[0], f.contexts[0].destination);
  await f.modem.transmit([new Uint8Array([4])], { channel: 'radio', keepAlive: true });
  const third = f.processors[2];
  await f.modem.listen();
  assert.equal(third.onaudioprocess, null);
  assert.ok(f.sources.filter(source => source.loop).every(source => source.stopped));
  await f.modem.stop();
});

test('failed encoding and abort clean up the continuous noise graph', async t => {
  const f = await fixture(t, { encodingError: true });
  await assert.rejects(f.modem.transmit([new Uint8Array([1])], { channel: 'radio', keepAlive: true }), /Encoder failed/);
  assert.equal(f.processors[0].onaudioprocess, null);
  assert.equal(f.sources[0].stopped, true);
  const g = await fixture(t, { holdPlayback: true, suppressStoppedEvent: true });
  const controller = new AbortController();
  const pending = g.modem.transmit([new Uint8Array([1])], { channel: 'weak', signal: controller.signal });
  const rejected = assert.rejects(pending, { name: 'AbortError' });
  await until(() => g.sources.some(source => !source.loop));
  controller.abort(); await rejected;
  assert.ok(g.sources.every(source => source.stopped));
  assert.equal(g.processors[0].onaudioprocess, null);
});

test('suspending a retained hiss channel stops it even between transmissions', async t => {
  const activity = [];
  const f = await fixture(t, { onActivity: event => activity.push(event) });
  await f.modem.transmit([new Uint8Array([1])], { channel: 'radio', keepAlive: true });
  assert.deepEqual(activity.at(-1), { mode: 'idle', active: true });
  f.contexts[0].state = 'suspended';
  f.contexts[0].onstatechange();
  await until(() => f.contexts[0].closes === 1);
  assert.equal(f.processors[0].onaudioprocess, null);
  assert.equal(f.sources.find(source => source.loop).stopped, true);
  assert.deepEqual(activity.at(-1), { mode: 'idle', active: false });
});
