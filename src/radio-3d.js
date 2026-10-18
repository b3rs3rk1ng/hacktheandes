import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// A small, self-contained product scene. All surfaces and markings are generated
// locally; mounting the receiver never starts audio or performs a network request.
export function mountRadio3D(container, { onAction = () => {}, onVolume = () => {}, getState = () => ({}) } = {}) {
  if (!container) throw new Error('No se encontró el espacio de la radio.');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = .93;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = 'radio-three-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:pan-y;cursor:grab;';
  container.appendChild(canvas);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(33, 1, .1, 100);
  camera.position.set(7, 4, 13);
  camera.lookAt(.65, .15, 0);
  const environment = new RoomEnvironment();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environmentMap = pmrem.fromScene(environment, .04);
  scene.environment = environmentMap.texture;
  environment.dispose();
  pmrem.dispose();

  const resources = new Set();
  const keep = value => { resources.add(value); return value; };
  const color = { teal: '#176b68', tealDark: '#0c4c4c', ivory: '#e6dcc7', ivoryLight: '#f0e7d6', coral: '#ef5b42', silver: '#bac8cc', ink: '#243a3c', black: '#111d20' };
  const material = (c, roughness = .4, metalness = 0, extra = {}) => keep(new THREE.MeshStandardMaterial({ color: c, roughness, metalness, ...extra }));
  const shell = material(color.teal, .27, .2);
  const seam = material(color.tealDark, .47, .08);
  const face = material(color.ivory, .42, .08);
  const silver = material(color.silver, .24, .83);
  const silverDark = material('#829da1', .34, .76);
  const black = material(color.black, .65, .1);
  const rubber = material('#172c2c', .78, .02);
  const ivory = material(color.ivoryLight, .31, .1);
  const coral = material(color.coral, .32, .1);
  const mesh = (geometry, mat, parent, xyz = [0, 0, 0]) => {
    keep(geometry);
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(...xyz);
    object.castShadow = true;
    object.receiveShadow = true;
    (parent || scene).add(object);
    return object;
  };
  const rounded = (w, h, d, radius, mat, parent, xyz) => mesh(new RoundedBoxGeometry(w, h, d, 4, radius), mat, parent, xyz);
  const cylinder = (r, depth, mat, parent, xyz, segments = 64) => {
    const object = mesh(new THREE.CylinderGeometry(r, r, depth, segments), mat, parent, xyz);
    object.rotation.x = Math.PI / 2;
    return object;
  };
  const ring = (r, tube, mat, parent, xyz) => mesh(new THREE.TorusGeometry(r, tube, 12, 100), mat, parent, xyz);
  const makeTexture = (width, height, paint) => {
    const el = document.createElement('canvas');
    el.width = width; el.height = height;
    paint(el.getContext('2d'), width, height);
    const texture = keep(new THREE.CanvasTexture(el));
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
    return texture;
  };
  const label = (width, height, x, y, z, paint, parent = radio) => {
    const texture = makeTexture(1024, Math.round(1024 * height / width), paint);
    const mat = keep(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, toneMapped: false }));
    const plane = mesh(new THREE.PlaneGeometry(width, height), mat, parent, [x, y, z]);
    plane.castShadow = false;
    return plane;
  };

  const radio = new THREE.Group();
  scene.add(radio);
  radio.rotation.y = -.12;
  const body = rounded(7.05, 4.15, 1.95, .38, shell, radio, [0, 0, 0]);
  // The thin gasket and the separate metal front reveal the depth of the case.
  rounded(6.84, 3.96, .14, .27, seam, radio, [0, 0, .963]);
  rounded(6.70, 3.80, .13, .23, silverDark, radio, [0, 0, 1.047]);
  rounded(6.56, 3.67, .10, .21, face, radio, [0, 0, 1.13]);
  rounded(6.86, 3.94, .055, .27, seam, radio, [0, 0, -.965]);
  rounded(6.60, 3.67, .055, .24, shell, radio, [0, 0, -1.005]);

  // Four actual slotted screws sit in little countersunk cups.
  const screwAt = (x, y, z, parent = radio, angle = .35) => {
    cylinder(.084, .027, silverDark, parent, [x, y, z], 24);
    const cap = cylinder(.061, .027, silver, parent, [x, y, z + .018], 24);
    const slot = rounded(.072, .013, .007, .004, black, parent, [x, y, z + .035]);
    slot.rotation.z = angle;
    return cap;
  };
  for (const x of [-3.04, 3.04]) for (const y of [-1.56, 1.56]) screwAt(x, y, 1.19, radio, x * y * .23);

  // Speaker: a recessed cone, woven lattice, perforated metal and stepped rims.
  const speaker = new THREE.Group();
  speaker.position.set(-1.63, -.17, 1.19);
  radio.add(speaker);
  cylinder(1.47, .095, silverDark, speaker, [0, 0, .012]);
  cylinder(1.41, .10, seam, speaker, [0, 0, .045]);
  cylinder(1.34, .046, black, speaker, [0, 0, .075]);
  const cone = mesh(new THREE.ConeGeometry(1.19, .14, 80, 1, true), material('#243b3b', .94, 0, { side: THREE.DoubleSide }), speaker, [0, 0, .075]);
  cone.rotation.x = Math.PI / 2;
  const diaphragm = cylinder(.43, .045, material('#142729', .63, .06), speaker, [0, 0, .13]);
  ring(1.23, .028, rubber, speaker, [0, 0, .125]);
  ring(1.405, .035, silver, speaker, [0, 0, .145]);
  ring(1.335, .013, silverDark, speaker, [0, 0, .156]);
  // Instanced strips make genuine holes, rather than painting a speaker onto a plane.
  const weaveMat = material('#73827b', .64, .48);
  const wireGeo = keep(new THREE.CylinderGeometry(.010, .010, 1, 5));
  const wireSpecs = [];
  const radius = 1.30;
  for (let i = -30; i <= 30; i++) {
    const offset = i * .042;
    if (Math.abs(offset) >= radius) continue;
    const length = 2 * Math.sqrt(radius * radius - offset * offset);
    wireSpecs.push({ x: offset, y: 0, z: .17, length, rotate: 0 });
    wireSpecs.push({ x: 0, y: offset, z: .174, length, rotate: Math.PI / 2 });
  }
  const wires = keep(new THREE.InstancedMesh(wireGeo, weaveMat, wireSpecs.length));
  const dummy = new THREE.Object3D();
  wireSpecs.forEach((s, index) => {
    dummy.position.set(s.x, s.y, s.z); dummy.rotation.set(0, 0, s.rotate); dummy.scale.set(1, s.length, 1); dummy.updateMatrix();
    wires.setMatrixAt(index, dummy.matrix);
  });
  wires.instanceMatrix.needsUpdate = true;
  wires.castShadow = false;
  speaker.add(wires);
  // Two concentric rings catch light differently along the machined edge.
  ring(1.45, .018, silver, speaker, [0, 0, .12]);

  label(1.56, .40, -1.63, 1.47, 1.192, (ctx, w, h) => {
    ctx.fillStyle = color.tealDark;
    ctx.font = `900 ${h * .79}px Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ONDA', w / 2, h * .52);
  });
  label(2.20, .17, -1.63, -1.70, 1.192, (ctx, w, h) => {
    ctx.fillStyle = '#5a6960'; ctx.font = `600 ${h * .65}px Arial, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('RADIO · DATOS · COMUNIDAD', w / 2, h / 2);
  });

  // Recessed frequency dial, printed markings, a pointer and an actual glass cover.
  const dialX = 1.56, dialY = .94;
  rounded(2.61, 1.20, .13, .10, silver, radio, [dialX, dialY, 1.212]);
  rounded(2.46, 1.055, .08, .058, black, radio, [dialX, dialY, 1.285]);
  label(2.32, .92, dialX, dialY, 1.333, (ctx, w, h) => {
    ctx.fillStyle = '#142e30'; ctx.fillRect(0, 0, w, h);
    const glow = ctx.createLinearGradient(0, 0, 0, h);
    glow.addColorStop(0, '#355453'); glow.addColorStop(.4, '#1a3738'); glow.addColorStop(1, '#10282b');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, w, h);
    const left = w * .065, right = w * .95, top = h * .36;
    ctx.strokeStyle = '#bec9af'; ctx.lineWidth = 2;
    for (let i = 0; i <= 40; i++) {
      const x = left + (right - left) * i / 40;
      const major = i % 4 === 0;
      ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + h * (major ? .22 : .11)); ctx.stroke();
    }
    ctx.fillStyle = '#d9dfba'; ctx.font = `500 ${h * .105}px Arial, sans-serif`;
    ctx.textAlign = 'center';
    [88, 92, 96, 100, 104, 108].forEach((f, i) => ctx.fillText(f, left + (right - left) * i / 5, h * .27));
    ctx.textAlign = 'left'; ctx.font = `700 ${h * .098}px Arial, sans-serif`; ctx.fillText('FM', left, h * .82);
    ctx.font = `500 ${h * .078}px Arial, sans-serif`; ctx.textAlign = 'right'; ctx.fillStyle = '#93b3a5'; ctx.fillText('MHz', right, h * .82);
    ctx.strokeStyle = '#5e7973'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, h * .65); ctx.lineTo(right, h * .65); ctx.stroke();
  });
  const pointer = rounded(.026, .62, .015, .008, coral, radio, [1.66, dialY + .03, 1.358]);
  let pointerBase = pointer.position.x;
  const glassMat = keep(new THREE.MeshPhysicalMaterial({ color: '#c7ece4', metalness: 0, roughness: .08, transmission: 0, transparent: true, opacity: .10, clearcoat: 1, clearcoatRoughness: .1, depthWrite: false }));
  rounded(2.36, .96, .035, .05, glassMat, radio, [dialX, dialY, 1.39]);
  const glintMat = keep(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: .09, depthWrite: false }));
  const glint = mesh(new THREE.PlaneGeometry(.19, .89), glintMat, radio, [2.38, .94, 1.416]);
  glint.rotation.z = -.42;

  // Power lamp and its tiny chrome socket.
  cylinder(.084, .025, silverDark, radio, [.52, .08, 1.223], 32);
  const lampMat = material('#7b8f6b', .23, .12, { emissive: '#d3ff99', emissiveIntensity: 0 });
  cylinder(.057, .026, lampMat, radio, [.52, .08, 1.244], 32);
  label(1.15, .16, 1.22, .08, 1.196, (ctx, w, h) => {
    ctx.fillStyle = '#52665b'; ctx.font = `600 ${h * .65}px Arial, sans-serif`; ctx.textBaseline = 'middle'; ctx.fillText('ON AIR', 0, h / 2);
  });

  const makeKnob = (x, y, radius, mat, rotation = 0) => {
    cylinder(radius + .08, .025, silverDark, radio, [x, y, 1.22]);
    ring(radius + .075, .012, silver, radio, [x, y, 1.24]);
    const holder = new THREE.Group(); holder.position.set(x, y, 1.25); holder.rotation.z = rotation; radio.add(holder);
    const knob = cylinder(radius, .26, mat, holder, [0, 0, .13]);
    // Individual knurls around the circumference produce the tactile silhouette.
    const ridgeGeo = keep(new THREE.BoxGeometry(.018, .053, .19));
    const ridgeMat = mat === coral ? material('#c94835', .48, .15) : silverDark;
    const ridges = keep(new THREE.InstancedMesh(ridgeGeo, ridgeMat, 48));
    for (let i = 0; i < 48; i++) {
      const a = i / 48 * Math.PI * 2;
      dummy.position.set(Math.cos(a) * radius, Math.sin(a) * radius, .12);
      dummy.rotation.set(0, 0, a - Math.PI / 2); dummy.scale.set(1, 1, 1); dummy.updateMatrix(); ridges.setMatrixAt(i, dummy.matrix);
    }
    ridges.instanceMatrix.needsUpdate = true; holder.add(ridges);
    cylinder(radius - .055, .018, mat, holder, [0, 0, .269]);
    ring(radius - .075, .007, mat === coral ? coral : ivory, holder, [0, 0, .282]);
    const mark = rounded(.028, radius * .36, .012, .009, mat === coral ? ivory : seam, holder, [0, radius * .54, .287]);
    return { holder, knob, mark };
  };
  const volume = makeKnob(.96, -.91, .52, coral);
  const tuner = makeKnob(2.38, -.91, .43, ivory, -.63);
  label(.94, .18, .96, -1.62, 1.196, (ctx, w, h) => {
    ctx.fillStyle = '#475c52'; ctx.font = `700 ${h * .65}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('VOLUMEN', w / 2, h / 2);
  });
  label(1.04, .18, 2.38, -1.62, 1.196, (ctx, w, h) => {
    ctx.fillStyle = '#475c52'; ctx.font = `700 ${h * .65}px Arial, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('SINTONÍA', w / 2, h / 2);
  });
  // A genuinely pressable top power key, separate from the volume control.
  rounded(.93, .075, .56, .075, seam, radio, [2.12, 2.072, .02]);
  const power = rounded(.78, .18, .44, .064, coral, radio, [2.12, 2.16, .02]);
  const powerSymbol = makeTexture(128, 128, (ctx, w, h) => {
    ctx.strokeStyle = '#fff0d9'; ctx.lineWidth = 11; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.arc(w / 2, h / 2 + 2, 32, -Math.PI * .32, Math.PI * 1.32); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(w / 2, 15); ctx.lineTo(w / 2, 54); ctx.stroke();
  });
  const powerInk = keep(new THREE.MeshBasicMaterial({ map: powerSymbol, transparent: true, depthWrite: false }));
  const powerIcon = mesh(new THREE.PlaneGeometry(.19, .19), powerInk, power, [0, .095, 0]);
  powerIcon.rotation.x = -Math.PI / 2;

  // Carry handle: a true extruded open shape, with a soft black hand grip.
  const roundedPath = (path, x, y, width, height, r, reverse = false) => {
    // The outer and inner paths use opposite directions for the open center.
    if (!reverse) {
      path.moveTo(x + r, y); path.lineTo(x + width - r, y); path.quadraticCurveTo(x + width, y, x + width, y + r);
      path.lineTo(x + width, y + height - r); path.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
      path.lineTo(x + r, y + height); path.quadraticCurveTo(x, y + height, x, y + height - r);
      path.lineTo(x, y + r); path.quadraticCurveTo(x, y, x + r, y);
    } else {
      path.moveTo(x + r, y); path.quadraticCurveTo(x, y, x, y + r); path.lineTo(x, y + height - r);
      path.quadraticCurveTo(x, y + height, x + r, y + height); path.lineTo(x + width - r, y + height);
      path.quadraticCurveTo(x + width, y + height, x + width, y + height - r); path.lineTo(x + width, y + r);
      path.quadraticCurveTo(x + width, y, x + width - r, y); path.lineTo(x + r, y);
    }
    path.closePath();
  };
  const handleShape = new THREE.Shape(); roundedPath(handleShape, -2.13, 1.96, 3.84, 1.43, .33);
  const opening = new THREE.Path(); roundedPath(opening, -1.88, 2.05, 3.34, 1.10, .17, true); handleShape.holes.push(opening);
  const handle = mesh(new THREE.ExtrudeGeometry(handleShape, { depth: .22, bevelEnabled: true, bevelSegments: 3, steps: 1, bevelSize: .045, bevelThickness: .045, curveSegments: 12 }), silver, radio, [0, 0, -.24]);
  rounded(2.36, .27, .34, .11, rubber, radio, [-.21, 3.29, -.11]);
  for (let i = -11; i <= 11; i++) rounded(.017, .19, .018, .005, seam, radio, [-.21 + i * .088, 3.29, .07]);
  // Handle mounts and pivot bolts on the rear shoulder.
  for (const x of [-2.03, 1.62]) {
    rounded(.49, .19, .57, .07, seam, radio, [x, 2.04, -.13]);
    cylinder(.11, .08, silver, radio, [x, 2.16, .02], 32);
  }

  // Telescoping antenna, tilted away from the handle, with collar rings and tip.
  const antenna = new THREE.Group(); antenna.position.set(2.93, 1.96, -.48); antenna.rotation.z = -Math.PI * 58 / 180; radio.add(antenna);
  const base = mesh(new THREE.CylinderGeometry(.145, .18, .20, 32), silverDark, antenna, [0, .08, 0]);
  mesh(new THREE.SphereGeometry(.12, 20, 12), silver, antenna, [0, .23, 0]);
  const segments = [ { y: .65, len: .80, r: .047 }, { y: 1.43, len: .84, r: .035 }, { y: 2.21, len: .78, r: .024 } ];
  for (const segment of segments) {
    mesh(new THREE.CylinderGeometry(segment.r, segment.r + .003, segment.len, 16), silver, antenna, [0, segment.y, 0]);
    mesh(new THREE.CylinderGeometry(segment.r + .012, segment.r + .012, .065, 16), silverDark, antenna, [0, segment.y - segment.len / 2 + .04, 0]);
  }
  mesh(new THREE.SphereGeometry(.042, 16, 10), silver, antenna, [0, 2.615, 0]);

  // Right-side vents and carrying strap anchors remain visible as the model turns.
  for (let i = 0; i < 10; i++) {
    const vent = rounded(.026, .75, .065, .012, seam, radio, [3.523, .72 - i * .15, -.24]);
    vent.rotation.x = Math.PI / 2;
  }
  const battery = rounded(4.50, 2.37, .045, .13, seam, radio, [0, -.20, -1.048]);
  rounded(4.34, 2.21, .035, .10, shell, radio, [0, -.20, -1.079]);
  rounded(.66, .15, .07, .03, black, radio, [0, .96, -1.10]);
  for (const x of [-2.36, 2.36]) {
    rounded(.71, .23, 1.16, .09, rubber, radio, [x, -2.11, 0]);
    rounded(.53, .045, .96, .02, seam, radio, [x, -2.24, 0]);
  }
  // Little top ridges and a selector switch add scale to the silhouette.
  for (let i = 0; i < 3; i++) rounded(.29, .055, .12, .025, silverDark, radio, [.33 + i * .41, 2.10, .35]);

  const key = new THREE.DirectionalLight('#fff7e9', 4.1); key.position.set(-3, 9, 8); key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024); key.shadow.camera.left = -7; key.shadow.camera.right = 7; key.shadow.camera.top = 8; key.shadow.camera.bottom = -5;
  key.shadow.normalBias = .03; key.shadow.bias = -.00015; key.shadow.radius = 4;
  scene.add(key);
  const fill = new THREE.DirectionalLight('#d8edff', 2.1); fill.position.set(7, 5, -3); scene.add(fill);
  const bounce = new THREE.DirectionalLight('#d1f2e6', .75); bounce.position.set(-6, 0, -3); scene.add(bounce);
  scene.add(new THREE.AmbientLight('#dfe8ef', .45));
  const floor = mesh(new THREE.PlaneGeometry(70, 70), keep(new THREE.ShadowMaterial({ opacity: .16 })), scene, [0, -2.28, 0]);
  floor.rotation.x = -Math.PI / 2; floor.castShadow = false; floor.receiveShadow = true;
  const contactTexture = makeTexture(256, 256, (ctx, w, h) => {
    const g = ctx.createRadialGradient(w / 2, h / 2, w * .03, w / 2, h / 2, w * .49);
    g.addColorStop(0, 'rgba(34,58,64,.33)'); g.addColorStop(.45, 'rgba(34,58,64,.20)'); g.addColorStop(1, 'rgba(34,58,64,0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  });
  const contact = mesh(new THREE.PlaneGeometry(10, 4.0), keep(new THREE.MeshBasicMaterial({ map: contactTexture, transparent: true, depthWrite: false })), scene, [0, -2.267, 0]);
  contact.rotation.x = -Math.PI / 2; contact.castShadow = false;

  let state = { active: false, volume: .65, channel: 'radio', channelPosition: .5, visible: true, bodyColor: color.teal, ...getState() };
  let disposed = false, contextLost = false, visible = true, raf = null, lastFrame = 0;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const normalizedVolume = value => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : .65));
  const animate = () => state.active && !reduced.matches && visible && state.visible !== false && !document.hidden;
  const schedule = () => { if (!disposed && !contextLost && raf === null && visible && state.visible !== false && !document.hidden) raf = requestAnimationFrame(render); };
  function render(time = 0) {
    raf = null;
    if (disposed || contextLost || !visible || state.visible === false || document.hidden) return;
    if (!animate() || time - lastFrame >= 30) {
      const moving = animate();
      pointer.position.x = pointerBase + (moving ? Math.sin(time * .0018) * .012 : 0);
      diaphragm.position.z = .13 + (moving ? Math.sin(time * .04) * .0025 * normalizedVolume(state.volume) : 0);
      renderer.render(scene, camera); lastFrame = time;
    }
    if (animate()) schedule();
  }
  function setState(partial = {}) {
    state = { ...state, ...partial };
    state.volume = normalizedVolume(state.volume);
    if (typeof state.bodyColor === 'string' && /^#[0-9a-f]{6}$/i.test(state.bodyColor)) shell.color.set(state.bodyColor);
    if (state.visible === false && raf !== null) { cancelAnimationFrame(raf); raf = null; }
    volume.holder.rotation.z = (1 - state.volume) * 4.2 - 2.1;
    const channelPosition = THREE.MathUtils.clamp(Number.isFinite(Number(state.channelPosition)) ? Number(state.channelPosition) : .5, 0, 1);
    pointerBase = .60 + channelPosition * 1.92;
    tuner.holder.rotation.z = (channelPosition - .5) * -4.2;
    lampMat.color.set(state.active ? '#d6eb8c' : '#647c62');
    lampMat.emissiveIntensity = state.active ? .9 : 0;
    power.position.y = state.active ? 2.13 : 2.16;
    schedule();
  }
  const resize = () => {
    if (disposed) return;
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight || 430);
    renderer.setSize(width, height, false); camera.aspect = width / height;
    // The angled antenna shares the horizontal frame with the body. Narrow
    // stages pull back continuously, rather than clipping its tip on phones.
    const fit = Math.max(1, 1.35 / camera.aspect);
    camera.position.set(.65 + (7 - .65) * fit, .15 + (4 - .15) * fit, 13 * fit);
    camera.lookAt(.65, .15, 0); camera.updateProjectionMatrix(); schedule();
  };
  const resizeObserver = new ResizeObserver(resize); resizeObserver.observe(container);
  const intersection = typeof IntersectionObserver === 'function' ? new IntersectionObserver(entries => {
    visible = entries[0]?.isIntersecting !== false;
    if (!visible && raf !== null) { cancelAnimationFrame(raf); raf = null; }
    if (visible) schedule();
  }, { threshold: 0 }) : null;
  intersection?.observe(container);
  const visibility = () => { if (document.hidden && raf !== null) { cancelAnimationFrame(raf); raf = null; } else schedule(); };
  document.addEventListener('visibilitychange', visibility);
  const motionChange = () => schedule(); reduced.addEventListener?.('change', motionChange);

  const raycaster = new THREE.Raycaster();
  const rayPoint = new THREE.Vector2();
  let drag = null;
  const hitAt = event => {
    const rect = canvas.getBoundingClientRect();
    rayPoint.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(rayPoint, camera);
    // Test the whole case, so a hidden knob cannot be clicked through its back.
    const intersections = raycaster.intersectObject(radio, true);
    const first = intersections.find(hit => hit.object.visible && hit.object.material?.opacity !== 0 && hit.object !== glint && hit.object.material !== glassMat && ![powerIcon].includes(hit.object));
    if (!first) return null;
    let object = first.object;
    while (object && object !== radio) {
      if (object === volume.holder) return 'volume';
      if (object === tuner.holder) return 'tuner';
      if (object === power) return 'power';
      object = object.parent;
    }
    return 'body';
  };
  const pointerDown = event => {
    if (event.button !== 0 || disposed) return;
    const hit = hitAt(event);
    if (!hit) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, yaw: radio.rotation.y, pitch: radio.rotation.x, volume: state.volume, hit, moved: false };
    canvas.setPointerCapture(event.pointerId); canvas.style.cursor = hit === 'volume' ? 'ns-resize' : 'grabbing';
  };
  const pointerMove = event => {
    if (!drag || drag.id !== event.pointerId) {
      const hit = hitAt(event); canvas.style.cursor = hit === 'power' ? 'pointer' : hit === 'volume' ? 'ns-resize' : 'grab'; return;
    }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    if (drag.hit === 'volume') {
      const value = normalizedVolume(drag.volume + (dx - dy) / 160);
      setState({ volume: value }); onVolume(value);
    } else if (drag.hit === 'tuner') {
      // A gesture selects a real channel once on release. Its resulting state,
      // rather than an imaginary frequency, positions the pointer and knob.
    } else {
      radio.rotation.y = THREE.MathUtils.clamp(drag.yaw + dx * .008, -1.25, 1.15);
      radio.rotation.x = THREE.MathUtils.clamp(drag.pitch + dy * .004, -.12, .20);
      schedule();
    }
    drag.lastX = event.clientX; drag.lastY = event.clientY;
  };
  const pointerUp = event => {
    if (!drag || drag.id !== event.pointerId) return;
    const completed = drag; drag = null; canvas.style.cursor = 'grab';
    try { canvas.releasePointerCapture(event.pointerId); } catch {}
    if (!completed.moved && completed.hit === 'power') onAction('preview');
    if (completed.hit === 'tuner') onAction('tune');
  };
  const pointerCancel = () => { drag = null; canvas.style.cursor = 'grab'; };
  const wheel = event => {
    if (hitAt(event) !== 'volume') return;
    event.preventDefault(); const value = normalizedVolume(state.volume - event.deltaY * .001);
    setState({ volume: value }); onVolume(value);
  };
  const handleContextLost = event => { event.preventDefault(); contextLost = true; if (raf !== null) cancelAnimationFrame(raf); raf = null; };
  const contextRestored = () => { contextLost = false; schedule(); };
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerCancel);
  canvas.addEventListener('wheel', wheel, { passive: false });
  canvas.addEventListener('webglcontextlost', handleContextLost);
  canvas.addEventListener('webglcontextrestored', contextRestored);
  setState(state); resize();

  return {
    setState,
    resetView() { radio.rotation.set(0, -.12, 0); schedule(); },
    dispose() {
      if (disposed) return; disposed = true;
      if (raf !== null) cancelAnimationFrame(raf);
      resizeObserver.disconnect(); intersection?.disconnect();
      document.removeEventListener('visibilitychange', visibility);
      reduced.removeEventListener?.('change', motionChange);
      canvas.removeEventListener('pointerdown', pointerDown); canvas.removeEventListener('pointermove', pointerMove);
      canvas.removeEventListener('pointerup', pointerUp); canvas.removeEventListener('pointercancel', pointerCancel);
      canvas.removeEventListener('wheel', wheel); canvas.removeEventListener('webglcontextlost', handleContextLost); canvas.removeEventListener('webglcontextrestored', contextRestored);
      for (const resource of resources) resource.dispose();
      key.shadow.dispose(); environmentMap.dispose(); renderer.dispose(); renderer.forceContextLoss(); canvas.remove();
    },
  };
}
