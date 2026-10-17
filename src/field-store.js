import { validateField } from './protocol.js';

export const FIELD_STORAGE_KEY = 'onda:fields-v1';
export const MAX_FIELDS = 12;

const keyOf = field => JSON.stringify([field.id, field.context, field.variable]);

function receivedDate(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) {
    throw new Error('Fecha de recepción inválida.');
  }
  return new Date(value).toISOString();
}

function validRecords(records) {
  if (!Array.isArray(records)) return [];
  const found = new Map();
  // A damaged or legacy record must not erase otherwise valid saved fields.
  for (const record of records) {
    try {
      const field = validateField(record.field);
      const receivedAt = receivedDate(record.receivedAt);
      const key = keyOf(field);
      const previous = found.get(key);
      if (!previous || Date.parse(field.observedAt) > Date.parse(previous.field.observedAt)) {
        found.set(key, { field, receivedAt });
      }
    } catch { /* Ignore corrupt records independently. */ }
  }
  return [...found.values()].sort((a, b) => Date.parse(b.field.observedAt) - Date.parse(a.field.observedAt)).slice(0, MAX_FIELDS);
}

export function mergeField(fields, incoming, { receivedAt = new Date().toISOString() } = {}) {
  const field = validateField(incoming);
  const timestamp = receivedDate(receivedAt);
  const records = validRecords(fields);
  const key = keyOf(field);
  const previous = records.find(record => keyOf(record.field) === key);
  if (previous) {
    const age = Date.parse(field.observedAt) - Date.parse(previous.field.observedAt);
    if (age < 0) return { fields: records, duplicate: false, stale: true };
    if (age === 0) {
      if (JSON.stringify(previous.field) !== JSON.stringify(field)) {
        throw new Error('El campo ya existe con otra información para la misma observación. Se conservó la versión anterior.');
      }
      return { fields: records, duplicate: true, stale: false };
    }
  }
  // Live and replay have independent identities. A historical replay can never
  // replace a live observation, even when id and variable are the same.
  const next = [{ field, receivedAt: timestamp }, ...records.filter(record => keyOf(record.field) !== key)]
    .sort((a, b) => Date.parse(b.field.observedAt) - Date.parse(a.field.observedAt)).slice(0, MAX_FIELDS);
  return { fields: next, duplicate: false, stale: false };
}

export function loadFields(storage) {
  try { return validRecords(JSON.parse(storage.getItem(FIELD_STORAGE_KEY) || '[]')); }
  catch { return []; }
}

export function saveFields(storage, fields) {
  storage.setItem(FIELD_STORAGE_KEY, JSON.stringify(validRecords(fields)));
}

export function fieldFreshness(field, now = Date.now()) {
  if (Date.parse(field.expiresAt) <= now) return 'expired';
  if (Date.parse(field.observedAt) > now + 5 * 60 * 1000) return 'future';
  return 'current';
}

// Geographic grids sample cell centres. They do not interpolate a classified
// value, extend outside their bounds, or treat 0 (unclassified) as 255 (no data).
export function sampleField(field, longitude, latitude) {
  const { bounds: [west, south, east, north], cols, rows } = field;
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude) ||
      longitude < west || longitude > east || latitude < south || latitude > north) return null;
  const col = Math.min(cols - 1, Math.floor((longitude - west) / (east - west) * cols));
  const row = Math.min(rows - 1, Math.floor((latitude - south) / (north - south) * rows));
  return {
    value: field.values[row * cols + col], col, row,
    longitude: west + (col + 0.5) * (east - west) / cols,
    latitude: south + (row + 0.5) * (north - south) / rows,
  };
}
