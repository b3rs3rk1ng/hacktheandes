const $ = id => document.getElementById(id);

// The object is another view of the existing station. It never owns an audio
// session, so stopping, permission errors and source changes keep one lifecycle.
export function mountRadioShowcase({ getModem = () => null, onToggle, getBusy = () => false,
  getStationState = () => null, loadModel = () => import('./radio-3d.js') } = {}) {
  const stage = $('radio-3d-stage');
  const preview = $('radio-showcase-preview');
  const originalStart = $('station-start');
  const channel = $('station-channel');
  const volume = $('radio-volume');
  const finishes = [...document.querySelectorAll('[data-radio-color]')];
  if (!stage || !preview || !volume) return { setVisible() {}, dispose() {} };

  const state = { active: false, mode: 'idle', volume: Number(volume.value) / 100, bodyColor: '#176b68', visible: true };
  const listeners = new AbortController();
  let model = null;
  let disposed = false;
  let station = getStationState() || { running: false, operation: null, phase: 'stopped' };
  const observationTime = value => new Intl.DateTimeFormat('es-PE', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Lima',
  }).format(new Date(value));

  function readChannel() {
    state.channel = channel?.value || '';
    state.channelPosition = channel && channel.options.length > 1
      ? Math.max(0, channel.selectedIndex) / (channel.options.length - 1) : 0;
  }

  function syncPreview() {
    const stopping = station.running && station.operation === 'emit';
    preview.disabled = !stopping && (station.running || getBusy() || Boolean(originalStart?.disabled));
    preview.querySelector('span').textContent = stopping ? 'Apagar radio' : 'Encender radio';
    preview.setAttribute('aria-pressed', String(Boolean(stopping)));
    preview.classList.toggle('is-playing', Boolean(stopping));
  }

  function sync() {
    const label = station.running ? ({
      preparing: 'Preparando boletín', intro: 'En sintonía', transmitting: 'Transmitiendo boletín', waiting: 'Radio encendida',
    }[station.phase] || 'Radio encendida') : !state.active ? 'Apagada' : ({
      starting: 'Preparando audio', previewing: 'Probando sonido',
      transmitting: 'Transmitiendo datos', listening: 'Escuchando',
      idle: 'Emitiendo señal',
    }[state.mode] || 'Audio activo');
    $('radio-power-state').textContent = label;
    stage.closest('.radio-showcase').dataset.active = String(state.active || station.running);
    const status = $('radio-stream-status');
    if (status) status.textContent = station.phase === 'error' ? station.message : station.running
      ? station.phase === 'transmitting' ? `Boletín ${station.cycle} · ${station.sent} de ${station.total} fragmentos enviados`
        : station.message || 'Radio encendida.'
      : 'Enciende la radio. El boletín se repite hasta que la apagues.';
    const source = $('radio-stream-source');
    if (source) source.textContent = station.observedAt
      ? `${station.context === 'replay' ? 'Histórico de demostración' : 'Último análisis disponible'} · ${observationTime(station.observedAt)}${station.sourceLabel ? ` · ${station.sourceLabel}` : ''}`
      : 'Datos reales. Cada teléfono muestra su zona.';
    volume.value = String(Math.round(state.volume * 100));
    $('radio-volume-value').value = `${volume.value}%`;
    finishes.forEach(button => button.setAttribute('aria-pressed', String(button.dataset.radioColor === state.bodyColor)));
    model?.setState({ ...state });
    syncPreview();
  }

  function changeVolume(value) {
    if (!Number.isFinite(value)) return;
    state.volume = Math.max(0, Math.min(1, value));
    getModem()?.setVolume?.(state.volume);
    sync();
  }

  function requestToggle() {
    syncPreview();
    if (preview.disabled) return;
    if (typeof onToggle === 'function') onToggle();
    else originalStart?.click();
    syncPreview();
  }

  function tuneChannel() {
    if (!channel || channel.disabled || getBusy()) return;
    const options = [...channel.options];
    const available = options.filter(option => !option.disabled && !option.parentElement?.disabled);
    if (!available.length) return;
    const current = available.indexOf(options[channel.selectedIndex]);
    channel.selectedIndex = options.indexOf(available[(current + 1) % available.length]);
    channel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  preview.addEventListener('click', requestToggle, { signal: listeners.signal });
  volume.addEventListener('input', () => changeVolume(Number(volume.value) / 100), { signal: listeners.signal });
  channel?.addEventListener('change', () => { readChannel(); sync(); }, { signal: listeners.signal });
  finishes.forEach(button => button.addEventListener('click', () => {
    state.bodyColor = button.dataset.radioColor;
    sync();
  }, { signal: listeners.signal }));
  $('radio-reset-view')?.addEventListener('click', () => model?.resetView(), { signal: listeners.signal });
  window.addEventListener('onda:audio-activity', event => {
    if (!event.detail || typeof event.detail.active !== 'boolean') return;
    state.active = event.detail.active;
    state.mode = event.detail.mode || 'idle';
    sync();
  }, { signal: listeners.signal });
  window.addEventListener('onda:station-state', event => {
    if (!event.detail || typeof event.detail.running !== 'boolean') return;
    station = event.detail;
    sync();
  }, { signal: listeners.signal });

  const observer = new MutationObserver(syncPreview);
  if (originalStart) observer.observe(originalStart, { attributes: true, attributeFilter: ['disabled'] });
  readChannel();
  sync();

  loadModel().then(({ mountRadio3D }) => {
    if (disposed) return;
    model = mountRadio3D(stage, {
      onAction: action => {
        if (action === 'preview' || action === 'power') requestToggle();
        if (action === 'tune') tuneChannel();
      },
      onVolume: changeVolume,
      getState: () => ({ ...state }),
    });
    $('radio-3d-loading')?.remove();
    model.setState({ ...state });
  }).catch(() => {
    if (disposed) return;
    model?.dispose();
    model = null;
    stage.classList.add('radio-showcase-unavailable');
    const message = document.createElement('p');
    message.className = 'radio-showcase-loading';
    message.setAttribute('role', 'status');
    message.textContent = 'La vista 3D no está disponible en este navegador. Puedes escuchar la radio con los controles de abajo.';
    stage.replaceChildren(message);
    $('radio-3d-hint').hidden = true;
    $('radio-reset-view').hidden = true;
  });

  return {
    setVisible(visible) {
      state.visible = Boolean(visible);
      model?.setState({ ...state });
    },
    getState: () => ({ ...state }),
    dispose() {
      disposed = true;
      listeners.abort();
      observer.disconnect();
      model?.dispose();
      model = null;
    },
  };
}
