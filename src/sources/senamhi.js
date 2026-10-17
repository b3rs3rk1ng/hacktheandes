import { fetchSource, rasterizeFeatureCollection, validateFeed } from '../live-feed.js';

export const SENAMHI_CONFIG = Object.freeze({
  indexUrl: 'https://www.senamhi.gob.pe/mapas/mapa-nowcasting/nowcasting-analisis.php',
  wfsUrl: 'https://idesep.senamhi.gob.pe/geoserver/g_nowcasting/ows',
  typeName: 'g_nowcasting:view_nowcasting',
  source: { name: 'SENAMHI · nowcasting experimental', url: 'https://www.senamhi.gob.pe/mapas/mapa-nowcasting/' },
  variable: 'precipitation-category',
  freshnessMs: 2 * 60 * 60 * 1000,
  grids: [
    { id: 'nowcast-national', bounds: [-81.5, -18.5, -68.5, 0.5], cols: 26, rows: 38 },
    { id: 'nowcast-detail', bounds: [-73.26, -4.10333, -73.06, -3.90333], cols: 9, rows: 9 },
  ],
});

/** Parse only source identifiers, never arbitrary executable HTML or request parameters. */
export function parseSourceKeys(html) {
  const keys = new Map();
  for (const match of String(html).matchAll(/data-fichero\s*=\s*["'](nowcasting_(\d{8})-(\d{4})_analysis_\d{8}-\d{4}_web)["']/g)) {
    const [, key, day, time] = match;
    const stamp = `${day.slice(0, 4)}-${day.slice(4, 6)}-${day.slice(6, 8)}T${time.slice(0, 2)}:${time.slice(2, 4)}:00-05:00`;
    const epoch = Date.parse(stamp);
    // Date.parse normalises invalid month days; reject rather than silently changing dates.
    if (!Number.isFinite(epoch)) continue;
    const local = new Date(epoch - 5 * 3600000).toISOString();
    if (local.slice(0, 10) !== stamp.slice(0, 10) || local.slice(11, 16) !== stamp.slice(11, 16)) continue;
    keys.set(key, epoch);
  }
  return [...keys].sort((a, b) => b[1] - a[1]).map(([key]) => key);
}

export function buildFeatureUrl(sourceKey, config = SENAMHI_CONFIG) {
  if (!/^nowcasting_\d{8}-\d{4}_analysis_\d{8}-\d{4}_web$/.test(sourceKey)) throw new Error('Identificador de fuente inválido.');
  const url = new URL(config.wfsUrl);
  url.search = new URLSearchParams({
    service: 'WFS', version: '2.0.0', request: 'GetFeature', typeNames: config.typeName,
    outputFormat: 'application/json', viewparams: `fichero:${sourceKey}`, count: '2000',
  });
  return url.href;
}

export function feedFromGeoJSON(collection, {
  sourceKey,
  context = 'live',
  fetchedAt = new Date().toISOString(),
  grids = SENAMHI_CONFIG.grids,
  config = SENAMHI_CONFIG,
} = {}) {
  if (collection?.type !== 'FeatureCollection' || !Array.isArray(collection.features) || !collection.features.length) {
    throw new Error('SENAMHI no devolvió polígonos; se conserva el registro anterior.');
  }
  if (Number.isFinite(Number(collection.totalFeatures)) && Number(collection.totalFeatures) !== collection.features.length) {
    throw new Error('SENAMHI devolvió una colección incompleta.');
  }
  const crs = collection.crs?.properties?.name;
  if (crs && !/(?:4326|CRS84)$/i.test(crs)) throw new Error('La fuente usa coordenadas no compatibles.');
  const times = new Set();
  const sourceKeys = new Set();
  for (const feature of collection.features) {
    const properties = feature.properties;
    if (!Number.isFinite(Date.parse(properties?.fecha1)) || ![0, 1, 2, 3].includes(properties?.nivel)
      || !['Polygon', 'MultiPolygon'].includes(feature.geometry?.type)) {
      throw new Error('SENAMHI contiene un registro no compatible.');
    }
    times.add(new Date(properties.fecha1).toISOString());
    sourceKeys.add(properties.fichero);
  }
  if (times.size !== 1 || sourceKeys.size !== 1 || (sourceKey && !sourceKeys.has(sourceKey))) {
    throw new Error('SENAMHI mezcló observaciones distintas.');
  }
  const observedAt = [...times][0];
  const expiresAt = new Date(Date.parse(observedAt) + config.freshnessMs).toISOString();
  return validateFeed({
    version: 1,
    fetchedAt,
    sourceUpdatedAt: observedAt,
    sourceKey: sourceKey || [...sourceKeys][0],
    fields: grids.map((grid) => ({
      version: 1, type: 'grid', id: grid.id, variable: config.variable,
      observedAt, expiresAt, source: { ...config.source }, bounds: [...grid.bounds], cols: grid.cols, rows: grid.rows,
      values: rasterizeFeatureCollection(collection, grid, { valueOf: (feature) => feature.properties.nivel, emptyValue: 0 }),
      context,
    })),
    notes: [
      'Producto experimental de SENAMHI. Las celdas representan una muestra en su centro, no un pronóstico exacto del poblado.',
      '0 = sin clasificación en el punto muestreado; no significa ausencia de lluvia. 255 = sin dato.',
      'La vigencia de dos horas es un criterio operativo de Onda; no es la vigencia de un aviso oficial.',
      'No se transmiten cantidades de precipitación: ppmin/ppmax no se interpretan como milímetros.',
    ],
  });
}

export async function getSenamhiFeed({
  signal, fetchImpl = globalThis.fetch, timeoutMs = 15000,
  grids = SENAMHI_CONFIG.grids, config = SENAMHI_CONFIG,
} = {}) {
  const html = await fetchSource(config.indexUrl, { signal, fetchImpl, timeoutMs, format: 'text' });
  const [sourceKey] = parseSourceKeys(html);
  if (!sourceKey) throw new Error('No se encontró una observación de SENAMHI.');
  const collection = await fetchSource(buildFeatureUrl(sourceKey, config), { signal, fetchImpl, timeoutMs });
  return feedFromGeoJSON(collection, { sourceKey, grids, config });
}
