import { createSituationUI } from './situation.js';
import { createStation } from './station.js';
import { createAudioModem } from './audio.js';
import { createScreenAwake } from './screen-awake.js';
import { createAssembler, encodeAlert } from './protocol.js';
import { locations, officialSources, officialBulletins } from './data.js';
import { isForLocation, validity, loadInbox, saveInbox, mergeNotice } from './inbox.js';

const runtime = {bundled:globalThis.ONDA_CONFIG?.bundled === true, canEmit:globalThis.ONDA_CONFIG?.canEmit !== false};
const $ = id => document.getElementById(id);
const node = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
const readSetting = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const writeSetting = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const dateText = value => {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split('-').reverse().join('/');
  return new Intl.DateTimeFormat('es-PE', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' }).format(new Date(value));
};
const labels = { info:'Informativo', moderate:'Atención', severe:'Importante' };
let storage;
try { storage = window.localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw new Error('No se puede guardar en este navegador.'); } }; }
let notices = loadInbox(storage);
let selectedLocation = readSetting('onda:location', locations[0].code);
if (!locations.some(location => location.code === selectedLocation)) selectedLocation = locations[0].code;
let listening = false;
let receivedFrames = 0;
let showAll = false;
let modem;
let toastTimer;
let transmissionController;
let cachedPacket;
let packetGeneration = 0;
let sending = false;
let clearPending = false;
let radioShowcase;
let radioShowcaseLoading;
const assembler = createAssembler();
const situationReady = createSituationUI(storage,{toast,onReset:()=>{assembler.reset();$('receive-progress').hidden=true;}}).catch(error=>{ $('situation-map').textContent=error.message; return null; });
const station = createStation({ getModem:()=>modem, isBusy:()=>listening||sending, onBusy:value=>{sending=value;$('transmit-button').disabled=value;} });
const screenAwake = createScreenAwake();

function loadRadioShowcase() {
  if (!runtime.canEmit) return;
  if (!radioShowcaseLoading) radioShowcaseLoading = import('./radio-shell.js').then(({ mountRadioShowcase }) => {
    radioShowcase = mountRadioShowcase({ getModem: () => modem,
      onPreview: () => $('station-preview').click(), getBusy: () => listening || sending });
    radioShowcase.setVisible(!$('send-view').hidden);
    return radioShowcase;
  }).catch(() => { radioShowcaseLoading = null; });
  return radioShowcaseLoading;
}

const modemReady = createAudioModem({ onActivity: activity => {
  screenAwake.setActive(activity.active);
  window.dispatchEvent(new CustomEvent('onda:audio-activity', { detail: activity }));
} }).then(value => {
  modem = value;
  const selectedVolume = radioShowcase?.getState?.()?.volume;
  if (typeof selectedVolume === 'number') modem.setVolume(selectedVolume);
  $('engine-state').textContent = 'Disponible';
  return modem;
}).catch(error => {
  $('engine-state').textContent = 'No disponible';
  $('receiver-feedback').textContent = error.message;
  $('listen-button').disabled = true;
  $('transmit-button').disabled = true;
  return null;
});

for (const id of ['location', 'send-location']) {
  for (const location of locations) {
    const option = node('option', `${location.name} · ${location.region}`);
    option.value = location.code;
    $(id).append(option);
  }
  $(id).value = selectedLocation;
}

function toast(message) {
  $('toast').textContent = message;
  $('toast').hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5500);
}

function renderNetwork() {
  document.body.classList.toggle('offline', !navigator.onLine);
  $('network-text').textContent = runtime.bundled ? 'App offline' : navigator.onLine ? 'Red disponible' : 'Sin internet';
}
window.addEventListener('online', renderNetwork);
window.addEventListener('offline', renderNetwork);
renderNetwork();

function renderInbox() {
  const location = locations.find(item => item.code === selectedLocation);
  const relevant = notices.filter(notice => isForLocation(notice.alert, location));
  const visible = showAll ? notices : relevant;
  $('inbox-count').textContent = String(visible.length);
  $('stored-count').textContent = String(notices.length);
  $('inbox-title').textContent = showAll ? 'Todos los avisos recibidos' : 'Avisos de tu localidad';
  $('inbox-subtitle').textContent = showAll ? 'Incluye avisos de otras localidades.' : `Para ${location.name} y su región. Guardados aquí.`;
  $('notice-list').replaceChildren();
  $('inbox-empty').hidden = visible.length > 0;
  $('show-all').hidden = notices.length === relevant.length && !showAll;
  $('show-all').textContent = showAll ? 'Ver solamente mi localidad' : `Ver también ${notices.length - relevant.length} de otras localidades`;
  for (const { alert, receivedAt } of visible) {
    const state = validity(alert);
    const card = node('article', undefined, `notice ${alert.severity} ${state === 'expired' ? 'expired' : ''}`);
    const top = node('div', undefined, 'notice-top');
    top.append(node('span', alert.status === 'test' ? 'Ejercicio' : 'Resumen de fuente', `tag ${alert.status === 'test' ? 'tag-test' : ''}`));
    top.append(node('span', state === 'expired' ? 'Vencido' : state === 'future' ? 'Revisar fecha del emisor' : labels[alert.severity], `tag tag-${state === 'expired' ? 'expired' : alert.severity}`));
    card.append(top, node('p', alert.areas.map(area => area.name).join(', '), 'notice-area'));
    card.append(node('h3', alert.title), node('p', alert.body, 'notice-body'));
    card.append(node('p', `${state === 'expired' ? 'Venció' : 'Vigente hasta'} ${dateText(alert.expiresAt)}`, 'notice-validity'));
    const foot = node('div', undefined, 'notice-foot');
    if (alert.source.url) {
      const link = node('a', alert.source.name);
      link.href = alert.source.url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      foot.append(link);
    } else foot.append(node('span', alert.source.name));
    foot.append(node('span', `Origen sin verificar · recibido ${dateText(receivedAt)}`));
    card.append(foot);
    $('notice-list').append(card);
  }
}

function receiverStatus(status) {
  const texts = { loading:'Abriendo micrófono', ready:'Listo para escuchar', listening:'Escuchando el boletín', receiving:'Llegan fragmentos', stopped:'Listo para escuchar', interrupted:'Escucha interrumpida' };
  $('receiver-state').textContent = texts[status] || 'Listo para escuchar';
  if (status === 'interrupted') {
    listening = false;
    $('listen-button').lastElementChild.textContent = 'Volver a escuchar';
    document.querySelector('.radio-panel').classList.remove('listening');
    $('receiver-feedback').textContent = 'Vuelve a pulsar escuchar y mantén esta pantalla abierta.';
  }
}

async function receiveFrame(frame) {
  const result = await assembler.accept(frame);
  if (result.state === 'invalid') {
    $('receiver-feedback').textContent = 'Se descartó un fragmento dañado. Sigue escuchando la repetición.';
    return;
  }
  receivedFrames++;
  $('received-frames').textContent = String(receivedFrames);
  if (result.state === 'duplicate') {
    $('receiver-feedback').textContent = 'Este aviso ya está recibido. Puedes seguir escuchando.';
    return;
  }
  if (result.state === 'partial') {
    $('receive-progress').hidden = false;
    $('fragment-progress').max = result.total;
    $('fragment-progress').value = result.received;
    $('fragment-text').textContent = `${result.received} de ${result.total} fragmentos. Si falta alguno, espera la siguiente vuelta.`;
    return;
  }
  if (result.state === 'complete' && result.field) {
    try {
      const situation=await situationReady;
      if (!situation) throw new Error('El mapa no está disponible. Recarga la app con internet.');
      const message=await situation.receive(result.field);
      $('receive-progress').hidden=true;$('receiver-feedback').textContent=message;toast(message);
    } catch(error) {$('receiver-feedback').textContent=error.message;}
    return;
  }
  if (result.state !== 'complete' || !result.alert) return;
  try {
    const updated = mergeNotice(notices, result.alert);
    notices = updated.notices;
    let saved = true;
    try { saveInbox(storage, notices); } catch { saved = false; }
    $('receive-progress').hidden = true;
    renderInbox();
    const location = locations.find(item => item.code === selectedLocation);
    const relevant = isForLocation(result.alert, location);
    const message = updated.duplicate ? 'Aviso recibido antes. Se conservó una sola copia.' : relevant ? 'Aviso recibido completo.' : 'Aviso recibido para otra localidad. Quedó guardado.';
    $('receiver-feedback').textContent = saved ? message : `${message} No se pudo guardar; conserva esta pantalla abierta.`;
    toast(message);
  } catch (error) { $('receiver-feedback').textContent = error.message; }
}

async function stopListening() {
  listening = false;
  if (modem) await modem.stop();
  $('listen-button').lastElementChild.textContent = 'Escuchar boletín';
  document.querySelector('.radio-panel').classList.remove('listening');
  $('radio-title').textContent = 'Acerca el celular al altavoz';
  $('receiver-hint').textContent = 'Pulsa escuchar cuando empiece el boletín. Mantén esta pantalla abierta.';
  drawWave(0);
}

$('listen-button').addEventListener('click', async () => {
  if (listening) { await stopListening(); return; }
  if (!modem) { toast('El motor de audio se está preparando. Vuelve a pulsar escuchar.'); return; }
  $('listen-button').disabled = true;
  $('receiver-feedback').textContent = '';
  try {
    // listen() resumes Web Audio before its first await, inside this gesture.
    const started = modem.listen({ onFrame:receiveFrame, onLevel:level => drawWave(Math.min(1, level * 12)), onStatus:receiverStatus });
    await started;
    listening = true;
    document.querySelector('.radio-panel').classList.add('listening');
    $('listen-button').lastElementChild.textContent = 'Detener escucha';
    $('radio-title').textContent = 'Listo. Deja que llegue el aviso.';
    $('receiver-hint').textContent = 'Mantén el celular cerca del altavoz y esta pantalla abierta.';
  } catch (error) {
    await stopListening();
    $('receiver-feedback').textContent = error.message;
    $('receiver-state').textContent = 'No se pudo escuchar';
  } finally { $('listen-button').disabled = false; }
});

const waveHeights = [6,9,13,19,28,40,57,77,92,64,45,31,18,12,8,12,19,33,48,68,91,75,52,34,23,15,10,6,4];
const bars = waveHeights.map((height, i) => {
  const bar = node('i');
  bar.style.setProperty('--bar', `${Math.max(5, height * .2)}px`);
  bar.style.setProperty('--i', i);
  $('waveform').append(bar);
  return bar;
});
function drawWave(level) {
  bars.forEach((bar, i) => bar.style.setProperty('--bar', `${5 + waveHeights[i] * level}px`));
}
for (let i = 0; i < 52; i++) {
  const bar = node('i');
  bar.style.setProperty('--bar', `${6 + (Math.sin(i * 1.4) + 1) * 13}px`);
  bar.style.setProperty('--i', i);
  $('emitter-bars').append(bar);
}

$('location').addEventListener('change', () => {
  selectedLocation = $('location').value;
  writeSetting('onda:location', selectedLocation);
  showAll = false;
  renderInbox();
});
$('show-all').addEventListener('click', () => { showAll = !showAll; renderInbox(); });

function makeManualAlert() {
  const location = locations.find(item => item.code === $('send-location').value);
  const now = Date.now();
  return {
    version:1,
    id:Array.from(crypto.getRandomValues(new Uint8Array(6)), byte => byte.toString(16).padStart(2, '0')).join(''),
    status:'test',
    kind:$('send-kind').value,
    severity:$('send-severity').value,
    areas:[{ code:location.code, name:location.name }],
    issuedAt:new Date(now).toISOString(),
    expiresAt:new Date(now + Number($('send-hours').value) * 3600000).toISOString(),
    title:$('send-title').value.trim(),
    body:$('send-body').value.trim(),
    source:{ name:'Prueba local', url:'' },
  };
}

async function preparePacket() {
  const generation = ++packetGeneration;
  cachedPacket = null;
  $('preview-area').textContent = locations.find(item => item.code === $('send-location').value)?.name || '';
  $('preview-title').textContent = $('send-title').value || 'Título del aviso';
  $('preview-body').textContent = $('send-body').value || 'Escribe un mensaje breve.';
  $('body-count').textContent = `${$('send-body').value.length} / 280`;
  if (!$('send-title').value.trim() || !$('send-body').value.trim()) return;
  try {
    const alert = makeManualAlert();
    const packet = await encodeAlert(alert);
    if (generation !== packetGeneration) return;
    cachedPacket = { alert, ...packet };
    $('original-size').textContent = `${packet.originalBytes} B`;
    $('compressed-size').textContent = `${packet.compressedBytes} B`;
    $('packet-count').textContent = String(packet.frames.length);
  } catch (error) { $('transmit-feedback').textContent = error.message; }
}

for (const element of $('send-form').elements) {
  if (!['BUTTON'].includes(element.tagName) && element.id !== 'send-repeat') element.addEventListener('input', () => { void preparePacket(); });
}
$('send-form').addEventListener('submit', async event => {
  event.preventDefault();
  if (sending) return;
  if (!modem) { toast('El motor de audio todavía se está preparando. Vuelve a pulsar emitir.'); return; }
  if (!cachedPacket) { await preparePacket(); toast('Mensaje preparado. Pulsa emitir para reproducirlo.'); return; }
  if (listening) { toast('Detén la escucha antes de emitir desde este dispositivo.'); return; }
  const packet = cachedPacket;
  transmissionController = new AbortController();
  sending = true;
  document.body.classList.add('transmitting');
  $('transmit-button').disabled = true;
  $('station-speed').disabled = true;
  $('station-channel').disabled = true;
  $('stop-transmit').hidden = false;
  $('transmit-feedback').textContent = 'Locutor y sintonía · 5 segundos. Después comienza el aviso.';
  try {
    // Audio activation remains directly attached to this user gesture.
    await modem.previewChannel({ channel:$('station-channel').value, seconds:5,
      keepAlive:true, signal:transmissionController.signal });
    $('transmit-feedback').textContent = 'Emitiendo. El receptor debe estar escuchando.';
    await modem.transmit(packet.frames, { repeat:Number($('send-repeat').value), speed:$('station-speed').value,
      channel:$('station-channel').value, signal:transmissionController.signal, onProgress:progress => {
      $('transmit-progress').max = progress.total;
      $('transmit-progress').value = progress.sent;
      $('transmit-progress-text').textContent = `Vuelta ${progress.cycle} de ${progress.cycles} · fragmento ${progress.frame} de ${progress.frames}`;
    } });
    $('transmit-progress').value = $('transmit-progress').max;
    $('transmit-progress-text').textContent = 'Emisión terminada.';
    $('transmit-feedback').textContent = 'Emisión terminada. Comprueba el mensaje en el receptor; este emisor no puede confirmar si llegó.';
  } catch (error) {
    $('transmit-feedback').textContent = error.name === 'AbortError' ? 'Emisión detenida. El receptor conserva los fragmentos que alcanzó a recibir.' : error.message;
  } finally {
    sending = false;
    document.body.classList.remove('transmitting');
    $('transmit-button').disabled = false;
    $('station-speed').disabled = false;
    $('station-channel').disabled = false;
    $('stop-transmit').hidden = true;
    transmissionController = null;
  }
});
$('stop-transmit').addEventListener('click', () => transmissionController?.abort());

async function setMode(mode, updateUrl = true) {
  if (!['receive', 'send', 'guide'].includes(mode) || (mode === 'send' && !runtime.canEmit)) mode = 'receive';
  if (mode !== 'receive' && listening) await stopListening();
  if (mode !== 'send' && sending) { transmissionController?.abort(); station.stop(); }
  if (mode === 'send') void station.prepare();
  for (const view of ['receive', 'send', 'guide']) $(`${view}-view`).hidden = view !== mode;
  radioShowcase?.setVisible(mode === 'send');
  if (mode === 'send') void loadRadioShowcase();
  document.querySelectorAll('[data-mode]').forEach(button => {
    const active = button.dataset.mode === mode;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (updateUrl) {
    const url = new URL(location.href);
    if (mode === 'receive') url.searchParams.delete('mode'); else url.searchParams.set('mode', mode);
    history.replaceState(null, '', url);
  }
}
document.body.classList.toggle('receive-only', !runtime.canEmit);
document.querySelectorAll('[data-mode="send"]').forEach(button=>{button.hidden=!runtime.canEmit;});
document.querySelectorAll('[data-mode]').forEach(button => button.addEventListener('click', () => void setMode(button.dataset.mode)));
document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => { void setMode(button.dataset.go); window.scrollTo({ top:0, behavior:'smooth' }); }));
void setMode(new URL(location.href).searchParams.get('mode') || 'receive', false);

for (const source of [...officialBulletins.map(alert => ({ name:alert.source.name, url:alert.source.url, description:`${alert.title}. Emitido ${dateText(alert.issuedAt)}; vence ${dateText(alert.expiresAt)}. Ámbito regional.` })), ...officialSources]) {
  const item = node('div', undefined, 'source-item');
  const link = node('a', source.name);
  link.href = source.url; link.target = '_blank'; link.rel = 'noopener noreferrer';
  item.append(link, node('p', source.description));
  $('official-sources').append(item);
}

$('export-button').addEventListener('click', () => {
  const file = new Blob([JSON.stringify({ version:1, exportedAt:new Date().toISOString(), notices }, null, 2)], { type:'application/json' });
  const url = URL.createObjectURL(file);
  const link = node('a'); link.href = url; link.download = 'onda-avisos.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('clear-button').addEventListener('click', () => {
  if (!clearPending) {
    clearPending = true;
    $('clear-button').textContent = 'Pulsa de nuevo para borrar los avisos';
    setTimeout(() => { clearPending = false; $('clear-button').textContent = 'Borrar avisos de este dispositivo'; }, 5000);
    return;
  }
  try {
    saveInbox(storage, []); notices = []; assembler.reset(); receivedFrames = 0;
    $('received-frames').textContent = '0'; $('receive-progress').hidden = true;
    renderInbox(); toast('Avisos borrados de este dispositivo.');
  } catch { toast('No se pudo actualizar el almacenamiento.'); }
  clearPending = false; $('clear-button').textContent = 'Borrar avisos de este dispositivo';
});

async function prepareOffline() {
  if (runtime.bundled) {
    $('offline-title').textContent='Incluida en este iPhone';
    $('offline-description').textContent='El mapa y las herramientas vienen dentro de la app. Los datos nuevos llegan al escuchar la señal.';
    $('offline-state').textContent='Disponible';
    document.querySelector('.readiness-strip').classList.add('ready');
    const firstStep=document.querySelector('.guide-steps article p');
    if(firstStep)firstStep.textContent='Abre Onda, elige tu lugar o usa GPS. El mapa ya viene incluido en la app.';
    return;
  }

  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    $('offline-title').textContent = 'Este navegador no permite guardar la web offline';
    $('offline-description').textContent = 'Usa Safari desde la dirección HTTPS para preparar el iPhone.';
    $('offline-state').textContent = 'No disponible';
    return;
  }
  try {
    const registered = await navigator.serviceWorker.register('/sw.js', {updateViaCache:'none'});
    if (registered.installing) await new Promise((resolve,reject)=>{const worker=registered.installing;worker.addEventListener('statechange',()=>{if(worker.state==='activated')resolve();else if(worker.state==='redundant')reject(new Error('La nueva versión no se pudo guardar.'));});});
    const registration = await navigator.serviceWorker.ready;
    await new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      const timeout = setTimeout(() => reject(new Error('La preparación tardó más de lo esperado.')), 15000);
      channel.port1.onmessage = event => { clearTimeout(timeout); event.data?.ready ? resolve() : reject(new Error('Faltan recursos guardados.'));  };
      registration.active.postMessage({ type:'OFFLINE_STATUS' }, [channel.port2]);
    });
    $('offline-title').textContent = 'Lista sin internet';
    $('offline-description').textContent = 'Puedes desconectar la red. El almacenamiento del navegador puede borrarse; comprueba la apertura antes de salir.';
    $('offline-state').textContent = 'Guardada';
    document.querySelector('.readiness-strip').classList.add('ready');
  } catch (error) {
    $('offline-title').textContent = 'Preparación offline pendiente';
    $('offline-description').textContent = 'Mantén internet y recarga la web para volver a intentarlo.';
    $('offline-state').textContent = 'Pendiente';
    console.warn('Offline:', error.message);
  }
}

let reloadingShell=false;
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange',()=>{
  if (!reloadingShell && !listening && !sending) {reloadingShell=true;location.reload();}
  else toast('Nueva versión guardada. Recarga Onda cuando termine la recepción.');
});
renderInbox();
void preparePacket();
void prepareOffline();
setInterval(renderInbox, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && listening) {
    void stopListening();
    $('receiver-feedback').textContent = 'Se detuvo la escucha al salir de esta pantalla. Pulsa escuchar para continuar.';
  }
});
window.addEventListener('pagehide', () => { screenAwake.setActive(false); station.stop(); transmissionController?.abort(); if (modem) void modem.stop(); });

// Kept exported for integration checks using the real frame validation path.
export { receiveFrame };
