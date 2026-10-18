import test from 'node:test';
import assert from 'node:assert/strict';
import { mountRadioShowcase } from '../src/radio-shell.js';

function fixture(t, options = {}) {
  const nodes = new Map();
  const showcase = { dataset: {} };
  class Node extends EventTarget {
    constructor(id) { super(); this.id = id; this.disabled = false; this.value = ''; this.textContent = ''; this.attributes = {}; this.dataset = {}; this.selectedIndex = 1;
      this.options = [{ value: 'direct' }, { value: 'radio' }, { value: 'weak' }];
      const classes = new Set(); this.classList = { toggle: (name, active) => active ? classes.add(name) : classes.delete(name), add: name => classes.add(name), contains: name => classes.has(name) };
    }
    querySelector() { return this.label ||= { textContent: '' }; }
    closest() { return showcase; }
    setAttribute(name, value) { this.attributes[name] = value; }
    remove() {}
    click() { if (!this.disabled) this.dispatchEvent(new Event('click')); }
  }
  const node = id => { if (!nodes.has(id)) nodes.set(id, new Node(id)); return nodes.get(id); };
  node('radio-volume').value = '65'; node('station-channel').value = 'radio';
  const globals = {
    document: { getElementById: node, querySelectorAll: () => [] },
    window: new EventTarget(), MutationObserver: class { observe() {} disconnect() {} },
  };
  for (const [key, value] of Object.entries(globals)) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => { if (previous) Object.defineProperty(globalThis, key, previous); else delete globalThis[key]; });
  }
  let controls, toggles = 0, busy = false, volume;
  const shell = mountRadioShowcase({
    getBusy: () => busy, onToggle: () => toggles++, getModem: () => ({ setVolume: value => { volume = value; } }),
    loadModel: async () => ({ mountRadio3D: (_stage, callbacks) => { controls = callbacks; return { setState() {}, dispose() {} }; } }),
    ...options,
  });
  t.after(() => shell.dispose());
  return { shell, node, showcase, get controls() { return controls; }, get toggles() { return toggles; }, get volume() { return volume; },
    setBusy: value => { busy = value; },
    publish: detail => globals.window.dispatchEvent(new CustomEvent('onda:station-state', { detail })),
    audio: detail => globals.window.dispatchEvent(new CustomEvent('onda:audio-activity', { detail })),
  };
}

test('radio power controls continuous station and remains available during preparation, playback and pauses', async t => {
  const f = fixture(t);
  await Promise.resolve(); await Promise.resolve();
  const power = f.node('radio-showcase-preview');
  assert.equal(power.label.textContent, 'Encender radio');
  power.click();
  assert.equal(f.toggles, 1);
  f.setBusy(true);
  for (const phase of ['preparing', 'intro', 'transmitting', 'waiting']) {
    f.publish({ running: true, operation: 'emit', phase, cycle: 2, sent: 1, total: 4,
      observedAt: '2026-10-17T23:40:00Z', sourceLabel: 'Servicio de observación', message: 'Señal en curso.' });
    assert.equal(power.disabled, false, `power must still stop the station in ${phase}`);
    assert.equal(power.label.textContent, 'Apagar radio');
    assert.equal(f.showcase.dataset.active, 'true');
  }
  f.audio({ active: false, mode: 'idle' });
  assert.equal(power.label.textContent, 'Apagar radio', 'temporary silence never changes station ownership');
  assert.match(f.node('radio-stream-source').textContent, /Servicio de observación/);
  f.controls.onAction('power');
  assert.equal(f.toggles, 2);
  f.setBusy(false);
  f.publish({ running: false, operation: null, phase: 'stopped' });
  assert.equal(power.label.textContent, 'Encender radio');
  assert.equal(power.disabled, false);
  f.controls.onAction('preview');
  assert.equal(f.toggles, 3, 'the 3D legacy action also selects continuous playback');
  f.node('radio-volume').value = '24';
  f.node('radio-volume').dispatchEvent(new Event('input'));
  assert.equal(f.volume, 0.24);
});

test('sound preview and another audio owner cannot be replaced by radio power, tuning respects locked controls', async t => {
  const f = fixture(t);
  await Promise.resolve(); await Promise.resolve();
  const power = f.node('radio-showcase-preview');
  f.publish({ running: true, operation: 'preview', phase: 'intro' });
  assert.equal(power.disabled, true);
  f.controls.onAction('power');
  assert.equal(f.toggles, 0);
  f.node('station-channel').disabled = true;
  f.controls.onAction('tune');
  assert.equal(f.node('station-channel').selectedIndex, 1);
  f.setBusy(true);
  f.publish({ running: false, operation: null, phase: 'stopped' });
  assert.equal(power.disabled, true);
  f.setBusy(false);
  f.publish({ running: false, operation: null, phase: 'error', message: 'No hay salida de audio.' });
  assert.equal(power.disabled, false);
  assert.equal(f.node('radio-stream-status').textContent, 'No hay salida de audio.');
  f.shell.dispose();
  f.publish({ running: true, operation: 'emit', phase: 'transmitting' });
  assert.equal(power.label.textContent, 'Encender radio', 'disposed view releases subscriptions');
});
