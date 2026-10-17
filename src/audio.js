// ggwave supplies the modem and its Reed–Solomon correction. This module handles
// browser audio lifecycle only; no microphone permission is requested on load.
let factoryPromise;
let modulePromise;

function abortError() { return new DOMException('Operación cancelada.', 'AbortError'); }

function loadFactory() {
  if (typeof window === 'undefined') throw new Error('El módem de audio requiere un navegador.');
  if (window.ggwave_factory) return Promise.resolve(window.ggwave_factory);
  if (!factoryPromise) {
    factoryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('../public/vendor/ggwave-0.4.0.js', import.meta.url).href;
      script.onload = () => window.ggwave_factory ? resolve(window.ggwave_factory) : reject(new Error('Módem de audio no disponible.'));
      script.onerror = () => { factoryPromise = null; reject(new Error('No se pudo cargar el módem local. Abre la app una vez con conexión.')); };
      document.head.append(script);
    });
  }
  return factoryPromise;
}

async function loadModule() {
  if (!modulePromise) {
    modulePromise = loadFactory().then((factory) => factory({ print: () => {}, printErr: () => {} })).then((module) => {
      module.disableLog();
      return module;
    }).catch((error) => { modulePromise = null; throw error; });
  }
  return modulePromise;
}

function microphoneError(error) {
  if (error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError') {
    return new Error('Micrófono bloqueado. Permite el acceso en los ajustes del navegador y vuelve a escuchar.');
  }
  if (error?.name === 'NotFoundError') return new Error('No se encontró un micrófono.');
  if (error?.name === 'NotReadableError') return new Error('El micrófono está ocupado o no puede abrirse.');
  return error;
}

export async function createAudioModem() {
  const modem = await loadModule();
  let context = null;
  let instance = null;
  let stream = null;
  let input = null;
  let processor = null;
  let silence = null;
  let playback = null;
  let mode = 'idle';
  let generation = 0;
  let statusCallback = () => {};
  let receivingTimer;

  function resetInstance() {
    if (instance !== null) modem.free(instance);
    const parameters = modem.getDefaultParameters();
    parameters.sampleRateInp = context.sampleRate;
    parameters.sampleRateOut = context.sampleRate;
    parameters.sampleFormatInp = modem.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
    parameters.sampleFormatOut = modem.SampleFormat.GGWAVE_SAMPLE_FORMAT_F32;
    instance = modem.init(parameters);
    if (instance < 0) { instance = null; throw new Error('No se pudo iniciar el módem de audio.'); }
  }

  // Called at the beginning of a button handler, before its first await. Safari
  // needs resume() inside the gesture, even when the modem itself is preloaded.
  function activate() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error('Este navegador no admite Web Audio.');
    if (!context || context.state === 'closed') {
      context = new AudioContext();
      context.onstatechange = () => {
        if (context?.state === 'interrupted' || (context?.state === 'suspended' && mode !== 'idle')) {
          statusCallback('interrupted');
        }
      };
    }
    const resumed = context.resume();
    if (instance === null) resetInstance();
    return resumed;
  }

  function releaseCapture() {
    clearTimeout(receivingTimer);
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); processor = null; }
    if (input) { input.disconnect(); input = null; }
    if (silence) { silence.disconnect(); silence = null; }
    if (stream) { for (const track of stream.getTracks()) { track.onended = null; track.stop(); } stream = null; }
  }

  async function stop() {
    const token = ++generation;
    mode = 'idle';
    releaseCapture();
    if (playback) { try { playback.stop(); } catch {} playback = null; }
    if (instance !== null) { modem.free(instance); instance = null; }
    const previous = context;
    context = null;
    if (previous) {
      previous.onstatechange = null;
      if (previous.state !== 'closed') await previous.close();
    }
    if (token === generation) statusCallback('stopped');
  }

  async function listen({ onFrame = () => {}, onLevel = () => {}, onStatus = () => {} } = {}) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('El micrófono requiere HTTPS o localhost. Abre la dirección segura de la app.');
    }
    if (mode === 'listening') return;
    if (mode !== 'idle') throw new Error('Detén la transmisión antes de escuchar.');
    statusCallback = onStatus;
    const resume = activate();
    const token = ++generation;
    mode = 'starting';
    onStatus('loading');
    try {
      await resume;
      const captured = await navigator.mediaDevices.getUserMedia({ audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      } });
      if (token !== generation) { captured.getTracks().forEach((track) => track.stop()); throw abortError(); }
      stream = captured;
      input = context.createMediaStreamSource(stream);
      // ScriptProcessor is retained as the cross-Safari fallback used by the
      // upstream ggwave example. Output stays silent; microphone is never echoed.
      processor = context.createScriptProcessor(4096, 1, 1);
      silence = context.createGain();
      silence.gain.value = 0;
      let lastLevel = 0;
      processor.onaudioprocess = (event) => {
        if (token !== generation || mode !== 'listening') return;
        const samples = event.inputBuffer.getChannelData(0);
        const now = performance.now();
        if (now - lastLevel > 100) {
          let energy = 0;
          for (const sample of samples) energy += sample * sample;
          onLevel(Math.min(1, Math.sqrt(energy / samples.length)));
          lastLevel = now;
        }
        const decoded = modem.decode(instance, new Int8Array(samples.buffer, samples.byteOffset, samples.byteLength));
        if (decoded?.length) {
          // ggwave's decoded bytes point at reused WASM memory: copy immediately.
          const frame = new Uint8Array(decoded);
          // Clear spectral history after each complete packet. This avoids stale
          // markers from a preceding, differently sized transmission influencing
          // the next packet. Application fragments live in the assembler, not here.
          resetInstance();
          onStatus('receiving');
          clearTimeout(receivingTimer);
          receivingTimer = setTimeout(() => { if (mode === 'listening') onStatus('listening'); }, 600);
          Promise.resolve(onFrame(frame)).catch(() => {});
        }
      };
      for (const track of stream.getAudioTracks()) track.onended = () => {
        if (token === generation) { void stop().then(() => onStatus('interrupted')); }
      };
      input.connect(processor);
      processor.connect(silence);
      silence.connect(context.destination);
      mode = 'listening';
      onStatus('listening');
    } catch (error) {
      if (token === generation) await stop();
      throw microphoneError(error);
    }
  }

  async function transmit(frames, { onProgress = () => {}, onStatus = () => {}, repeat = 2, signal } = {}) {
    if (!Array.isArray(frames) || !frames.length || frames.length > 68 || frames.some((frame) => !(frame instanceof Uint8Array) || !frame.length || frame.length > 140)) {
      throw new Error('La transmisión requiere paquetes de entre 1 y 140 bytes.');
    }
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 8) throw new Error('Repeticiones: entre 1 y 8.');
    if (mode !== 'idle') throw new Error('Detén la escucha o transmisión actual primero.');
    if (signal?.aborted) throw abortError();
    statusCallback = onStatus;
    const resume = activate();
    const token = ++generation;
    mode = 'transmitting';
    const cancel = () => { void stop(); };
    signal?.addEventListener('abort', cancel, { once: true });
    try {
      await resume;
      onStatus('transmitting');
      let sent = 0;
      for (let cycle = 0; cycle < repeat; cycle++) {
        for (let part = 0; part < frames.length; part++) {
          if (token !== generation || signal?.aborted) throw abortError();
          const waveform = modem.encode(instance, frames[part], modem.ProtocolId.GGWAVE_PROTOCOL_AUDIBLE_FAST, 40);
          if (!waveform?.byteLength || waveform.byteLength % 4) throw new Error('No se pudo generar la señal de audio.');
          const bytes = new Uint8Array(waveform.buffer, waveform.byteOffset, waveform.byteLength).slice();
          const samples = new Float32Array(bytes.buffer);
          const buffer = context.createBuffer(1, samples.length, context.sampleRate);
          buffer.copyToChannel(samples, 0);
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          playback = source;
          onProgress({ sent, total: frames.length * repeat, cycle: cycle + 1, cycles: repeat, frame: part + 1, frames: frames.length, durationSeconds: buffer.duration });
          await new Promise((resolve) => { source.onended = resolve; source.start(); });
          source.disconnect();
          if (playback === source) playback = null;
          if (token !== generation || signal?.aborted) throw abortError();
          sent++;
          onProgress({ sent, total: frames.length * repeat, cycle: cycle + 1, cycles: repeat, frame: part + 1, frames: frames.length, durationSeconds: buffer.duration });
          // Separate sound markers between packets. Missing packets can arrive
          // in a later repeat cycle; there is no return-channel acknowledgement.
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (token === generation) await stop();
    }
  }

  return { transmit, listen, stop };
}
