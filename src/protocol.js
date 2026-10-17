import { deflateSync, inflateSync } from '../public/vendor/fflate-0.8.3.js';

// Shared transport: compact alerts (v1) and geographic fields (v2), optional
// raw DEFLATE, independently checked chunks. A field's application version is 1.
// Checksums detect accidental corruption. They do not authenticate an issuer.
export const PROTOCOL_LIMITS = Object.freeze({
  frameBytes: 140,
  headerBytes: 18,
  payloadBytes: 122,
  messageBytes: 8192,
  pendingMessages: 16,
  pendingLifetimeMs: 15 * 60 * 1000,
});

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const statuses = ['test', 'actual'];
const severities = ['info', 'moderate', 'severe'];
const exactDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;
const dayDate = /^\d{4}-\d{2}-\d{2}$/;
const contexts = ['live', 'replay'];
const fieldCodes = [0, 1, 2, 3, 255];
const base64Alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export const FIELD_LIMITS = Object.freeze({ axisCells: 128, cells: 4096 });

function text(value, field, maxBytes) {
  if (typeof value !== 'string' || !value.trim() || encoder.encode(value).length > maxBytes) {
    throw new Error(`${field}: texto requerido, máximo ${maxBytes} bytes.`);
  }
  return value.trim();
}

function date(value, field, allowDay = false) {
  if (typeof value !== 'string' || !(exactDate.test(value) || (allowDay && dayDate.test(value)))) {
    throw new Error(`${field}: fecha ISO requerida.`);
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(`${field}: fecha inválida.`);
  if (dayDate.test(value)) {
    if (new Date(timestamp).toISOString().slice(0, 10) !== value) throw new Error(`${field}: fecha inválida.`);
    return value;
  }
  // Date.parse normalizes impossible dates such as February 30; reject those too.
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  if (day > new Date(Date.UTC(year, month, 0)).getUTCDate() || month < 1 || month > 12 || day < 1) {
    throw new Error(`${field}: fecha inválida.`);
  }
  return new Date(timestamp).toISOString();
}

function source(value, allowEmptyUrl = false) {
  const url = allowEmptyUrl && value?.url === '' ? '' : text(value?.url, 'URL de origen', 256);
  if (url) {
    let parsed;
    try { parsed = new URL(url); } catch { throw new Error('URL de origen inválida.'); }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('El origen requiere una URL HTTP o HTTPS sin credenciales.');
    }
  }
  return { name: text(value?.name, 'Nombre de origen', 100), url };
}

export function validateAlert(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1) {
    throw new Error('Versión de aviso no compatible.');
  }
  if (!statuses.includes(value.status)) throw new Error('Estado del aviso no válido.');
  if (!severities.includes(value.severity)) throw new Error('Nivel del aviso no válido.');
  if (!Array.isArray(value.areas) || value.areas.length < 1 || value.areas.length > 24) {
    throw new Error('El aviso requiere entre 1 y 24 localidades.');
  }
  const areas = value.areas.map((area) => ({
    code: text(area?.code, 'Código de localidad', 32),
    name: text(area?.name, 'Nombre de localidad', 80),
  }));
  if (new Set(areas.map((area) => area.code)).size !== areas.length) throw new Error('Localidades duplicadas.');
  const issuedAt = date(value.issuedAt, 'Emisión', true);
  const expiresAt = date(value.expiresAt, 'Vencimiento');
  if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new Error('El vencimiento debe ser posterior a la emisión.');
  return {
    version: 1,
    id: text(value.id, 'Identificador', 80),
    status: value.status,
    kind: text(value.kind, 'Tipo de aviso', 32),
    severity: value.severity,
    areas,
    issuedAt,
    expiresAt,
    title: text(value.title, 'Título', 180),
    body: text(value.body, 'Contenido', 1200),
    source: source(value.source, value.status === 'test'),
  };
}

export function validateField(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.version !== 1 || value.type !== 'grid') {
    throw new Error('Versión de campo no compatible.');
  }
  if (!contexts.includes(value.context)) throw new Error('Contexto del campo no válido.');
  const { cols, rows } = value;
  if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1 ||
      cols > FIELD_LIMITS.axisCells || rows > FIELD_LIMITS.axisCells || cols * rows > FIELD_LIMITS.cells) {
    throw new Error('Dimensiones de campo fuera de los límites.');
  }
  if (!Array.isArray(value.bounds) || value.bounds.length !== 4 || !Array.from(value.bounds).every(Number.isFinite)) {
    throw new Error('El campo requiere límites geográficos válidos.');
  }
  const [west, south, east, north] = value.bounds;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) {
    throw new Error('Límites geográficos fuera de rango o invertidos.');
  }
  if (!Array.isArray(value.values) || value.values.length !== cols * rows ||
      !Array.from(value.values).every(code => fieldCodes.includes(code))) {
    throw new Error('Los valores deben coincidir con la rejilla y ser 0, 1, 2, 3 o 255.');
  }
  const observedAt = date(value.observedAt, 'Observación');
  const expiresAt = date(value.expiresAt, 'Vencimiento');
  if (Date.parse(expiresAt) <= Date.parse(observedAt)) throw new Error('El vencimiento debe ser posterior a la observación.');
  return {
    version: 1, type: 'grid', id: text(value.id, 'Identificador', 80),
    variable: text(value.variable, 'Variable', 64), observedAt, expiresAt,
    source: source(value.source),
    bounds: [west, south, east, north], cols, rows, values: [...value.values], context: value.context,
  };
}

// Five categorical values fit in three bits. Base64 keeps the compact envelope
// JSON-compatible without expanding a 4096-cell field beyond the message cap.
function packValues(values) {
  const bytes = new Uint8Array(Math.ceil(values.length * 3 / 8));
  values.forEach((value, index) => {
    const code = value === 255 ? 4 : value;
    const bit = index * 3;
    bytes[bit >>> 3] |= code << (bit & 7);
    if ((bit & 7) > 5) bytes[(bit >>> 3) + 1] |= code >>> (8 - (bit & 7));
  });
  let result = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const word = (bytes[index] << 16) | ((bytes[index + 1] || 0) << 8) | (bytes[index + 2] || 0);
    result += base64Alphabet[(word >>> 18) & 63] + base64Alphabet[(word >>> 12) & 63] +
      (index + 1 < bytes.length ? base64Alphabet[(word >>> 6) & 63] : '=') +
      (index + 2 < bytes.length ? base64Alphabet[word & 63] : '=');
  }
  return result;
}

function unpackValues(value, count) {
  if (!Number.isInteger(count) || count < 1 || count > FIELD_LIMITS.cells || typeof value !== 'string') {
    throw new Error('Valores de campo inválidos.');
  }
  const byteCount = Math.ceil(count * 3 / 8);
  if (value.length !== Math.ceil(byteCount / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Codificación de campo inválida.');
  }
  const bytes = new Uint8Array(byteCount);
  let cursor = 0;
  for (let index = 0; index < value.length; index += 4) {
    const a = base64Alphabet.indexOf(value[index]);
    const b = base64Alphabet.indexOf(value[index + 1]);
    const c = value[index + 2] === '=' ? 0 : base64Alphabet.indexOf(value[index + 2]);
    const d = value[index + 3] === '=' ? 0 : base64Alphabet.indexOf(value[index + 3]);
    const word = (a << 18) | (b << 12) | (c << 6) | d;
    if (cursor < byteCount) bytes[cursor++] = word >>> 16;
    if (cursor < byteCount) bytes[cursor++] = word >>> 8;
    if (cursor < byteCount) bytes[cursor++] = word;
  }
  const values = Array.from({ length: count }, (_, index) => {
    const bit = index * 3;
    const word = bytes[bit >>> 3] | ((bytes[(bit >>> 3) + 1] || 0) << 8);
    const code = (word >>> (bit & 7)) & 7;
    if (code > 4) throw new Error('Categoría de campo inválida.');
    return code === 4 ? 255 : code;
  });
  // Reject padding ambiguities rather than accept several encodings of one grid.
  if (packValues(values) !== value) throw new Error('Relleno de campo inválido.');
  return values;
}

function packField(field) {
  return [2, field.id, field.variable, Date.parse(field.observedAt), Date.parse(field.expiresAt),
    [field.source.name, field.source.url], field.bounds, field.cols, field.rows,
    packValues(field.values), contexts.indexOf(field.context)];
}

function unpackField(value) {
  if (!Array.isArray(value) || value.length !== 11 || value[0] !== 2 || !Array.isArray(value[5]) ||
      !Number.isSafeInteger(value[3]) || !Number.isSafeInteger(value[4]) ||
      !Number.isInteger(value[7]) || !Number.isInteger(value[8])) throw new Error('Estructura de campo inválida.');
  return validateField({
    version: 1, type: 'grid', id: value[1], variable: value[2],
    observedAt: new Date(value[3]).toISOString(), expiresAt: new Date(value[4]).toISOString(),
    source: { name: value[5][0], url: value[5][1] }, bounds: value[6], cols: value[7], rows: value[8],
    values: unpackValues(value[9], value[7] * value[8]), context: contexts[value[10]],
  });
}

function pack(alert) {
  return [1, alert.id, statuses.indexOf(alert.status), alert.kind, severities.indexOf(alert.severity),
    alert.areas.map(({ code, name }) => [code, name]),
    dayDate.test(alert.issuedAt) ? alert.issuedAt : Date.parse(alert.issuedAt),
    Date.parse(alert.expiresAt), alert.title, alert.body, [alert.source.name, alert.source.url]];
}

function unpack(value) {
  if (!Array.isArray(value) || value.length !== 11 || !Array.isArray(value[5]) || !Array.isArray(value[10])) {
    throw new Error('Estructura de aviso inválida.');
  }
  const timestamp = (value) => {
    if (!Number.isSafeInteger(value)) throw new Error('Marca de tiempo inválida.');
    return new Date(value).toISOString();
  };
  return validateAlert({
    version: value[0], id: value[1], status: statuses[value[2]], kind: value[3], severity: severities[value[4]],
    areas: value[5].map((area) => ({ code: area?.[0], name: area?.[1] })),
    issuedAt: typeof value[6] === 'string' ? value[6] : timestamp(value[6]),
    expiresAt: timestamp(value[7]), title: value[8], body: value[9],
    source: { name: value[10][0], url: value[10][1] },
  });
}

const crcTable = Uint32Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = (value & 1) ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(...parts) {
  let value = 0xffffffff;
  for (const part of parts) for (const byte of part) value = crcTable[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export async function encodeAlert(value) {
  const alert = validateAlert(value);
  return encodeMessage(alert, pack(alert), 1);
}

export async function encodeField(value) {
  const field = validateField(value);
  return encodeMessage(field, packField(field), 2);
}

function encodeMessage(value, packed, version) {
  const compact = encoder.encode(JSON.stringify(packed));
  if (compact.length > PROTOCOL_LIMITS.messageBytes) throw new Error('Mensaje demasiado grande.');
  const compressed = deflateSync(compact, { level: 9 });
  const useCompression = compressed.length < compact.length;
  const wire = useCompression ? compressed : compact;
  const total = Math.ceil(wire.length / PROTOCOL_LIMITS.payloadBytes);
  const checksum = crc32(wire);
  const frames = Array.from({ length: total }, (_, part) => {
    const payload = wire.subarray(part * PROTOCOL_LIMITS.payloadBytes, (part + 1) * PROTOCOL_LIMITS.payloadBytes);
    const frame = new Uint8Array(PROTOCOL_LIMITS.headerBytes + payload.length);
    const view = new DataView(frame.buffer);
    frame.set([0x4f, 0x4e, version, useCompression ? 1 : 0]);
    view.setUint32(4, checksum);
    view.setUint16(8, wire.length);
    view.setUint16(10, compact.length);
    frame[12] = part;
    frame[13] = total;
    frame.set(payload, PROTOCOL_LIMITS.headerBytes);
    view.setUint32(14, crc32(frame.subarray(0, 14), payload));
    return frame;
  });
  return {
    id: value.id,
    frames,
    originalBytes: encoder.encode(JSON.stringify(value)).length,
    compactBytes: compact.length,
    compressedBytes: wire.length,
  };
}

function parseFrame(value) {
  if (!(value instanceof Uint8Array) || value.length <= PROTOCOL_LIMITS.headerBytes || value.length > PROTOCOL_LIMITS.frameBytes) {
    throw new Error('Tamaño de paquete inválido.');
  }
  const frame = new Uint8Array(value);
  if (frame[0] !== 0x4f || frame[1] !== 0x4e || ![1, 2].includes(frame[2]) || frame[3] > 1) throw new Error('Paquete no compatible.');
  const view = new DataView(frame.buffer);
  const checksum = view.getUint32(4);
  const wireLength = view.getUint16(8);
  const plainLength = view.getUint16(10);
  const index = frame[12];
  const total = frame[13];
  const payload = frame.subarray(PROTOCOL_LIMITS.headerBytes);
  if (!wireLength || wireLength > PROTOCOL_LIMITS.messageBytes || !plainLength || plainLength > PROTOCOL_LIMITS.messageBytes ||
      total !== Math.ceil(wireLength / PROTOCOL_LIMITS.payloadBytes) || index >= total ||
      payload.length !== Math.min(PROTOCOL_LIMITS.payloadBytes, wireLength - index * PROTOCOL_LIMITS.payloadBytes) ||
      (!frame[3] && plainLength !== wireLength)) throw new Error('Metadatos de paquete inválidos.');
  if (view.getUint32(14) !== crc32(frame.subarray(0, 14), payload)) throw new Error('Paquete dañado: checksum incorrecto.');
  return { key: `${frame[2]}:${checksum}:${wireLength}:${plainLength}:${frame[3]}`, version: frame[2], checksum, wireLength, plainLength, index, total, encoding: frame[3], payload };
}

export function createAssembler() {
  const pending = new Map();
  const completed = new Map();
  let queue = Promise.resolve();
  let revision = 0;

  async function process(frame) {
    try {
      const packet = parseFrame(frame);
      if (completed.has(packet.key)) return { state: 'duplicate', received: packet.total, total: packet.total };
      const now = Date.now();
      for (const [key, item] of pending) if (now - item.createdAt > PROTOCOL_LIMITS.pendingLifetimeMs) pending.delete(key);
      let message = pending.get(packet.key);
      if (!message) {
        if (pending.size >= PROTOCOL_LIMITS.pendingMessages) pending.delete(pending.keys().next().value);
        message = { createdAt: now, parts: new Map() };
        pending.set(packet.key, message);
      }
      if (message.parts.has(packet.index)) return { state: 'duplicate', received: message.parts.size, total: packet.total };
      message.parts.set(packet.index, packet.payload);
      if (message.parts.size < packet.total) return { state: 'partial', received: message.parts.size, total: packet.total };
      pending.delete(packet.key);
      const wire = new Uint8Array(packet.wireLength);
      for (const [index, payload] of message.parts) wire.set(payload, index * PROTOCOL_LIMITS.payloadBytes);
      if (crc32(wire) !== packet.checksum) throw new Error('Mensaje dañado: checksum incorrecto.');
      // Bound decompression output before allocating; a malformed stream cannot grow without limit.
      const compact = packet.encoding ? inflateSync(wire, { out: new Uint8Array(packet.plainLength) }) : wire;
      if (compact.length !== packet.plainLength) throw new Error('Longitud del mensaje incorrecta.');
      const decoded = JSON.parse(decoder.decode(compact));
      const content = packet.version === 1 ? { alert: unpack(decoded) } : { field: unpackField(decoded) };
      if (completed.size >= 128) completed.delete(completed.keys().next().value);
      completed.set(packet.key, true);
      return { state: 'complete', received: packet.total, total: packet.total, ...content };
    } catch (error) {
      return { state: 'invalid', received: 0, total: 0, error: error instanceof Error ? error.message : 'Paquete inválido.' };
    }
  }

  return {
    accept(frame) {
      // Receivers may deliver callbacks concurrently; assembly preserves arrival order.
      const copy = frame instanceof Uint8Array ? new Uint8Array(frame) : frame;
      const currentRevision = revision;
      const result = queue.then(() => currentRevision === revision ? process(copy) :
        { state: 'invalid', received: 0, total: 0, error: 'Recepción reiniciada.' });
      queue = result.catch(() => {});
      return result;
    },
    reset() { revision++; pending.clear(); completed.clear(); },
  };
}
