// RijExamen Gent — rijsimulator in de browser.
// Kaartdata © OpenStreetMap-bijdragers (ODbL), luchtfoto's © Digitaal Vlaanderen (open data).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const $ = (id) => document.getElementById(id);
const KMH = 3.6;

// =====================================================================
// Koppeling gsm ↔ scherm via MQTT (werkt ook als de gsm op 4G zit)
// =====================================================================
const BROKERS = ['wss://broker.hivemq.com:8884/mqtt', 'wss://test.mosquitto.org:8081/mqtt', 'wss://broker.emqx.io:8084/mqtt'];
function mqttLink(code, role) {
  const other = role === 'auto' ? 'stuur' : 'auto';
  const base = 'rijexamen-gent/v1/' + code + '/';
  return new Promise(async (resolve, reject) => {
    if (!window.mqtt) return reject(new Error('geen verbindingsbibliotheek'));
    for (const url of BROKERS) {
      const ok = await new Promise((done) => {
        const client = mqtt.connect(url, { connectTimeout: 6000, reconnectPeriod: 2000, clientId: 'rg_' + role + '_' + Math.random().toString(36).slice(2, 10), clean: true });
        let settled = false;
        const fail = () => { if (!settled) { settled = true; client.end(true); done(false); } };
        const timer = setTimeout(fail, 7000);
        client.on('error', fail);
        client.on('connect', () => {
          if (settled) return;
          client.subscribe(base + other, { qos: 0 }, (err) => {
            if (err) return fail();
            settled = true; clearTimeout(timer);
            const handlers = [];
            client.on('message', (topic, payload) => { try { const d = JSON.parse(payload.toString()); handlers.forEach((h) => h(d)); } catch (e) {} });
            resolve({ send: (o) => client.publish(base + role, JSON.stringify(o), { qos: 0 }), on: (h) => handlers.push(h), client });
            done(true);
          });
        });
      });
      if (ok) return;
    }
    reject(new Error('geen server bereikbaar'));
  });
}

// =====================================================================
// Gsm als stuur
// =====================================================================
const motion = { ok: false, angle: 0 };
function listenMotion() {
  addEventListener('devicemotion', (e) => {
    const g = e.accelerationIncludingGravity; if (!g || g.x == null || (g.x === 0 && g.y === 0)) return;
    motion.angle = Math.atan2(g.x, g.y) * 180 / Math.PI; motion.ok = true;
  });
}
function startPad() { $('start').hidden = true; $('padjoin').hidden = false; $('codein').focus(); }
$('go-pad').onclick = startPad;
$('btn-join').onclick = () => {
  const code = $('codein').value.replace(/\D/g, '');
  if (code.length !== 4) { $('joinmsg').textContent = 'De code heeft 4 cijfers.'; return; }
  // de toestemming voor de bewegingssensor moet meteen bij de tik gevraagd worden (iPhone)
  const perm = (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') ? DeviceMotionEvent.requestPermission().catch(() => 'denied') : Promise.resolve('granted');
  try { document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {}); } catch (e) {}
  perm.then(async () => {
    listenMotion();
    $('joinmsg').textContent = 'Koppelen…';
    try {
      const link = await mqttLink(code, 'stuur');
      $('padjoin').hidden = true; $('pad').hidden = false;
      navigator.wakeLock?.request('screen').catch(() => {});
      runPad(link);
    } catch (e) { $('joinmsg').textContent = 'Koppelen lukte niet: ' + e.message + '. Controleer je internetverbinding en probeer opnieuw.'; }
  });
};

function runPad(link) {
  const st = { s: 0, g: 0, b: 0, l: 0, iL: 0, iR: 0, gr: 0, hn: 0 };
  const wheel = $('wheel');
  let angle = 0, grab = null, held = false, useTilt = null, zero = null, lastCar = 0;
  const wrap = (a) => ((a + 540) % 360) - 180;
  const ang = (t) => { const r = wheel.getBoundingClientRect(); return Math.atan2(t.clientY - (r.top + r.height / 2), t.clientX - (r.left + r.width / 2)) * 180 / Math.PI; };
  const wz = $('wheelzone');
  wz.addEventListener('touchstart', (e) => { e.preventDefault(); if (useTilt) return; const t = e.changedTouches[0]; grab = { id: t.identifier, a: ang(t), base: angle }; held = true; }, { passive: false });
  wz.addEventListener('touchmove', (e) => {
    e.preventDefault(); if (!grab) return;
    for (const t of e.changedTouches) if (t.identifier === grab.id) {
      const d = wrap(ang(t) - grab.a); angle = Math.max(-200, Math.min(200, grab.base + d));
      if (Math.abs(d) > 120) { grab.a = ang(t); grab.base = angle; }
    }
  }, { passive: false });
  const rel = (e) => { for (const t of e.changedTouches) if (grab && t.identifier === grab.id) { grab = null; held = false; } };
  wz.addEventListener('touchend', rel); wz.addEventListener('touchcancel', rel);
  const pedal = (el, key) => {
    const fill = el.querySelector('.fill');
    const upd = (e) => {
      e.preventDefault(); const r = el.getBoundingClientRect(); let v = 0;
      for (const t of e.targetTouches) v = Math.max(v, Math.min(1, Math.max(0.35, 1.25 - (t.clientY - r.top) / r.height)));
      st[key] = v; fill.style.height = v * 100 + '%';
      if (e.type === 'touchstart') navigator.vibrate?.(8);
    };
    ['touchstart', 'touchmove', 'touchend', 'touchcancel'].forEach((ev) => el.addEventListener(ev, upd, { passive: false }));
  };
  pedal($('p-gas'), 'g'); pedal($('p-brake'), 'b');
  const tap = (id, fn) => $(id).addEventListener('touchstart', (e) => { e.preventDefault(); navigator.vibrate?.(10); fn(); }, { passive: false });
  tap('k-indl', () => st.iL++); tap('k-indr', () => st.iR++); tap('k-gear', () => st.gr++);
  tap('k-tilt', () => { if (motion.ok) { useTilt = !useTilt; zero = motion.angle; angle = 0; } });
  tap('k-cal', () => { zero = motion.angle; angle = 0; });
  const hold = (id, key, v) => { const b = $(id);
    b.addEventListener('touchstart', (e) => { e.preventDefault(); st[key] = v; b.classList.add('on'); }, { passive: false });
    ['touchend', 'touchcancel'].forEach((ev) => b.addEventListener(ev, () => { st[key] = 0; b.classList.remove('on'); })); };
  hold('k-lookl', 'l', -1); hold('k-lookr', 'l', 1); hold('k-horn', 'hn', 1);
  link.on((h) => {
    lastCar = Date.now();
    $('padspeed').textContent = (h.v || 0) + ' km/u · ' + (h.gear || 'D');
    $('k-indl').classList.toggle('on', !!h.indL); $('k-indr').classList.toggle('on', !!h.indR);
    $('padinfo').textContent = (useTilt ? 'Draai je gsm als een stuur' : 'Draai het stuur met je duim') + ' · ' + (h.f || 0) + ' fouten';
  });
  setInterval(() => {
    if (motion.ok && useTilt === null) { useTilt = true; zero = motion.angle; }
    $('k-tilt').hidden = !motion.ok; $('k-tilt').textContent = useTilt ? 'Duim' : 'Kantelen'; $('k-cal').hidden = !useTilt;
    if (useTilt) { const d = -wrap(motion.angle - zero) * 2; angle += (Math.max(-200, Math.min(200, d)) - angle) * 0.5; }
    else if (!held) angle *= 0.86;
    wheel.style.transform = `rotate(${angle}deg)`;
    st.s = +(Math.max(-1, Math.min(1, angle / 180))).toFixed(3);
    if (Date.now() - lastCar > 3000) $('padinfo').textContent = 'Wachten op het scherm… (staat de simulator open op je computer?)';
    link.send(st);
  }, 50);
}

// =====================================================================
// Wereld
// =====================================================================
let QUALITY = 'licht';
try { QUALITY = localStorage.getItem('rg-kwaliteit') || 'licht'; } catch (e) {}
const LIGHT = QUALITY !== 'mooi';
const VIEW = LIGHT ? 380 : 900;                       // zichtafstand in meter
const REGION = { x0: -180, x1: 330, z0: -920, z1: 200 }; // Overpoort → Sint-Pietersplein → Sint-Pietersnieuwstraat → Vooruit
const inRegion = (x, z, m = 0) => x >= REGION.x0 - m && x <= REGION.x1 + m && z >= REGION.z0 - m && z <= REGION.z1 + m;
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: !LIGHT, powerPreference: 'high-performance' });
renderer.setPixelRatio(LIGHT ? Math.min(devicePixelRatio, 1) : Math.min(devicePixelRatio, 1.5));
renderer.autoClear = false;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
const MAXANISO = renderer.capabilities.getMaxAnisotropy();
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xd9a184, VIEW * 0.3, VIEW);
scene.add(new THREE.HemisphereLight(0xffe2c8, 0x55506a, 1.05));
const sun = new THREE.DirectionalLight(0xffc28a, 1.5); sun.position.set(-300, 160, 120); scene.add(sun);
const sky = new THREE.Mesh(new THREE.SphereGeometry(VIEW + 500, 32, 16), new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `varying vec3 vP; void main(){ float h = vP.y; vec3 hor = vec3(1.0, 0.70, 0.48); vec3 mid = vec3(0.86, 0.62, 0.60); vec3 top = vec3(0.36, 0.40, 0.62);
    vec3 c = h < 0.0 ? hor : (h < 0.18 ? mix(hor, mid, h / 0.18) : mix(mid, top, min(1.0, (h - 0.18) / 0.55)));
    c += vec3(1.0, 0.8, 0.5) * pow(max(dot(normalize(vP), normalize(vec3(-0.85, 0.2, 0.35))), 0.0), 50.0) * 0.8;
    gl_FragColor = vec4(c, 1.0); }`
}));
sky.renderOrder = -1; scene.add(sky);

// ---- textuurtjes, getekend op canvas ----
function tex(w, h, draw, rx = 1, ry = 1) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = MAXANISO; return t;
}
let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
function grain(c, w, h, base, amount, size = 2) { c.fillStyle = base; c.fillRect(0, 0, w, h); for (let i = 0; i < w * h / 12; i++) { const v = Math.random(); c.fillStyle = v > 0.5 ? `rgba(255,255,255,${(v - 0.5) * amount})` : `rgba(0,0,0,${(0.5 - v) * amount})`; c.fillRect(Math.random() * w, Math.random() * h, size, size); } }
function bricks(c, w, h, base, mortar) {
  grain(c, w, h, mortar, 0.15);
  const bw = 22, bh = 7;
  for (let y = 0; y < h; y += bh) for (let x = -((y / bh) % 2) * bw / 2; x < w; x += bw) {
    const k = 0.85 + Math.random() * 0.3; const [r, g, b] = base;
    c.fillStyle = `rgb(${r * k | 0},${g * k | 0},${b * k | 0})`; c.fillRect(x + 1, y + 1, bw - 2, bh - 2);
  }
}
// raam met kozijn, glas met reflectie, soms verlicht
function windowAt(c, x, y, w, h, frame, lit) {
  c.fillStyle = frame; c.fillRect(x - 4, y - 4, w + 8, h + 10);
  const g = c.createLinearGradient(x, y, x + w, y + h);
  if (lit) { g.addColorStop(0, '#ffd9a0'); g.addColorStop(1, '#e89a50'); } else { g.addColorStop(0, '#5b6f86'); g.addColorStop(0.5, '#2a3340'); g.addColorStop(1, '#3c4a5c'); }
  c.fillStyle = g; c.fillRect(x, y, w, h);
  c.fillStyle = frame; c.fillRect(x + w / 2 - 2, y, 4, h); c.fillRect(x, y + h * 0.32, w, 3);
  c.fillStyle = 'rgba(255,255,255,.18)'; c.fillRect(x + 3, y + 3, w * 0.18, h - 6);
  c.fillStyle = '#c9c1b4'; c.fillRect(x - 7, y + h + 4, w + 14, 6);             // vensterbank
}
// bovenverdiepingen: 1 tegel = 6 m breed, 2 verdiepingen van 3,2 m
function upper(kind) {
  return tex(256, 274, (c, w, h) => {
    if (kind === 'redbrick') bricks(c, w, h, [150, 62, 44], '#b9a89a');
    else if (kind === 'brownbrick') bricks(c, w, h, [112, 66, 48], '#a89a8a');
    else if (kind === 'yellowbrick') bricks(c, w, h, [196, 160, 104], '#d8cbb4');
    else if (kind === 'plaster') grain(c, w, h, '#e9e3d8', 0.08);
    else if (kind === 'cream') grain(c, w, h, '#ddd0b4', 0.08);
    else if (kind === 'stone') { grain(c, w, h, '#b7ae9f', 0.18); c.strokeStyle = 'rgba(70,60,50,.35)'; for (let y = 0; y < h; y += 34) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } }
    else if (kind === 'modern') { grain(c, w, h, '#8f969c', 0.1); }
    const frame = kind === 'modern' ? '#2b2f33' : (kind === 'plaster' || kind === 'cream' ? '#f4f1ea' : '#ece6dc');
    for (let f = 0; f < 2; f++) {
      const y0 = f * h / 2;
      if (kind === 'modern') { for (let b = 0; b < 3; b++) windowAt(c, b * w / 3 + 8, y0 + 18, w / 3 - 16, h / 2 - 40, frame, Math.random() < 0.25); }
      else if (kind === 'stone') { for (let b = 0; b < 2; b++) windowAt(c, b * w / 2 + 40, y0 + 14, w / 2 - 80, h / 2 - 30, '#5a5248', false); }
      else for (let b = 0; b < 2; b++) windowAt(c, b * w / 2 + 30, y0 + 22, w / 2 - 60, h / 2 - 50, frame, Math.random() < 0.3);
      c.fillStyle = 'rgba(40,30,25,.25)'; c.fillRect(0, y0 + h / 2 - 4, w, 4);   // lijst tussen verdiepingen
    }
  });
}
// gelijkvloers: 1 tegel = 6 m breed, 3,6 m hoog
function ground(kind) {
  return tex(256, 154, (c, w, h) => {
    if (kind === 'house') {
      bricks(c, w, h, [140, 70, 50], '#b5a596');
      c.fillStyle = '#3a2418'; c.fillRect(24, 34, 56, h - 34); c.fillStyle = '#5a3a28'; c.fillRect(30, 40, 44, h - 46); c.fillStyle = '#c9a65a'; c.fillRect(66, 92, 4, 6);
      windowAt(c, 120, 36, 100, 80, '#ece6dc', Math.random() < 0.3);
    } else {
      grain(c, w, h, kind === 'bar' ? '#2a1d17' : '#30363c', 0.1);
      const glow = kind === 'bar' ? ['#ffb35c', '#c4542e'] : ['#e8f0f5', '#9fb3c2'];
      const g = c.createLinearGradient(0, 40, 0, h); g.addColorStop(0, glow[0]); g.addColorStop(1, glow[1]);
      c.fillStyle = g; c.fillRect(14, 44, w - 90, h - 54); c.fillRect(w - 64, 44, 50, h - 44);
      c.fillStyle = 'rgba(0,0,0,.35)'; for (let x = 14; x < w - 90; x += 46) c.fillRect(x, 44, 3, h - 54);
      c.fillStyle = kind === 'bar' ? '#7a1f1f' : '#1f4f7a'; c.fillRect(0, 6, w, 30);
      c.fillStyle = '#f5ead0'; c.font = 'bold 18px sans-serif'; c.fillText(kind === 'bar' ? 'CAFÉ' : 'WINKEL', 20, 28);
      if (kind === 'bar') { c.fillStyle = 'rgba(255,190,90,.35)'; c.fillRect(0, 36, w, 8); }
    }
  });
}
const UP = {}; for (const k of ['redbrick', 'brownbrick', 'yellowbrick', 'plaster', 'cream', 'stone', 'modern']) UP[k] = upper(k);
const GF = { house: ground('house'), bar: ground('bar'), shop: ground('shop') };
const grassTex = tex(256, 256, (c, w, h) => grain(c, w, h, '#53633c', 0.3, 3), 500, 500);
const asphaltTex = tex(256, 256, (c, w, h) => grain(c, w, h, '#4f5156', 0.2));

const groundPlane = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshLambertMaterial({ map: grassTex }));
groundPlane.rotation.x = -Math.PI / 2; groundPlane.position.y = -0.08; scene.add(groundPlane);

// ---- ruimtelijke rasters ----
const CELL = 20;
const roadGrid = new Map(), juncGrid = new Map(), bldGrid = new Map();
const segments = [], buildings = [];
const gkey = (i, j) => i + ',' + j;
function gridAdd(map, item, minx, minz, maxx, maxz) {
  for (let i = Math.floor(minx / CELL); i <= Math.floor(maxx / CELL); i++)
    for (let j = Math.floor(minz / CELL); j <= Math.floor(maxz / CELL); j++) { const k = gkey(i, j); if (!map.has(k)) map.set(k, []); map.get(k).push(item); }
}
function nearestSegment(x, z, ring = 1) {
  const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL); let best = null, bd = Infinity;
  for (let i = ci - ring; i <= ci + ring; i++) for (let j = cj - ring; j <= cj + ring; j++) {
    const list = roadGrid.get(gkey(i, j)); if (!list) continue;
    for (const s of list) {
      const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1;
      let t = ((x - s.ax) * dx + (z - s.az) * dz) / L2; t = Math.max(0, Math.min(1, t));
      const px = s.ax + t * dx, pz = s.az + t * dz, d = Math.hypot(x - px, z - pz);
      if (d < bd) { bd = d; best = { s, d, px, pz }; }
    }
  }
  return best;
}
function nearJunction(x, z, r) {
  const ci = Math.floor(x / CELL), cj = Math.floor(z / CELL);
  for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
    const list = juncGrid.get(gkey(i, j)); if (list) for (const p of list) if (Math.hypot(p.x - x, p.z - z) < r) return true;
  }
  return false;
}
function pointInPoly(x, z, p) {
  let inside = false;
  for (let i = 0, j = p.length - 2; i < p.length; j = i, i += 2) {
    const xi = p[i], zi = p[i + 1], xj = p[j], zj = p[j + 1];
    if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
function insideBuilding(x, z) {
  const list = bldGrid.get(gkey(Math.floor(x / CELL), Math.floor(z / CELL)));
  if (list) for (const b of list) if (x >= b.minx && x <= b.maxx && z >= b.minz && z <= b.maxz && pointInPoly(x, z, b.p)) return b;
  return null;
}
function quad(ax, az, bx, bz, hw, y) {
  const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz) || 1, nx = -dz / L * hw, nz = dx / L * hw;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz, ax + nx, y, az + nz, bx - nx, y, bz - nz, ax - nx, y, az - nz], 3));
  g.computeVertexNormals(); return g;
}

// ---- kaart opbouwen uit data/gent.json ----
const WIDTH = { motorway: 10, trunk: 10, primary: 9, secondary: 8, tertiary: 7, unclassified: 6, residential: 6, living_street: 5.5, service: 4 };
let DATA = null, orthoCovered = () => false;
async function loadWorld() {
  const r = await fetch('data/gent.json', { cache: 'no-cache' });
  if (!r.ok) throw new Error('kaartdata nog niet beschikbaar');
  DATA = await r.json();
  // alleen het gebied rond de route houden (sneller op gewone computers)
  const keepPts = (arr) => { const o = []; for (let i = 0; i < arr.length; i += 2) if (inRegion(arr[i], arr[i + 1])) o.push(arr[i], arr[i + 1]); return o; };
  DATA.buildings = DATA.buildings.filter((b) => inRegion(b[5][0], b[5][1]));
  DATA.roads = DATA.roads.filter((rd) => { const c = rd[7]; for (let i = 0; i < c.length; i += 2) if (inRegion(c[i], c[i + 1], 40)) return true; return false; });
  DATA.trees = keepPts(DATA.trees); DATA.lamps = keepPts(DATA.lamps); DATA.crossings = keepPts(DATA.crossings); DATA.signals = keepPts(DATA.signals);
  if (DATA.ortho) DATA.ortho.tiles = DATA.ortho.tiles.filter(([tx, tz]) => tx + 128 > REGION.x0 - 60 && tx < REGION.x1 + 60 && tz + 128 > REGION.z0 - 60 && tz < REGION.z1 + 60);

  // luchtfoto's als wegdek
  const T = DATA.ortho?.tile || 128, have = new Set();
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  const orthoGeo = new THREE.PlaneGeometry(T, T); orthoGeo.rotateX(-Math.PI / 2);
  for (const [tx, tz, file] of DATA.ortho?.tiles || []) {
    have.add(tx + ',' + tz);
    let t;
    if (LIGHT) {
      // in lichte modus verkleind tot 512 px: vier keer minder grafisch geheugen
      const cv = document.createElement('canvas'); cv.width = cv.height = 512; t = new THREE.CanvasTexture(cv);
      const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { cv.getContext('2d').drawImage(img, 0, 0, 512, 512); t.needsUpdate = true; };
      img.src = 'data/ortho/' + file; t.anisotropy = Math.min(4, MAXANISO);
    } else { t = loader.load('data/ortho/' + file); t.anisotropy = MAXANISO; }
    t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(orthoGeo, new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4 }));
    m.position.set(tx + T / 2, 0, tz + T / 2); scene.add(m);
  }
  orthoCovered = (x, z) => have.has(Math.floor(x / T) * T + ',' + Math.floor(z / T) * T);

  // straten (logica) en wegdek buiten de luchtfoto
  const asphalt = [], use = new Map();
  DATA.roads.forEach(([type, name, max, oneway, lanes, width, priv, c], wi) => {
    let pts = []; for (let i = 0; i < c.length; i += 2) pts.push({ x: c[i], z: c[i + 1] });
    if (oneway === -1) pts = pts.reverse();
    const ln = parseInt(lanes, 10);
    const w = width > 2 ? width : ln ? Math.max(4.5, ln * 3.1) : (WIDTH[type] || 6), half = w / 2;
    const limit = max || (type === 'living_street' ? 20 : type === 'primary' || type === 'secondary' ? 50 : 30);
    for (const p of pts) { const k = p.x + ',' + p.z; if (!use.has(k)) use.set(k, new Set()); use.get(k).add(wi); }
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], len = Math.hypot(b.x - a.x, b.z - a.z); if (len < 0.3) continue;
      const s = { ax: a.x, az: a.z, bx: b.x, bz: b.z, half, oneway: !!oneway, limit, name, type, len, priv: !!priv };
      segments.push(s);
      gridAdd(roadGrid, s, Math.min(a.x, b.x) - half, Math.min(a.z, b.z) - half, Math.max(a.x, b.x) + half, Math.max(a.z, b.z) + half);
      if (!orthoCovered((a.x + b.x) / 2, (a.z + b.z) / 2)) asphalt.push(quad(a.x, a.z, b.x, b.z, half, 0.02));
    }
  });
  for (const [k, ws] of use) if (ws.size >= 2) { const [x, z] = k.split(',').map(Number); gridAdd(juncGrid, { x, z }, x, z, x, z); }
  if (asphalt.length) scene.add(new THREE.Mesh(mergeGeometries(asphalt), new THREE.MeshLambertMaterial({ color: 0x55575b, side: THREE.DoubleSide })));

  buildCity();
  buildStreetFurniture();
}

// ---- gebouwen met gevels ----
const MATS = {};
function buildCity() {
  const bufs = {};
  let chunk = '';
  const buf = (key) => { key = chunk + '|' + key; return bufs[key] || (bufs[key] = { p: [], n: [], uv: [] }); };
  const roofs = { p: [], n: [], c: [] };
  const v = new THREE.Vector3(), col = new THREE.Color();
  const pushQuad = (b, a1, a2, y0, y1, nx, nz, u0, u1, v0, v1) => {
    const P = [[a1[0], y0, a1[1]], [a2[0], y0, a2[1]], [a2[0], y1, a2[1]], [a1[0], y1, a1[1]]];
    const U = [[u0, v0], [u1, v0], [u1, v1], [u0, v1]];
    for (const i of [0, 1, 2, 0, 2, 3]) { b.p.push(...P[i]); b.n.push(nx, 0, nz); b.uv.push(...U[i]); }
  };
  const busyStreets = /Overpoortstraat|Sint-Pietersnieuwstraat|Sint-Pietersplein|Kortrijksepoortstraat|Kortrijksesteenweg/;
  for (const [h0, minh, levels, kind, info, p] of DATA.buildings) {
    if (p.length < 6) continue;
    let area = 0, cx = 0, cz = 0, minx = Infinity, minz = Infinity, maxx = -Infinity, maxz = -Infinity;
    const n = p.length / 2;
    for (let i = 0; i < n; i++) {
      const x = p[i * 2], z = p[i * 2 + 1], x2 = p[((i + 1) % n) * 2], z2 = p[((i + 1) % n) * 2 + 1];
      area += x * z2 - x2 * z; cx += x; cz += z;
      minx = Math.min(minx, x); maxx = Math.max(maxx, x); minz = Math.min(minz, z); maxz = Math.max(maxz, z);
    }
    area /= 2; cx /= n; cz /= n;
    const A = Math.abs(area);
    if (A < 6) continue;
    chunk = Math.floor(cx / 160) + ',' + Math.floor(cz / 160);
    const name = (info.name || '').toLowerCase();
    const isChurch = kind === 'church' || kind === 'chapel' || /kerk|abdij/.test(name);
    const big = A > 900 || /university|school|college|commercial|office|hospital|civic|public/.test(kind);
    let H = h0 || (isChurch ? 18 : big ? 16 : kind === 'garage' || kind === 'shed' || kind === 'roof' ? 3 : 9 + rnd() * 4.5);
    const base = minh || 0;
    if (H <= base + 1) H = base + 3;
    const hashKey = Math.abs(Math.round(cx * 7 + cz * 13));
    let up = ['redbrick', 'brownbrick', 'plaster', 'redbrick', 'cream', 'yellowbrick', 'brownbrick', 'plaster'][hashKey % 8];
    const mat = (info['building:material'] || '') + ' ' + (info['building:colour'] || '');
    if (/brick/.test(mat)) up = /yellow|beige/.test(mat) ? 'yellowbrick' : 'redbrick';
    else if (/plaster|white/.test(mat)) up = 'plaster';
    else if (/stone/.test(mat)) up = 'stone';
    if (isChurch) up = 'stone';
    else if (big) up = /yellow|beige/.test(mat) ? 'yellowbrick' : 'modern';
    const street = info['addr:street'] || '';
    const bar = /bar|pub|cafe|biergarten|nightclub|fast_food|restaurant/.test(info.amenity || '');
    let gf = isChurch || big ? null : bar ? 'bar' : info.shop ? 'shop' : busyStreets.test(street) && rnd() < 0.55 ? (rnd() < 0.6 ? 'bar' : 'shop') : 'house';
    if (base > 0) gf = null;
    const GH = 3.6;
    const ccw = area > 0;
    for (let i = 0; i < n; i++) {
      const a1 = [p[i * 2], p[i * 2 + 1]], a2 = [p[((i + 1) % n) * 2], p[((i + 1) % n) * 2 + 1]];
      const dx = a2[0] - a1[0], dz = a2[1] - a1[1], L = Math.hypot(dx, dz); if (L < 0.2) continue;
      // buitenwaartse normaal (in x-z vlak, z naar het zuiden)
      let nx = dz / L, nz = -dx / L; if (!ccw) { nx = -nx; nz = -nz; }
      const [q1, q2] = ccw ? [a2, a1] : [a1, a2]; // volgorde zodat de voorkant naar buiten wijst
      if (gf) {
        pushQuad(buf('g_' + gf), q1, q2, base, base + GH, nx, nz, 0, L / 6, 0, 1);
        pushQuad(buf('u_' + up), q1, q2, base + GH, H, nx, nz, 0, L / 6, 0, (H - base - GH) / 6.4);
      } else pushQuad(buf('u_' + up), q1, q2, base, H, nx, nz, 0, L / 6, 0, (H - base) / 6.4);
    }
    // plat dak (driehoeken uit de omtrek)
    try {
      const shape = new THREE.Shape(); for (let i = 0; i < n; i++) (i ? shape.lineTo : shape.moveTo).call(shape, p[i * 2], -p[i * 2 + 1]);
      const sg = new THREE.ShapeGeometry(shape); sg.rotateX(-Math.PI / 2); sg.translate(0, H, 0);
      const pos = sg.toNonIndexed().attributes.position;
      const rc = info['roof:colour'] ? col.set(info['roof:colour']) : col.setHex(isChurch ? 0x5f6a70 : [0x4a4442, 0x5b3a30, 0x3e4246][hashKey % 3]);
      for (let i = 0; i < pos.count; i += 3) {
        // driehoek naar boven laten kijken
        const ax = pos.getX(i), az = pos.getZ(i), bx = pos.getX(i + 1), bz = pos.getZ(i + 1), cx2 = pos.getX(i + 2), cz2 = pos.getZ(i + 2);
        const upward = (bz - az) * (cx2 - ax) - (bx - ax) * (cz2 - az) > 0;
        const order = upward ? [i, i + 1, i + 2] : [i, i + 2, i + 1];
        for (const j of order) { roofs.p.push(pos.getX(j), H, pos.getZ(j)); roofs.n.push(0, 1, 0); roofs.c.push(rc.r, rc.g, rc.b); }
      }
    } catch (e) {}
    const bld = { p, minx, minz, maxx, maxz, H, cx, cz, name: info.name || '', kind };
    buildings.push(bld);
    gridAdd(bldGrid, bld, minx, minz, maxx, maxz);
    if (isChurch && /pieter/.test(name) && A > 600) addDome(cx, cz, H);
    if (/vooruit|viernulvier/.test(name)) addSign(bld, 'VIERNULVIER · VOORUIT');
  }
  for (const key in bufs) {
    const b = bufs[key], g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
    const mk = key.split('|')[1];
    if (!MATS[mk]) {
      const map = mk.startsWith('g_') ? GF[mk.slice(2)] : UP[mk.slice(2)];
      const emissive = mk === 'g_bar' ? 0x553015 : mk === 'g_shop' ? 0x202a30 : 0x000000;
      MATS[mk] = new THREE.MeshLambertMaterial({ map, emissive, emissiveMap: emissive ? map : null });
    }
    g.computeBoundingSphere();
    scene.add(new THREE.Mesh(g, MATS[mk]));
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(roofs.p, 3)); rg.setAttribute('normal', new THREE.Float32BufferAttribute(roofs.n, 3)); rg.setAttribute('color', new THREE.Float32BufferAttribute(roofs.c, 3));
  scene.add(new THREE.Mesh(rg, new THREE.MeshLambertMaterial({ vertexColors: true })));
}
function addDome(x, z, H) {
  const stone = new THREE.MeshLambertMaterial({ color: 0xb9b1a2 }), lead = new THREE.MeshLambertMaterial({ color: 0x5d6e6c });
  const drum = new THREE.Mesh(new THREE.CylinderGeometry(7, 7, 8, 24), stone); drum.position.set(x, H + 4, z);
  const dome = new THREE.Mesh(new THREE.SphereGeometry(7.3, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), lead); dome.position.set(x, H + 8, z);
  const lan = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 4, 10), stone); lan.position.set(x, H + 17, z);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 3, 10), lead); cap.position.set(x, H + 20.5, z);
  scene.add(drum, dome, lan, cap);
}
function addSign(b, text) {
  // naambord op de gevel die het dichtst bij een straat ligt
  const n = nearestSegment(b.cx, b.cz, 3); if (!n) return;
  const t = tex(512, 64, (c, w, h) => { c.fillStyle = '#1c1c1c'; c.fillRect(0, 0, w, h); c.fillStyle = '#f5d76e'; c.font = 'bold 40px sans-serif'; c.textAlign = 'center'; c.fillText(text, w / 2, 46); });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(12, 1.5), new THREE.MeshBasicMaterial({ map: t }));
  const dx = n.px - b.cx, dz = n.pz - b.cz, L = Math.hypot(dx, dz) || 1;
  let ex = b.cx, ez = b.cz; for (let k = 0; k < 80 && insideBuilding(ex, ez); k++) { ex += dx / L; ez += dz / L; }
  m.position.set(ex + dx / L * 0.2, 6, ez + dz / L * 0.2); m.lookAt(ex + dx, 6, ez + dz); scene.add(m);
}

// ---- bomen, lantaarnpalen en zebrapaden op hun echte plek ----
const crossings = [];
function buildStreetFurniture() {
  const inst = (geo, mat, n, fn) => { const m = new THREE.InstancedMesh(geo, mat, n); const M = new THREE.Matrix4(); for (let i = 0; i < n; i++) { fn(M, i); m.setMatrixAt(i, M); } scene.add(m); return m; };
  const S = new THREE.Vector3(), Q = new THREE.Quaternion(), T = new THREE.Vector3(), col = new THREE.Color();
  const tr = DATA.trees, nt = tr.length / 2, sc = Array.from({ length: nt }, () => 0.8 + rnd() * 0.7);
  inst(new THREE.CylinderGeometry(0.16, 0.26, 3.4, 7), new THREE.MeshLambertMaterial({ color: 0x4f3a2b }), nt, (M, i) => M.compose(T.set(tr[i * 2], 1.7 * sc[i], tr[i * 2 + 1]), Q.identity(), S.setScalar(sc[i])));
  const crowns = inst(new THREE.IcosahedronGeometry(2.6, LIGHT ? 0 : 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), nt, (M, i) => M.compose(T.set(tr[i * 2], 5 * sc[i], tr[i * 2 + 1]), Q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), i), S.set(sc[i], sc[i] * 1.1, sc[i])));
  for (let i = 0; i < nt; i++) crowns.setColorAt(i, col.setHSL(0.27 + rnd() * 0.08, 0.42, 0.3 + rnd() * 0.1));
  const lp = DATA.lamps, nl = lp.length / 2;
  inst(new THREE.CylinderGeometry(0.06, 0.09, 6.5, 6), new THREE.MeshLambertMaterial({ color: 0x2b3036 }), nl, (M, i) => M.compose(T.set(lp[i * 2], 3.25, lp[i * 2 + 1]), Q.identity(), S.setScalar(1)));
  inst(new THREE.SphereGeometry(0.28, 10, 8), new THREE.MeshBasicMaterial({ color: 0xffdca0 }), nl, (M, i) => M.compose(T.set(lp[i * 2], 6.5, lp[i * 2 + 1]), Q.identity(), S.setScalar(1)));
  for (let i = 0; i < DATA.crossings.length; i += 2) crossings.push({ x: DATA.crossings[i], z: DATA.crossings[i + 1] });
  // verkeerslichten (paal met drie lampen)
  const sg = DATA.signals; const ns = sg.length / 2;
  inst(new THREE.CylinderGeometry(0.07, 0.07, 3.2, 6), new THREE.MeshLambertMaterial({ color: 0x30353b }), ns, (M, i) => M.compose(T.set(sg[i * 2] + 3, 1.6, sg[i * 2 + 1]), Q.identity(), S.setScalar(1)));
  inst(new THREE.BoxGeometry(0.35, 1, 0.3), new THREE.MeshLambertMaterial({ color: 0x15181b }), ns, (M, i) => M.compose(T.set(sg[i * 2] + 3, 3.5, sg[i * 2 + 1]), Q.identity(), S.setScalar(1)));
}

// =====================================================================
// Auto en cockpit
// =====================================================================
const car = new THREE.Group(); scene.add(car);
const COCKPIT = 1;
const cmat = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, ...extra });
function part(geo, mat, pos, rot) { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); if (rot) m.rotation.set(...rot); m.layers.set(COCKPIT); car.add(m); return m; }
const paint = new THREE.MeshPhongMaterial({ color: 0x1d3557, shininess: 90, specular: 0x8899aa });
// motorkap: licht gebogen oppervlak
{
  const g = new THREE.PlaneGeometry(1.76, 1.7, 12, 6); const pos = g.attributes.position;
  for (let i = 0; i < pos.count; i++) { const x = pos.getX(i), y = pos.getY(i); pos.setZ(i, -Math.pow(x / 0.88, 2) * 0.06 - (y + 0.85) * 0.05); }
  g.computeVertexNormals(); g.rotateX(-Math.PI / 2);
  const hood = new THREE.Mesh(g, paint); hood.position.set(0, 0.93, -1.85); hood.layers.set(COCKPIT); car.add(hood);
}
const trim = cmat(0x1b1e22), soft = cmat(0x2a2d31), metal = cmat(0x9aa0a6);
part(new THREE.BoxGeometry(1.86, 0.16, 0.62), soft, [0, 0.82, -0.82]);                       // dashboard
part(new THREE.BoxGeometry(1.86, 0.04, 0.3), trim, [0, 0.9, -1.05], [0.2, 0, 0]);         // voorkant dashboard
part(new THREE.BoxGeometry(0.3, 0.25, 0.5), trim, [0.02, 0.68, -0.55]);                     // middenconsole
for (const sgn of [-1, 1]) {
  const pl = part(new THREE.BoxGeometry(0.06, 1.0, 0.06), trim, [0.95 * sgn, 1.4, -0.98]); pl.rotation.x = -0.62;   // A-stijl
  part(new THREE.BoxGeometry(0.08, 0.5, 1.2), soft, [0.96 * sgn, 0.85, -0.2]);                                                            // deur
  part(new THREE.BoxGeometry(0.05, 0.03, 1.1), metal, [0.93 * sgn, 1.1, -0.2]);                                                           // raamrand
}
part(new THREE.BoxGeometry(1.86, 0.08, 0.45), soft, [0, 1.8, -0.62]);                       // dakrand
part(new THREE.BoxGeometry(0.26, 0.07, 0.03), trim, [0, 1.66, -0.62]);                      // behuizing binnenspiegel
// instrumentenpaneel met echte meters (canvas, ververst tijdens het rijden)
const dashCanvas = document.createElement('canvas'); dashCanvas.width = 512; dashCanvas.height = 192;
const dashTex = new THREE.CanvasTexture(dashCanvas); dashTex.colorSpace = THREE.SRGBColorSpace;
const cluster = part(new THREE.PlaneGeometry(0.42, 0.16), new THREE.MeshBasicMaterial({ map: dashTex }), [-0.37, 1.0, -0.72], [-0.35, 0, 0]);
function drawDash(kmh, rpm, gearTxt, indL, indR, blink) {
  const c = dashCanvas.getContext('2d'), w = 512, h = 192;
  c.fillStyle = '#07090b'; c.fillRect(0, 0, w, h);
  const dial = (cx, val, max, label, ticks) => {
    c.strokeStyle = '#2c3a44'; c.lineWidth = 10; c.beginPath(); c.arc(cx, 110, 74, Math.PI * 0.75, Math.PI * 2.25); c.stroke();
    c.strokeStyle = '#d9e4ec'; c.lineWidth = 2;
    for (let i = 0; i <= ticks; i++) { const a = Math.PI * 0.75 + (i / ticks) * Math.PI * 1.5; c.beginPath(); c.moveTo(cx + Math.cos(a) * 62, 110 + Math.sin(a) * 62); c.lineTo(cx + Math.cos(a) * 72, 110 + Math.sin(a) * 72); c.stroke(); }
    const a = Math.PI * 0.75 + Math.min(1, val / max) * Math.PI * 1.5;
    c.strokeStyle = '#ff5a36'; c.lineWidth = 4; c.beginPath(); c.moveTo(cx, 110); c.lineTo(cx + Math.cos(a) * 66, 110 + Math.sin(a) * 66); c.stroke();
    c.fillStyle = '#9fb0bc'; c.font = '14px sans-serif'; c.textAlign = 'center'; c.fillText(label, cx, 170);
  };
  dial(110, rpm, 7000, 'x1000 tpm', 7); dial(402, kmh, 180, 'km/u', 9);
  c.fillStyle = '#f2f6f8'; c.font = 'bold 44px sans-serif'; c.textAlign = 'center'; c.fillText(Math.round(kmh), 256, 104);
  c.fillStyle = '#f2a900'; c.font = 'bold 22px sans-serif'; c.fillText(gearTxt, 256, 140);
  c.fillStyle = indL && blink ? '#39d26b' : '#16301e'; c.beginPath(); c.moveTo(200, 30); c.lineTo(222, 16); c.lineTo(222, 44); c.fill();
  c.fillStyle = indR && blink ? '#39d26b' : '#16301e'; c.beginPath(); c.moveTo(312, 30); c.lineTo(290, 16); c.lineTo(290, 44); c.fill();
  dashTex.needsUpdate = true;
}
// stuur met drie spaken
const wheel = new THREE.Group(); wheel.position.set(-0.37, 0.92, -0.56); wheel.rotation.x = -0.38; car.add(wheel);
{
  const leather = cmat(0x111214);
  const rim = new THREE.Mesh(new THREE.TorusGeometry(0.185, 0.024, 10, 40), leather); rim.layers.set(COCKPIT); wheel.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.065, 0.05, 20), cmat(0x1e2023)); hub.rotation.x = Math.PI / 2; hub.layers.set(COCKPIT); wheel.add(hub);
  for (const a of [0, Math.PI, -Math.PI / 2]) {           // spaken naar links, rechts en onder
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.03, 0.015), leather);
    sp.position.set(Math.cos(a) * 0.11, Math.sin(a) * 0.11, 0); sp.rotation.z = a; sp.layers.set(COCKPIT); wheel.add(sp);
  }
  const logo = new THREE.Mesh(new THREE.CircleGeometry(0.018, 16), metal); logo.position.z = 0.027; logo.layers.set(COCKPIT); wheel.add(logo);
}
const camera = new THREE.PerspectiveCamera(70, 1, 0.12, VIEW + 600);
camera.position.set(-0.37, 1.25, -0.1); camera.layers.enable(COCKPIT); car.add(camera);

function mirrorCam(fov, pos, yaw) { const c = new THREE.PerspectiveCamera(fov, 1, 0.3, LIGHT ? 220 : 1200); c.position.set(...pos); c.rotation.y = yaw; car.add(c); return c; }
const mirrors = {
  rear: { cam: mirrorCam(28, [0, 1.35, 0.2], Math.PI), el: $('m-rear') },
  left: { cam: mirrorCam(30, [-1.0, 1.1, -0.65], Math.PI - 0.22), el: $('m-left') },
  right: { cam: mirrorCam(30, [1.0, 1.1, -0.65], Math.PI + 0.22), el: $('m-right') },
};
const hudScene = new THREE.Scene(), hudCam = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1);
for (const k in mirrors) {
  const m = mirrors[k];
  m.rt = new THREE.WebGLRenderTarget(16, 16);
  m.rt.texture.wrapS = THREE.RepeatWrapping; m.rt.texture.repeat.x = -1; m.rt.texture.offset.x = 1;
  m.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: m.rt.texture }));
  hudScene.add(m.plane);
}
function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  hudCam.right = w; hudCam.top = h; hudCam.updateProjectionMatrix();
  const R = { rear: [0.36, 0.03, 0.28, 0.12], left: [0.015, 0.56, 0.17, 0.15], right: [0.815, 0.56, 0.17, 0.15] };
  for (const k in mirrors) {
    const [x, y, ww, hh] = R[k], r = { x: x * w, y: y * h, w: ww * w, h: hh * h }, m = mirrors[k];
    m.cam.aspect = r.w / r.h; m.cam.updateProjectionMatrix();
    const pr = renderer.getPixelRatio() * (LIGHT ? 0.6 : 1); m.rt.setSize(Math.round(r.w * pr), Math.round(r.h * pr));
    m.plane.scale.set(r.w, r.h, 1); m.plane.position.set(r.x + r.w / 2, h - r.y - r.h / 2, 0);
    Object.assign(m.el.style, { left: r.x + 'px', top: r.y + 'px', width: r.w + 'px', height: r.h + 'px' });
  }
}
addEventListener('resize', resize); resize();

// =====================================================================
// Rijden, verkeer en beoordeling
// =====================================================================
const input = { steer: 0, gas: 0, brake: 0, look: 0, phoneAt: -99 };
const st = { x: 0, z: 0, h: 0, v: 0, gear: 'D', indL: false, indR: false, lastIndL: -99, lastIndR: -99, lastLookL: -99, lastLookR: -99, look: 0 };
let running = false, t = 0, faults = [], dist = 0, lastTurn = 0;
const history = [], trail = [];

function placeOn(s, frac) {
  const dx = s.bx - s.ax, dz = s.bz - s.az, L = Math.hypot(dx, dz), off = s.oneway ? 0 : s.half * 0.5;
  st.x = s.ax + dx * frac + (-dz / L) * off; st.z = s.az + dz * frac + (dx / L) * off;
  st.h = Math.atan2(-dx, -dz); st.v = 0; history.length = 0; trail.length = 0;
}
function spawn() {
  let best = null, bd = Infinity;
  for (const s of segments) if (s.name === 'Overpoortstraat') { const d = Math.hypot((s.ax + s.bx) / 2 + 9, (s.az + s.bz) / 2 + 5); if (d < bd) { bd = d; best = s; } }
  const s = best || segments[0];
  const south = s.bz >= s.az, a = south ? s : { ...s, ax: s.bx, az: s.bz, bx: s.ax, bz: s.az };
  placeOn(a, 0.2); lastPriv = true;
  setTimeout(() => message('Je vertrekt in de Overpoortstraat (autovrij, 20 km/u). Rij rustig naar de Citadellaan.', '', 5), 600);
}
function resetToRoad() {
  const n = nearestSegment(st.x, st.z, 3); if (!n) return spawn();
  const s = n.s; let h = Math.atan2(-(s.bx - s.ax), -(s.bz - s.az)); if (Math.cos(h - st.h) < 0 && !s.oneway) h += Math.PI;
  const fx = -Math.sin(h), fz = -Math.cos(h), off = s.oneway ? 0 : s.half * 0.5;
  st.x = n.px - fz * off; st.z = n.pz + fx * off; st.h = h; st.v = 0; history.length = 0;
}

let msgT = 0;
function message(text, kind = '', secs = 3) { const m = $('message'); m.textContent = text; m.className = 'show ' + kind; msgT = secs; }
const cool = {};
function fault(code, text, zwaar = false, cd = 12) {
  if (cool[code] && t - cool[code] < cd) return; cool[code] = t;
  const where = nearestSegment(st.x, st.z)?.s.name || '';
  faults.push({ text, zwaar, where, time: t });
  const ul = $('faultlist'); if (faults.length === 1) ul.innerHTML = '';
  const li = document.createElement('li'); li.textContent = text + (where ? ' · ' + where : ''); if (zwaar) li.className = 'zwaar'; ul.prepend(li);
  $('faultcount').textContent = faults.length;
  message(text, 'bad', 3.5); beep(zwaar ? 220 : 440, 0.15);
}

// ---- geluid ----
let ac = null;
function audio() { if (!ac) try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} return ac; }
function beep(f, d, vol = 0.08) { const a = audio(); if (!a) return; const o = a.createOscillator(), g = a.createGain(); o.frequency.value = f; g.gain.value = vol; o.connect(g).connect(a.destination); o.start(); o.stop(a.currentTime + d); }
let siren = null;
function sirenOn() { const a = audio(); if (!a || siren) return; const o = a.createOscillator(), g = a.createGain(); o.type = 'triangle'; g.gain.value = 0; o.connect(g).connect(a.destination); o.start(); siren = { o, g }; }
function sirenSet(v) { if (!siren) return; siren.g.gain.value = Math.max(0, v) * 0.06 * (snd.muted ? 0 : 1); siren.o.frequency.value = (Math.floor(t * 1.4) % 2) ? 660 : 880; }
function sirenOff() { if (siren) { siren.o.stop(); siren = null; } }
const snd = { on: false, muted: false };
function noiseSrc(a) { const b = a.createBuffer(1, a.sampleRate * 2, a.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; const n = a.createBufferSource(); n.buffer = b; n.loop = true; n.start(); return n; }
function soundStart() {
  const a = audio(); if (!a || snd.on) return; a.resume?.(); snd.on = true;
  snd.master = a.createGain(); snd.master.connect(a.destination);
  const chain = (...n) => { for (let i = 0; i < n.length - 1; i++) n[i].connect(n[i + 1]); };
  snd.e1 = a.createOscillator(); snd.e1.type = 'sawtooth'; snd.e2 = a.createOscillator(); snd.e2.type = 'square';
  snd.ef = a.createBiquadFilter(); snd.ef.type = 'lowpass'; snd.ef.Q.value = 5; snd.eg = a.createGain(); snd.eg.gain.value = 0.04;
  snd.e1.connect(snd.ef); snd.e2.connect(snd.ef); chain(snd.ef, snd.eg, snd.master); snd.e1.start(); snd.e2.start();
  snd.rf = a.createBiquadFilter(); snd.rf.type = 'bandpass'; snd.rf.Q.value = 0.7; snd.rg = a.createGain(); snd.rg.gain.value = 0; chain(noiseSrc(a), snd.rf, snd.rg, snd.master);
  const sf = a.createBiquadFilter(); sf.type = 'bandpass'; sf.frequency.value = 2400; sf.Q.value = 9; snd.sg = a.createGain(); snd.sg.gain.value = 0; chain(noiseSrc(a), sf, snd.sg, snd.master);
  const cf = a.createBiquadFilter(); cf.type = 'lowpass'; cf.frequency.value = 260; const cg = a.createGain(); cg.gain.value = 0.05; chain(noiseSrc(a), cf, cg, snd.master);
  snd.h1 = a.createOscillator(); snd.h2 = a.createOscillator(); snd.h1.type = snd.h2.type = 'square'; snd.h1.frequency.value = 415; snd.h2.frequency.value = 520;
  const hf = a.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 1800; snd.hg = a.createGain(); snd.hg.gain.value = 0;
  snd.h1.connect(hf); snd.h2.connect(hf); chain(hf, snd.hg, snd.master); snd.h1.start(); snd.h2.start();
}
const GEARS = [0, 4.5, 9, 14, 20, 28];
let rpmNow = 850, gearNow = 1;
function soundUpdate(gas, brake, offroad) {
  const v = Math.abs(st.v); let g = 1; while (g < GEARS.length - 1 && v > GEARS[g]) g++;
  const lo = GEARS[g - 1], hi = GEARS[g]; rpmNow = 850 + Math.min(1, (v - lo) / (hi - lo)) * 2600 + gas * 350; gearNow = g;
  if (!snd.on) return; const now = ac.currentTime, f = rpmNow / 30;
  snd.e1.frequency.setTargetAtTime(f, now, 0.06); snd.e2.frequency.setTargetAtTime(f * 0.5, now, 0.06);
  snd.ef.frequency.setTargetAtTime(220 + gas * 700 + rpmNow * 0.12, now, 0.08); snd.eg.gain.setTargetAtTime(0.03 + gas * 0.035, now, 0.1);
  snd.rf.frequency.setTargetAtTime(250 + v * 30 + (offroad ? 300 : 0), now, 0.1); snd.rg.gain.setTargetAtTime(Math.min(0.14, v * 0.006) * (offroad ? 1.8 : 1), now, 0.1);
  snd.sg.gain.setTargetAtTime(brake > 0.6 && v > 7 ? 0.05 : 0, now, 0.05);
  snd.master.gain.setTargetAtTime(snd.muted || !running ? 0 : 1, now, 0.05);
}
function horn(on) { if (snd.on) snd.hg.gain.setTargetAtTime(on && !snd.muted ? 0.07 : 0, ac.currentTime, 0.02); }
function crash() { const a = audio(); if (!a || snd.muted) return; const n = noiseSrc(a), f = a.createBiquadFilter(), g = a.createGain(); f.type = 'lowpass'; f.frequency.value = 900; g.gain.value = 0.25; g.gain.setTargetAtTime(0, a.currentTime + 0.05, 0.12); n.connect(f).connect(g).connect(a.destination); setTimeout(() => n.stop(), 900); }
function toggleMute() { snd.muted = !snd.muted; $('btn-mute').textContent = snd.muted ? 'Geluid aan' : 'Geluid uit'; }

// ---- voetgangers aan de echte zebrapaden ----
const peds = []; let nextPed = 10;
function spawnPed() {
  const fx = -Math.sin(st.h), fz = -Math.cos(st.h);
  let pick = null;
  for (const c of crossings) { const dx = c.x - st.x, dz = c.z - st.z, d = Math.hypot(dx, dz); if (d > 30 && d < 75 && (dx * fx + dz * fz) / d > 0.85) { pick = c; break; } }
  if (!pick) { const d = 40 + rnd() * 20; pick = { x: st.x + fx * d, z: st.z + fz * d }; }
  const n = nearestSegment(pick.x, pick.z); if (!n || n.d > 6) return;
  const s = n.s, L = s.len, rx = -(s.bz - s.az) / L, rz = (s.bx - s.ax) / L;
  const side = rnd() < 0.5 ? 1 : -1, w = s.half + 1.2, g = new THREE.Group();
  const bodyCol = [0x9b2c2c, 0x2c5f9b, 0x2f7d4f, 0xd08a2c, 0x444a55][peds.length % 5];
  const add = (geo, color, y, x = 0) => { const m = new THREE.Mesh(geo, cmat(color)); m.position.set(x, y, 0); g.add(m); return m; };
  const legs = [add(new THREE.CylinderGeometry(0.07, 0.07, 0.85, 8), 0x23262d, 0.43, -0.1), add(new THREE.CylinderGeometry(0.07, 0.07, 0.85, 8), 0x23262d, 0.43, 0.1)];
  add(new THREE.CylinderGeometry(0.2, 0.17, 0.65, 10), bodyCol, 1.17);
  add(new THREE.SphereGeometry(0.12, 12, 10), 0xd9a882, 1.62);
  const p = { g, legs, sx: n.px + rx * w * side, sz: n.pz + rz * w * side, ex: n.px - rx * w * side, ez: n.pz - rz * w * side, k: 0, wait: 0.6 + rnd() * 1.5, cx: n.px, cz: n.pz, judged: false };
  g.position.set(p.sx, 0, p.sz); g.lookAt(p.ex, 0, p.ez); scene.add(g); peds.push(p);
}
function updatePeds(dt) {
  if (st.v * KMH > 8) nextPed -= dt;
  if (nextPed <= 0) { spawnPed(); nextPed = 16 + rnd() * 16; }
  for (let i = peds.length - 1; i >= 0; i--) {
    const p = peds[i], dCar = Math.hypot(p.cx - st.x, p.cz - st.z);
    const walking = p.wait <= 0 && p.k < 1;
    if (p.wait > 0) p.wait -= dt; else p.k = Math.min(1, p.k + dt * 1.3 / Math.hypot(p.ex - p.sx, p.ez - p.sz));
    p.g.position.set(p.sx + (p.ex - p.sx) * p.k, 0, p.sz + (p.ez - p.sz) * p.k);
    p.legs[0].rotation.x = walking ? Math.sin(t * 8) * 0.4 : 0; p.legs[1].rotation.x = -p.legs[0].rotation.x;
    const onRoad = p.wait <= 0 && p.k > 0.05 && p.k < 0.95, pd = Math.hypot(p.g.position.x - st.x, p.g.position.z - st.z);
    if (pd < 1.6 && Math.abs(st.v) > 0.5) { if (!cool.aanrijding || t - cool.aanrijding > 5) crash(); fault('aanrijding', 'Aanrijding met voetganger', true, 5); }
    else if (!p.judged && onRoad && dCar < 7 && st.v * KMH > 8) { p.judged = true; fault('zebra', 'Geen voorrang aan voetganger op het zebrapad', true); }
    if ((p.k >= 1 && dCar > 25) || dCar > 160) { scene.remove(p.g); peds.splice(i, 1); }
  }
}

// ---- politie met zwaailicht ----
const police = new THREE.Group();
{
  const add = (geo, mat, pos) => { const m = new THREE.Mesh(geo, mat); m.position.set(...pos); police.add(m); return m; };
  add(new THREE.BoxGeometry(1.8, 0.7, 4.5), new THREE.MeshPhongMaterial({ color: 0xf4f4f4, shininess: 80 }), [0, 0.75, 0]);
  add(new THREE.BoxGeometry(1.82, 0.2, 4.52), cmat(0x1f4fbf), [0, 0.78, 0]);
  add(new THREE.BoxGeometry(1.6, 0.55, 2.3), cmat(0x223040), [0, 1.35, 0.2]);
  for (const x of [-0.8, 0.8]) for (const z of [-1.4, 1.4]) { const w = add(new THREE.CylinderGeometry(0.33, 0.33, 0.25, 16), cmat(0x111111), [x, 0.33, z]); w.rotation.z = Math.PI / 2; }
  police.userData.lights = [add(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0x0033ff }), [-0.35, 1.72, 0.2]), add(new THREE.BoxGeometry(0.5, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: 0x0033ff }), [0.35, 1.72, 0.2])];
  police.visible = false; scene.add(police);
}
const pol = { active: false, next: 80, phase: '', time: 0, back: 40, yielded: 0 };
function trailPoint(back) {
  let acc = 0;
  for (let i = trail.length - 1; i > 0; i--) { const a = trail[i], b = trail[i - 1], d = Math.hypot(a.x - b.x, a.z - b.z); if (acc + d >= back) { const f = (back - acc) / d; return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, h: a.h }; } acc += d; }
  return { x: st.x + Math.sin(st.h) * back, z: st.z + Math.cos(st.h) * back, h: st.h };
}
function updatePolice(dt) {
  if (!pol.active) {
    if (st.v * KMH > 15) pol.next -= dt;
    if (pol.next <= 0) { Object.assign(pol, { active: true, phase: 'nadert', time: 0, back: 45, yielded: 0 }); police.visible = true; sirenOn(); message('Prioritair voertuig achter je. Kijk in je spiegels.', '', 4); }
    return;
  }
  pol.time += dt;
  police.userData.lights.forEach((l, i) => l.material.color.setHex(((Math.floor(t * 6) + i) % 2) ? 0x0033ff : 0x00102a));
  if (pol.phase === 'nadert') {
    pol.back = Math.max(9, pol.back - dt * 5);
    const p = trailPoint(pol.back); police.position.set(p.x, 0, p.z); police.rotation.y = p.h;
    sirenSet(1 - pol.back / 60);
    if (st.v * KMH < 15) pol.yielded += dt; else pol.yielded = Math.max(0, pol.yielded - dt);
    if (pol.yielded > 1.5) { pol.phase = 'passeert'; pol.time = 0; message('Goed: doorgang verleend', 'good', 2.5); }
    else if (pol.time > 14) { fault('prioritair', 'Geen doorgang verleend aan prioritair voertuig', true); pol.phase = 'passeert'; pol.time = 0; }
  } else {
    const fx = -Math.sin(st.h), fz = -Math.cos(st.h), k = Math.min(1, pol.time / 3), along = -9 + k * 70;
    police.position.set(st.x + fx * along + fz * 2.4, 0, st.z + fz * along - fx * 2.4); police.rotation.y = st.h;
    sirenSet(1 - k);
    if (k >= 1) { police.visible = false; pol.active = false; pol.next = 110 + rnd() * 80; sirenOff(); }
  }
}

// ---- invoer ----
const keys = {};
addEventListener('keydown', (e) => {
  if (!running) return;
  keys[e.code] = true;
  if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  if (e.code === 'KeyQ') toggleInd('L'); if (e.code === 'KeyE') toggleInd('R'); if (e.code === 'KeyR') toggleGear();
  if (e.code === 'KeyH' && !e.repeat) horn(true); if (e.code === 'KeyM') toggleMute();
});
addEventListener('keyup', (e) => { keys[e.code] = false; if (e.code === 'KeyH') horn(false); });
function toggleInd(side) { if (side === 'L') { st.indL = !st.indL; st.indR = false; } else { st.indR = !st.indR; st.indL = false; } }
function toggleGear() {
  if (Math.abs(st.v) > 0.5) { message('Eerst stilstaan om te schakelen', '', 1.5); return; }
  st.gear = st.gear === 'D' ? 'R' : 'D'; $('gear').textContent = st.gear === 'D' ? 'D · VOORUIT' : 'R · ACHTERUIT';
}

let offT = 0, leftT = 0, speedT = 0, wrongT = 0, kb = 0, lastBlink = false, lastPriv = false, dashT = 0;
function drive(dt) {
  let steer, gas, brake, look;
  if (t - input.phoneAt < 1) ({ steer, gas, brake, look } = input);
  else {
    const target = (keys.ArrowRight ? 1 : 0) - (keys.ArrowLeft ? 1 : 0);
    kb += (target - kb) * Math.min(1, dt * (target ? 2.5 : 5));
    steer = kb; gas = keys.ArrowUp ? 1 : 0; brake = keys.ArrowDown || keys.Space ? 1 : 0; look = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  }
  if (look < 0) st.lastLookL = t; if (look > 0) st.lastLookR = t;
  st.look += (look - st.look) * Math.min(1, dt * 6);
  const dir = st.gear === 'D' ? 1 : -1, n = nearestSegment(st.x, st.z), off = !n || n.d > n.s.half + 1.0;
  let acc = gas * (dir > 0 ? 3.2 : 1.6) * dir;
  if (brake > 0 && st.v !== 0) acc -= Math.sign(st.v) * brake * 7.5;
  acc -= st.v * (off ? 0.5 : 0.06) + Math.sign(st.v) * 0.3 * (gas === 0);
  const nv = st.v + acc * dt;
  st.v = dir > 0 ? Math.max(0, Math.min(27, nv)) : Math.min(0, Math.max(-4, nv));
  st.h -= (st.v / 2.6) * Math.tan(steer * 0.6 / (1 + Math.abs(st.v) / 14)) * dt;
  const fx = -Math.sin(st.h), fz = -Math.cos(st.h);
  const nx = st.x + fx * st.v * dt, nz = st.z + fz * st.v * dt;
  // botsing met een gebouw: neus of hoek van de auto komt in een gebouw
  const lead = st.v >= 0 ? 2.2 : -2.2, rx = -fz, rz = fx;
  const hit = insideBuilding(nx + fx * lead + rx * 0.85, nz + fz * lead + rz * 0.85) || insideBuilding(nx + fx * lead - rx * 0.85, nz + fz * lead - rz * 0.85);
  if (hit) {
    if (Math.abs(st.v) > 1.5) { crash(); fault('gebouw', 'Aanrijding met een gebouw of muur', true, 5); }
    st.v = 0;
  } else { st.x = nx; st.z = nz; }
  const moved = Math.abs(st.v * dt); dist += moved;
  car.position.set(st.x, 0, st.z); car.rotation.y = st.h; camera.rotation.y = -st.look * 1.25; wheel.rotation.z = -steer * 2.2;
  const last = trail[trail.length - 1];
  if (!last || Math.hypot(last.x - st.x, last.z - st.z) > 0.7) { trail.push({ x: st.x, z: st.z, h: st.h }); if (trail.length > 400) trail.shift(); }
  if (moved > 0) history.push({ d: dist, h: st.h }); while (history.length && dist - history[0].d > 30) history.shift();

  soundUpdate(gas, brake, off);
  const kmh = Math.abs(st.v) * KMH, limit = n && !off ? n.s.limit : null;
  $('speed').textContent = Math.round(kmh); if (limit) $('limitval').textContent = limit; $('street').textContent = n && !off ? n.s.name : '';
  const blink = Math.floor(t * 2.6) % 2 === 0;
  $('ind-l').classList.toggle('on', st.indL && blink); $('ind-r').classList.toggle('on', st.indR && blink);
  if ((st.indL || st.indR) && blink !== lastBlink) beep(blink ? 1800 : 1400, 0.02, snd.muted ? 0 : 0.04); lastBlink = blink;
  if (st.indL) st.lastIndL = t; if (st.indR) st.lastIndR = t;
  if ((dashT += dt) > 0.08) { dashT = 0; drawDash(kmh, rpmNow, st.gear === 'R' ? 'R' : 'D' + gearNow, st.indL, st.indR, blink); }

  // beoordeling
  if (off && kmh > 3) offT += dt; else offT = 0;
  if (offT > 1.0) fault('off', 'Van de rijbaan afgeweken', true, 8);
  if (n && !off) {
    if (n.s.priv && !lastPriv && kmh > 2) fault('autovrij', 'Autovrij gebied ingereden zonder vergunning', true, 20);
    lastPriv = n.s.priv;
    const along = (n.s.bx - n.s.ax) * fx + (n.s.bz - n.s.az) * fz;
    if (n.s.oneway && along < -0.5 * n.s.len && kmh > 4 && dir > 0) wrongT += dt; else wrongT = 0;
    if (wrongT > 1.2) fault('richting', 'Eenrichtingsstraat in verboden richting ingereden', true, 15);
  }
  if (limit && kmh > limit + 3) speedT += dt; else speedT = 0;
  if (speedT > 2) { const z = kmh > limit + 15; fault('snel' + (z ? 'Z' : ''), `Te snel: ${Math.round(kmh)} km/u waar ${limit} geldt`, z, 15); }
  if (n && !off && !n.s.oneway && n.s.half >= 3 && kmh > 10 && !nearJunction(st.x, st.z, 15) && !pol.active) {
    let dx = n.s.bx - n.s.ax, dz = n.s.bz - n.s.az; if (dx * fx + dz * fz < 0) { dx = -dx; dz = -dz; }
    const L = Math.hypot(dx, dz), side = (st.x - n.px) * (-dz / L) + (st.z - n.pz) * (dx / L);
    if (side < -0.3) leftT += dt; else leftT = 0;
    if (leftT > 2.5) fault('links', 'Links van de middellijn gereden', false, 15);
  } else leftT = 0;
  if (history.length > 2 && t - lastTurn > 3) {
    let dh = st.h - history[0].h; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    if (Math.abs(dh) > 0.95 && nearJunction(st.x, st.z, 25)) {
      lastTurn = t; const left = dh > 0;
      if (t - (left ? st.lastIndL : st.lastIndR) > 9) fault('ind', `Geen richtingaanwijzer bij ${left ? 'links' : 'rechts'} afslaan`, false, 3);
      if (!left && t - st.lastLookR > 9) fault('dodehoek', 'Geen dodehoekcontrole bij rechts afslaan', false, 3);
      st.indL = st.indR = false; history.length = 0;
    }
  }
}

let mirrorTurn = 0;
const clock = new THREE.Clock();
(function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  if (!running) return;
  t += dt; drive(dt); updatePeds(dt); updatePolice(dt); sky.position.copy(car.position);
  if (msgT > 0 && (msgT -= dt) <= 0) $('message').classList.remove('show');
  mirrorTurn = (mirrorTurn + 1) % 3;
  ['rear', 'left', 'right'].forEach((k, i) => { if (LIGHT && i !== mirrorTurn) return; const m = mirrors[k]; renderer.setRenderTarget(m.rt); renderer.clear(); renderer.render(scene, m.cam); });
  renderer.setRenderTarget(null); renderer.clear(); renderer.render(scene, camera);
  renderer.clearDepth(); renderer.render(hudScene, hudCam);
})();

// ---- koppelen vanaf het scherm ----
let link = null, padSeen = null, linkCode = null;
async function setupLink() {
  $('link').hidden = false;
  if (link) return;
  linkCode = linkCode || String(1000 + Math.floor(Math.random() * 9000));
  $('codebig').textContent = linkCode; $('codeshow').textContent = linkCode;
  if (window.qrcode) { const q = qrcode(0, 'M'); q.addData(location.href.split('#')[0] + '#stuur-' + linkCode); q.make(); $('qr').innerHTML = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true }); }
  $('linkhint').textContent = 'Verbinden met de server…';
  try { link = await mqttLink(linkCode, 'auto'); }
  catch (e) { $('linkhint').textContent = 'Verbinden lukte niet (' + e.message + '). Controleer je internet en klik opnieuw op "Gsm koppelen".'; return; }
  $('linkhint').textContent = 'Klaar. Wachten op je gsm…'; $('codepill').hidden = false;
  link.on((c) => {
    if (!padSeen) { padSeen = { iL: c.iL, iR: c.iR, gr: c.gr }; $('link').hidden = true; message('Gsm gekoppeld', 'good', 2); }
    if (c.iL !== padSeen.iL) toggleInd('L'); if (c.iR !== padSeen.iR) toggleInd('R'); if (c.gr !== padSeen.gr) toggleGear();
    padSeen = { iL: c.iL, iR: c.iR, gr: c.gr };
    horn(!!c.hn);
    Object.assign(input, { steer: +c.s || 0, gas: +c.g || 0, brake: +c.b || 0, look: +c.l || 0, phoneAt: t });
    $('linkstatus').textContent = 'Stuur: gekoppeld'; $('linkstatus').classList.add('ok');
  });
  setInterval(() => {
    if (t - input.phoneAt > 2 && padSeen) { $('linkstatus').textContent = 'Stuur: verbinding kwijt'; $('linkstatus').classList.remove('ok'); }
    if (running) link.send({ v: Math.round(Math.abs(st.v) * KMH), gear: st.gear, indL: st.indL, indR: st.indR, f: faults.length });
  }, 250);
}

// ---- schermen ----
$('go-drive').onclick = () => { audio(); soundStart(); $('start').hidden = true; $('hud').hidden = false; restart(); running = true; setupLink(); };
$('btn-link').onclick = setupLink;
$('btn-link-close').onclick = () => { $('link').hidden = true; };
$('btn-reset').onclick = resetToRoad;
$('btn-mute').onclick = toggleMute;
function restart() {
  faults = []; $('faultlist').innerHTML = '<li class="none">Nog geen fouten</li>'; $('faultcount').textContent = '0';
  for (const p of peds) scene.remove(p.g); peds.length = 0;
  police.visible = false; pol.active = false; pol.next = 80; sirenOff();
  st.indL = st.indR = false; st.gear = 'D'; $('gear').textContent = 'D · VOORUIT'; t = 0; dist = 0; nextPed = 10;
  for (const k in cool) delete cool[k];
  spawn();
}
$('btn-end').onclick = () => {
  running = false; sirenOff(); horn(false); soundUpdate(0, 0, false);
  const zw = faults.filter((f) => f.zwaar).length, li = faults.length - zw, pass = zw === 0 && li <= 3;
  $('verdict').textContent = pass ? 'Geslaagd' : 'Niet geslaagd'; $('verdict').className = pass ? 'pass' : 'fail';
  $('reportsum').textContent = `${Math.floor(t / 60)} min ${Math.round(t % 60)} s, ${(dist / 1000).toFixed(1)} km. ${zw} zware en ${li} kleine fouten. Indicatieve beoordeling: één zware fout of meer dan drie kleine fouten betekent niet geslaagd.`;
  const ul = $('reportlist'); ul.innerHTML = '';
  if (!faults.length) ul.innerHTML = '<li>Geen fouten. Mooi gereden.</li>';
  for (const f of faults) { const el = document.createElement('li'); el.className = f.zwaar ? 'zwaar' : ''; el.textContent = `${Math.floor(f.time / 60)}:${String(Math.floor(f.time % 60)).padStart(2, '0')}  ${f.zwaar ? '[zwaar] ' : ''}${f.text}${f.where ? ' (' + f.where + ')' : ''}`; ul.appendChild(el); }
  $('report').hidden = false;
};
$('btn-again').onclick = () => { $('report').hidden = true; restart(); running = true; };

{ const m = location.hash.match(/^#stuur-(\d{4})$/); if (m) { startPad(); $('codein').value = m[1]; } }
if (matchMedia('(pointer: coarse)').matches && Math.min(innerWidth, innerHeight) < 600) $('go-pad').classList.add('suggest');

$('btn-quality').textContent = LIGHT ? 'Grafiek: licht (sneller)' : 'Grafiek: mooi (zwaarder)';
$('btn-quality').onclick = () => { try { localStorage.setItem('rg-kwaliteit', LIGHT ? 'mooi' : 'licht'); } catch (e) {} location.reload(); };
loadWorld().then(() => {
  $('loadstate').textContent = `Kaart geladen: ${buildings.length} gebouwen, ${segments.length} straatstukken, ${DATA.trees.length / 2} bomen.`;
  $('go-drive').disabled = false;
}).catch((e) => { $('loadstate').textContent = 'De kaart kon niet laden: ' + e.message + '. Probeer het over een paar minuten opnieuw.'; });
window.__sim = { st, get faults() { return faults; }, segments, buildings, spawnPed, pol };
