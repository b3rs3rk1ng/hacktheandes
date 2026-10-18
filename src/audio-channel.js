// A deliberately small, repeatable audio-channel simulation. These presets are
// illustrative listening conditions, not a calibrated AM/FM propagation model.
// One instance must span packets and their gaps so hiss, filters and fading do
// not restart whenever a packet begins. It works without Web Audio or ggwave.
export const CHANNEL_PROFILES = Object.freeze({
  direct: Object.freeze({
    label: 'Directo', highPassHz: 0, lowPassHz: 0, signalGain: 1,
    hissLevel: 0, hissLowPassHz: 0, fadeDepth: 0, fadeSeconds: 1,
  }),
  radio: Object.freeze({
    label: 'Radio simulada', highPassHz: 150, lowPassHz: 7000, signalGain: 0.9,
    hissLevel: 0.012, hissLowPassHz: 9500, fadeDepth: 0.18, fadeSeconds: 6.7,
  }),
  weak: Object.freeze({
    label: 'Señal débil simulada', highPassHz: 250, lowPassHz: 4500, signalGain: 0.75,
    hissLevel: 0.038, hissLowPassHz: 7500, fadeDepth: 0.65, fadeSeconds: 5.3,
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
  const phaseStep = 2 * Math.PI / (configuration.fadeSeconds * sampleRate);
  // Two slow components avoid a single mechanical volume wobble. Seed changes
  // phase as well as noise; both components are continuous across process calls.
  let phase = seed / 0x100000000 * 2 * Math.PI;
  let secondPhase = phase * 0.71;
  let random = seed >>> 0;
  let processedSamples = 0;

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
      random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
      // A uniform source has the flat spectrum needed for audible broadband
      // hiss. hissLevel is its RMS before the receiver's noise low-pass filter.
      const hiss = hissFilter(((random + 0.5) / 0x100000000 * 2 - 1) * Math.sqrt(3) * configuration.hissLevel);
      const fading = 1 - configuration.fadeDepth * (0.5 - 0.35 * Math.cos(phase) - 0.15 * Math.cos(secondPhase));
      const signal = low(high(input[index])) * configuration.signalGain * fading;
      // Smooth saturation bounds all simulated output, including unusually loud
      // inputs, without the discontinuity of clipping individual peaks.
      output[index] = Math.tanh(signal + hiss);
      phase += phaseStep;
      secondPhase += phaseStep * 0.613;
      if (phase >= 2 * Math.PI) phase -= 2 * Math.PI;
      if (secondPhase >= 2 * Math.PI) secondPhase -= 2 * Math.PI;
    }
    processedSamples += input.length;
    return output;
  }

  return Object.freeze({
    profile, sampleRate, seed, process,
    get processedSamples() { return processedSamples; },
  });
}
