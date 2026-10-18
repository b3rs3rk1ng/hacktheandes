import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHANNEL_PROFILES, createAudioChannel } from '../src/audio-channel.js';
import { createAssembler, encodeField } from '../src/protocol.js';

function rms(samples, start = 0, end = samples.length) {
  let energy = 0;
  for (let index = start; index < end; index++) energy += samples[index] ** 2;
  return Math.sqrt(energy / (end - start));
}
function sine(sampleRate, frequency, seconds, amplitude = 0.2) {
  return Float32Array.from({ length: Math.round(sampleRate * seconds) }, (_, index) => amplitude * Math.sin(2 * Math.PI * frequency * index / sampleRate));
}
function processed(options, input) {
  return createAudioChannel(options).process(input, new Float32Array(input.length));
}

test('channel profiles are immutable and invalid configuration or PCM never advances state', () => {
  assert.ok(Object.isFrozen(CHANNEL_PROFILES));
  for (const value of Object.values(CHANNEL_PROFILES)) {
    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(value.introduction));
  }
  for (const options of [{ profile: 'toString' }, { profile: '' }, { sampleRate: 8000 }, { sampleRate: NaN }, { sampleRate: 44100.5 }, { seed: -1 }, { seed: 2 ** 32 }, { seed: Infinity }]) {
    assert.throws(() => createAudioChannel({ sampleRate: 44100, ...options }));
  }
  const channel = createAudioChannel({ sampleRate: 48000 });
  const output = new Float32Array([0.7, 0.7]);
  for (const input of [new Float32Array([0, NaN]), new Float32Array([0, Infinity]), new Float32Array(1), [0, 1]]) {
    assert.throws(() => channel.process(input, output));
  }
  const backing = new Float32Array(5);
  assert.throws(() => channel.process(backing.subarray(0, 3), backing.subarray(1, 4)), /solaparse/);
  assert.deepEqual(output, new Float32Array([0.7, 0.7]));
  assert.equal(channel.processedSamples, 0);
  assert.equal(channel.process(new Float32Array(0), new Float32Array(0)).length, 0);
  const input = new Float32Array([0.1, -0.1, 0]);
  assert.deepEqual(channel.process(input, new Float32Array(3)), processed({ sampleRate: 48000 }, input));
});

test('direct copies every finite PCM sample exactly, including in-place buffers', () => {
  const input = new Float32Array([0, -0, 0.1, -1, 1, 5, 1e30]);
  const channel = createAudioChannel({ profile: 'direct', sampleRate: 44100, seed: 0 });
  const output = new Float32Array(input.length);
  assert.equal(channel.process(input, output), output);
  assert.deepEqual(output, input);
  assert.equal(channel.process(output, output), output);
  assert.deepEqual(output, input);
  assert.equal(channel.beginIntroduction(), 0);
  assert.equal(channel.isIntroducing, false);
  assert.deepEqual(channel.process(input, output), input, 'direct has no introduction, hiss or speaker effect');
  assert.equal(channel.processedSamples, input.length * 3);
});

test('introduction duration and rejected operations preserve sample-clock state', () => {
  const channel = createAudioChannel({ profile: 'radio', sampleRate: 48000 });
  assert.equal(channel.isIntroducing, false, 'there is no tuning scene until explicitly requested');
  assert.equal(channel.beginIntroduction(), 5);
  channel.process(new Float32Array(4800), new Float32Array(4800));
  assert.equal(channel.introductionRemainingSeconds, 4.9);
  for (const seconds of [0, -1, 0.9, 15.1, Infinity, NaN, '5', null]) assert.throws(() => channel.beginIntroduction(seconds));
  assert.throws(() => channel.process(new Float32Array([0, Infinity]), new Float32Array(2)));
  assert.equal(channel.introductionRemainingSeconds, 4.9, 'invalid calls cannot restart or advance the scene');
  channel.process(new Float32Array(235200), new Float32Array(235200));
  assert.equal(channel.isIntroducing, false);
  assert.equal(channel.introductionRemainingSeconds, 0);
  assert.equal(channel.processedSamples, 240000);
  assert.equal(channel.beginIntroduction(1), 1, 'a later explicit scene is possible without resetting the channel');
  assert.equal(channel.processedSamples, 240000);
});

for (const sampleRate of [44100, 48000]) for (const profile of ['radio', 'weak']) {
  test(`${profile} introduction at ${sampleRate} Hz ends at five seconds regardless of block boundaries`, () => {
    const options = { profile, sampleRate, seed: 42 };
    const input = sine(sampleRate, 1200, 5.2);
    input.fill(0, 0, Math.round(sampleRate * 0.7));
    const wholeChannel = createAudioChannel(options);
    wholeChannel.beginIntroduction(5);
    const whole = wholeChannel.process(input, new Float32Array(input.length));
    const channel = createAudioChannel(options), chunked = new Float32Array(input.length);
    channel.beginIntroduction(5);
    for (let offset = 0; offset < input.length; offset += 4093) {
      const end = Math.min(input.length, offset + 4093);
      channel.process(input.subarray(offset, end), chunked.subarray(offset, end));
    }
    assert.deepEqual(chunked, whole, 'the scene must not restart or truncate at a packet/buffer boundary');
    assert.equal(channel.isIntroducing, false);
    assert.equal(channel.introductionRemainingSeconds, 0);
    assert.ok(rms(whole, 0, Math.round(sampleRate * 0.5)) > 0.02, 'silent input produces audible tuning/static');
    assert.ok(whole.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
  });
}

test('the introduction has recognizable static and a narrower voice band, then returns to a gentler data background', () => {
  const sampleRate = 44100, options = { profile: 'radio', sampleRate, seed: 19 };
  const channel = createAudioChannel(options);
  channel.beginIntroduction(5);
  const staticOnly = channel.process(new Float32Array(sampleRate * 6), new Float32Array(sampleRate * 6));
  assert.ok(rms(staticOnly, 0, sampleRate / 2) > rms(staticOnly, sampleRate * 5, sampleRate * 6) * 2);
  const input = sine(sampleRate, 6500, 2, 0.4);
  const intro = createAudioChannel(options);
  intro.beginIntroduction(5);
  const voicePath = intro.process(input, new Float32Array(input.length));
  const dataPath = processed(options, input);
  assert.ok(rms(voicePath, sampleRate) < rms(dataPath, sampleRate) * 0.5, 'only voice is limited to the small radio speaker band');
});

for (const sampleRate of [44100, 48000]) for (const profile of ['radio', 'weak']) {
  test(`${profile} at ${sampleRate} Hz preserves exact state across uneven blocks, silence and in-place buffers`, () => {
    const input = sine(sampleRate, 3500, 0.7);
    input.fill(0, 3000, 12000);
    const options = { profile, sampleRate, seed: 97 };
    const full = processed(options, input);
    const chunked = input.slice();
    const channel = createAudioChannel(options);
    let offset = 0, block = 0;
    while (offset < input.length) {
      const end = Math.min(input.length, offset + [1, 4096, 43, 127][block++ % 4]);
      channel.process(chunked.subarray(offset, end), chunked.subarray(offset, end));
      offset = end;
    }
    assert.deepEqual(chunked, full, 'chunk boundaries cannot restart fading, hiss or filters');
    assert.equal(channel.processedSamples, input.length);
    assert.notDeepEqual(processed({ ...options, seed: 98 }, input), full);
    assert.ok(full.every(Number.isFinite));
    assert.ok(rms(full, 5000, 10000) > 0.002, 'a packet gap still contains hiss');
  });
}

test('radio-shaped signal reduces very low/high frequencies and varies gain smoothly over seconds', () => {
  const sampleRate = 44100, options = { sampleRate, profile: 'radio', seed: 42 };
  const middle = processed(options, sine(sampleRate, 3000, 1));
  const low = processed(options, sine(sampleRate, 30, 1));
  const high = processed(options, sine(sampleRate, 16000, 1));
  assert.ok(rms(low, 1000) < rms(middle, 1000) * 0.15);
  assert.ok(rms(high, 1000) < rms(middle, 1000) * 0.15);
  const varying = processed(options, sine(sampleRate, 3000, 12));
  const levels = [];
  for (let start = sampleRate; start < varying.length; start += sampleRate / 2) levels.push(rms(varying, start, start + sampleRate / 2));
  assert.ok(Math.max(...levels) / Math.min(...levels) > 1.1, 'signal strength changes over seconds');
  assert.ok(levels.slice(1).every((level, index) => Math.abs(level - levels[index]) < 0.01), 'fading has no abrupt half-second gain jump');
  const loud = processed(options, new Float32Array(1000).fill(1000));
  assert.ok(loud.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
});

test('a separate weak channel has stronger persistent hiss than a normal radio', () => {
  const silence = new Float32Array(48000);
  const normal = processed({ sampleRate: 48000, profile: 'radio', seed: 1 }, silence);
  const weak = processed({ sampleRate: 48000, profile: 'weak', seed: 1 }, silence);
  assert.ok(rms(normal) > 0.004 && rms(normal) < 0.02);
  assert.ok(rms(weak) > rms(normal) * 2);
  assert.notDeepEqual(weak.subarray(0, 1024), weak.subarray(1024, 2048), 'hiss does not loop a short recording');
});

test('the supported sample-rate endpoints keep filter state finite after loud audio and silence', () => {
  for (const sampleRate of [16000, 192000]) for (const profile of ['radio', 'weak']) {
    const channel = createAudioChannel({ sampleRate, profile, seed: 0xffffffff });
    const loud = Float32Array.from({ length: 3000 }, (_, index) => index % 2 ? -1e30 : 1e30);
    channel.process(loud, loud);
    const silence = new Float32Array(3000);
    channel.process(silence, silence);
    assert.ok(loud.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
    assert.ok(silence.every(sample => Number.isFinite(sample) && Math.abs(sample) <= 1));
  }
});

test('complete geographic fields survive the same radio simulation used for audible playback', async () => {
  const path = fileURLToPath(new URL('../public/vendor/ggwave-0.4.0.js', import.meta.url));
  const wrapper = { exports: {} };
  new Function('module', 'exports', 'require', '__filename', '__dirname', await readFile(path, 'utf8'))(wrapper, wrapper.exports, createRequire(import.meta.url), path, dirname(path));
  const modem = await wrapper.exports({ print: () => {}, printErr: () => {} });
  modem.disableLog();
  for (const [sampleRate, speed, bounds, values, introductionSeconds] of [
    [44100, 'FAST', [130, 30, 134, 34], [0, 1, 2, 255], 0],
    [48000, 'FASTEST', [18, -34, 22, -30], [3, 2, 1, 0], 0],
    [44100, 'FAST', [130, 30, 134, 34], [0, 1, 2, 255], 5],
    [48000, 'FASTEST', [18, -34, 22, -30], [3, 2, 1, 0], 5],
  ]) {
    const field = {
      version: 1, type: 'grid', id: 'radio-roundtrip', variable: 'rain-category',
      observedAt: '2026-10-17T15:00:00.000Z', expiresAt: '2026-10-17T16:00:00.000Z',
      source: { name: 'Example service', url: 'https://example.org/observations' },
      bounds, cols: 2, rows: 2, values, context: 'live',
    };
    const encoded = await encodeField(field);
    const parameters = modem.getDefaultParameters();
    parameters.sampleRateInp = sampleRate;
    parameters.sampleRateOut = sampleRate;
    const tx = modem.init(parameters);
    let rx = modem.init(parameters);
    try {
      const recordings = [new Float32Array(Math.round(sampleRate * (introductionSeconds + 0.3)))];
      for (const frame of encoded.frames) {
        const raw = modem.encode(tx, frame, modem.ProtocolId[`GGWAVE_PROTOCOL_AUDIBLE_${speed}`], 40);
        recordings.push(new Float32Array(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice().buffer), new Float32Array(Math.round(sampleRate * 0.25)));
      }
      const length = Math.ceil(recordings.reduce((sum, samples) => sum + samples.length, 0) / 4096) * 4096;
      const recording = new Float32Array(length);
      let cursor = 0;
      for (const samples of recordings) { recording.set(samples, cursor); cursor += samples.length; }
      const channel = createAudioChannel({ sampleRate, profile: 'radio', seed: 97 });
      if (introductionSeconds) channel.beginIntroduction(introductionSeconds);
      const assembler = createAssembler();
      let received;
      for (let offset = 0; offset < length; offset += 4096) {
        const input = recording.subarray(offset, offset + 4096);
        const block = channel.process(input, new Float32Array(4096));
        const bytes = modem.decode(rx, new Int8Array(block.buffer, block.byteOffset, block.byteLength));
        if (bytes?.length) {
          const result = await assembler.accept(new Uint8Array(bytes));
          if (result.state === 'complete') received = result.field;
          modem.free(rx);
          rx = modem.init(parameters);
        }
      }
      assert.deepEqual(received, field, `${sampleRate} Hz ${speed}, intro ${introductionSeconds}s: complete payload and CRC must match`);
      assert.equal(channel.isIntroducing, false);
    } finally { modem.free(tx); modem.free(rx); }
  }
});
