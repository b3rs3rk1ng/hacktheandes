import { createLiveFeedClient, fetchSource, getLiveFeed, validateFeed } from './live-feed.js';
import { encodeField, validateField } from './protocol.js';

const $ = id => document.getElementById(id);
const time = value => new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' }).format(new Date(value));
const stopped = signal => signal.reason || new DOMException('Emisión detenida', 'AbortError');
const feedMetadata = feed => ({ observedAt: feed.sourceUpdatedAt, fetchedAt: feed.fetchedAt,
  sourceLabel: [...new Set(feed.fields.map(field => field.source?.name).filter(Boolean))].join(' · ') });
const channels = {
  direct: {
    label: 'Sonido directo',
    description: 'Sonido directo, sin efectos de radio. La simulación de radio aplica siseo, banda reducida y desvanecimiento al audio que recibe el micrófono; no prueba una emisora real.',
  },
  radio: {
    label: 'Radio simulada · estable',
    description: 'Simulación de una radio estable: aplica siseo, banda reducida y desvanecimiento leve al audio que recibe el micrófono. No prueba una emisora real.',
  },
  weak: {
    label: 'Radio simulada · señal variable',
    description: 'Simulación de señal variable: aplica siseo, banda reducida y desvanecimiento al audio que recibe el micrófono. Puede perder fragmentos; no prueba una emisora real.',
  },
};

function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(stopped(signal)); return; }
    const done = () => { signal.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(done, ms);
    const abort = () => { clearTimeout(timer); reject(stopped(signal)); };
    signal.addEventListener('abort', abort, { once: true });
  });
}

// Preparation may be shared by the source panel and an emitter. Stopping one
// emission stops its wait immediately, without cancelling the shared warmup.
function cancellable(operation, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(stopped(signal));
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(operation).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

function feedForContext(value, context) {
  const feed = validateFeed(value);
  const fields = feed.fields.map(validateField);
  if (fields.some(field => field.context !== context)) throw new Error('El registro mezcla datos en vivo e históricos.');
  return { ...feed, fields };
}

function validateReplay(value) {
  if (value?.version !== 1 || value.context !== 'replay' || !Array.isArray(value.frames) ||
      !value.frames.length || value.frames.length > 128) throw new Error('El registro histórico no es válido.');
  const frames = value.frames.map(frame => feedForContext(frame, 'replay'));
  if (frames.some((frame, index) => index && Date.parse(frame.sourceUpdatedAt) < Date.parse(frames[index - 1].sourceUpdatedAt))) {
    throw new Error('El registro histórico no está ordenado por fecha.');
  }
  return { ...value, frames };
}

export function createStation({ getModem, isBusy, onBusy, onState = () => {}, fetchImpl = globalThis.fetch }) {
  let client, replay, controller, preparing, operation;
  let prepared = false;
  let lastCheck = 0;
  let state = Object.freeze({ operation: null, phase: 'stopped', running: false, cycle: 0, sent: 0, total: 0,
    observedAt: null, fetchedAt: null, sourceLabel: '', context: null, message: 'Enciende la radio para transmitir.', error: null });
  function updateState(change) {
    state = Object.freeze({ ...state, ...change });
    // A view must never interrupt transmission or prevent cleanup.
    try { onState(state); } catch { /* Observer errors do not own audio. */ }
  }
  // Both source URLs are same-origin and may sit behind the private site login.
  const fetchLocal = (url, options) => fetchImpl(url, { ...options, credentials: 'same-origin' });
  const readJSON = url => fetchSource(url, { fetchImpl: fetchLocal });

  function describeChannel() {
    $('station-channel-info').textContent = channels[$('station-channel').value]?.description || 'Selecciona un canal de sonido válido.';
  }

  function selectedChannel() {
    const channel = $('station-channel').value;
    if (!Object.hasOwn(channels, channel)) throw new Error('Canal de sonido no válido.');
    return channel;
  }

  async function intro(modem, channel, signal, keepAlive) {
    $('station-state').textContent = `Radio · locutor y sintonía · 5 segundos · ${channels[channel].label}`;
    updateState({ phase: 'intro', message: 'Locutor y sintonía. El boletín comienza enseguida.' });
    await cancellable(modem.previewChannel({ channel, seconds: 5, signal, keepAlive }), signal);
    if (signal.aborted) throw stopped(signal);
  }

  async function preview(signal, primed, modem) {
    await cancellable(primed, signal);
    if (signal.aborted) throw stopped(signal);
    await intro(modem, selectedChannel(), signal, false);
    $('station-state').textContent = 'Escucha de prueba terminada. No se enviaron datos.';
  }

  function status(result) {
    if (result.state === 'loading') { $('source-state').textContent = 'Consultando fuente…'; return; }
    const feed = result.feed;
    $('source-state').textContent = result.state === 'ready' ? 'Consulta oficial completada' : 'Fuente no disponible · se conserva el último registro';
    if (feed) {
      $('source-time').textContent = `Análisis ${time(feed.sourceUpdatedAt)} · consulta ${time(feed.fetchedAt)}`;
      $('source-cells').textContent = `${feed.fields.reduce((sum, field) => sum + field.values.length, 0)} celdas · ${feed.fields.length} rejillas`;
      $('source-age').textContent = Date.now() - Date.parse(feed.sourceUpdatedAt) > 2 * 3600000 ? 'Registro desactualizado' : 'La fuente puede tardar en publicar cambios.';
      if (state.context !== 'replay') updateState(feedMetadata(feed));
    }
    if (result.error) $('source-age').textContent = `${result.error.message} La fecha original se conserva.`;
  }

  function refresh(signal) {
    if (!client) return Promise.resolve();
    lastCheck = Date.now();
    return client.refresh({ gatewayUrl: '/api/feed', signal, fetchImpl: fetchLocal });
  }

  function prepare() {
    if (preparing) return preparing;
    if (prepared) return Promise.resolve(true);
    preparing = (async () => {
      const [initialValue, replayValue] = await Promise.all([
        readJSON('/public/data/initial-feed.json'), readJSON('/public/data/replay-feed.json'),
      ]);
      const initial = feedForContext(initialValue, 'live');
      const historical = validateReplay(replayValue);
      const nextClient = createLiveFeedClient({
        initialFeed: initial,
        load: async options => feedForContext(await getLiveFeed(options), 'live'),
        onStatus: status,
      });
      // Repeated visits retain the existing client and its newer observation.
      replay = historical;
      client = nextClient;
      prepared = true;
      status({ state: 'unavailable', feed: initial });
      await refresh();
      return true;
    })().catch(error => {
      $('source-state').textContent = error.message;
      return false;
    }).finally(() => { preparing = null; });
    return preparing;
  }

  async function run(signal, primed, modem) {
    await cancellable(primed, signal);
    await cancellable(prepare(), signal);
    if (signal.aborted) throw stopped(signal);
    if (!client) throw new Error('No hay un registro preparado para emitir.');
    const context = $('station-context').value;
    if (!['live', 'replay'].includes(context)) throw new Error('Contexto de emisión no válido.');
    const speed = $('station-speed').value;
    const channel = selectedChannel();
    const channelLabel = channels[channel].label;
    await intro(modem, channel, signal, true);
    let cycle = 0, replayIndex = 0;
    while (!signal.aborted) {
      if (context === 'live' && Date.now() - lastCheck >= 300000) await cancellable(refresh(signal), signal);
      if (signal.aborted) throw stopped(signal);
      const feed = context === 'replay' ? replay.frames[Math.min(replayIndex, replay.frames.length - 1)] : client.lastFeed;
      if (!feed) throw new Error('Todavía no hay datos para transmitir.');
      cycle++;
      const sourceState = context === 'replay'
        ? `Histórico ${time(feed.sourceUpdatedAt)} · paso ${Math.min(replayIndex + 1, replay.frames.length)} de ${replay.frames.length}`
        : `Emitiendo análisis de ${time(feed.sourceUpdatedAt)} · vuelta ${cycle}`;
      $('station-state').textContent = `${sourceState} · ${channelLabel}`;
      const packets = await Promise.all(feed.fields.map(field => encodeField(field)));
      if (signal.aborted) throw stopped(signal);
      const total = packets.reduce((sum, packet) => sum + packet.frames.length * 2, 0);
      let sent = 0;
      updateState({ phase: 'transmitting', cycle, sent, total, context, ...feedMetadata(feed),
        message: context === 'replay' ? 'Transmitiendo observaciones históricas.' : 'Transmitiendo el último análisis disponible.' });
      $('station-size').textContent = `${packets.reduce((sum, packet) => sum + packet.compressedBytes, 0)} B comprimidos · ${total} fragmentos con repetición`;
      // Complete the whole bulletin before repeating any field. Receivers get
      // every area sooner, with the same two copies and total airtime.
      for (let pass = 0; pass < 2; pass++) {
        for (const packet of packets) {
          if (signal.aborted) throw stopped(signal);
          await modem.transmit(packet.frames, { repeat: 1, keepAlive: true, speed, channel, signal, onProgress: progress => {
            $('station-progress').max = total;
            $('station-progress').value = sent + progress.sent;
            $('station-progress-text').textContent = `${sent + progress.sent} de ${total} fragmentos · ${channelLabel} · la laptop debe seguir abierta`;
            updateState({ sent: sent + progress.sent });
          } });
          sent += packet.frames.length;
          updateState({ sent });
        }
      }
      if (signal.aborted) throw stopped(signal);
      if (context === 'replay') replayIndex++;
      updateState({ phase: 'waiting', message: 'Radio encendida. El boletín vuelve a emitirse en unos segundos.' });
      await pause(2500, signal);
    }
  }

  async function startOperation(mode) {
    if (controller) {
      if (operation === mode) controller.abort(new DOMException('Emisión detenida', 'AbortError'));
      return;
    }
    const modem = getModem();
    if (!modem) { $('station-state').textContent = 'El audio se está preparando. Vuelve a pulsar en un momento.'; updateState({ phase: 'error', error: $('station-state').textContent, message: $('station-state').textContent }); return; }
    if (isBusy()) { $('station-state').textContent = 'Detén la otra recepción o emisión antes de iniciar.'; updateState({ phase: 'error', error: $('station-state').textContent, message: $('station-state').textContent }); return; }
    controller = new AbortController();
    const current = controller;
    operation = mode;
    const context = mode === 'emit' ? $('station-context').value : state.context;
    updateState({ operation: mode, phase: 'preparing', running: true, cycle: 0, sent: 0, total: 0,
      ...(context !== state.context ? { observedAt: null, fetchedAt: null, sourceLabel: '' } : {}), context, error: null,
      message: mode === 'emit' ? 'Preparando el boletín de la radio…' : 'Preparando la prueba de sonido…' });
    onBusy(true);
    $('station-start').textContent = mode === 'emit' ? 'Detener emisión continua' : 'Emitir datos continuamente';
    $('station-start').disabled = mode === 'preview';
    $('station-preview').textContent = mode === 'preview' ? 'Detener escucha de prueba' : 'Probar sonido · 5 s';
    $('station-preview').disabled = mode === 'emit';
    $('station-context').disabled = true;
    $('station-speed').disabled = true;
    $('station-channel').disabled = true;
    document.body.classList.add('transmitting');
    try {
      // No await precedes prime(): Safari receives resume inside this gesture.
      await (mode === 'preview' ? preview : run)(current.signal, modem.prime(), modem);
    } catch (error) {
      $('station-state').textContent = current.signal.aborted
        ? mode === 'preview' ? 'Escucha de prueba detenida. No se enviaron datos.' : 'Emisión detenida. Los receptores conservan los datos.'
        : error.message;
      updateState({ phase: current.signal.aborted ? 'stopped' : 'error',
        error: current.signal.aborted ? null : error.message, message: $('station-state').textContent });
    } finally {
      try { await modem.stop(); }
      catch (error) { $('station-state').textContent = `No se pudo cerrar el audio: ${error.message}`; updateState({ phase: 'error', error: error.message, message: $('station-state').textContent }); }
      if (controller === current) { controller = null; operation = null; }
      onBusy(false);
      $('station-start').textContent = 'Emitir datos continuamente';
      $('station-start').disabled = false;
      $('station-preview').textContent = 'Probar sonido · 5 s';
      $('station-preview').disabled = false;
      $('station-context').disabled = false;
      $('station-speed').disabled = false;
      $('station-channel').disabled = false;
      document.body.classList.remove('transmitting');
      updateState({ operation: null, running: false, phase: state.phase === 'error' ? 'error' : 'stopped', message: $('station-state').textContent });
    }
  }
  $('station-start').addEventListener('click', () => startOperation('emit'));
  $('station-preview').addEventListener('click', () => startOperation('preview'));
  $('source-refresh').addEventListener('click', () => {
    void (prepared ? refresh() : prepare()).catch(error => {
      if (error.name !== 'AbortError') $('source-state').textContent = error.message;
    });
  });
  $('station-channel').addEventListener('change', describeChannel);
  describeChannel();
  return {
    prepare,
    stop: () => controller?.abort(new DOMException('Emisión detenida', 'AbortError')),
    get running() { return !!controller; },
    get state() { return state; },
  };
}
