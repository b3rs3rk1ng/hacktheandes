import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { encodeAlert, createAssembler, validateAlert, PROTOCOL_LIMITS } from '../src/protocol.js';

function sample(overrides = {}) {
  return {
    version: 1, id: 'test-alert-123', status: 'test', kind: 'rain', severity: 'moderate',
    areas: [{ code: 'zone-001', name: 'Comunidad A' }],
    issuedAt: '2026-10-17T15:00:00.000Z', expiresAt: '2026-10-18T15:00:00.000Z',
    title: 'Aviso de prueba', body: 'Se esperan lluvias. Consulta el aviso y su fecha de vigencia.',
    source: { name: 'Prueba local', url: '' },
    ...overrides,
  };
}

async function assemble(frames) {
  const receiver = createAssembler();
  let result;
  for (const frame of frames) result = await receiver.accept(frame);
  return result;
}

test('compact payload round-trips Unicode, multiple areas and declared sources', async () => {
  const alert = sample({
    id: 'ñ-☀️-試験', kind: 'water', status: 'actual', severity: 'severe',
    areas: [{ code: 'alpha', name: 'Comunidad Ñ' }, { code: 'beta', name: '第二地域' }],
    body: 'Boletín histórico de prueba: ñ, á, 水. No implica predicción ni autenticación.',
    source: { name: 'Origen declarado', url: 'https://example.org/boletin' },
  });
  const encoded = await encodeAlert(alert);
  assert.ok(encoded.frames.every((frame) => frame.length <= PROTOCOL_LIMITS.frameBytes));
  assert.ok(encoded.compressedBytes < encoded.originalBytes);
  const result = await assemble(encoded.frames);
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.alert, alert);
});

test('day-precision issue dates stay day-precision', async () => {
  const alert = sample({ issuedAt: '2026-10-17' });
  const encoded = await encodeAlert(alert);
  assert.equal((await assemble(encoded.frames)).alert.issuedAt, '2026-10-17');
});

test('out-of-order repeated cycles recover a missing packet without retransmitting everything', async () => {
  const alert = sample({ body: Array.from({ length: 75 }, (_, index) => `Dato ${index}: ${Math.sin(index).toFixed(8)}`).join('; ').slice(0, 1100) });
  const { frames } = await encodeAlert(alert);
  assert.ok(frames.length >= 3);
  const receiver = createAssembler();
  for (const frame of frames.slice(1).reverse()) assert.equal((await receiver.accept(frame)).state, 'partial');
  const duplicate = await receiver.accept(frames[1]);
  assert.equal(duplicate.state, 'duplicate');
  assert.equal(duplicate.received, frames.length - 1);
  const complete = await receiver.accept(frames[0]);
  assert.equal(complete.state, 'complete');
  assert.deepEqual(complete.alert, alert);
  assert.equal((await receiver.accept(frames[0])).state, 'duplicate');
  receiver.reset();
  assert.equal((await receiver.accept(frames[0])).state, 'partial');
});

test('interleaved independent messages never merge their fragments', async () => {
  const a = await encodeAlert(sample({ id: 'one' }));
  const b = await encodeAlert(sample({ id: 'two', areas: [{ code: 'another-zone', name: 'Another community' }], body: 'Otro boletín, otro contenido.' }));
  const receiver = createAssembler();
  const received = [];
  for (let index = 0; index < Math.max(a.frames.length, b.frames.length); index++) {
    for (const frame of [a.frames[index], b.frames[index]].filter(Boolean)) {
      const result = await receiver.accept(frame);
      if (result.state === 'complete') received.push(result.alert.id);
    }
  }
  assert.deepEqual(received.sort(), ['one', 'two']);
});

test('single-bit corruption in every byte is rejected, with successful recovery afterward', async () => {
  const { frames } = await encodeAlert(sample());
  for (let index = 0; index < frames[0].length; index++) {
    const corrupted = frames[0].slice();
    corrupted[index] ^= 1;
    assert.equal((await createAssembler().accept(corrupted)).state, 'invalid', `byte ${index}`);
  }
  const receiver = createAssembler();
  const corrupt = frames[0].slice();
  corrupt[corrupt.length - 1] ^= 4;
  assert.equal((await receiver.accept(corrupt)).state, 'invalid');
  let result;
  for (const frame of frames) result = await receiver.accept(frame);
  assert.equal(result.state, 'complete');
  assert.equal((await receiver.accept(new Uint8Array(500))).state, 'invalid');
  assert.equal((await receiver.accept('not bytes')).state, 'invalid');
});

test('validation rejects ambiguous or unsafe content and accepts independent geography', async () => {
  const invalid = [
    { version: 2 }, { status: 'unknown' }, { severity: 'unknown' },
    { title: '' }, { body: 'x'.repeat(1201) },
    { areas: [] }, { areas: [{ code: 'x', name: 'One' }, { code: 'x', name: 'Two' }] },
    { issuedAt: '2026-02-30' }, { issuedAt: '2026-02-30T00:00:00Z' },
    { expiresAt: '2026-10-16T15:00:00Z' }, { expiresAt: '2026-10-18' },
    { source: { name: 'x', url: 'javascript:alert(1)' } },
    { status: 'actual', source: { name: 'x', url: '' } },
    { source: { name: 'x', url: 'https://user:password@example.org/' } },
  ];
  for (const overrides of invalid) await assert.rejects(encodeAlert(sample(overrides)));
  const outside = sample({ kind: 'wildfire', areas: [{ code: 'opaque-custom-zone', name: 'Northern District' }], issuedAt: '2026-10-17T10:00:00-05:00' });
  assert.equal(validateAlert(outside).issuedAt, '2026-10-17T15:00:00.000Z');
  assert.equal((await assemble((await encodeAlert(outside)).frames)).alert.areas[0].code, 'opaque-custom-zone');
});

test('parallel accept callbacks serialize safely and deliver once', async () => {
  const { frames } = await encodeAlert(sample());
  const receiver = createAssembler();
  const results = await Promise.all([...frames, ...frames].map((frame) => receiver.accept(frame)));
  assert.equal(results.filter((result) => result.state === 'complete').length, 1);
  const oldFrames = Promise.all(frames.map((frame) => receiver.accept(frame)));
  receiver.reset();
  assert.ok((await oldFrames).every((result) => result.state === 'invalid'));
  assert.equal((await Promise.all(frames.map((frame) => receiver.accept(frame)))).filter((result) => result.state === 'complete').length, 1);
});

for (const sampleRate of [48000, 44100]) test(`actual ggwave waveform round-trip at ${sampleRate} Hz with slight deterministic noise`, async () => {
  const path = fileURLToPath(new URL('../public/vendor/ggwave-0.4.0.js', import.meta.url));
  const code = await readFile(path, 'utf8');
  const wrapper = { exports: {} };
  // The unmodified vendored artifact supports CommonJS. Loading the distribution
  // this way avoids changing it just for the application's ES module package.
  new Function('module', 'exports', 'require', '__filename', '__dirname', code)(wrapper, wrapper.exports, createRequire(import.meta.url), path, dirname(path));
  const modem = await wrapper.exports({ print: () => {}, printErr: () => {} });
  modem.disableLog();
  const parameters = modem.getDefaultParameters();
  parameters.sampleRateInp = sampleRate;
  parameters.sampleRateOut = sampleRate;
  const tx = modem.init(parameters);
  let rx = modem.init(parameters);
  try {
    const expected = sample();
    const encoded = await encodeAlert(expected);
    const received = [];
    const recordings = [];
    let seed = 12345;
    for (const frame of encoded.frames) {
      const raw = modem.encode(tx, frame, modem.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST, 40);
      const waveform = new Float32Array(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice().buffer);
      for (let index = 0; index < waveform.length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        waveform[index] += (seed / 0xffffffff - 0.5) * 0.002;
      }
      recordings.push(waveform, new Float32Array(sampleRate / 4));
    }
    const sampleCount = recordings.reduce((sum, recording) => sum + recording.length, 0);
    const microphone = new Float32Array(Math.ceil(sampleCount / 4096) * 4096);
    let cursor = 0;
    for (const recording of recordings) { microphone.set(recording, cursor); cursor += recording.length; }
    // Continuous, equally sized callbacks reproduce the browser capture stream,
    // including silence and packet boundaries that fall inside a callback.
    for (let offset = 0; offset < microphone.length; offset += 4096) {
      const samples = microphone.subarray(offset, offset + 4096);
      const result = modem.decode(rx, new Int8Array(samples.buffer, samples.byteOffset, samples.byteLength));
      if (result?.length) {
        received.push(new Uint8Array(result));
        // Match audio.js: clear acoustic history after each decoded packet.
        modem.free(rx);
        rx = modem.init(parameters);
      }
    }
    assert.equal(received.length, encoded.frames.length);
    const result = await assemble(received);
    assert.equal(result.state, 'complete');
    assert.deepEqual(result.alert, expected);
  } finally { modem.free(tx); modem.free(rx); }
});
