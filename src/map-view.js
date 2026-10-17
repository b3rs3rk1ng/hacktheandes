/**
 * Offline, tile-free map. All geometry and locality names are stored in the app.
 * Field cells are estimates at their grid resolution, never safe-route advice.
 * Sources, licenses, scales and limitations are retained in public/data/*.json.
 */
const DATA_ROOT = new URL('../public/data/', import.meta.url);
const LEVEL_COLORS = ['#dce6ed', '#f1c849', '#ed8b38', '#ce4248'];
const MAP_CELL_COLORS = ['#e4ebef', '#f4dfa0', '#f3bd91', '#e5a2a5'];
let basePromise;
let localitiesPromise;

async function readData(name) {
  const response = await fetch(new URL(name, DATA_ROOT));
  if (!response.ok) throw new Error(`No se pudo cargar el mapa guardado (${response.status}).`);
  return response.json();
}

export async function loadLocalities() {
  localitiesPromise ||= readData('localities.json').then((data) => data.localities).catch((error) => { localitiesPromise = null; throw error; });
  return (await localitiesPromise).map((location) => ({ ...location }));
}

// The transport/store contract owns cell indexing and geographic edges.
export { sampleField } from './field-store.js';

function coordinate(value, direction) {
  return `${Math.abs(value).toFixed(3)}° ${value < 0 ? direction[0] : direction[1]}`;
}

function validLocation(location) {
  return location && Number.isFinite(location.longitude) && Number.isFinite(location.latitude)
    && Math.abs(location.longitude) <= 180 && Math.abs(location.latitude) <= 90;
}

// Keep a usable projection at the poles while preserving the selected GPS point.
const projectionLatitude = (latitude) => Math.max(-85, Math.min(85, latitude));

function installStyles() {
  if (document.getElementById('situation-map-style')) return;
  const style = document.createElement('style');
  style.id = 'situation-map-style';
  style.textContent = `
    .situation-map{position:relative;isolation:isolate;background:#eaf1f5;border:1px solid #cad8e3;border-radius:22px;overflow:hidden;color:#18304e}
    .situation-map canvas{display:block;width:100%;height:clamp(360px,52vh,540px);touch-action:none;cursor:crosshair;outline-offset:-5px}
    .situation-map canvas:focus-visible{outline:3px solid #164b9b}
    .situation-map__zoom{position:absolute;right:14px;top:14px;display:flex;flex-direction:column;gap:6px}
    .situation-map__zoom button{display:grid;place-items:center;min-width:44px;min-height:44px;padding:0;border:1px solid #c5d3df;border-radius:12px;background:#fff;color:#164b9b;font:500 25px/1 Avenir Next,Avenir,system-ui,sans-serif;box-shadow:0 2px 6px #18304e0a;cursor:pointer}
    .situation-map__zoom button:focus-visible{outline:3px solid #164b9b;outline-offset:2px}
    .situation-map__caption{position:absolute;left:14px;top:14px;max-width:calc(100% - 84px);padding:7px 10px;border-radius:10px;background:#fffffff0;pointer-events:none;font:500 12px/1.4 Avenir Next,Avenir,system-ui,sans-serif}
    .situation-map__footer{display:flex;gap:8px 16px;flex-wrap:wrap;align-items:center;padding:10px 14px;background:#ffffffed;border-top:1px solid #d9e3eb;font:400 11px/1.4 Avenir Next,Avenir,system-ui,sans-serif}
    .situation-map__footer a{color:#164b9b;text-decoration:underline;text-underline-offset:2px}
    .situation-map__legend{display:flex;gap:9px;flex-wrap:wrap;margin:0 0 0 auto;list-style:none;padding:0}
    .situation-map__legend[hidden]{display:none}
    .situation-map__legend li{display:inline-flex;align-items:center;gap:4px}
    .situation-map__legend i{width:9px;height:9px;border-radius:2px;display:inline-block}
    .situation-map__hint{margin:8px 0 0;color:#53697e;font-size:12px;line-height:1.5}
    @media(prefers-reduced-motion:no-preference){.situation-map__zoom button{transition:background .12s}.situation-map__zoom button:hover{background:#edf3ff}}
  `;
  document.head.append(style);
}

/**
 * @param {HTMLElement} element
 * @param {{onSelect?: (location: {longitude:number,latitude:number,name?:string})=>void}} options
 */
export async function createSituationMap(element, { onSelect = () => {} } = {}) {
  if (!element) throw new TypeError('Falta el contenedor del mapa.');
  basePromise ||= readData('basemap.json').catch((error) => { basePromise = null; throw error; });
  const [basemap, localities] = await Promise.all([basePromise, loadLocalities()]);
  installStyles();

  const shell = document.createElement('div');
  shell.className = 'situation-map';
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Mapa sin conexión. Toca un punto para elegir tu ubicación. Con teclado, mueve el mapa con las flechas y pulsa Enter para seleccionar el centro.');
  const caption = document.createElement('div');
  caption.className = 'situation-map__caption';
  caption.textContent = 'Mapa guardado en el teléfono';
  const zoom = document.createElement('div');
  zoom.className = 'situation-map__zoom';
  zoom.setAttribute('role', 'group');
  zoom.setAttribute('aria-label', 'Escala del mapa');
  const zoomIn = document.createElement('button');
  zoomIn.type = 'button'; zoomIn.textContent = '+'; zoomIn.setAttribute('aria-label', 'Acercar mapa');
  const zoomOut = document.createElement('button');
  zoomOut.type = 'button'; zoomOut.textContent = '−'; zoomOut.setAttribute('aria-label', 'Alejar mapa');
  zoom.append(zoomIn, zoomOut);
  const footer = document.createElement('div');
  footer.className = 'situation-map__footer';
  const attribution = document.createElement('span');
  attribution.innerHTML = '<a href="https://www.naturalearthdata.com/" target="_blank" rel="noopener noreferrer">Natural Earth</a> · <a href="https://www.geonames.org/" target="_blank" rel="noopener noreferrer">GeoNames (CC BY)</a>';
  const legend = document.createElement('ul');
  legend.className = 'situation-map__legend';
  legend.setAttribute('aria-label', 'Clasificación de la fuente');
  ['Sin clasificación', 'Amarillo', 'Naranja', 'Rojo'].forEach((name, index) => {
    const item = document.createElement('li');
    const swatch = document.createElement('i');
    swatch.style.background = LEVEL_COLORS[index];
    item.append(swatch, name); legend.append(item);
  });
  footer.append(attribution, legend);
  shell.append(canvas, caption, zoom, footer);
  const hint = document.createElement('p');
  hint.className = 'situation-map__hint';
  hint.textContent = 'Toca tu ubicación. Arrastra para explorar. La lluvia se muestra por celdas. Ríos y límites generalizados; no indica rutas seguras.';
  element.replaceChildren(shell, hint);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Este navegador no permite mostrar el mapa.');

  const nationalBounds = basemap.viewBounds;
  const state = {
    width: 600, height: 420, mode: 'national',
    longitude: (nationalBounds[0] + nationalBounds[2]) / 2,
    latitude: (nationalBounds[1] + nationalBounds[3]) / 2,
    span: nationalBounds[3] - nationalBounds[1],
    fields: [], selected: null, destroyed: false,
  };
  let pendingFrame = 0;
  let gesture = null;
  let lastProject;
  let visiblePlaces = [];

  function getProjection() {
    const radians = Math.PI / 180;
    const yScale = state.height / state.span;
    const xScale = yScale * Math.cos(projectionLatitude(state.latitude) * radians);
    return {
      xScale, yScale,
      point: ([longitude, latitude]) => [
        state.width / 2 + (longitude - state.longitude) * xScale,
        state.height / 2 - (latitude - state.latitude) * yScale,
      ],
      inverse: ([x, y]) => ({
        longitude: state.longitude + (x - state.width / 2) / xScale,
        latitude: state.latitude - (y - state.height / 2) / yScale,
      }),
    };
  }

  function path(points, project, close = false) {
    if (!points.length) return;
    points.forEach((point, index) => {
      const [x, y] = project(point);
      if (index === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (close) ctx.closePath();
  }

  function countryPaths(geometry, project) {
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const polygon of polygons) for (const ring of polygon) path(ring, project, true);
  }

  function drawGrid(project) {
    // Draw older fields first; a later observation overlays its own coverage.
    for (const field of state.fields) {
      const [west, south, east, north] = field.bounds;
      const dx = (east - west) / field.cols;
      const dy = (north - south) / field.rows;
      const a = project([west, north]); const b = project([east, south]);
      if (b[0] < 0 || a[0] > state.width || b[1] < 0 || a[1] > state.height) continue;
      const cellWidth = dx * lastProject.xScale;
      const cellHeight = dy * lastProject.yScale;
      const colFrom = Math.max(0, Math.floor(-a[0] / cellWidth));
      const colTo = Math.min(field.cols, Math.ceil((state.width - a[0]) / cellWidth));
      const rowFrom = Math.max(0, Math.floor((b[1] - state.height) / cellHeight));
      const rowTo = Math.min(field.rows, Math.ceil(b[1] / cellHeight));
      ctx.save();
      for (let row = rowFrom; row < rowTo; row++) for (let column = colFrom; column < colTo; column++) {
        const value = field.values[row * field.cols + column];
        if (value === 255 || value < 0 || value > 3) continue;
        const x = a[0] + column * cellWidth;
        const y = b[1] - (row + 1) * cellHeight;
        ctx.fillStyle = MAP_CELL_COLORS[value];
        ctx.globalAlpha = 1;
        ctx.fillRect(x, y, cellWidth + 0.3, cellHeight + 0.3);
        if (cellWidth > 7 && cellHeight > 7) {
          ctx.globalAlpha = 0.35; ctx.strokeStyle = '#fff'; ctx.lineWidth = 0.7;
          ctx.strokeRect(x, y, cellWidth, cellHeight);
        }
      }
      ctx.restore();
    }
  }

  function draw() {
    pendingFrame = 0;
    if (state.destroyed) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, state.width, state.height);
    ctx.fillStyle = '#eaf1f5'; ctx.fillRect(0, 0, state.width, state.height);
    const projection = getProjection(); lastProject = projection;
    const project = projection.point;
    for (const feature of basemap.countries) {
      ctx.beginPath(); countryPaths(feature.geometry, project);
      ctx.fillStyle = feature.code === 'PER' ? '#f5f8f2' : '#e2eadf';
      ctx.fill('evenodd'); ctx.strokeStyle = '#bdcbbb'; ctx.lineWidth = 1; ctx.stroke();
    }
    // Geographic graticule: thin, fixed geography, not decorative animated data.
    const step = state.span > 8 ? 5 : state.span > 1 ? 1 : state.span > 0.3 ? 0.1 : 0.05;
    const nw = projection.inverse([0, 0]); const se = projection.inverse([state.width, state.height]);
    ctx.strokeStyle = '#7893a31a'; ctx.lineWidth = 0.6;
    for (let lon = Math.ceil(nw.longitude / step) * step; lon < se.longitude; lon += step) {
      const x = project([lon, state.latitude])[0]; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, state.height); ctx.stroke();
    }
    for (let lat = Math.ceil(se.latitude / step) * step; lat < nw.latitude; lat += step) {
      const y = project([state.longitude, lat])[1]; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(state.width, y); ctx.stroke();
    }
    drawGrid(project);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const river of basemap.rivers) {
      ctx.beginPath();
      for (const line of river.geometry.coordinates) path(line, project);
      ctx.strokeStyle = state.span < 2 ? '#77acc5' : '#9cbfd0';
      ctx.lineWidth = state.span < 2 ? (river.rank <= 2 ? 4 : 2) : (river.rank <= 2 ? 1.5 : 0.7);
      ctx.stroke();
    }
    if (state.span < 2) {
      const namedRivers = new Set();
      for (const river of basemap.rivers) {
        if (!river.name || namedRivers.has(river.name)) continue;
        const visible = river.geometry.coordinates.flat().map(project).filter(([x, y]) => x > 35 && x < state.width - 70 && y > 70 && y < state.height - 65);
        if (visible.length < 3) continue;
        const [x, y] = visible[Math.floor(visible.length / 2)];
        ctx.font = 'italic 12px Avenir Next,Avenir,system-ui,sans-serif';
        ctx.strokeStyle = '#f5f8f2'; ctx.lineWidth = 3; ctx.strokeText(river.name, x + 7, y + 14);
        ctx.fillStyle = '#397f9f'; ctx.fillText(river.name, x + 7, y + 14); namedRivers.add(river.name);
      }
    }
    // Names are labels of source geometry, not generated places or inferred roads.
    visiblePlaces = [];
    const labels = [];
    const selectedName = state.selected?.name;
    const ordered = [...localities].sort((a, b) => (a.name === selectedName ? -1 : b.name === selectedName ? 1 : 0));
    for (const place of ordered) {
      const [x, y] = project([place.longitude, place.latitude]);
      if (x < 15 || x > state.width - 15 || y < 42 || y > state.height - 35) continue;
      visiblePlaces.push({ ...place, x, y });
      const isSelected = place.name === selectedName;
      ctx.beginPath(); ctx.arc(x, y, isSelected ? 4 : 3, 0, 2 * Math.PI);
      ctx.fillStyle = '#274d6c'; ctx.fill();
      const text = place.name;
      ctx.font = `${isSelected ? 650 : 500} ${state.span < 2 ? 13 : 12}px Avenir Next,Avenir,system-ui,sans-serif`;
      const width = ctx.measureText(text).width;
      let labelX = x + 8;
      if (labelX + width > state.width - 8) labelX = x - width - 8;
      const box = [labelX - 2, y - 17, labelX + width + 2, y + 1];
      if (!isSelected && labels.some((b) => b[0] < box[2] && b[2] > box[0] && b[1] < box[3] && b[3] > box[1])) continue;
      labels.push(box);
      ctx.lineWidth = 3; ctx.strokeStyle = '#f7faf7'; ctx.strokeText(text, labelX, y - 4);
      ctx.fillStyle = '#284558'; ctx.fillText(text, labelX, y - 4);
    }
    if (state.selected) {
      const [x, y] = project([state.selected.longitude, state.selected.latitude]);
      ctx.beginPath(); ctx.arc(x, y, 12, 0, 2 * Math.PI);
      ctx.fillStyle = '#164b9b18'; ctx.fill();
      ctx.beginPath(); ctx.arc(x, y, 6, 0, 2 * Math.PI);
      ctx.fillStyle = '#164b9b'; ctx.fill(); ctx.strokeStyle = '#fff'; ctx.lineWidth = 2.5; ctx.stroke();
    }
    // Scale is derived from geographic latitude and the projection.
    const kmPerPixel = 111.195 / projection.yScale;
    const targetKm = Math.min(110, state.width * 0.22) * kmPerPixel;
    const exponent = 10 ** Math.floor(Math.log10(targetKm));
    const scaleKm = [1, 2, 5, 10].map((n) => n * exponent).filter((n) => n <= targetKm).at(-1) || exponent;
    const scaleWidth = scaleKm / kmPerPixel;
    ctx.strokeStyle = '#35566f'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(18, state.height - 25); ctx.lineTo(18, state.height - 20); ctx.lineTo(18 + scaleWidth, state.height - 20); ctx.lineTo(18 + scaleWidth, state.height - 25); ctx.stroke();
    ctx.font = '11px Avenir Next,Avenir,system-ui,sans-serif'; ctx.fillStyle = '#35566f';
    ctx.fillText(`${scaleKm < 1 ? Math.round(scaleKm * 1000) + ' m' : scaleKm + ' km'}`, 18, state.height - 30);
    ctx.textAlign = 'right'; ctx.fillText('N ↑', state.width - 16, state.height - 20); ctx.textAlign = 'left';
    legend.hidden = !state.fields.length;
    const label = state.mode === 'national' ? 'Perú' : state.selected?.name || 'Alrededores';
    caption.textContent = `${label} · mapa guardado`;
  }

  function scheduleDraw() {
    if (!pendingFrame && !state.destroyed) pendingFrame = requestAnimationFrame(draw);
  }
  function fitNational() {
    state.longitude = (nationalBounds[0] + nationalBounds[2]) / 2;
    state.latitude = (nationalBounds[1] + nationalBounds[3]) / 2;
    state.span = Math.max(nationalBounds[3] - nationalBounds[1],
      (nationalBounds[2] - nationalBounds[0]) * Math.cos(state.latitude * Math.PI / 180) * state.height / state.width) * 1.04;
  }
  function resize() {
    const rect = canvas.getBoundingClientRect();
    state.width = rect.width || 600; state.height = rect.height || 420;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(state.width * dpr); canvas.height = Math.round(state.height * dpr);
    if (state.mode === 'national') fitNational();
    scheduleDraw();
  }
  function changeZoom(factor) {
    state.mode = 'local'; state.span = Math.min(40, Math.max(0.04, state.span * factor)); scheduleDraw();
  }
  zoomIn.addEventListener('click', () => changeZoom(1 / 1.6));
  zoomOut.addEventListener('click', () => changeZoom(1.6));
  const localPoint = (event) => {
    const rect = canvas.getBoundingClientRect(); return [event.clientX - rect.left, event.clientY - rect.top];
  };
  function selectPoint(point) {
    const near = visiblePlaces.find((place) => Math.hypot(place.x - point[0], place.y - point[1]) < 18);
    const selected = near
      ? { longitude: near.longitude, latitude: near.latitude, name: near.name }
      : getProjection().inverse(point);
    if (!validLocation(selected)) return;
    state.selected = selected; scheduleDraw();
    canvas.setAttribute('aria-label', `Ubicación seleccionada: ${selected.name || `${coordinate(selected.latitude, ['S', 'N'])}, ${coordinate(selected.longitude, ['O', 'E'])}`}. Usa las flechas para explorar y Enter para seleccionar.`);
    onSelect({ ...selected });
  }
  function pointerDown(event) {
    if (event.button !== 0) return;
    gesture = { point: localPoint(event), center: [state.longitude, state.latitude], moved: false };
    canvas.setPointerCapture(event.pointerId);
  }
  function pointerMove(event) {
    if (!gesture) return;
    const point = localPoint(event); const dx = point[0] - gesture.point[0]; const dy = point[1] - gesture.point[1];
    if (Math.hypot(dx, dy) > 5) gesture.moved = true;
    if (!gesture.moved) return;
    const projection = getProjection(); state.mode = 'local';
    state.longitude = gesture.center[0] - dx / projection.xScale;
    state.latitude = Math.max(-80, Math.min(80, gesture.center[1] + dy / projection.yScale)); scheduleDraw();
  }
  function pointerUp(event) {
    if (!gesture) return;
    if (!gesture.moved) selectPoint(localPoint(event));
    gesture = null;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }
  function pointerCancel() { gesture = null; }
  function keyDown(event) {
    const shifts = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
    if (shifts[event.key]) {
      event.preventDefault(); const [dx, dy] = shifts[event.key]; state.mode = 'local';
      state.longitude += dx * state.span * 0.15 / Math.cos(state.latitude * Math.PI / 180);
      state.latitude = Math.max(-80, Math.min(80, state.latitude + dy * state.span * 0.15)); scheduleDraw();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault(); selectPoint([state.width / 2, state.height / 2]);
    } else if (event.key === '+' || event.key === '=') { event.preventDefault(); changeZoom(1 / 1.6); }
    else if (event.key === '-') { event.preventDefault(); changeZoom(1.6); }
  }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);
  canvas.addEventListener('keydown', keyDown);
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();

  return {
    setFields(fields) {
      // Keep only bounded well-formed grids; this view never interprets alert text.
      state.fields = (Array.isArray(fields) ? fields : []).filter((field) => {
        const b = field?.bounds;
        return Array.isArray(b) && b.length === 4 && b.every(Number.isFinite)
          && b[0] < b[2] && b[1] < b[3] && b[0] >= -180 && b[2] <= 180 && b[1] >= -90 && b[3] <= 90
          && Number.isInteger(field.cols) && Number.isInteger(field.rows)
          && field.cols > 0 && field.rows > 0 && field.cols * field.rows <= 262144
          && field.values?.length === field.cols * field.rows;
      }).sort((a, b) => (Date.parse(a.observedAt) || 0) - (Date.parse(b.observedAt) || 0));
      scheduleDraw();
    },
    setLocation(location) {
      if (!validLocation(location)) throw new TypeError('Coordenadas no válidas.');
      state.selected = { ...location };
      if (state.mode === 'local') { state.longitude = location.longitude; state.latitude = projectionLatitude(location.latitude); }
      scheduleDraw();
    },
    setView(view) {
      if (view !== 'national' && view !== 'local') throw new TypeError('Vista no válida.');
      state.mode = view;
      if (view === 'national') fitNational();
      else {
        state.span = 0.24;
        if (state.selected) { state.longitude = state.selected.longitude; state.latitude = projectionLatitude(state.selected.latitude); }
      }
      scheduleDraw();
    },
    destroy() {
      state.destroyed = true; observer.disconnect();
      if (pendingFrame) cancelAnimationFrame(pendingFrame);
      canvas.removeEventListener('pointerdown', pointerDown);
      canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp);
      canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('keydown', keyDown);
      element.replaceChildren();
    },
  };
}
