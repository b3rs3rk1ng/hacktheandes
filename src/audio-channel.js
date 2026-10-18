// A deliberately small, repeatable audio-channel simulation. These presets are
// illustrative listening conditions, not a calibrated AM/FM propagation model.
// One instance must span packets and their gaps so hiss, filters and fading do
// not restart whenever a packet begins. It works without Web Audio or ggwave.
export const CHANNEL_PROFILES = Object.freeze({
  direct: Object.freeze({
    label: 'Directo', highPassHz: 0, lowPassHz: 0, signalGain: 1,
    hissLevel: 0, hissLowPassHz: 0, fadeDepth: 0, fadeSeconds: 1,
    crackleRate: 0, crackleLevel: 0,
    introduction: Object.freeze({ highPassHz: 0, lowPassHz: 0, hissLevel: 0, crackleRate: 0, crackleLevel: 0, tuningSeconds: 0, tuningLevel: 0 }),
  }),
  radio: Object.freeze({
    label: 'Radio simulada', highPassHz: 150, lowPassHz: 7000, signalGain: 0.9,
    hissLevel: 0.012, hissLowPassHz: 9500, fadeDepth: 0.18, fadeSeconds: 6.7,
    crackleRate: 0.3, crackleLevel: 0.025,
    introduction: Object.freeze({ highPassHz: 220, lowPassHz: 3400, hissLevel: 0.04, crackleRate: 3.5, crackleLevel: 0.13, tuningSeconds: 0.5, tuningLevel: 0.055 }),
  }),
  weak: Object.freeze({
    label: 'Señal débil simulada', highPassHz: 250, lowPassHz: 4500, signalGain: 0.75,
    hissLevel: 0.038, hissLowPassHz: 7500, fadeDepth: 0.65, fadeSeconds: 5.3,
    crackleRate: 0.65, crackleLevel: 0.045,
    introduction: Object.freeze({ highPassHz: 250, lowPassHz: 3100, hissLevel: 0.07, crackleRate: 5, crackleLevel: 0.17, tuningSeconds: 0.5, tuningLevel: 0.065 }),
  }),
});

// Stable second-order Butterworth filters (transposed direct form II). Filter
// coefficients and state remain in double precision; only PCM output is F32.
function filter(kind, frequency, sampleRate) {
  const omega = 2 * Math.PI * Math.min(frequency, sampleRate * 0.45) / sampleRate;
  const cosine = Math.cos(omega), alpha = Math.sin(omega) / Math.SQRT2;
  const a0 = 1 + alpha, a1 = -2 * cosine / a0, a2 = (1 - alpha) / a0;
  const b0 = (1 + (kind === 'high' ? cosine : -cosine)) / (2 * a0);
  const b1 = (kind === 'high' ? -2 : 2) * b0, b2 = b0;
  let first = 0, second = 0;
  return sample => {
    const result = b0 * sample + first;
    first = b1 * sample - a1 * result + second;
    second = b2 * sample - a2 * result;
    return result;
  };
}

export function createAudioChannel({ profile = 'radio', sampleRate, seed = 0x4f4e4441 } = {}) {
  if (typeof profile !== 'string' || !Object.hasOwn(CHANNEL_PROFILES, profile)) {
    throw new TypeError('Perfil de canal de audio no compatible.');
  }
  if (!Number.isInteger(sampleRate) || sampleRate < 16000 || sampleRate > 192000) {
    throw new RangeError('Frecuencia de muestreo: entre 16000 y 192000 Hz.');
  }
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) {
    throw new RangeError('La semilla debe ser un entero de 32 bits sin signo.');
  }
  const configuration = CHANNEL_PROFILES[profile];
  const high = profile === 'direct' ? null : filter('high', configuration.highPassHz, sampleRate);
  const low = profile === 'direct' ? null : filter('low', configuration.lowPassHz, sampleRate);
  const hissFilter = profile === 'direct' ? null : filter('low', configuration.hissLowPassHz, sampleRate);
  const introduction = configuration.introduction;
  const voiceHigh = profile === 'direct' ? null : filter('high', introduction.highPassHz, sampleRate);
  const voiceLow = profile === 'direct' ? null : filter('low', introduction.lowPassHz, sampleRate);
  const crackleFilter = profile === 'direct' ? null : filter('low', 5200, sampleRate);
  const crackleFastDecay = Math.exp(-1 / (0.0004 * sampleRate));
  const crackleSlowDecay = Math.exp(-1 / (0.004 * sampleRate));
  const phaseStep = 2 * Math.PI / (configuration.fadeSeconds * sampleRate);
  // Two slow components avoid a single mechanical volume wobble. Seed changes
  // phase as well as noise; both components are continuous across process calls.
  let phase = seed / 0x100000000 * 2 * Math.PI;
  let secondPhase = phase * 0.71;
  let random = seed >>> 0;
  let processedSamples = 0;
  let introductionLength = 0, introductionRemaining = 0;
  let tuningPhase = 0, crackleFast = 0, crackleSlow = 0;

  function uniform() {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    return (random + 0.5) / 0x100000000;
  }

  // The scene uses the sample clock, so buffering, device rate and packet gaps
  // cannot prolong it. Calling this is explicit: normal data has no tuning sweep.
  // It never restarts the channel's random stream, filter history or fading.
  function beginIntroduction(seconds = 5) {
    if (!Number.isFinite(seconds) || seconds < 1 || seconds > 15) {
      throw new RangeError('La introducción debe durar entre 1 y 15 segundos.');
    }
    introductionLength = profile === 'direct' ? 0 : Math.round(seconds * sampleRate);
    introductionRemaining = introductionLength;
    tuningPhase = 0;
    return introductionLength / sampleRate;
  }

  function process(input, output) {
    if (!(input instanceof Float32Array) || !(output instanceof Float32Array) || input.length !== output.length) {
      throw new TypeError('El canal requiere dos Float32Array del mismo tamaño.');
    }
    if (input.buffer === output.buffer && input.byteOffset !== output.byteOffset &&
        input.byteOffset < output.byteOffset + output.byteLength && output.byteOffset < input.byteOffset + input.byteLength) {
      throw new RangeError('Los búferes pueden ser iguales, pero no solaparse parcialmente.');
    }
    // Reject the whole block before advancing state or modifying output.
    for (let index = 0; index < input.length; index++) {
      if (!Number.isFinite(input[index])) throw new TypeError('La señal PCM debe contener muestras finitas.');
    }
    if (profile === 'direct') {
      output.set(input);
      processedSamples += input.length;
      return output;
    }
    for (let index = 0; index < input.length; index++) {
      const introducing = introductionRemaining > 0;
      const elapsed = introducing ? (introductionLength - introductionRemaining) / sampleRate : 0;
      // Ease strong introductory interference down over the last quarter-second.
      const scene = introducing ? Math.min(1, introductionRemaining / (sampleRate * 0.25)) : 0;
      const opening = introducing && elapsed < introduction.tuningSeconds;
      const hissLevel = configuration.hissLevel + (introduction.hissLevel - configuration.hissLevel) * scene;
      // A uniform source has the flat spectrum needed for audible broadband
      // hiss. hissLevel is its RMS before the receiver's noise low-pass filter.
      const hiss = hissFilter((uniform() * 2 - 1) * Math.sqrt(3) * hissLevel);
      const crackleRate = configuration.crackleRate + (introduction.crackleRate * (opening ? 2 : 1) - configuration.crackleRate) * scene;
      const crackleLevel = configuration.crackleLevel + (introduction.crackleLevel - configuration.crackleLevel) * scene;
      if (uniform() < crackleRate / sampleRate) {
        const impulse = (uniform() * 2 - 1) * crackleLevel;
        crackleFast += impulse;
        crackleSlow += impulse;
      }
      crackleFast *= crackleFastDecay;
      crackleSlow *= crackleSlowDecay;
      // Sparse, non-looping shot noise gives small contact/static crackles.
      const crackle = crackleFilter(crackleSlow - crackleFast);
      let tuning = 0;
      if (opening) {
        const fraction = elapsed / introduction.tuningSeconds;
        const envelope = Math.sin(Math.PI * fraction) ** 2;
        tuningPhase += 2 * Math.PI * (450 + 1150 * fraction + 110 * Math.sin(18 * fraction)) / sampleRate;
        tuning = Math.sin(tuningPhase) * introduction.tuningLevel * envelope;
      }
      const fading = 1 - configuration.fadeDepth * (0.5 - 0.35 * Math.cos(phase) - 0.15 * Math.cos(secondPhase));
      // Always advance both paths: switching to data cannot reveal stale filter
      // history from a previous packet. Only the introduction narrows the voice.
      const broadSignal = low(high(input[index]));
      const voiceSignal = voiceLow(voiceHigh(input[index]));
      const voiceGain = introducing ? Math.min(1, Math.max(0, (elapsed - 0.4) / 0.2)) : 1;
      const signal = (introducing ? voiceSignal * voiceGain : broadSignal) * configuration.signalGain * fading;
      // Smooth saturation bounds all simulated output, including unusually loud
      // inputs, without the discontinuity of clipping individual peaks.
      output[index] = Math.tanh(signal + hiss + crackle + tuning);
      if (introducing) introductionRemaining--;
      phase += phaseStep;
      secondPhase += phaseStep * 0.613;
      if (phase >= 2 * Math.PI) phase -= 2 * Math.PI;
      if (secondPhase >= 2 * Math.PI) secondPhase -= 2 * Math.PI;
    }
    processedSamples += input.length;
    return output;
  }

  return Object.freeze({
    profile, sampleRate, seed, process, beginIntroduction,
    get processedSamples() { return processedSamples; },
    get isIntroducing() { return introductionRemaining > 0; },
    get introductionRemainingSeconds() { return introductionRemaining / sampleRate; },
  });
}
