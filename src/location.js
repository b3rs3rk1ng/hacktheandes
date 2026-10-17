/** Device-local geographic selection. No reverse-geocoding or network needed. */
export const LOCATION_KEY = 'onda:position-v1';
export function normalizeLocation(value) {
  if (!value || !Number.isFinite(value.longitude) || !Number.isFinite(value.latitude)
    || Math.abs(value.longitude) > 180 || Math.abs(value.latitude) > 90) throw new Error('Ubicación inválida.');
  const result = { longitude:value.longitude, latitude:value.latitude, name:(String(value.name || '').trim() || 'Punto elegido').slice(0,100) };
  if (value.accuracy !== undefined) {
    if (!Number.isFinite(value.accuracy) || value.accuracy < 0) throw new Error('Precisión de ubicación inválida.');
    result.accuracy = value.accuracy;
  }
  return result;
}
export function loadLocation(storage, fallback) {
  try { return normalizeLocation(JSON.parse(storage.getItem(LOCATION_KEY))); } catch { return normalizeLocation(fallback); }
}
export function saveLocation(storage, value) { const position = normalizeLocation(value); storage.setItem(LOCATION_KEY, JSON.stringify(position)); return position; }
export function locateDevice(geolocation, {timeout=20000}={}) {
  return new Promise((resolve,reject) => {
    if (typeof geolocation?.getCurrentPosition !== 'function') { reject(new Error('Este navegador no ofrece GPS. Elige tu lugar en el mapa.')); return; }
    if (!Number.isFinite(timeout) || timeout <= 0 || timeout > 2147483647) { reject(new Error('Tiempo de espera GPS inválido.')); return; }
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true; clearTimeout(deadline); callback(value);
    };
    const failure = error => {
      const denied = error?.code === 1 || ['SecurityError', 'NotAllowedError'].includes(error?.name);
      const message = denied ? 'GPS sin permiso. Puedes elegir el lugar manualmente.'
        : error?.code === 3 ? 'El GPS tardó demasiado. Puedes elegir el lugar manualmente.'
        : 'No se consiguió posición. Acércate a una ventana o elige el lugar manualmente.';
      finish(reject, new Error(message));
    };
    // Keep manual selection available even when a browser never completes its callback.
    const deadline = setTimeout(() => failure({code:3}), timeout);
    try {
      geolocation.getCurrentPosition(position => {
        try { finish(resolve, normalizeLocation({longitude:position?.coords?.longitude, latitude:position?.coords?.latitude, accuracy:position?.coords?.accuracy, name:'Mi ubicación GPS'})); }
        catch(error) { finish(reject,error); }
      }, failure, {enableHighAccuracy:true, maximumAge:0, timeout});
    } catch(error) { failure(error); }
  });
}
