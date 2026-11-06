import * as THREE from 'three';
import Globe from 'globe.gl';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';

// ============================================================
// Config
// ============================================================
const RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.primal.net',
  'wss://nostr.mom',
  'wss://relay.snort.social',
];
const KIND = 7462;
const params = new URLSearchParams(location.search);
const room = (params.get('c') || 'world').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48) || 'world';
const TAG = 'diwali-globe:v1:' + room;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const R = 100; // globe radius in scene units (globe.gl default)

const INDIA = { lat: 22.5, lng: 80, altitude: 1.15 };
const COLORS = [
  [1.0, 0.32, 0.45], [1.0, 0.78, 0.22], [0.35, 0.8, 1.0], [0.68, 0.45, 1.0],
  [0.35, 1.0, 0.55], [1.0, 0.5, 0.12], [1.0, 0.95, 0.85],
];
const CRACKER_TYPES = ['peony', 'ring', 'willow', 'double', 'glitter'];

// ============================================================
// Helpers
// ============================================================
const $ = (id) => document.getElementById(id);
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
const clean = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const round1 = (v) => Math.round(v * 10) / 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const regionNames = (() => { try { return new Intl.DisplayNames(['en'], { type: 'region' }); } catch { return null; } })();
const countryName = (cc) => { try { return (cc && regionNames && regionNames.of(cc)) || cc || ''; } catch { return cc || ''; } };
const flag = (cc) => (cc && /^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '🌍');
const shareUrl = () => location.origin + location.pathname + (room !== 'world' ? '?c=' + room : '');

// ============================================================
// Identity
// ============================================================
const secret = (() => {
  const s = store.get('dg.sk', null);
  if (typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)) return unhex(s);
  const k = generateSecretKey();
  store.set('dg.sk', hex(k));
  return k;
})();
const myPub = getPublicKey(secret);

// ============================================================
// Globe
// ============================================================
const el = $('globe');
const globe = new Globe(el, { rendererConfig: { antialias: true, alpha: false } })
  .globeImageUrl('img/earth-night.jpg')
  .backgroundImageUrl('img/night-sky.png')
  .atmosphereColor('#ff9d4d')
  .atmosphereAltitude(0.2)
  .showGraticules(false)
  .width(innerWidth)
  .height(innerHeight);

const renderer = globe.renderer();
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
const camera = globe.camera();
const scene = globe.scene();
const controls = globe.controls();
controls.autoRotate = !reduceMotion;
controls.autoRotateSpeed = 2.4;
controls.enableDamping = true;
controls.minDistance = R * 1.08;
controls.maxDistance = R * 5;
globe.pointOfView({ lat: 18, lng: 40, altitude: 2.7 }, 0);

// Brighten the night texture a little so city lights pop
const mat = globe.globeMaterial();
mat.shininess = 4;
// Make the city lights glow: use the night texture itself as an emissive map
globe.onGlobeReady(() => {
  if (mat.map) { mat.emissiveMap = mat.map; mat.emissive = new THREE.Color(0xffffff); mat.emissiveIntensity = 0.9; mat.needsUpdate = true; }
});

const camDist = () => camera.position.length();
const altitude = () => camDist() / R - 1;

// ============================================================
// Fireworks particle engine (one pooled Points object)
// ============================================================
const MAXP = 18000;
const pPos = new Float32Array(MAXP * 3);
const pVel = new Float32Array(MAXP * 3);
const pCol = new Float32Array(MAXP * 3);
const pGrav = new Float32Array(MAXP * 3);
const pSize = new Float32Array(MAXP);
const pAlpha = new Float32Array(MAXP);
const pLife = new Float32Array(MAXP);
const pMax = new Float32Array(MAXP);
const pDrag = new Float32Array(MAXP);
const pFlick = new Uint8Array(MAXP);
let pHead = 0;

const pGeo = new THREE.BufferGeometry();
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('aSize', new THREE.BufferAttribute(pSize, 1).setUsage(THREE.DynamicDrawUsage));
pGeo.setAttribute('aAlpha', new THREE.BufferAttribute(pAlpha, 1).setUsage(THREE.DynamicDrawUsage));
const pMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 800 } },
  vertexShader: `
    attribute float aSize; attribute float aAlpha; attribute vec3 color;
    varying vec3 vColor; varying float vAlpha;
    uniform float uScale;
    void main() {
      vColor = color; vAlpha = aAlpha;
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_PointSize = aAlpha <= 0.0 ? 0.0 : clamp(aSize * uScale / -mv.z, 1.5, 90.0);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying vec3 vColor; varying float vAlpha;
    void main() {
      float d = length(gl_PointCoord - 0.5);
      float core = smoothstep(0.5, 0.0, d);
      float a = core * core * vAlpha;
      gl_FragColor = vec4(mix(vColor, vec3(1.0), core * core * 0.55), a);
    }`,
  transparent: true,
  depthWrite: false,
  depthTest: true,
  blending: THREE.AdditiveBlending,
});
const points = new THREE.Points(pGeo, pMat);
points.frustumCulled = false;
points.renderOrder = 10;
scene.add(points);

function spawn(p, v, col, size, life, g, drag, flick) {
  const i = pHead; pHead = (pHead + 1) % MAXP;
  const i3 = i * 3;
  pPos[i3] = p.x; pPos[i3 + 1] = p.y; pPos[i3 + 2] = p.z;
  pVel[i3] = v.x; pVel[i3 + 1] = v.y; pVel[i3 + 2] = v.z;
  pCol[i3] = col[0]; pCol[i3 + 1] = col[1]; pCol[i3 + 2] = col[2];
  pGrav[i3] = g.x; pGrav[i3 + 1] = g.y; pGrav[i3 + 2] = g.z;
  pSize[i] = size; pLife[i] = life; pMax[i] = life; pAlpha[i] = 1;
  pDrag[i] = drag; pFlick[i] = flick ? 1 : 0;
}

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _g = new THREE.Vector3();
function randomUnit(out) {
  const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(th), s * Math.sin(th), u);
}
function basis(n) {
  const up = Math.abs(n.y) < 0.95 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
  const t1 = new THREE.Vector3().crossVectors(n, up).normalize();
  const t2 = new THREE.Vector3().crossVectors(n, t1).normalize();
  return [t1, t2];
}
// Bursts get bigger when the camera is far away, so they read at world scale
const fxScale = () => clamp((camDist() - R) / 85, 0.5, 2.8);

function explode(pos, n, type, scale, colA, colB) {
  const radius = 5.5 * scale;
  _g.copy(n).multiplyScalar(-1.1 * scale);
  // flash
  spawn(pos, _w.set(0, 0, 0), [1, 0.95, 0.85], 7 * scale, 0.22, _g, 0, false);
  if (type === 'ring') {
    const [t1, t2] = basis(n);
    const tilt = rand(-0.6, 0.6);
    for (let i = 0; i < 110; i++) {
      const a = (i / 110) * Math.PI * 2;
      _v.copy(t1).multiplyScalar(Math.cos(a)).addScaledVector(t2, Math.sin(a)).addScaledVector(n, Math.sin(a) * tilt).normalize();
      spawn(pos, _v.multiplyScalar(radius * 2.6 * rand(0.95, 1.05)), colA, 0.77 * scale, rand(1.3, 1.7), _g, 2.6, false);
    }
    for (let i = 0; i < 40; i++) spawn(pos, randomUnit(_v).multiplyScalar(radius * 1.2 * rand(0.6, 1)), colB, 0.63 * scale, rand(1, 1.4), _g, 2.6, true);
  } else if (type === 'willow') {
    const gold = [1, 0.72, 0.28];
    _g.multiplyScalar(2.2);
    for (let i = 0; i < 150; i++) spawn(pos, randomUnit(_v).multiplyScalar(radius * 1.7 * rand(0.7, 1.05)), gold, 0.63 * scale, rand(2.2, 3), _g, 1.5, true);
  } else if (type === 'double') {
    for (let i = 0; i < 120; i++) spawn(pos, randomUnit(_v).multiplyScalar(radius * 2.6 * rand(0.92, 1.05)), colA, 0.77 * scale, rand(1.3, 1.8), _g, 2.5, false);
    for (let i = 0; i < 70; i++) spawn(pos, randomUnit(_v).multiplyScalar(radius * 1.3 * rand(0.9, 1.05)), colB, 0.7 * scale, rand(1.2, 1.6), _g, 2.5, false);
  } else if (type === 'glitter') {
    for (let i = 0; i < 170; i++) spawn(pos, randomUnit(_v).multiplyScalar(radius * 2.3 * rand(0.6, 1.05)), i % 3 ? [1, 0.95, 0.8] : colA, 0.56 * scale, rand(1.4, 2.2), _g, 2.2, true);
  } else { // peony
    for (let i = 0; i < 160; i++) spawn(pos, randomUnit(_v).multiplyScalar(radius * 2.6 * rand(0.88, 1.05)), i % 5 ? colA : colB, 0.77 * scale, rand(1.3, 1.9), _g, 2.5, false);
  }
}

// Diya lighting effect: golden sparkles rising from the city
function sparkle(pos, n, scale) {
  _g.copy(n).multiplyScalar(0.6 * scale);
  for (let i = 0; i < 70; i++) {
    randomUnit(_v).multiplyScalar(rand(0.8, 2.6) * scale).addScaledVector(n, rand(1, 4) * scale);
    spawn(pos, _v, pick([[1, 0.8, 0.3], [1, 0.95, 0.7], [1, 0.6, 0.2]]), 0.56 * scale, rand(1, 2), _g, 1.6, true);
  }
}

const rockets = [];
function launch(lat, lng, opts = {}) {
  const scale = opts.scale || fxScale();
  const start = globe.getCoords(lat, lng, 0.004);
  const n = new THREE.Vector3(start.x, start.y, start.z).normalize();
  const height = rand(5, 8) * scale + 1.5;
  rockets.push({
    pos: new THREE.Vector3(start.x, start.y, start.z),
    n,
    speed: height / 0.9,
    t: 0,
    fuse: 0.9,
    delay: opts.delay || 0,
    type: opts.type || pick(CRACKER_TYPES),
    colA: opts.colA || pick(COLORS),
    colB: opts.colB || pick(COLORS),
    scale,
  });
}

let lastT = performance.now();
let simRunning = true;
function simulate() {
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  // rockets
  for (let i = rockets.length - 1; i >= 0; i--) {
    const r = rockets[i];
    if (r.delay > 0) { r.delay -= dt; continue; }
    r.t += dt;
    r.pos.addScaledVector(r.n, r.speed * dt * (1.2 - r.t / r.fuse * 0.6));
    _g.set(0, 0, 0);
    for (let k = 0; k < 2; k++) {
      randomUnit(_v).multiplyScalar(0.6 * r.scale).addScaledVector(r.n, -2 * r.scale);
      spawn(r.pos, _v, [1, 0.75, 0.35], 0.35 * r.scale, rand(0.25, 0.5), _g, 3, false);
    }
    if (r.t >= r.fuse) {
      explode(r.pos, r.n, r.type, r.scale, r.colA, r.colB);
      rockets.splice(i, 1);
    }
  }

  // particles
  for (let i = 0; i < MAXP; i++) {
    if (pLife[i] <= 0) { if (pAlpha[i] !== 0) pAlpha[i] = 0; continue; }
    pLife[i] -= dt;
    if (pLife[i] <= 0) { pAlpha[i] = 0; continue; }
    const i3 = i * 3;
    const k = Math.max(0, 1 - pDrag[i] * dt);
    pVel[i3] = pVel[i3] * k + pGrav[i3] * dt;
    pVel[i3 + 1] = pVel[i3 + 1] * k + pGrav[i3 + 1] * dt;
    pVel[i3 + 2] = pVel[i3 + 2] * k + pGrav[i3 + 2] * dt;
    pPos[i3] += pVel[i3] * dt;
    pPos[i3 + 1] += pVel[i3 + 1] * dt;
    pPos[i3 + 2] += pVel[i3 + 2] * dt;
    const f = pLife[i] / pMax[i];
    let a = Math.pow(f, 1.4);
    if (pFlick[i] && Math.random() < 0.35) a *= 0.2;
    pAlpha[i] = a;
  }
  pGeo.attributes.position.needsUpdate = true;
  pGeo.attributes.color.needsUpdate = true;
  pGeo.attributes.aSize.needsUpdate = true;
  pGeo.attributes.aAlpha.needsUpdate = true;

  updateCityMarkers(now / 1000);
  if (simRunning) requestAnimationFrame(simulate);
}

function updatePointScale() {
  const h = renderer.domElement.height;
  pMat.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}

// ============================================================
// City markers (diyas on the globe)
// ============================================================
function diyaTexture() {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 160;
  const g = c.getContext('2d');
  g.translate(64, 112);
  // bowl
  const body = new Path2D();
  body.moveTo(-50, 0);
  body.bezierCurveTo(-46, 28, -20, 42, 0, 42);
  body.bezierCurveTo(20, 42, 46, 28, 50, 0);
  body.closePath();
  const gr = g.createLinearGradient(0, 0, 0, 42);
  gr.addColorStop(0, '#ff9a3c'); gr.addColorStop(1, '#8a2f05');
  g.fillStyle = gr; g.fill(body);
  g.fillStyle = '#ffe9a3';
  for (let i = -3; i <= 3; i++) { g.beginPath(); g.arc(i * 12, 18 + (i * i) * 0.25, 2.6, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#3a1606';
  g.beginPath(); g.ellipse(0, 0, 50, 10, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ffd977'; g.lineWidth = 3; g.stroke();
  const oil = g.createRadialGradient(0, 0, 1, 0, 0, 42);
  oil.addColorStop(0, 'rgba(255,200,90,0.9)'); oil.addColorStop(1, 'rgba(160,80,10,0.2)');
  g.fillStyle = oil; g.beginPath(); g.ellipse(0, 1, 42, 7, 0, 0, Math.PI * 2); g.fill();
  // flame
  const f = new Path2D();
  f.moveTo(0, -100);
  f.bezierCurveTo(12, -66, 24, -38, 18, -14);
  f.quadraticCurveTo(0, 6, -18, -14);
  f.bezierCurveTo(-24, -38, -12, -66, 0, -100);
  const fg = g.createRadialGradient(0, -22, 0, 0, -34, 70);
  fg.addColorStop(0, '#fffbe6'); fg.addColorStop(0.3, '#ffe27a'); fg.addColorStop(0.6, '#ffa52e'); fg.addColorStop(1, 'rgba(255,70,0,0.6)');
  g.fillStyle = fg; g.fill(f);
  const core = g.createRadialGradient(0, -26, 0, 0, -26, 16);
  core.addColorStop(0, 'rgba(255,255,255,0.95)'); core.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = core; g.beginPath(); g.ellipse(0, -26, 9, 18, 0, 0, Math.PI * 2); g.fill();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,210,120,1)');
  gr.addColorStop(0.2, 'rgba(255,160,60,0.55)');
  gr.addColorStop(0.55, 'rgba(255,110,30,0.12)');
  gr.addColorStop(1, 'rgba(255,90,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const DIYA_TEX = diyaTexture();
const GLOW_TEX = glowTexture();

const cities = new Map(); // key -> cluster
function cityKey(city, cc, lat, lng) {
  return city ? (city.toLowerCase() + '|' + (cc || '')) : ('@' + Math.round(lat * 2) / 2 + ',' + Math.round(lng * 2) / 2);
}
function makeMarker(cluster) {
  const group = new THREE.Group();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: GLOW_TEX, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
  const diya = new THREE.Sprite(new THREE.SpriteMaterial({ map: DIYA_TEX, depthWrite: false, transparent: true }));
  diya.center.set(0.5, 0.12);
  group.add(glow, diya);
  group.userData = { glow, diya, phase: Math.random() * 10 };
  cluster.obj = group;
  return group;
}

globe
  .customThreeObject((d) => d.obj || makeMarker(d))
  .customThreeObjectUpdate((obj, d) => {
    const c = globe.getCoords(d.lat, d.lng, 0.002);
    obj.position.set(c.x, c.y, c.z);
  })
  .onCustomLayerHover((d) => showTooltip(d))
  .onCustomLayerClick((d) => showTooltip(d, true));

function updateCityMarkers(t) {
  const dist = camDist() - R;
  const base = clamp(dist / 60, 0.25, 4.5);
  for (const c of cities.values()) {
    if (!c.obj) continue;
    const { glow, diya, phase } = c.obj.userData;
    const flick = 1 + 0.08 * Math.sin(t * 7 + phase) + 0.05 * Math.sin(t * 13 + phase * 2);
    const weight = 1 + Math.log2(1 + c.diyas) * 0.35;
    const pop = c.popUntil && t < c.popUntil ? 1 + 0.6 * Math.sin(((c.popUntil - t) / 1.2) * Math.PI) : 1;
    const s = base * weight * pop;
    diya.visible = c.diyas > 0;
    diya.scale.set(s * 1.6, s * 2.0 * (0.97 + 0.03 * flick), 1);
    glow.scale.set(s * 4.5 * flick, s * 4.5 * flick, 1);
    glow.material.opacity = (c.diyas > 0 ? 0.75 : 0.45) * flick;
  }
}

let cityListTimer = null;
function refreshCities() {
  clearTimeout(cityListTimer);
  cityListTimer = setTimeout(() => globe.customLayerData([...cities.values()]), 60);
}

// ============================================================
// Events (Nostr)
// ============================================================
const seen = new Set();
const crackerPool = []; // past crackers, replayed as ambient bursts
let totals = { diyas: 0, crackers: 0 };
let initialDone = false;
const loadTime = Date.now() / 1000;

function parse(ev) {
  if (!ev || ev.kind !== KIND || typeof ev.content !== 'string') return null;
  if (!Array.isArray(ev.tags) || !ev.tags.some((t) => t[0] === 't' && t[1] === TAG)) return null;
  let c; try { c = JSON.parse(ev.content); } catch { return null; }
  if (!c || (c.t !== 'd' && c.t !== 'c')) return null;
  const lat = Number(c.la), lng = Number(c.lo);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return {
    id: ev.id, pub: ev.pubkey, type: c.t,
    name: clean(c.n, 24) || 'Someone',
    wish: clean(c.w, 100),
    city: clean(c.city, 40),
    cc: /^[A-Z]{2}$/.test(c.cc) ? c.cc : '',
    lat, lng,
    kind: CRACKER_TYPES.includes(c.k) ? c.k : null,
    created: Math.min(ev.created_at | 0, Math.floor(Date.now() / 1000) + 60),
  };
}

function ingest(ev, local = false) {
  if (!ev || seen.has(ev.id)) return;
  const e = parse(ev);
  if (!e) return;
  seen.add(e.id);
  const key = cityKey(e.city, e.cc, e.lat, e.lng);
  let c = cities.get(key);
  if (!c) {
    c = { key, city: e.city, cc: e.cc, lat: e.lat, lng: e.lng, diyas: 0, crackers: 0, wishes: [], n: 0 };
    cities.set(key, c);
  }
  // running average keeps the marker centred on the city
  c.n++; c.lat += (e.lat - c.lat) / c.n; c.lng += (e.lng - c.lng) / c.n;
  if (e.type === 'd') {
    c.diyas++; totals.diyas++;
    if (e.wish || e.name) { c.wishes.push(e); c.wishes.sort((a, b) => b.created - a.created); c.wishes.length = Math.min(c.wishes.length, 6); }
  } else {
    c.crackers++; totals.crackers++;
    crackerPool.push(e);
    if (crackerPool.length > 2000) crackerPool.shift();
  }
  refreshCities();
  updateStats();

  const live = local || (initialDone && !document.hidden && e.created >= loadTime - 30);
  if (!live) return;
  const jl = e.lat + rand(-0.15, 0.15), jg = e.lng + rand(-0.15, 0.15);
  if (e.type === 'c') {
    if (local) {
      // your own cracker is the hero: a bigger volley right above your city
      const s = Math.max(fxScale(), 1.5) * 1.8;
      launch(jl, jg, { type: e.kind || undefined, scale: s });
      launch(jl + rand(-0.4, 0.4), jg + rand(-0.4, 0.4), { delay: 0.35, scale: s * 0.8 });
      launch(jl + rand(-0.4, 0.4), jg + rand(-0.4, 0.4), { delay: 0.7, scale: s * 0.9 });
    } else {
      launch(jl, jg, { type: e.kind || undefined });
      if (Math.random() < 0.5) launch(jl + rand(-0.2, 0.2), jg + rand(-0.2, 0.2), { delay: rand(0.2, 0.6) });
    }
  } else {
    c.popUntil = performance.now() / 1000 + 1.2;
    const p = globe.getCoords(e.lat, e.lng, 0.006);
    const pos = new THREE.Vector3(p.x, p.y, p.z);
    sparkle(pos, pos.clone().normalize(), fxScale());
    addRing(e.lat, e.lng);
  }
  if (!local && e.pub !== myPub) toast(e);
}

let ringsArr = [];
function addRing(lat, lng) {
  const r = { lat, lng, until: Date.now() + 3500 };
  ringsArr = ringsArr.filter((x) => x.until > Date.now()).concat(r);
  globe.ringsData(ringsArr);
  setTimeout(() => { ringsArr = ringsArr.filter((x) => x.until > Date.now()); globe.ringsData(ringsArr); }, 3600);
}
globe
  .ringColor(() => (t) => `rgba(255,190,90,${Math.max(0, 1 - t)})`)
  .ringMaxRadius(3.5)
  .ringPropagationSpeed(2.5)
  .ringRepeatPeriod(700)
  .ringAltitude(0.003);

let eose = 0;
const acks = new Map();
class Relay {
  constructor(url) { this.url = url; this.open = false; this.backoff = 1500; this.queue = []; this.connect(); }
  connect() {
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.open = true; this.backoff = 1500; updateNet();
      ws.send(JSON.stringify(['REQ', 'dg', { kinds: [KIND], '#t': [TAG], limit: 3000 }]));
      const q = this.queue; this.queue = []; q.forEach((m) => ws.send(m));
    };
    ws.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d[0] === 'EVENT' && d[1] === 'dg') ingest(d[2]);
      else if (d[0] === 'EOSE' && d[1] === 'dg') { eose++; if (eose === 1) setTimeout(() => { initialDone = true; }, 800); }
      else if (d[0] === 'OK' && acks.has(d[1]) && d[2]) { acks.set(d[1], acks.get(d[1]) + 1); $('warn').hidden = true; }
    };
    ws.onclose = () => { this.open = false; updateNet(); this.retry(); };
    ws.onerror = () => {};
  }
  retry() { setTimeout(() => this.connect(), this.backoff); this.backoff = Math.min(this.backoff * 2, 30000); }
  send(m) { if (this.open && this.ws.readyState === 1) this.ws.send(m); else this.queue.push(m); }
}
const relays = RELAYS.map((u) => new Relay(u));
setTimeout(() => { initialDone = true; }, 5000);

function updateNet() {
  $('netDot').classList.toggle('on', relays.some((r) => r.open));
}

function publish(content) {
  const ev = finalizeEvent({
    kind: KIND,
    created_at: Math.floor(Date.now() / 1000),
    tags: [['t', TAG], ['client', 'diwali-globe']],
    content: JSON.stringify(content),
  }, secret);
  acks.set(ev.id, 0);
  const msg = JSON.stringify(['EVENT', ev]);
  relays.forEach((r) => r.send(msg));
  setTimeout(() => {
    if (acks.get(ev.id) === 0) {
      $('warn').textContent = 'Having trouble reaching the network. It will send once you are back online.';
      $('warn').hidden = false;
    }
  }, 9000);
  return ev;
}

// Ambient: replay real crackers people burst earlier, so the sky stays alive
(function ambient() {
  if (!document.hidden && initialDone && crackerPool.length && !reduceMotion) {
    const e = pick(crackerPool);
    launch(e.lat + rand(-0.25, 0.25), e.lng + rand(-0.25, 0.25), { type: e.kind || undefined });
  }
  const busy = Math.min(crackerPool.length, 60);
  setTimeout(ambient, rand(2600, 4200) - busy * 30);
})();

// ============================================================
// Location
// ============================================================
let me = null; // {city, cc, lat, lng, src}
async function getJSON(url, ms = 4500) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try { const r = await fetch(url, { signal: ctl.signal }); if (!r.ok) throw new Error(r.status); return await r.json(); }
  finally { clearTimeout(t); }
}
async function detectLocation() {
  const saved = store.get('dg.loc', null);
  if (saved && Number.isFinite(saved.lat) && saved.src === 'gps') return saved;
  try {
    const d = await getJSON('https://get.geojs.io/v1/ip/geo.json');
    const lat = parseFloat(d.latitude), lng = parseFloat(d.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { city: d.city || d.region || '', cc: (d.country_code || '').toUpperCase(), lat, lng, src: 'ip' };
  } catch { /* try next */ }
  try {
    const d = await getJSON('https://ipwho.is/');
    if (d.success !== false && Number.isFinite(d.latitude)) return { city: d.city || d.region || '', cc: (d.country_code || '').toUpperCase(), lat: d.latitude, lng: d.longitude, src: 'ip' };
  } catch { /* fall back */ }
  if (saved && Number.isFinite(saved.lat)) return saved;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  if (/Calcutta|Kolkata/.test(tz)) return { city: 'India', cc: 'IN', lat: 22.5, lng: 79, src: 'tz' };
  return { city: '', cc: '', lat: 20, lng: 0, src: 'none' };
}
async function preciseLocation() {
  const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: false, timeout: 12000 }));
  const lat = pos.coords.latitude, lng = pos.coords.longitude;
  let city = '', cc = '';
  try {
    const d = await getJSON(`https://api-bdc.io/data/reverse-geocode-client?latitude=${lat}&longitude=${lng}&localityLanguage=en`);
    city = d.city || d.locality || d.principalSubdivision || '';
    cc = (d.countryCode || '').toUpperCase();
  } catch { /* coordinates only */ }
  return { city, cc, lat: round1(lat), lng: round1(lng), src: 'gps' };
}
function placeLabel(l) {
  if (!l) return 'Locating…';
  if (!l.city && !l.cc) return 'Somewhere on Earth';
  const country = countryName(l.cc);
  return `${flag(l.cc)} ${[l.city, country].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}`;
}
function setMe(l) {
  me = { ...l, lat: round1(l.lat), lng: round1(l.lng) };
  store.set('dg.loc', me);
  $('locLabel').textContent = placeLabel(me);
}

$('locFix').addEventListener('click', async () => {
  if (!navigator.geolocation) { alert('Location is not available in this browser.'); return; }
  $('locLabel').textContent = '📍 Asking for location…';
  try {
    setMe(await preciseLocation());
    flyToMe(1800);
    toastText(`📍 Moved you to <b>${escapeHtml(me.city || 'your spot')}</b>. Only your city is shared, never your exact location.`);
  } catch {
    $('locLabel').textContent = placeLabel(me);
    toastText('Could not get your location. Using your approximate city.');
  }
});

// ============================================================
// Camera choreography
// ============================================================
function flyToMe(ms = 2200) {
  if (!me) return;
  controls.autoRotate = false;
  globe.pointOfView({ lat: me.lat, lng: me.lng, altitude: 0.5 }, ms);
}
function pullBack() {
  if (!me) return;
  controls.autoRotate = false;
  if (altitude() < 1.0) globe.pointOfView({ lat: me.lat - 9, lng: me.lng, altitude: 1.25 }, 1500);
}
$('camMe').addEventListener('click', () => flyToMe(1500));
$('camIndia').addEventListener('click', () => { controls.autoRotate = false; globe.pointOfView(INDIA, 1500); });
$('camWorld').addEventListener('click', () => {
  globe.pointOfView({ lat: me ? me.lat : 20, lng: me ? me.lng : 60, altitude: 2.6 }, 1500);
  setTimeout(() => { controls.autoRotate = !reduceMotion; controls.autoRotateSpeed = 0.6; }, 1600);
});
// any user drag stops the spin
renderer.domElement.addEventListener('pointerdown', () => { controls.autoRotate = false; hideTooltip(); });

async function intro() {
  const started = performance.now();
  const loc = await detectLocation();
  setMe(loc);
  const minSpin = reduceMotion ? 0 : 3200;
  await sleep(Math.max(0, minSpin - (performance.now() - started)));
  const label = me.city || countryName(me.cc) || 'your corner of the world';
  $('introText').textContent = `✨ Diwali in ${label}…`;
  controls.autoRotate = false;
  if (reduceMotion) {
    globe.pointOfView({ lat: me.lat, lng: me.lng, altitude: 0.5 }, 0);
  } else {
    globe.pointOfView({ lat: me.lat, lng: me.lng, altitude: 2.3 }, 2000);
    await sleep(2000);
    globe.pointOfView({ lat: me.lat, lng: me.lng, altitude: 0.5 }, 2600);
    await sleep(2600);
  }
  $('intro').classList.add('gone');
  setTimeout(() => $('intro').remove(), 900);
  if (!nameInput.value) nameInput.focus({ preventScroll: true });
}

// ============================================================
// Actions
// ============================================================
const nameInput = $('nameInput'), wishInput = $('wishInput');
nameInput.value = store.get('dg.name', '');
function needName() {
  const name = clean(nameInput.value, 24);
  if (name) { store.set('dg.name', name); return name; }
  nameInput.classList.remove('shake'); void nameInput.offsetWidth; nameInput.classList.add('shake');
  nameInput.focus();
  return null;
}
let lastAction = 0;
function canAct(gap) { const t = Date.now(); if (t - lastAction < gap) return false; lastAction = t; return true; }

$('diyaBtn').addEventListener('click', () => {
  const name = needName();
  if (!name || !me || !canAct(4000)) return;
  ensureAudio();
  const ev = publish({ t: 'd', n: name, w: clean(wishInput.value, 100), city: me.city, cc: me.cc, la: me.lat, lo: me.lng });
  wishInput.value = '';
  pullBack();
  setTimeout(() => { ingest(ev, true); chime(); }, altitude() < 1.0 ? 900 : 100);
  toastText(`🪔 Your diya is glowing in <b>${escapeHtml(me.city || 'your city')}</b>!`);
});
$('crackerBtn').addEventListener('click', () => {
  if (!me || !canAct(1200)) return;
  const name = clean(nameInput.value, 24) || store.get('dg.name', '') || 'Someone';
  ensureAudio();
  const k = pick(CRACKER_TYPES);
  const ev = publish({ t: 'c', n: name, city: me.city, cc: me.cc, la: me.lat, lo: me.lng, k });
  const wasClose = altitude() < 1.0;
  pullBack();
  setTimeout(() => { ingest(ev, true); boom(1.0); }, wasClose ? 700 : 0);
});

// ============================================================
// UI bits
// ============================================================
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function updateStats() {
  $('diyaCount').textContent = totals.diyas.toLocaleString();
  $('diyaLabel').textContent = totals.diyas === 1 ? 'diya' : 'diyas';
  $('crackerLabel').textContent = totals.crackers === 1 ? 'cracker' : 'crackers';
  $('cityLabel').textContent = cities.size === 1 ? 'city' : 'cities';
  $('crackerCount').textContent = totals.crackers.toLocaleString();
  $('cityCount').textContent = cities.size.toLocaleString();
}

function toast(e) {
  const where = e.city || countryName(e.cc) || 'somewhere';
  const msg = e.type === 'd'
    ? `🪔 <b>${escapeHtml(e.name)}</b> lit a diya in ${escapeHtml(where)}${e.wish ? ': “' + escapeHtml(e.wish) + '”' : ''}`
    : `🎆 <b>${escapeHtml(e.name)}</b> burst a cracker in ${escapeHtml(where)}`;
  toastText(msg);
}
function toastText(html) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = html;
  const box = $('toasts');
  box.prepend(el);
  while (box.children.length > 3) box.lastChild.remove();
  setTimeout(() => el.remove(), 4200);
}

let mouse = { x: innerWidth / 2, y: innerHeight / 2 };
addEventListener('pointermove', (e) => { mouse = { x: e.clientX, y: e.clientY }; if (!tip.hidden) placeTip(); });
const tip = $('tooltip');
let tipPinned = false;
function showTooltip(c, pin = false) {
  if (!c) { if (!tipPinned) hideTooltip(); return; }
  tipPinned = pin;
  const where = [c.city, countryName(c.cc)].filter((x, i, a) => x && a.indexOf(x) === i).join(', ') || 'Somewhere';
  let html = `<div class="city">${flag(c.cc)} ${escapeHtml(where)}</div><div class="counts">🪔 ${c.diyas} diya${c.diyas === 1 ? '' : 's'} · 🎆 ${c.crackers} cracker${c.crackers === 1 ? '' : 's'}</div>`;
  for (const w of c.wishes.slice(0, 4)) html += `<div class="wish"><b>${escapeHtml(w.name)}</b>${w.wish ? ': ' + escapeHtml(w.wish) : ' lit a diya'}</div>`;
  tip.innerHTML = html;
  tip.hidden = false;
  placeTip();
}
function hideTooltip() { tip.hidden = true; tipPinned = false; }
function placeTip() {
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = clamp(mouse.x, w / 2 + 8, innerWidth - w / 2 - 8) + 'px';
  tip.style.top = Math.max(mouse.y, h + 24) + 'px';
}

// Share
const shareText = () => `🪔 Light up your city this Diwali! I just lit a diya${me && me.city ? ' in ' + me.city : ''}. Come burst a cracker above your city and watch the whole world glow ✨\n${shareUrl()}`;
$('waBtn').addEventListener('click', () => { $('waBtn').href = 'https://wa.me/?text=' + encodeURIComponent(shareText()); });
$('waBtn').href = 'https://wa.me/?text=' + encodeURIComponent(shareText());
$('copyBtn').addEventListener('click', async () => {
  const url = shareUrl();
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: 'Diwali Globe', text: 'Light up your city this Diwali 🪔', url }); return; }
    await navigator.clipboard.writeText(url);
    $('copyBtn').textContent = 'Copied ✓';
    setTimeout(() => { $('copyBtn').textContent = 'Copy link'; }, 1800);
  } catch { prompt('Copy this link:', url); }
});

// ============================================================
// Sound (WebAudio, generated, no files)
// ============================================================
let muted = store.get('dg.muted', false);
const muteBtn = $('muteBtn');
const syncMute = () => { muteBtn.textContent = muted ? '🔇' : '🔊'; };
syncMute();
muteBtn.addEventListener('click', () => { muted = !muted; store.set('dg.muted', muted); syncMute(); });
let ac = null;
function ensureAudio() {
  try { if (!ac) ac = new (window.AudioContext || window.webkitAudioContext)(); if (ac.state === 'suspended') ac.resume(); } catch { ac = null; }
}
function noiseBuffer(sec) {
  const b = ac.createBuffer(1, ac.sampleRate * sec, ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
function boom(delaySec) {
  if (muted || !ac) return;
  const t0 = ac.currentTime + delaySec;
  // whistle up
  const o = ac.createOscillator(), og = ac.createGain();
  o.type = 'sine'; o.frequency.setValueAtTime(700, ac.currentTime); o.frequency.exponentialRampToValueAtTime(2400, t0);
  og.gain.setValueAtTime(0.0001, ac.currentTime); og.gain.exponentialRampToValueAtTime(0.04, ac.currentTime + 0.1); og.gain.exponentialRampToValueAtTime(0.0001, t0);
  o.connect(og).connect(ac.destination); o.start(); o.stop(t0 + 0.05);
  // bang
  const n = ac.createBufferSource(); n.buffer = noiseBuffer(1.6);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t0); lp.frequency.exponentialRampToValueAtTime(120, t0 + 1.2);
  const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.8, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.5);
  n.connect(lp).connect(g).connect(ac.destination); n.start(t0);
  // crackle
  const cr = ac.createBufferSource(); cr.buffer = noiseBuffer(1.2);
  const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 3000;
  const cg = ac.createGain(); cg.gain.setValueAtTime(0.0001, t0 + 0.25);
  for (let i = 0; i < 14; i++) { const tt = t0 + 0.3 + i * rand(0.04, 0.09); cg.gain.setValueAtTime(rand(0.05, 0.18), tt); cg.gain.setValueAtTime(0.0001, tt + 0.015); }
  cr.connect(hp).connect(cg).connect(ac.destination); cr.start(t0 + 0.25);
}
function chime() {
  if (muted || !ac) return;
  const t0 = ac.currentTime;
  [[880, 0.16], [1320, 0.09], [1760, 0.05], [2640, 0.025]].forEach(([f, v], i) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + 0.02 + i * 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + 2.3);
  });
}

// ============================================================
// Boot
// ============================================================
function onResize() {
  globe.width(innerWidth).height(innerHeight);
  // keep the globe centred in the space between header and panel
  const top = $('header').getBoundingClientRect().bottom;
  const bottom = innerHeight - $('panel').getBoundingClientRect().top;
  globe.globeOffset([0, (top - bottom) / 2]);
  updatePointScale();
  $('toasts').style.top = ($('header').getBoundingClientRect().bottom + 6) + 'px';
}
addEventListener('resize', onResize);
if (document.fonts && document.fonts.ready) document.fonts.ready.then(onResize);
onResize();
requestAnimationFrame(simulate);
document.addEventListener('visibilitychange', () => { if (!document.hidden) lastT = performance.now(); });
intro();

// Debug hook for automated checks
window.__dg = { cities, totals, launch, get me() { return me; }, altitude };
