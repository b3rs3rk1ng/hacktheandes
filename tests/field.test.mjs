import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { encodeAlert, encodeField, validateField, createAssembler, PROTOCOL_LIMITS } from '../src/protocol.js';
import { mergeField, loadFields, saveFields, sampleField, fieldFreshness, FIELD_STORAGE_KEY, MAX_FIELDS } from '../src/field-store.js';

const observedAt = '2026-10-17T15:00:00.000Z';
const expiresAt = '2026-10-17T16:00:00.000Z';
const receivedAt = '2026-10-17T15:01:00.000Z';
function sample(overrides = {}) {
  return {
    version: 1, type: 'grid', id: 'regional-conditions', variable: 'rain-category', observedAt, expiresAt,
    source: { name: 'Example meteorological service', url: 'https://example.org/observations' },
    bounds: [130, 30, 134, 34], cols: 2, rows: 2, values: [0, 1, 2, 255], context: 'live', ...overrides,
  };
}
async function assemble(frames, assembler = createAssembler()) {
  let result;
  for (const frame of frames) result = await assembler.accept(frame);
  return result;
}
const record = field => ({ field, receivedAt });

test('worldwide fields round-trip compactly at the full 4096-cell contract limit', async () => {
  let seed = 917;
  const values = Array.from({ length: 4096 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return [0, 1, 2, 3, 255][seed % 5];
  });
  const field = sample({ id: '世界-☀️', bounds: [-180, -90, 180, 90], cols: 128, rows: 32, values });
  const encoded = await encodeField(field);
  assert.ok(encoded.compactBytes < 3000);
  assert.ok(encoded.compactBytes < encoded.originalBytes / 3);
  assert.ok(encoded.frames.length > 5);
  assert.ok(encoded.frames.every(frame => frame[2] === 2 && frame.length <= PROTOCOL_LIMITS.frameBytes));
  const result = await assemble(encoded.frames.slice().reverse());
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.field, field);
  assert.equal(result.alert, undefined);
});

test('grids recover reordered/repeated frames while sharing an assembler with existing alerts', async () => {
  const field = sample({ cols: 25, rows: 16, values: Array.from({ length: 400 }, (_, i) => [0, 1, 2, 3, 255][(i * 7 + Math.floor(i / 5)) % 5]) });
  const grid = await encodeField(field);
  const alert = {
    version: 1, id: 'existing-alert', status: 'test', kind: 'rain', severity: 'info',
    areas: [{ code: 'JP-custom', name: '地域' }], issuedAt: observedAt, expiresAt,
    title: 'Known alert', body: 'The old wire contract still works.', source: { name: 'Example', url: '' },
  };
  const notice = await encodeAlert(alert);
  const receiver = createAssembler();
  for (const frame of grid.frames.slice(1).reverse()) await receiver.accept(frame);
  const noticeResult = await assemble(notice.frames, receiver);
  assert.deepEqual(noticeResult.alert, alert);
  if (grid.frames.length > 1) assert.equal((await receiver.accept(grid.frames[1])).state, 'duplicate');
  const result = await receiver.accept(grid.frames[0]);
  assert.equal(result.state, 'complete');
  assert.deepEqual(result.field, field);
  assert.equal((await receiver.accept(grid.frames[0])).state, 'duplicate');
});

test('all frame byte corruptions are rejected before accepting a replacement grid', async () => {
  const encoded = await encodeField(sample());
  for (const frame of encoded.frames) {
    for (let index = 0; index < frame.length; index++) {
      const corrupted = frame.slice();
      corrupted[index] ^= 1;
      assert.equal((await createAssembler().accept(corrupted)).state, 'invalid', `byte ${index}`);
    }
  }
  assert.deepEqual((await assemble(encoded.frames)).field, sample());
});

test('field validation rejects unsafe or ambiguous grids, dates, sources and contexts', () => {
  const bad = [
    { version: 2 }, { type: 'alert' }, { context: 'historical' }, { id: '' }, { variable: '' },
    { bounds: [170, -10, -170, 10] }, { bounds: [-181, 0, 0, 1] }, { bounds: [0, -91, 1, 0] },
    { bounds: [0, 0, 1, 91] }, { bounds: [0, 0, 181, 1] }, { bounds: [0, 0, Infinity, 1] },
    { bounds: new Array(4) }, { bounds: [0, 0, 0, 1] }, { bounds: [0, 1, 1, 0] },
    { cols: 0 }, { rows: 129 }, { cols: 1.5 }, { cols: 128, rows: 128, values: Array(16384).fill(0) },
    { values: [0, 1, 2] }, { values: [0, 1, 2, 4] }, { values: [0, 1, 2, null] }, { values: new Array(4) },
    { observedAt: '2026-10-17' }, { observedAt: '2026-02-30T15:00:00Z' }, { expiresAt: observedAt },
    { source: { name: 'x', url: '' } }, { source: { name: 'x', url: 'javascript:alert(1)' } },
    { source: { name: 'x', url: 'https://user:password@example.org/' } },
  ];
  for (const overrides of bad) assert.throws(() => validateField(sample(overrides)), JSON.stringify(overrides));
  assert.equal(validateField(sample({ observedAt: '2026-10-17T10:00:00-05:00' })).observedAt, observedAt);
});

test('samples use south-to-north rows and west-to-east columns without confusing unclassified and no data', () => {
  const japan = sample();
  assert.deepEqual(sampleField(japan, 130.2, 30.2), { value: 0, col: 0, row: 0, longitude: 131, latitude: 31 });
  assert.equal(sampleField(japan, 133.8, 30.1).value, 1);
  assert.equal(sampleField(japan, 130.1, 33.9).value, 2);
  assert.equal(sampleField(japan, 134, 34).value, 255);
  assert.equal(sampleField(japan, 132, 32).value, 255);
  assert.equal(sampleField(japan, 129.99, 32), null);
  assert.equal(sampleField(japan, 131, 34.01), null);
  assert.equal(sampleField(japan, NaN, 32), null);
  const africa = sample({ bounds: [18, -34, 22, -30], values: [3, 2, 1, 0] });
  assert.equal(sampleField(africa, 18.2, -33.8).value, 3);
});

test('store accepts newer observations, rejects older ones and protects same-time conflicts', () => {
  const first = mergeField([], sample(), { receivedAt });
  assert.equal(first.duplicate, false);
  assert.equal(first.fields.length, 1);
  const duplicate = mergeField(first.fields, sample(), { receivedAt: '2026-10-17T15:02:00Z' });
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.fields[0].receivedAt, receivedAt);
  const newer = sample({ observedAt: '2026-10-17T15:10:00Z', values: [1, 2, 3, 255] });
  const next = mergeField(first.fields, newer, { receivedAt });
  assert.equal(next.fields.length, 1);
  assert.deepEqual(next.fields[0].field, validateField(newer));
  assert.equal(mergeField(next.fields, sample(), { receivedAt }).stale, true);
  assert.throws(() => mergeField(first.fields, sample({ values: [3, 2, 1, 0] }), { receivedAt }));
  assert.throws(() => mergeField([], sample(), { receivedAt: 'bad' }));
});

test('live/replay, variables and dataset identities never overwrite one another', () => {
  let fields = [];
  for (const field of [sample(), sample({ context: 'replay' }), sample({ variable: 'water-category' }), sample({ id: 'other-region' })]) {
    fields = mergeField(fields, field, { receivedAt }).fields;
  }
  assert.equal(fields.length, 4);
  assert.equal(fields.filter(record => record.field.context === 'live').length, 3);
  const incoming = sample({ context: 'replay', observedAt: '2026-10-17T15:20:00Z', values: [3, 3, 3, 3] });
  fields = mergeField(fields, incoming, { receivedAt }).fields;
  assert.deepEqual(fields.find(record => record.field.context === 'live' && record.field.id === 'regional-conditions' && record.field.variable === 'rain-category').field.values, [0, 1, 2, 255]);
});

test('persistence keeps valid newest records independently of order, ignores corruption and bounds retained datasets', () => {
  const memory = new Map();
  const storage = { getItem: key => memory.get(key), setItem: (key, value) => memory.set(key, value) };
  memory.set(FIELD_STORAGE_KEY, JSON.stringify([
    record(sample()), { field: sample(), receivedAt: 'not a date' },
    record(sample({ observedAt: '2026-10-17T15:10:00Z' })),
    record(sample({ values: [7, 7, 7, 7] })), null,
  ]));
  let fields = loadFields(storage);
  assert.equal(fields.length, 1);
  assert.equal(fields[0].field.observedAt, '2026-10-17T15:10:00.000Z');
  for (let index = 0; index < MAX_FIELDS + 3; index++) fields = mergeField(fields, sample({ id: `region-${index}`, observedAt: new Date(Date.parse(observedAt) + index * 1000).toISOString() }), { receivedAt }).fields;
  assert.equal(fields.length, MAX_FIELDS);
  saveFields(storage, fields);
  assert.deepEqual(loadFields(storage), fields);
  memory.set(FIELD_STORAGE_KEY, '{bad JSON');
  assert.deepEqual(loadFields(storage), []);
  memory.set(FIELD_STORAGE_KEY, '{}');
  assert.deepEqual(loadFields(storage), []);
});

test('freshness marks expired/future observations without silently renewing replayed data', () => {
  assert.equal(fieldFreshness(sample(), Date.parse(receivedAt)), 'current');
  assert.equal(fieldFreshness(sample(), Date.parse(expiresAt)), 'expired');
  assert.equal(fieldFreshness(sample(), Date.parse(observedAt) - 6 * 60 * 1000), 'future');
  assert.equal(fieldFreshness(sample({ context: 'replay' }), Date.parse(expiresAt) + 1), 'expired');
});

test('a geographic field survives the actual modem waveform with deterministic slight noise', async () => {
  const path = fileURLToPath(new URL('../public/vendor/ggwave-0.4.0.js', import.meta.url));
  const code = await readFile(path, 'utf8');
  const wrapper = { exports: {} };
  new Function('module', 'exports', 'require', '__filename', '__dirname', code)(wrapper, wrapper.exports, createRequire(import.meta.url), path, dirname(path));
  const modem = await wrapper.exports({ print: () => {}, printErr: () => {} });
  modem.disableLog();
  const parameters = modem.getDefaultParameters();
  parameters.sampleRateInp = 44100;
  parameters.sampleRateOut = 44100;
  const tx = modem.init(parameters);
  let rx = modem.init(parameters);
  try {
    const field = sample({ bounds: [84, 26, 88, 30], values: [0, 3, 255, 1] });
    const encoded = await encodeField(field);
    const recordings = [];
    let seed = 318;
    for (const frame of encoded.frames) {
      const raw = modem.encode(tx, frame, modem.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST, 40);
      const samples = new Float32Array(new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength).slice().buffer);
      for (let index = 0; index < samples.length; index++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        samples[index] += (seed / 0xffffffff - 0.5) * 0.002;
      }
      recordings.push(samples, new Float32Array(44100 / 4));
    }
    const microphone = new Float32Array(Math.ceil(recordings.reduce((sum, samples) => sum + samples.length, 0) / 4096) * 4096);
    let cursor = 0;
    for (const samples of recordings) { microphone.set(samples, cursor); cursor += samples.length; }
    const received = [];
    for (let offset = 0; offset < microphone.length; offset += 4096) {
      const samples = microphone.subarray(offset, offset + 4096);
      const bytes = modem.decode(rx, new Int8Array(samples.buffer, samples.byteOffset, samples.byteLength));
      if (bytes?.length) {
        received.push(new Uint8Array(bytes));
        modem.free(rx);
        rx = modem.init(parameters);
      }
    }
    assert.equal(received.length, encoded.frames.length);
    assert.deepEqual((await assemble(received)).field, field);
  } finally { modem.free(tx); modem.free(rx); }
});
