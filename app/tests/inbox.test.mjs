import test from 'node:test';
import assert from 'node:assert/strict';
import { isForLocation, validity, mergeNotice, loadInbox, saveInbox, MAX_NOTICES, STORAGE_KEY } from '../src/inbox.js';

const referenceTime = Date.parse('2026-10-17T12:00:00.000Z');
const receivedAt = '2026-10-17T12:00:00.000Z';

function alert(overrides = {}) {
  return {
    version: 1, id: 'example-notice', status: 'test', kind: 'weather', severity: 'moderate',
    areas: [{ code: 'NP-KOS', name: 'Koshi' }],
    issuedAt: '2026-10-17T11:00:00.000Z', expiresAt: '2026-10-17T18:00:00.000Z',
    title: 'Boletín de prueba', body: 'Revisa el boletín y su fecha de vigencia.',
    source: { name: 'Emisor de prueba', url: '' },
    ...overrides,
  };
}

function storage(initial = null) {
  const values = new Map(initial === null ? [] : [[STORAGE_KEY, initial]]);
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

test('local filtering uses configured exact locality and containing-area identifiers across countries', () => {
  const dhankuta = { code: 'NP:local:Dhankuta', areaCodes: ['NP-KOS', 'NP'], country: 'NP' };
  const sumida = { code: 'JP:13107', areaCodes: ['JP-13', 'JP'], country: 'JP' };
  assert.equal(isForLocation(alert(), dhankuta), true, 'a regional bulletin reaches its configured localities');
  assert.equal(isForLocation(alert({ areas: [{ code: 'NP:local:Dhankuta', name: 'Dhankuta' }] }), dhankuta), true);
  assert.equal(isForLocation(alert({ areas: [{ code: 'NP', name: 'Nepal' }] }), dhankuta), true);
  assert.equal(isForLocation(alert({ areas: [{ code: 'JP-13', name: 'Tokyo' }] }), sumida), true);
  assert.equal(isForLocation(alert(), sumida), false, 'another country does not receive the bulletin');
  assert.equal(isForLocation(alert({ areas: [{ code: 'NP-KOS2', name: 'Distinct configured area' }] }), dhankuta), false, 'prefix similarity is not an area match');
  assert.equal(isForLocation(alert(), null), false);
});

test('a locality-only configuration still works, without inferred hierarchy or matching display names', () => {
  const location = { code: 'custom-zone:42', name: 'Koshi' };
  assert.equal(isForLocation(alert({ areas: [{ code: 'custom-zone:42', name: 'Any display name' }] }), location), true);
  assert.equal(isForLocation(alert(), location), false, 'names do not imply membership');
  assert.equal(isForLocation(alert({ areas: [{ code: 'custom-zone', name: 'Koshi' }] }), location), false);
});

test('expiry is evaluated independently from test/actual status and exactly at the boundary', () => {
  for (const status of ['test', 'actual']) {
    const bulletin = alert({ status, expiresAt: receivedAt });
    assert.equal(validity(bulletin, referenceTime - 1), 'current');
    assert.equal(validity(bulletin, referenceTime), 'expired');
    assert.equal(validity(bulletin, referenceTime + 1), 'expired');
  }
  assert.equal(validity(alert({ expiresAt: '2026-10-17T07:00:00-05:00' }), referenceTime), 'expired', 'timezone offsets describe the same instant');
});

test('future issuance warns beyond five-minute clock tolerance and becomes current as time advances', () => {
  const futureNotice = alert({ issuedAt: '2026-10-17T12:05:00.001Z' });
  assert.equal(validity(futureNotice, referenceTime), 'future');
  assert.equal(validity(futureNotice, referenceTime + 1), 'current');
  assert.equal(validity(futureNotice, Date.parse('2026-10-17T18:00:00Z')), 'expired');
  assert.equal(validity(alert({ issuedAt: '2026-10-17' }), referenceTime), 'current', 'day-precision bulletins remain usable');
});

test('repeat reception preserves the original notice and receive timestamp', () => {
  const first = mergeNotice([], alert(), receivedAt);
  const repeated = mergeNotice(first.notices, alert(), '2026-10-17T12:10:00.000Z');
  assert.equal(first.duplicate, false);
  assert.equal(repeated.duplicate, true);
  assert.equal(repeated.notices.length, 1);
  assert.equal(repeated.notices[0].receivedAt, receivedAt);
  assert.deepEqual(repeated.notices[0].alert, alert());
});

test('canonical equivalents deduplicate while conflicting content cannot overwrite an existing identifier', () => {
  const first = mergeNotice([], alert(), receivedAt).notices;
  const equivalent = alert({ issuedAt: '2026-10-17T06:00:00-05:00', title: '  Boletín de prueba  ' });
  assert.equal(mergeNotice(first, equivalent).duplicate, true);
  for (const changed of [
    { body: 'Contenido distinto.' },
    { areas: [{ code: 'JP-13', name: 'Tokyo' }] },
    { expiresAt: '2026-10-17T19:00:00.000Z' },
    { severity: 'severe' },
  ]) assert.throws(() => mergeNotice(first, alert(changed)), /identificador/);
  assert.deepEqual(first, [{ alert: alert(), receivedAt }], 'conflicts leave the earlier notice intact');
  assert.equal(mergeNotice(first, alert({ id: 'a-distinct-update' })).notices.length, 2, 'a separate update identifier is accepted');
});

test('the bounded inbox keeps newest arrivals and survives persistence with the same order', () => {
  let notices = [];
  for (let index = 0; index < MAX_NOTICES + 7; index++) {
    notices = mergeNotice(notices, alert({ id: `notice-${index}` }), receivedAt).notices;
  }
  assert.equal(notices.length, MAX_NOTICES);
  assert.equal(notices[0].alert.id, `notice-${MAX_NOTICES + 6}`);
  assert.equal(notices.at(-1).alert.id, 'notice-7');
  const local = storage();
  saveInbox(local, notices);
  assert.deepEqual(loadInbox(local), notices);
  saveInbox(local, [...notices, { alert: alert({ id: 'too-old' }), receivedAt }]);
  assert.equal(JSON.parse(local.getItem(STORAGE_KEY)).length, MAX_NOTICES);
});

test('corrupt or unavailable storage does not prevent opening the receiver', () => {
  for (const initial of [null, '', '{broken JSON', 'null', '{}', '42', '"text"']) {
    assert.deepEqual(loadInbox(storage(initial)), []);
  }
  assert.deepEqual(loadInbox({ getItem() { throw new Error('Storage unavailable'); } }), []);
});

test('stored records recover independently, retaining the first valid copy of each identifier', () => {
  const valid = { alert: alert(), receivedAt };
  const other = { alert: alert({ id: 'second-notice', areas: [{ code: 'ZA-WC', name: 'Western Cape' }] }), receivedAt };
  const records = [
    null,
    { alert: alert({ id: 'invalid-first' }), receivedAt: 'not a date' },
    { alert: alert({ id: 'invalid-content', body: '' }), receivedAt },
    { alert: alert(), receivedAt: 'not a date' },
    valid,
    { alert: alert({ body: 'Conflicting persisted duplicate' }), receivedAt },
    other,
  ];
  assert.deepEqual(loadInbox(storage(JSON.stringify(records))), [valid, other]);
});
