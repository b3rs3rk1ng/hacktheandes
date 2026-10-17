/** Generic polygon sampling and freshness-aware source loading. No receiver network use. */

const finitePoint = (point) => Array.isArray(point) && point.length >= 2
  && Number.isFinite(point[0]) && Number.isFinite(point[1]);

function pointOnSegment(x, y, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  if (dx === 0 && dy === 0) return Math.abs(x - a[0]) < 1e-10 && Math.abs(y - a[1]) < 1e-10;
  const cross = (x - a[0]) * dy - (y - a[1]) * dx;
  if (Math.abs(cross) > 1e-10 * Math.max(1, Math.abs(dx), Math.abs(dy))) return false;
  const dot = (x - a[0]) * dx + (y - a[1]) * dy;
  return dot >= -1e-10 && dot <= dx * dx + dy * dy + 1e-10;
}

function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[j];
    const b = ring[i];
    if (pointOnSegment(x, y, a, b)) return true;
    if ((a[1] > y) !== (b[1] > y)
      && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function preparePolygon(coordinates) {
  if (!Array.isArray(coordinates) || !coordinates.length) throw new Error('Polígono sin anillos.');
  const bounds = [Infinity, Infinity, -Infinity, -Infinity];
  for (const ring of coordinates) {
    if (!Array.isArray(ring) || ring.length < 4 || !ring.every(finitePoint)) {
      throw new Error('Anillo geográfico inválido.');
    }
    for (const [x, y] of ring) {
      bounds[0] = Math.min(bounds[0], x);
      bounds[1] = Math.min(bounds[1], y);
      bounds[2] = Math.max(bounds[2], x);
      bounds[3] = Math.max(bounds[3], y);
    }
  }
  return { coordinates, bounds };
}

function containsPolygon({ coordinates, bounds }, x, y) {
  if (x < bounds[0] || y < bounds[1] || x > bounds[2] || y > bounds[3]) return false;
  return inRing(x, y, coordinates[0]) && !coordinates.slice(1).some((ring) => inRing(x, y, ring));
}

/** GeoJSON coordinates are longitude, latitude. Holes are excluded, outer edges included. */
export function pointInGeometry(geometry, longitude, latitude) {
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) return false;
  if (geometry?.type === 'Polygon') return containsPolygon(preparePolygon(geometry.coordinates), longitude, latitude);
  if (geometry?.type === 'MultiPolygon') {
    return geometry.coordinates.some((polygon) => containsPolygon(preparePolygon(polygon), longitude, latitude));
  }
  return false;
}

export function validateGridSpec(grid) {
  const { bounds, cols, rows } = grid || {};
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)
    || bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -90 || bounds[3] > 90
    || bounds[0] >= bounds[2] || bounds[1] >= bounds[3]
    || !Number.isInteger(cols) || !Number.isInteger(rows) || cols < 1 || rows < 1
    || cols > 128 || rows > 128 || cols * rows > 4096) throw new Error('Rejilla geográfica inválida.');
  return grid;
}

/** Sample cell centres, rows south to north, columns west to east. */
export function rasterizeFeatureCollection(collection, grid, {
  valueOf = (feature) => feature.properties?.value,
  emptyValue = 255,
  combine = Math.max,
} = {}) {
  validateGridSpec(grid);
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    throw new Error('La fuente no es una colección GeoJSON.');
  }
  const polygons = [];
  for (const feature of collection.features) {
    const value = valueOf(feature);
    if (value === null || value === undefined) continue;
    if (!Number.isFinite(value)) throw new Error('Valor geográfico inválido.');
    const geometry = feature.geometry;
    const sets = geometry?.type === 'Polygon' ? [geometry.coordinates]
      : geometry?.type === 'MultiPolygon' ? geometry.coordinates : [];
    for (const coordinates of sets) polygons.push({ ...preparePolygon(coordinates), value });
  }
  const [west, south, east, north] = grid.bounds;
  const values = [];
  for (let row = 0; row < grid.rows; row++) {
    const latitude = south + (row + 0.5) * (north - south) / grid.rows;
    for (let col = 0; col < grid.cols; col++) {
      const longitude = west + (col + 0.5) * (east - west) / grid.cols;
      let value = null;
      for (const polygon of polygons) {
        if (containsPolygon(polygon, longitude, latitude)) {
          value = value === null ? polygon.value : combine(value, polygon.value);
        }
      }
      values.push(value === null ? emptyValue : value);
    }
  }
  return values;
}

/** Enforce a deadline across both the network request and response decoding. */
export async function fetchSource(url, {
  signal, fetchImpl = globalThis.fetch, timeoutMs = 15000, format = 'json', maxBytes = 8 * 1024 * 1024,
} = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error('La fuente tardó demasiado.')), timeoutMs);
  try {
    const response = await fetchImpl(url, { signal: controller.signal, cache: 'no-store', credentials: 'omit' });
    if (!response.ok) throw new Error(`La fuente respondió HTTP ${response.status}.`);
    if (Number(response.headers.get('content-length')) > maxBytes) {
      await response.body?.cancel();
      throw new Error('La respuesta de la fuente supera el límite permitido.');
    }
    if (!response.body) throw new Error('La fuente devolvió una respuesta vacía.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let body = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxBytes) {
          await reader.cancel();
          throw new Error('La respuesta de la fuente supera el límite permitido.');
        }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
    } finally { reader.releaseLock(); }
    return format === 'text' ? body : JSON.parse(body);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', abort);
  }
}

export function validateFeed(feed) {
  if (!feed || !Array.isArray(feed.fields) || !feed.fields.length || feed.fields.length > 32
    || !Number.isFinite(Date.parse(feed.fetchedAt)) || !Number.isFinite(Date.parse(feed.sourceUpdatedAt))) {
    throw new Error('Respuesta del flujo inválida.');
  }
  for (const field of feed.fields) {
    validateGridSpec(field);
    if (field.type !== 'grid' || field.version !== 1 || !field.id || !field.variable
      || !['live', 'replay'].includes(field.context)
      || !Number.isFinite(Date.parse(field.observedAt)) || !Number.isFinite(Date.parse(field.expiresAt))
      || !Array.isArray(field.values) || field.values.length !== field.cols * field.rows
      || !field.values.every((value) => [0, 1, 2, 3, 255].includes(value))
      || !field.source?.name || !/^https?:\/\//.test(field.source?.url || '')) {
      throw new Error('Campo del flujo inválido.');
    }
  }
  return feed;
}

/** Only emitters call this. A gateway returns the same common feed contract. */
export async function getLiveFeed(options = {}) {
  if (options.gatewayUrl) return validateFeed(await fetchSource(options.gatewayUrl, options));
  const { getSenamhiFeed } = await import('./sources/senamhi.js');
  return getSenamhiFeed(options);
}

/** Keep the last genuine snapshot on failure without relabelling its observation time. */
export function createLiveFeedClient({ load = getLiveFeed, initialFeed = null, onStatus = () => {} } = {}) {
  let lastFeed = initialFeed ? validateFeed(initialFeed) : null;
  let pending = null;
  return {
    get lastFeed() { return lastFeed; },
    async refresh(options = {}) {
      if (pending) return pending;
      pending = (async () => {
        onStatus({ state: 'loading', feed: lastFeed });
        try {
          const feed = validateFeed(await load(options));
          if (lastFeed && Date.parse(feed.sourceUpdatedAt) < Date.parse(lastFeed.sourceUpdatedAt)) {
            throw new Error('La fuente devolvió un registro anterior al guardado.');
          }
          const changed = !lastFeed || feed.sourceUpdatedAt !== lastFeed.sourceUpdatedAt;
          lastFeed = feed;
          const result = { state: 'ready', feed, changed, checkedAt: new Date().toISOString() };
          onStatus(result);
          return result;
        } catch (error) {
          if (options.signal?.aborted) throw error;
          const result = { state: 'unavailable', feed: lastFeed, changed: false, error, checkedAt: new Date().toISOString() };
          onStatus(result);
          return result;
        } finally { pending = null; }
      })();
      return pending;
    },
  };
}
