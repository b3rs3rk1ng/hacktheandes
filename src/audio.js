import { CHANNEL_PROFILES, createAudioChannel } from './audio-channel.js';

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

// onActivity receives { mode, active } whenever the audio lifecycle changes.
// Capture, transmission and a retained channel producing hiss are active.
// A primed context alone does not keep the screen awake.
export async function createAudioModem({ onActivity = () => {}, fetchImpl = globalThis.fetch } = {}) {
  const modem = await loadModule();
  let context = null;
  let instance = null;
  let stream = null;
  let input = null;
  let processor = null;
  let silence = null;
  let playback = null;
  let cancelPlayback = null;
  const pendingOperations = new Set();
  let introductionPromise = null;
  let introductionController = null;
  let mode = 'idle';
  let generation = 0;
  let statusCallback = () => {};
  let receivingTimer;
  let outputChannel = null;
  let activityActive = false;

  function setMode(next) {
    const active = next !== 'idle' || outputChannel !== null;
    if (mode === next && activityActive === active) return;
    mode = next;
    activityActive = active;
    // Observers must not prevent microphone/playback cleanup.
    try { onActivity({ mode, active }); }
    catch (error) { console.warn('Audio activity observer:', error); }
  }

  function releaseOutputChannel() {
    if (!outputChannel) return;
    const previous = outputChannel;
    outputChannel = null;
    previous.node.onaudioprocess = null;
    try { previous.clock.stop(); } catch {}
    previous.clock.disconnect();
    previous.node.disconnect();
  }

  // A persistent, clocked graph processes the transmitted waveform AND the
  // silence between packets. Fading and hiss never restart at packet boundaries.
  // The receiver still decodes only its physical microphone input.
  function transmissionDestination(profile) {
    if (profile === 'direct') { releaseOutputChannel(); return context.destination; }
    if (outputChannel?.profile === profile) return outputChannel.node;
    releaseOutputChannel();
    const channel = createAudioChannel({ profile, sampleRate: context.sampleRate });
    const node = context.createScriptProcessor(4096, 1, 1);
    const clock = context.createBufferSource();
    outputChannel = { profile, node, clock, channel };
    clock.buffer = context.createBuffer(1, 4096, context.sampleRate);
    clock.loop = true;
    clock.connect(node);
    node.onaudioprocess = event => {
      channel.process(event.inputBuffer.getChannelData(0), event.outputBuffer.getChannelData(0));
    };
    node.connect(context.destination);
    clock.start();
    return node;
  }

  function waitForOperation(operation) {
    return new Promise((resolve, reject) => {
      const cancel = () => reject(abortError());
      pendingOperations.add(cancel);
      Promise.resolve(operation).then(resolve, reject).finally(() => pendingOperations.delete(cancel));
    });
  }

  async function loadIntroduction() {
    if (!introductionPromise) {
      const activeContext = context;
      const controller = new AbortController();
      introductionController = controller;
      const timeout = setTimeout(() => controller.abort(), 8000);
      controller.signal.addEventListener('abort', () => clearTimeout(timeout), { once: true });
      const pending = (async () => {
        const response = await fetchImpl(new URL('../public/audio/radio-intro.wav', import.meta.url), {
          credentials: 'same-origin', signal: controller.signal,
        });
        if (!response.ok || !/^audio\/(?:wav|x-wav|wave)(?:;|$)/i.test(response.headers.get('content-type') || '')) {
          throw new Error('No se pudo cargar la voz local del boletín.');
        }
        const limit = 512 * 1024;
        const declared = response.headers.get('content-length');
        if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error('La introducción de audio excede el límite.');
        const bytes = await response.arrayBuffer();
        if (!bytes.byteLength || bytes.byteLength > limit) throw new Error('La introducción de audio no es válida.');
        return activeContext.decodeAudioData(bytes);
      })().catch(error => {
        if (introductionPromise === pending) introductionPromise = null;
        throw error;
      }).finally(() => {
        clearTimeout(timeout);
        if (introductionController === controller) introductionController = null;
      });
      introductionPromise = pending;
    }
    return waitForOperation(introductionPromise);
  }

  async function playBuffer(buffer, destination, token, signal) {
    const source = context.createBufferSource();
    playback = source;
    try {
      source.buffer = buffer;
      source.connect(destination);
      if (token !== generation || signal?.aborted) throw abortError();
      await new Promise((resolve, reject) => {
        cancelPlayback = () => reject(abortError());
        source.onended = resolve;
        source.start();
      });
    } finally {
      source.onended = null;
      source.disconnect();
      if (playback === source) { playback = null; cancelPlayback = null; }
    }
  }

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
        if (context?.state === 'interrupted' || (context?.state === 'suspended' && activityActive)) {
          const report=statusCallback;
          void stop().then(()=>report('interrupted'));
        }
      };
    }
    const resumed = context.resume();
    if (instance === null) resetInstance();
    return waitForOperation(resumed);
  }

  // Call directly from a user gesture before starting a polling loop. Keeping
  // this context alive permits later packets without another button press.
  function prime() { return activate(); }

  function releaseCapture() {
    clearTimeout(receivingTimer);
    if (processor) { processor.onaudioprocess = null; processor.disconnect(); processor = null; }
    if (input) { input.disconnect(); input = null; }
    if (silence) { silence.disconnect(); silence = null; }
    if (stream) { for (const track of stream.getTracks()) { track.onended = null; track.stop(); } stream = null; }
  }

  async function stop() {
    const token = ++generation;
    releaseOutputChannel();
    setMode('idle');
    for (const cancel of pendingOperations) cancel();
    pendingOperations.clear();
    introductionController?.abort();
    introductionController = null;
    introductionPromise = null;
    releaseCapture();
    // Closing an AudioContext may suppress a queued source.onended event.
    // Settle the caller independently so Stop can always release the UI.
    const cancelPending = cancelPlayback;
    cancelPlayback = null;
    cancelPending?.();
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

  // A bounded, local station identification precedes data without overlapping
  // packets. Preview and continuous transmission share the same output graph.
  async function previewChannel({ channel = 'radio', seconds = 5, keepAlive = false, signal,
    onStatus = () => {} } = {}) {
    if (!Object.hasOwn(CHANNEL_PROFILES, channel)) throw new Error('Canal de audio no compatible.');
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 15) throw new Error('La prueba de radio debe durar entre 1 y 15 segundos.');
    if (typeof keepAlive !== 'boolean') throw new Error('keepAlive debe ser booleano.');
    if (mode !== 'idle') throw new Error('Detén la escucha o transmisión actual primero.');
    if (signal?.aborted) throw abortError();
    statusCallback = onStatus;
    const token = ++generation;
    const cancel = () => { void stop(); };
    signal?.addEventListener('abort', cancel, { once: true });
    setMode('previewing');
    let complete = false;
    try {
      await prime();
      if (token !== generation || signal?.aborted) throw abortError();
      const voice = await loadIntroduction();
      if (token !== generation || signal?.aborted) throw abortError();
      const buffer = context.createBuffer(1, Math.round(context.sampleRate * seconds), context.sampleRate);
      const samples = new Float32Array(buffer.length);
      const start = Math.round(context.sampleRate * 0.65);
      const speech = voice.getChannelData(0);
      const count = Math.min(speech.length, Math.max(0, samples.length - start));
      const fade = Math.round(context.sampleRate * 0.03);
      for (let index = 0; index < count; index++) {
        const envelope = Math.min(1, index / fade, (count - 1 - index) / fade);
        samples[start + index] = speech[index] * Math.max(0, envelope);
      }
      buffer.copyToChannel(samples, 0);
      const destination = transmissionDestination(channel);
      outputChannel?.channel.beginIntroduction(seconds);
      onStatus('previewing');
      await playBuffer(buffer, destination, token, signal);
      if (token !== generation || signal?.aborted) throw abortError();
      complete = true;
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (token === generation) {
        if (complete && keepAlive) { setMode('idle'); onStatus('idle'); }
        else await stop();
      }
    }
  }

  async function listen({ onFrame = () => {}, onLevel = () => {}, onStatus = () => {} } = {}) {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('El micrófono requiere HTTPS o localhost. Abre la dirección segura de la app.');
    }
    if (mode === 'listening') return;
    if (mode !== 'idle') throw new Error('Detén la transmisión antes de escuchar.');
    releaseOutputChannel();
    statusCallback = onStatus;
    const token = ++generation;
    setMode('starting');
    onStatus('loading');
    try {
      await prime();
      if (token !== generation) throw abortError();
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
      setMode('listening');
      onStatus('listening');
    } catch (error) {
      if (token === generation) await stop();
      throw microphoneError(error);
    }
  }

  async function transmit(frames, { onProgress = () => {}, onStatus = () => {}, repeat = 2, signal,
    keepAlive = false, speed = 'fast', channel = 'direct' } = {}) {
    if (!Array.isArray(frames) || !frames.length || frames.length > 68 || frames.some((frame) => !(frame instanceof Uint8Array) || !frame.length || frame.length > 140)) {
      throw new Error('La transmisión requiere paquetes de entre 1 y 140 bytes.');
    }
    if (!Number.isInteger(repeat) || repeat < 1 || repeat > 8) throw new Error('Repeticiones: entre 1 y 8.');
    if (!['fast', 'fastest'].includes(speed)) throw new Error('Velocidad de transmisión no compatible.');
    if (!Object.hasOwn(CHANNEL_PROFILES, channel)) throw new Error('Canal de audio no compatible.');
    if (typeof keepAlive !== 'boolean') throw new Error('keepAlive debe ser booleano.');
    if (mode !== 'idle') throw new Error('Detén la escucha o transmisión actual primero.');
    if (signal?.aborted) throw abortError();
    statusCallback = onStatus;
    const token = ++generation;
    setMode('transmitting');
    const cancel = () => { void stop(); };
    signal?.addEventListener('abort', cancel, { once: true });
    let complete = false;
    try {
      await prime();
      if (token !== generation || signal?.aborted) throw abortError();
      onStatus('transmitting');
      const protocol = modem.ProtocolId[speed === 'fastest' ? 'GGWAVE_PROTOCOL_AUDIBLE_FASTEST' : 'GGWAVE_PROTOCOL_AUDIBLE_FAST'];
      if (protocol === undefined) throw new Error('El módem no admite esa velocidad de transmisión.');
      const destination = transmissionDestination(channel);
      let sent = 0;
      for (let cycle = 0; cycle < repeat; cycle++) {
        for (let part = 0; part < frames.length; part++) {
          if (token !== generation || signal?.aborted) throw abortError();
          const waveform = modem.encode(instance, frames[part], protocol, 40);
          if (!waveform?.byteLength || waveform.byteLength % 4) throw new Error('No se pudo generar la señal de audio.');
          const bytes = new Uint8Array(waveform.buffer, waveform.byteOffset, waveform.byteLength).slice();
          const samples = new Float32Array(bytes.buffer);
          const buffer = context.createBuffer(1, samples.length, context.sampleRate);
          buffer.copyToChannel(samples, 0);
          onProgress({ sent, total: frames.length * repeat, cycle: cycle + 1, cycles: repeat, frame: part + 1, frames: frames.length, durationSeconds: buffer.duration });
          await playBuffer(buffer, destination, token, signal);
          if (token !== generation || signal?.aborted) throw abortError();
          sent++;
          onProgress({ sent, total: frames.length * repeat, cycle: cycle + 1, cycles: repeat, frame: part + 1, frames: frames.length, durationSeconds: buffer.duration });
          // Separate sound markers between packets. Missing packets can arrive
          // in a later repeat cycle; there is no return-channel acknowledgement.
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
      }
      if (token !== generation || signal?.aborted) throw abortError();
      complete = true;
    } finally {
      signal?.removeEventListener('abort', cancel);
      if (token === generation) {
        if (complete && keepAlive) { setMode('idle'); onStatus('idle'); }
        else await stop();
      }
    }
  }

  return { prime, previewChannel, transmit, listen, stop };
}
