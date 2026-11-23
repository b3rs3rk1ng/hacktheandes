// Mobile presentation only: vehicle state and rendering keep their existing owners.
const compact = matchMedia('(max-width: 700px), (max-height: 500px) and (max-width: 1000px)');
const definitions = [
  ['status', 'Estado', ['.mission:not(.ground-panel)', '.ground-panel', '.power', '.telemetry']],
  ['map', 'Mapa', ['.map']],
  ['fleet', 'Flota', ['.fleet-panel']],
  ['activity', 'Actividad', ['.activity-panel']],
];
const dock = document.createElement('nav');
dock.className = 'mobile-dock';
dock.setAttribute('aria-label', 'Paneles de inspección');
const details = document.createElement('aside');
details.className = 'mobile-details';
details.id = 'mobileDetails';
const close = document.createElement('button');
close.className = 'mobile-collapse';
close.type = 'button';
close.textContent = '⌄';
close.setAttribute('aria-label', 'Ocultar panel y ver la cámara completa');
details.append(close);
let active = 'status';
const panels = definitions.map(([id, label, selectors]) => {
  const panel = document.createElement('div');
  panel.id = `mobile-${id}`;
  panel.className = 'mobile-panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', label);
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = label;
  button.setAttribute('aria-controls', panel.id);
  button.onclick = () => { active = active === id ? null : id; update(); };
  dock.append(button);
  details.append(panel);
  const nodes = selectors.map(selector => document.querySelector(selector)).filter(Boolean).map(node => {
    const anchor = document.createComment('Presentation position');
    node.before(anchor);
    return { node, anchor };
  });
  return { id, panel, button, nodes };
});
function update() {
  details.hidden = !compact.matches || !active;
  dock.hidden = !compact.matches;
  document.body.classList.toggle('mobile-panel-open', compact.matches && !!active);
  for (const item of panels) {
    item.panel.hidden = item.id !== active;
    item.button.setAttribute('aria-expanded', String(compact.matches && item.id === active));
    item.button.setAttribute('aria-pressed', String(item.id === active));
  }
}
close.onclick = () => {
  const previous = panels.find(item => item.id === active);
  active = null;
  update();
  previous?.button.focus({ preventScroll: true });
};
details.addEventListener('keydown', event => { if (event.key === 'Escape') close.click(); });
function layout() {
  for (const item of panels) for (const { node, anchor } of item.nodes) {
    if (compact.matches) item.panel.append(node);
    else anchor.after(node);
  }
  update();
  // The renderer caches the inset camera rectangle; refresh after breakpoint changes.
  requestAnimationFrame(() => dispatchEvent(new Event('resize')));
}
document.body.append(details, dock);
compact.addEventListener('change', layout);
layout();
