import { createLiveFeedClient, fetchSource, getLiveFeed, validateFeed } from './live-feed.js';
import { encodeField, validateField } from './protocol.js';

const $ = id => document.getElementById(id);
const time = value => new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima' }).format(new Date(value));
const stopped = signal => signal.reason || new DOMException('Emisión detenida', 'AbortError');
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

export function createStation({ getModem, isBusy, onBusy, fetchImpl = globalThis.fetch }) {
  let client, replay, controller, preparing;
  let prepared = false;
  let lastCheck = 0;
  // Both source URLs are same-origin and may sit behind the private site login.
  const fetchLocal = (url, options) => fetchImpl(url, { ...options, credentials: 'same-origin' });
  const readJSON = url => fetchSource(url, { fetchImpl: fetchLocal });

  function describeChannel() {
    $('station-channel-info').textContent = channels[$('station-channel').value]?.description || 'Selecciona un canal de sonido válido.';
  }

  function status(result) {
    if (result.state === 'loading') { $('source-state').textContent = 'Consultando fuente…'; return; }
    const feed = result.feed;
    $('source-state').textContent = result.state === 'ready' ? 'Consulta oficial completada' : 'Fuente no disponible · se conserva el último registro';
    if (feed) {
      $('source-time').textContent = `Análisis ${time(feed.sourceUpdatedAt)} · consulta ${time(feed.fetchedAt)}`;
      $('source-cells').textContent = `${feed.fields.reduce((sum, field) => sum + field.values.length, 0)} celdas · ${feed.fields.length} rejillas`;
      $('source-age').textContent = Date.now() - Date.parse(feed.sourceUpdatedAt) > 2 * 3600000 ? 'Registro desactualizado' : 'La fuente puede tardar en publicar cambios.';
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
    const channel = $('station-channel').value;
    if (!Object.hasOwn(channels, channel)) throw new Error('Canal de sonido no válido.');
    const channelLabel = channels[channel].label;
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
      const total = packets.reduce((sum, packet) => sum + packet.frames.length * 2, 0);
      let sent = 0;
      $('station-size').textContent = `${packets.reduce((sum, packet) => sum + packet.compressedBytes, 0)} B comprimidos · ${total} fragmentos con repetición`;
      for (const packet of packets) {
        await modem.transmit(packet.frames, { repeat: 2, keepAlive: true, speed, channel, signal, onProgress: progress => {
          $('station-progress').max = total;
          $('station-progress').value = sent + progress.sent;
          $('station-progress-text').textContent = `${sent + progress.sent} de ${total} fragmentos · ${channelLabel} · la laptop debe seguir abierta`;
        } });
        sent += packet.frames.length * 2;
      }
      if (context === 'replay') replayIndex++;
      await pause(2500, signal);
    }
  }

  $('station-start').addEventListener('click', async () => {
    if (controller) { controller.abort(new DOMException('Emisión detenida', 'AbortError')); return; }
    const modem = getModem();
    if (!modem) { $('station-state').textContent = 'El audio se está preparando. Vuelve a pulsar emitir.'; return; }
    if (isBusy()) { $('station-state').textContent = 'Detén la otra recepción o emisión antes de iniciar.'; return; }
    controller = new AbortController();
    const current = controller;
    onBusy(true);
    $('station-start').textContent = 'Detener emisión continua';
    $('station-context').disabled = true;
    $('station-speed').disabled = true;
    $('station-channel').disabled = true;
    document.body.classList.add('transmitting');
    try {
      // No await precedes prime(): Safari receives resume inside this gesture.
      await run(current.signal, modem.prime(), modem);
    } catch (error) {
      $('station-state').textContent = current.signal.aborted ? 'Emisión detenida. Los receptores conservan los datos.' : error.message;
    } finally {
      try { await modem.stop(); }
      catch (error) { $('station-state').textContent = `No se pudo cerrar el audio: ${error.message}`; }
      if (controller === current) controller = null;
      onBusy(false);
      $('station-start').textContent = 'Emitir datos continuamente';
      $('station-context').disabled = false;
      $('station-speed').disabled = false;
      $('station-channel').disabled = false;
      document.body.classList.remove('transmitting');
    }
  });
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
  };
}
