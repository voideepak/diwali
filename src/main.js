import * as THREE from 'three';
import Globe from 'globe.gl';
import { generateSecretKey, getPublicKey, finalizeEvent, verifyEvent } from 'nostr-tools/pure';

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
// Diyas we lit ourselves so the map isn't empty on day one. They are shown
// openly as "Diwali Globe", never as a person, and never as live activity.
const SEED_PUB = 'e71e1112f305b995f27be836891f5ced625b3f4359d25eb531085c3eb2645564';
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
// Picker choices. Colour is an index into COLORS (null = mixed); height 0 small, 1 medium, 2 large.
const COLOR_NAMES = ['Rose', 'Gold', 'Sky blue', 'Violet', 'Green', 'Orange', 'White'];
const LIFT = [0.55, 1, 1.65]; // how high the shell climbs
const SPREAD = [0.75, 1, 1.3]; // how wide it bursts
const tint = (c, k) => c.map((x) => x + (1 - x) * k); // towards white

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
  .backgroundImageUrl('img/night-sky.png')
  .atmosphereColor('#5d7fc4')
  .atmosphereAltitude(0.13)
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

const mat = globe.globeMaterial();
mat.color = new THREE.Color(0x05080f); mat.shininess = 0; mat.specular = new THREE.Color(0x000000);

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
  if (!opts.force && rockets.length > 80) return; // sky is full; keep phones smooth
  const scale = (opts.scale || fxScale()) * (opts.spread || 1);
  const start = globe.getCoords(lat, lng, 0.004);
  const n = new THREE.Vector3(start.x, start.y, start.z).normalize();
  const height = (rand(5, 8) * scale + 1.5) * (opts.lift || 1);
  const fuse = opts.fuse || 0.9;
  rockets.push({
    pos: new THREE.Vector3(start.x, start.y, start.z),
    n,
    speed: height / fuse,
    t: 0,
    fuse,
    snd: opts.snd || 0,
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
    if (r.t === 0 && r.snd) { playWhistle(r.fuse, r.snd); r.clip = playFirework(r.fuse, r.snd); }
    r.t += dt;
    r.pos.addScaledVector(r.n, r.speed * dt * (1.2 - r.t / r.fuse * 0.6));
    _g.set(0, 0, 0);
    for (let k = 0; k < 2; k++) {
      randomUnit(_v).multiplyScalar(0.6 * r.scale).addScaledVector(r.n, -2 * r.scale);
      spawn(r.pos, _v, [1, 0.75, 0.35], 0.35 * r.scale, rand(0.25, 0.5), _g, 3, false);
    }
    if (r.t >= r.fuse) {
      explode(r.pos, r.n, r.type, r.scale, r.colA, r.colB);
      if (r.snd) playBoom(r.snd, r.type, r.clip);
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
  dMat.uniforms.uScale.value = pMat.uniforms.uScale.value = h / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)));
}

// ============================================================
// Map: a blank night globe with just coastlines, borders and Indian states
// ============================================================
const OCEAN = '#03050b', LAND = '#111a2e';
function drawLand(geo) {
  const W = Math.min(8192, renderer.capabilities.maxTextureSize || 4096), H = W / 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = OCEAN; g.fillRect(0, 0, W, H);
  const X = (v) => ((v / 100 + 180) / 360) * W, Y = (v) => ((90 - v / 100) / 180) * H;
  g.fillStyle = LAND;
  for (const poly of geo.land) {
    g.beginPath();
    for (const ring of poly) {
      for (let i = 0; i < ring.length; i += 2) (i ? g.lineTo : g.moveTo).call(g, X(ring[i]), Y(ring[i + 1]));
      g.closePath();
    }
    g.fill('evenodd');
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const m = globe.globeMaterial();
  m.map = t; m.color = new THREE.Color(0xffffff); m.needsUpdate = true;
}
function lineLayer(list, color, opacity, alt) {
  const pts = [];
  const r = R * (1 + alt);
  for (const line of list) {
    for (let i = 0; i + 3 < line.length; i += 2) {
      for (const j of [i, i + 2]) {
        const lat = (line[j + 1] / 100) * Math.PI / 180, lng = (line[j] / 100) * Math.PI / 180;
        // same axes as globe.gl's getCoords
        pts.push(r * Math.cos(lat) * Math.sin(lng), r * Math.sin(lat), r * Math.cos(lat) * Math.cos(lng));
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const ls = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  ls.renderOrder = 1;
  scene.add(ls);
  return ls;
}
fetch('data/geo.json').then((r) => r.json()).then((geo) => {
  drawLand(geo);
  lineLayer(geo.coast, 0x8fa6cf, 0.55, 0.0008);
  lineLayer(geo.borders, 0x9fb3d9, 0.42, 0.0009);
  lineLayer(geo.states, 0x7f93b8, 0.22, 0.0008);
}).catch(() => {});

// ============================================================
// Diyas: every diya ever lit is one small warm dot on the map
// ============================================================
let dotCap = 4096, dotN = 0;
let dPos = new Float32Array(dotCap * 3), dSeed = new Float32Array(dotCap), dBorn = new Float32Array(dotCap);
const dGeo = new THREE.BufferGeometry();
const dMat = new THREE.ShaderMaterial({
  uniforms: { uScale: { value: 800 }, uTime: { value: 0 } },
  vertexShader: `
    attribute float aSeed; attribute float aBorn;
    uniform float uScale; uniform float uTime;
    varying float vFlick; varying float vNew;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      float age = uTime - aBorn;
      vNew = age < 3.0 ? 1.0 - age / 3.0 : 0.0;
      vFlick = 0.85 + 0.1 * sin(uTime * 6.0 + aSeed * 40.0) + 0.05 * sin(uTime * 11.0 + aSeed * 90.0);
      // a real-world-sized light (~25 km halo) that never shrinks below a few pixels
      gl_PointSize = clamp(0.9 * uScale / -mv.z, 9.0, 48.0) * (1.0 + 2.0 * vNew);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: `
    varying float vFlick; varying float vNew;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      float core = exp(-d * d * 40.0);
      float halo = exp(-d * d * 6.0) * 0.45;
      vec3 col = mix(vec3(1.0, 0.55, 0.16), vec3(1.0, 0.93, 0.75), core);
      float a = (core + halo) * vFlick;
      gl_FragColor = vec4(col * a * (1.0 + vNew), 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
function bindDots() {
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  dGeo.setAttribute('aSeed', new THREE.BufferAttribute(dSeed, 1));
  dGeo.setAttribute('aBorn', new THREE.BufferAttribute(dBorn, 1));
}
bindDots();
dGeo.setDrawRange(0, 0);
const dots = new THREE.Points(dGeo, dMat);
dots.frustumCulled = false;
dots.renderOrder = 5;
scene.add(dots);

// Stable pseudo-random from the event id, so everyone sees the same dot in the same place
function hash01(s, salt) {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
function addDot(e, fresh) {
  if (dotN >= dotCap) {
    dotCap *= 2;
    const grow = (a, n) => { const b = new Float32Array(dotCap * n); b.set(a); return b; };
    dPos = grow(dPos, 3); dSeed = grow(dSeed, 1); dBorn = grow(dBorn, 1);
    bindDots();
  }
  // scatter around the city (~1–25 km) so a busy city fills in like a real city at night
  const ang = hash01(e.id, 1) * Math.PI * 2, rad = 0.02 + Math.pow(hash01(e.id, 2), 0.7) * 0.2;
  const lat = e.lat + Math.sin(ang) * rad, lng = e.lng + (Math.cos(ang) * rad) / Math.max(0.3, Math.cos(e.lat * Math.PI / 180));
  const p = globe.getCoords(lat, lng, 0.0012);
  dPos.set([p.x, p.y, p.z], dotN * 3);
  dSeed[dotN] = hash01(e.id, 3);
  dBorn[dotN] = fresh ? performance.now() / 1000 : -10;
  dotN++;
  for (const k of ['position', 'aSeed', 'aBorn']) dGeo.attributes[k].needsUpdate = true;
  dGeo.setDrawRange(0, dotN);
  return { lat, lng };
}

const cities = new Map(); // key -> cluster (for hover, wishes and the leaderboard)
function cityKey(city, cc, lat, lng) {
  return city ? (city.toLowerCase() + '|' + (cc || '')) : ('@' + Math.round(lat * 2) / 2 + ',' + Math.round(lng * 2) / 2);
}
// invisible hover target per city
const HIT_GEO = new THREE.SphereGeometry(1, 8, 6);
const HIT_MAT = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
function makeMarker(cluster) {
  const m = new THREE.Mesh(HIT_GEO, HIT_MAT);
  cluster.obj = m;
  return m;
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
  dMat.uniforms.uTime.value = t;
  const s = clamp((camDist() - R) / 40, 0.6, 6);
  for (const c of cities.values()) if (c.obj) c.obj.scale.setScalar(s);
}


// Throttled (not debounced), so a steady stream of events still refreshes the UI
let cityListTimer = null;
let cracklePool = []; // cities weighted by crackers, for the ambient show
function refreshCities() {
  if (cityListTimer) return;
  cityListTimer = setTimeout(() => {
    cityListTimer = null;
    const all = [...cities.values()];
    globe.customLayerData(all);
    renderBoard();
    updateStats();
    cracklePool = all.filter((c) => c.crackers > 0).map((c) => ({ lat: c.lat, lng: c.lng, w: Math.sqrt(c.crackers) }));
    cracklePool.total = cracklePool.reduce((s, c) => s + c.w, 0);
  }, cities.size > 800 ? 600 : 150);
}

// Leaderboard: the cities glowing brightest (most diyas)
const boardList = $('boardList');
function renderBoard() {
  const ranked = [...cities.values()].filter((c) => c.diyas > 0)
    .sort((a, b) => b.diyas - a.diyas || b.crackers - a.crackers);
  const myKey = me ? cityKey(me.city, me.cc, me.lat, me.lng) : null;
  const top = ranked.slice(0, 7);
  const myRank = myKey ? ranked.findIndex((c) => c.key === myKey) : -1;
  const max = top.length ? top[0].diyas : 1;
  const row = (c, i) => `<li class="${c.key === myKey ? 'me' : ''}" data-key="${escapeHtml(c.key)}">
    <span class="rank">${String(i + 1).padStart(2, '0')}</span>
    <span class="name">${escapeHtml(c.city || countryName(c.cc) || 'Somewhere')}${c.city && c.cc ? `<small>${escapeHtml(c.cc)}</small>` : ''}</span>
    <span class="n">${c.diyas.toLocaleString()}</span>
    <span class="bar" style="width:calc((100% - 50px) * ${Math.max(0.04, c.diyas / max).toFixed(3)})"></span></li>`;
  let html = top.map(row).join('');
  if (myRank >= 7) html += `<li class="gap">···</li>` + row(ranked[myRank], myRank);
  boardList.innerHTML = html;
  $('boardEmpty').hidden = ranked.length > 0;
}
boardList.addEventListener('click', (ev) => {
  const li = ev.target.closest('li[data-key]');
  const c = li && cities.get(li.dataset.key);
  if (!c) return;
  controls.autoRotate = false;
  globe.pointOfView({ lat: c.lat, lng: c.lng, altitude: 0.55 }, 1500);
  if (matchMedia('(max-width: 820px)').matches) $('board').classList.remove('open');
});
$('boardBtn').addEventListener('click', () => $('board').classList.toggle('open'));

// ============================================================
// Events (Nostr)
//
// Three kinds of message, all tagged with the room:
//   KIND        diya. Stored by relays; we page back through all of them.
//   KIND_LIVE   cracker. Ephemeral: relays pass it on to whoever is
//               listening but never store it, so crackers cannot crowd
//               diyas out of history.
//   KIND_TALLY  one replaceable message per person holding their running
//               cracker count per city. Relays keep only the newest, so
//               storage grows with people, not with crackers.
// ============================================================
const KIND_LIVE = 27462;
const KIND_TALLY = 37462;
const READERS = 3;          // listen to this many relays (write to all)
const PAGE = 500;           // history page size
const MAX_PAGES = 400;      // safety stop per relay (200k diyas)
const TALLY_CAP = 5000;     // max crackers one person can claim per city
const SKY_RPS = 6;          // remote rockets we launch per second, at most
const FX_RPS = 5;           // remote diya sparkles per second, at most

const seen = new Set();
let seenLive = new Set(), seenLiveOld = new Set(); // ephemeral ids, rotated so memory stays flat
setInterval(() => { seenLiveOld = seenLive; seenLive = new Set(); }, 120000);
const isSeen = (id) => seen.has(id) || seenLive.has(id) || seenLiveOld.has(id);
let totals = { diyas: 0, crackers: 0 };
let initialDone = false;
const loadTime = Date.now() / 1000;
const nowS = () => Math.floor(Date.now() / 1000);

function okLoc(c) {
  const lat = Number(c.la), lng = Number(c.lo);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng, city: clean(c.city, 40), cc: /^[A-Z]{2}$/.test(c.cc) ? c.cc : '' };
}
function parse(ev) {
  if (!ev || typeof ev.content !== 'string' || typeof ev.id !== 'string') return null;
  if (ev.kind !== KIND && ev.kind !== KIND_LIVE && ev.kind !== KIND_TALLY) return null;
  if (!Array.isArray(ev.tags) || !ev.tags.some((t) => t[0] === 't' && t[1] === TAG)) return null;
  let c; try { c = JSON.parse(ev.content); } catch { return null; }
  if (!c || typeof c !== 'object') return null;
  const created = Math.min(ev.created_at | 0, nowS() + 60);
  if (ev.kind === KIND_TALLY) {
    if (!ev.tags.some((t) => t[0] === 'd' && t[1] === TAG) || !Array.isArray(c.c)) return null;
    const rows = [];
    for (const r of c.c.slice(0, ev.pubkey === SEED_PUB ? 120 : 20)) {
      const loc = r && okLoc(r);
      const n = Math.floor(Number(r && r.n));
      if (loc && n > 0) rows.push({ ...loc, n: Math.min(n, TALLY_CAP) });
    }
    return { id: ev.id, pub: ev.pubkey, type: 't', rows, created };
  }
  if (c.t !== 'd' && c.t !== 'c') return null;
  const loc = okLoc(c);
  if (!loc) return null;
  return {
    id: ev.id, pub: ev.pubkey, type: c.t, eph: ev.kind === KIND_LIVE,
    seed: ev.pubkey === SEED_PUB,
    name: ev.pubkey === SEED_PUB ? 'Diwali Globe' : clean(c.n, 24) || 'Someone',
    wish: clean(c.w, 100),
    ...loc,
    kind: CRACKER_TYPES.includes(c.k) ? c.k : null,
    col: Number.isInteger(c.col) && c.col >= 0 && c.col < COLORS.length ? c.col : null,
    h: c.h === 0 || c.h === 2 ? c.h : 1,
    x: Math.floor(Number(c.x)) || 0,
    created,
  };
}

function cityFor(loc) {
  const key = cityKey(loc.city, loc.cc, loc.lat, loc.lng);
  let c = cities.get(key);
  if (!c) {
    c = { key, city: loc.city, cc: loc.cc, lat: loc.lat, lng: loc.lng, diyas: 0, crackers: 0, wishes: [], n: 0 };
    cities.set(key, c);
  }
  return c;
}

// Cracker counts: per person, per city, keep the highest running count we
// have heard (from a live cracker or from their tally). Taking the max makes
// it safe to hear the same thing from several relays, in any order.
const contrib = new Map(); // pub -> Map(cityKey -> n)
function addCrackers(pub, c, n) {
  let m = contrib.get(pub);
  if (!m) contrib.set(pub, (m = new Map()));
  const old = m.get(c.key) || 0;
  if (n <= old) return 0;
  m.set(c.key, n);
  c.crackers += n - old; totals.crackers += n - old;
  return n - old;
}

// My own running counts, so the next cracker carries the right number
const myCountsKey = 'dg.cx.' + room;
const myCounts = store.get(myCountsKey, {});

const pendingLocal = new Set(); // my own events, waiting for the camera to pull back
function ingest(ev, local = false) {
  if (!ev || isSeen(ev.id)) return;
  if (pendingLocal.has(ev.id) && !local) return; // relay echo beat us to it; the local copy plays the show
  pendingLocal.delete(ev.id);
  const e = parse(ev);
  if (!e) return;
  (e.eph ? seenLive : seen).add(e.id);

  if (e.type === 't') {
    for (const r of e.rows) {
      const c = cityFor(r);
      addCrackers(e.pub, c, r.n);
      if (e.pub === myPub) {
        const mine = myCounts[c.key];
        if (!mine || mine.n < r.n) myCounts[c.key] = { city: r.city, cc: r.cc, la: r.lat, lo: r.lng, n: r.n };
      }
    }
    if (e.pub === myPub) store.set(myCountsKey, myCounts);
    refreshCities();
    return;
  }

  const c = cityFor(e);
  // running average keeps the marker centred on the city
  c.n++; c.lat += (e.lat - c.lat) / c.n; c.lng += (e.lng - c.lng) / c.n;
  const live = local || (initialDone && !document.hidden && e.created >= loadTime - 30);
  let spot = null;
  if (e.type === 'd') {
    c.diyas++; totals.diyas++;
    spot = addDot(e, live);
    if (e.seed ? e.wish : (e.wish || e.name)) {
      // real people first; at most one line from the seed
      c.wishes.push(e);
      c.wishes.sort((a, b) => (a.seed - b.seed) || (b.created - a.created));
      const firstSeed = c.wishes.findIndex((w) => w.seed);
      c.wishes = c.wishes.filter((w, i) => !w.seed || i === firstSeed).slice(0, 6);
    }
  } else if (e.eph) {
    const had = (contrib.get(e.pub) || new Map()).get(c.key) || 0;
    addCrackers(e.pub, c, e.x > 0 ? Math.min(e.x, TALLY_CAP) : had + 1);
  } else {
    c.crackers++; totals.crackers++; // older clients stored each cracker
  }
  refreshCities();

  if (!live) return;
  if (local) { show(e, spot, c, true); return; }
  if (e.pub === myPub || e.seed) return;
  showQ.push({ e, spot, c, at: performance.now() });
  noteToast(e, c);
}

// ---------------------------------------------------------------
// The show. When the world is busy we cannot launch every rocket, so we
// launch a sample (cities you can see and cities near you first) and fold
// the rest into one bigger volley per city.
// ---------------------------------------------------------------
const showQ = [];
let skyTokens = SKY_RPS, fxTokens = FX_RPS;
const _cv = new THREE.Vector3();
function priority(it) {
  _cv.copy(camera.position).normalize();
  const p = globe.getCoords(it.c.lat, it.c.lng, 0);
  const facing = (p.x * _cv.x + p.y * _cv.y + p.z * _cv.z) / R; // 1 = straight at you
  let near = 0;
  if (me) near = 1 / (1 + Math.hypot(it.c.lat - me.lat, it.c.lng - me.lng) / 10);
  return (facing > 0.15 ? 2 + facing : facing) + near * 1.5 + Math.random() * 0.3;
}
function show(e, spot, c, local, volley = 1) {
  const jl = e.lat + rand(-0.15, 0.15), jg = e.lng + rand(-0.15, 0.15);
  if (e.type === 'c') {
    // the sender's chosen colour and height; mixed colours stay random
    const look = () => {
      const o = { lift: LIFT[e.h], spread: SPREAD[e.h] };
      if (e.col != null) { const c0 = COLORS[e.col]; o.colA = c0; o.colB = tint(c0, Math.random() < 0.5 ? 0.45 : 0.15); }
      return o;
    };
    if (local) {
      // your own cracker is the hero: a bigger volley right above your city
      const s = Math.max(fxScale(), 1.5) * 1.8;
      launch(jl, jg, { ...look(), type: e.kind || undefined, scale: s, fuse: BANG, snd: 1, force: true });
      launch(jl + rand(-0.4, 0.4), jg + rand(-0.4, 0.4), { ...look(), delay: 0.45, scale: s * 0.8, fuse: 1.3, snd: 0.6, force: true });
      launch(jl + rand(-0.4, 0.4), jg + rand(-0.4, 0.4), { ...look(), delay: 0.9, scale: s * 0.9, fuse: 1.4, snd: 0.7, force: true });
    } else {
      launch(jl, jg, { ...look(), type: e.kind || undefined, snd: 0.3 });
      const extra = volley > 1 ? Math.min(volley - 1, 3) : (Math.random() < 0.5 ? 1 : 0);
      for (let i = 0; i < extra; i++) launch(jl + rand(-0.3, 0.3), jg + rand(-0.3, 0.3), { ...look(), delay: rand(0.2, 0.9), snd: 0.2 });
    }
  } else {
    const p = globe.getCoords(spot.lat, spot.lng, 0.004);
    const pos = new THREE.Vector3(p.x, p.y, p.z);
    sparkle(pos, pos.clone().normalize(), fxScale() * 0.6);
    addRing(spot.lat, spot.lng);
  }
}
let lastRemoteShow = 0;
setInterval(() => {
  skyTokens = Math.min(SKY_RPS, skyTokens + SKY_RPS / 5);
  fxTokens = Math.min(FX_RPS, fxTokens + FX_RPS / 5);
  const t = performance.now();
  while (showQ.length && t - showQ[0].at > 2500) showQ.shift(); // too late to be "live"
  if (!showQ.length || document.hidden) return;
  const items = showQ.splice(0);
  // merge crackers per city so a busy city gets one rich volley
  const groups = new Map();
  for (const it of items) {
    if (it.e.type === 'd') {
      if (fxTokens >= 1 && priority(it) > 1) { fxTokens--; show(it.e, it.spot, it.c, false); }
      continue;
    }
    const g = groups.get(it.c.key);
    if (g) g.n++; else groups.set(it.c.key, { ...it, n: 1 });
  }
  const ranked = [...groups.values()].map((g) => ({ g, p: priority(g) })).sort((a, b) => b.p - a.p);
  const crowded = rockets.length > 40;
  for (const { g } of ranked) {
    const cost = Math.min(g.n, 4);
    if (crowded || skyTokens < 1) break;
    skyTokens -= cost;
    show(g.e, g.spot, g.c, false, g.n);
    lastRemoteShow = t;
  }
}, 200);

// Toasts: one at a time; when it's busy, a summary instead of a flood
let toastBuf = [];
function noteToast(e, c) { toastBuf.push({ e, c }); }
setInterval(() => {
  if (!toastBuf.length || document.hidden) return;
  const buf = toastBuf; toastBuf = [];
  if (buf.length === 1) { toast(buf[0].e); return; }
  const by = new Map();
  for (const { e, c } of buf) {
    const g = by.get(c.key) || { c, d: 0, k: 0 };
    if (e.type === 'd') g.d++; else g.k++;
    by.set(c.key, g);
  }
  const top = [...by.values()].sort((a, b) => (b.d + b.k) - (a.d + a.k))[0];
  const where = top.c.city || countryName(top.c.cc) || 'Somewhere';
  const parts = [];
  if (top.d) parts.push(`${top.d} diya${top.d === 1 ? '' : 's'}`);
  if (top.k) parts.push(`${top.k} cracker${top.k === 1 ? '' : 's'}`);
  const more = by.size - 1;
  toastText(`<b>${escapeHtml(where)}</b>: ${parts.join(' and ')} just now${more ? `, plus ${more} more cit${more === 1 ? 'y' : 'ies'}` : ''}`);
}, 1800);

let ringsArr = [];
function addRing(lat, lng) {
  const r = { lat, lng, until: Date.now() + 3500 };
  ringsArr = ringsArr.filter((x) => x.until > Date.now()).concat(r).slice(-12);
  globe.ringsData(ringsArr);
  setTimeout(() => { ringsArr = ringsArr.filter((x) => x.until > Date.now()); globe.ringsData(ringsArr); }, 3600);
}
globe
  .ringColor(() => (t) => `rgba(255,190,90,${Math.max(0, 1 - t)})`)
  .ringMaxRadius(1.1)
  .ringPropagationSpeed(2.5)
  .ringRepeatPeriod(700)
  .ringAltitude(0.003);

// ---------------------------------------------------------------
// Inbound queue: check signatures without freezing the page. Work is done
// in small time slices, so a big history or a flood just fills in gradually.
// ---------------------------------------------------------------
const inq = [];
const queued = new Set();
const lastLive = new Map(); // pub -> ms of their last live cracker we accepted
let pumping = false;
function enqueue(ev) {
  if (!ev || typeof ev.id !== 'string' || isSeen(ev.id) || queued.has(ev.id)) return;
  if (ev.kind === KIND_LIVE && inq.length > 3000) return; // drowning: a live cracker is just a show
  queued.add(ev.id); inq.push(ev);
  if (!pumping) { pumping = true; setTimeout(pump, 0); }
}
function pump() {
  const budget = document.hidden ? 40 : 8;
  const t0 = performance.now();
  while (inq.length && performance.now() - t0 < budget) {
    const ev = inq.shift();
    queued.delete(ev.id);
    if (isSeen(ev.id)) continue;
    if (ev.kind === KIND_LIVE) {
      const last = lastLive.get(ev.pubkey) || 0;
      if (Date.now() - last < 900) continue; // faster than the button allows
    }
    if (!pendingLocal.has(ev.id) && !verifyEvent(ev)) continue;
    if (ev.kind === KIND_LIVE) lastLive.set(ev.pubkey, Date.now());
    ingest(ev);
  }
  if (inq.length) setTimeout(pump, 0); else pumping = false;
}

// ---------------------------------------------------------------
// Relays. We write to all of them, but only listen to a few: every relay
// sends the same messages, so listening to all five just multiplies the
// download.
// ---------------------------------------------------------------
let eose = 0;
const acks = new Map();
let liveSince = nowS() - 60;
class Relay {
  constructor(url) {
    this.url = url; this.open = false; this.backoff = 1500; this.queue = [];
    this.reader = false;
    this.got = 0; this.fails = 0; this.notes = []; // for ?debug
    this.pagers = { d: { until: null, pages: 0, done: false }, t: { until: null, pages: 0, done: false } };
    this.connect();
  }
  connect() {
    let ws;
    try { ws = new WebSocket(this.url); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.open = true; this.backoff = 1500; updateNet();
      if (this.reader || relays.filter((r) => r.reader && r.open).length < READERS) this.listen();
      const q = this.queue; this.queue = []; q.forEach((m) => ws.send(m));
    };
    ws.onmessage = (m) => {
      let d; try { d = JSON.parse(m.data); } catch { return; }
      if (d[0] === 'EVENT') {
        this.got++;
        const ev = d[2];
        const p = this.pagers[d[1]];
        if (p && ev && (p.oldest == null || ev.created_at < p.oldest)) p.oldest = ev.created_at;
        if (p) p.got++;
        enqueue(ev);
      } else if (d[0] === 'EOSE') {
        if (this.pagers[d[1]]) this.nextPage(d[1]);
        if (d[1] === 'd' && ++eose === 1) setTimeout(() => { initialDone = true; }, 800);
      } else if (d[0] === 'NOTICE' || d[0] === 'CLOSED') {
        this.notes = [...this.notes.slice(-2), String(d[d.length - 1]).slice(0, 80)];
        if (d[0] === 'CLOSED' && this.pagers[d[1]]) this.pagers[d[1]].done = true;
      } else if (d[0] === 'OK' && acks.has(d[1]) && d[2]) { acks.set(d[1], acks.get(d[1]) + 1); $('warn').hidden = true; }
    };
    ws.onclose = () => { this.open = false; this.fails++; updateNet(); this.retry(); };
    ws.onerror = () => {};
  }
  req(id, filter) { if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(['REQ', id, filter])); }
  listen() {
    this.reader = true;
    // live: new diyas, crackers and tallies from now on
    this.req('live', { kinds: [KIND, KIND_LIVE, KIND_TALLY], '#t': [TAG], since: liveSince });
    // history: page back through every diya and every tally
    for (const id of ['d', 't']) if (!this.pagers[id].done) this.page(id);
  }
  page(id) {
    const p = this.pagers[id];
    p.got = 0; p.oldest = null;
    const f = { kinds: [id === 'd' ? KIND : KIND_TALLY], '#t': [TAG], limit: PAGE };
    if (p.until != null) f.until = p.until;
    this.req(id, f);
  }
  nextPage(id) {
    const p = this.pagers[id];
    if (this.open) this.ws.send(JSON.stringify(['CLOSE', id]));
    p.pages++;
    // stop when a page brings nothing older than where we already are
    if (!p.got || p.oldest == null || (p.until != null && p.oldest >= p.until && p.got < PAGE) || p.pages >= MAX_PAGES) { p.done = true; return; }
    p.until = p.until != null && p.oldest >= p.until ? p.until - 1 : p.oldest;
    this.page(id);
  }
  retry() { setTimeout(() => this.connect(), this.backoff); this.backoff = Math.min(this.backoff * 2, 30000); }
  send(m) { if (this.open && this.ws.readyState === 1) this.ws.send(m); else this.queue.push(m); }
}
// shuffle so different visitors lean on different relays
const relays = RELAYS.map((u) => [Math.random(), u]).sort((a, b) => a[0] - b[0]).map(([, u]) => new Relay(u));
setTimeout(() => { initialDone = true; }, 5000);
// if a relay we listen to drops, start listening to another one
setInterval(() => {
  liveSince = nowS() - 60;
  const live = relays.filter((r) => r.reader && r.open).length;
  if (live >= READERS) return;
  const spare = relays.find((r) => r.open && !r.reader);
  if (spare) spare.listen();
}, 5000);

function updateNet() {
  $('netDot').classList.toggle('on', relays.some((r) => r.open));
}

function sign(kind, tags, content) {
  return finalizeEvent({ kind, created_at: nowS(), tags: [['t', TAG], ...tags, ['client', 'diwali-globe']], content: JSON.stringify(content) }, secret);
}
function broadcast(ev, watch = true) {
  const msg = JSON.stringify(['EVENT', ev]);
  relays.forEach((r) => r.send(msg));
  if (!watch) return;
  acks.set(ev.id, 0);
  setTimeout(() => {
    if (acks.get(ev.id) === 0) {
      $('warn').textContent = 'Having trouble reaching the network. It will send once you are back online.';
      $('warn').hidden = false;
    }
  }, 9000);
}
function publish(content) {
  let ev;
  if (content.t === 'c') {
    const key = cityKey(content.city, content.cc, content.la, content.lo);
    const mine = myCounts[key] || { city: content.city, cc: content.cc, la: content.la, lo: content.lo, n: 0 };
    mine.n = Math.min(mine.n + 1, TALLY_CAP);
    myCounts[key] = mine;
    store.set(myCountsKey, myCounts);
    ev = sign(KIND_LIVE, [], { ...content, x: mine.n });
    scheduleTally();
  } else {
    ev = sign(KIND, [], content);
  }
  pendingLocal.add(ev.id);
  broadcast(ev);
  return ev;
}
// After a burst of clicks settles, store my running counts (one message, replaced each time)
let tallyTimer = null;
function scheduleTally() { clearTimeout(tallyTimer); tallyTimer = setTimeout(sendTally, 4000); }
function sendTally() {
  if (!tallyTimer) return;
  tallyTimer = null;
  const rows = Object.values(myCounts).sort((a, b) => b.n - a.n).slice(0, 20);
  if (rows.length) broadcast(sign(KIND_TALLY, [['d', TAG]], { v: 1, c: rows }), false);
}
addEventListener('pagehide', sendTally);
document.addEventListener('visibilitychange', () => { if (document.hidden) sendTally(); });

// Ambient: replay crackers in the cities that have burst the most, so the
// sky stays alive. Stays quiet while real people are bursting crackers.
(function ambient() {
  const pool = cracklePool;
  if (!document.hidden && initialDone && pool.length && !reduceMotion && performance.now() - lastRemoteShow > 4000) {
    let r = Math.random() * pool.total, c = pool[0];
    for (c of pool) if ((r -= c.w) <= 0) break;
    launch(c.lat + rand(-0.25, 0.25), c.lng + rand(-0.25, 0.25), { snd: 0.12 });
  }
  setTimeout(ambient, rand(2600, 4200) - Math.min(pool.length, 40) * 30);
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
  return `${[l.city, country].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}`;
}
function setMe(l) {
  me = { ...l, lat: round1(l.lat), lng: round1(l.lng) };
  store.set('dg.loc', me);
  setLoc(placeLabel(me));
  renderBoard();
}

function setLoc(text) { const b = $('locFix'); b.dataset.tip = text; b.setAttribute('aria-label', text + '. Click to use your exact location'); }
$('locFix').addEventListener('click', async () => {
  if (!navigator.geolocation) { alert('Location is not available in this browser.'); return; }
  setLoc('Finding you…');
  try {
    setMe(await preciseLocation());
    flyToMe(1800);
    toastText(`Moved you to <b>${escapeHtml(me.city || 'your spot')}</b>. Only your city is shared, never your exact location.`);
  } catch {
    setLoc(placeLabel(me));
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
function setView(id) { for (const b of document.querySelectorAll('.seg button')) b.classList.toggle('on', b.id === id); }
renderer.domElement.addEventListener('pointerdown', () => setView(null));
$('camMe').addEventListener('click', () => { flyToMe(1500); setView('camMe'); });
$('camIndia').addEventListener('click', () => setView('camIndia'));
$('camWorld').addEventListener('click', () => setView('camWorld'));
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
  $('introText').textContent = `Diwali in ${label}`;
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
}

// ============================================================
// Actions
// ============================================================
const nameInput = $('nameInput'), wishInput = $('wishInput');
nameInput.value = store.get('dg.name', '');
function needName() {
  const name = clean(nameInput.value, 24);
  if (name) { store.set('dg.name', name); return name; }
  openFields(true);
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
  toastText(`Your diya is lit in <b>${escapeHtml(me.city || 'your city')}</b>. That new dot is you.`);
});
// Name and wish live behind the pencil; they open by themselves when a diya needs a name.
function openFields(open) {
  $('fields').hidden = !open;
  $('nameBtn').setAttribute('aria-expanded', String(open));
}
$('nameBtn').addEventListener('click', () => {
  const open = $('fields').hidden;
  openFields(open);
  if (open) (nameInput.value ? wishInput : nameInput).focus();
});
nameInput.addEventListener('input', () => nameInput.classList.remove('shake'));
for (const el of [nameInput, wishInput]) el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('diyaBtn').click(); });

// Cracker look: colour and height, remembered per browser and sent with each cracker
let crackerCol = store.get('dg.col', null);
if (!(Number.isInteger(crackerCol) && crackerCol >= 0 && crackerCol < COLORS.length)) crackerCol = null;
let crackerH = [0, 1, 2].includes(store.get('dg.h', 1)) ? store.get('dg.h', 1) : 1;
const css = (c) => `rgb(${c.map((x) => Math.round(x * 255)).join(' ')})`;
const swatchBox = $('swatches');
for (const i of [null, ...COLORS.keys()]) {
  const b = document.createElement('button');
  b.type = 'button';
  b.dataset.col = i == null ? '' : i;
  const label = i == null ? 'Mixed colours' : COLOR_NAMES[i];
  b.setAttribute('aria-label', label); b.dataset.tip = label;
  b.innerHTML = `<span class="swatch"${i == null ? '' : ` style="--sw:${css(COLORS[i])}"`}></span>`;
  b.addEventListener('click', () => { crackerCol = i; store.set('dg.col', i); syncLook(); });
  swatchBox.append(b);
}
for (const b of document.querySelectorAll('.sizes button')) {
  b.addEventListener('click', () => { crackerH = Number(b.dataset.h); store.set('dg.h', crackerH); syncLook(); });
}
function syncLook() {
  for (const b of swatchBox.children) b.classList.toggle('on', b.dataset.col === (crackerCol == null ? '' : String(crackerCol)));
  for (const b of document.querySelectorAll('.sizes button')) b.classList.toggle('on', Number(b.dataset.h) === crackerH);
  const col = crackerCol == null ? null : css(COLORS[crackerCol]);
  $('styleSwatch').style.setProperty('--sw', col);
  $('crackerBtn').style.setProperty('--crk', col);
  const what = `${crackerCol == null ? 'mixed' : COLOR_NAMES[crackerCol].toLowerCase()}, ${['small', 'medium', 'large'][crackerH]}`;
  $('styleBtn').dataset.tip = `Colour and height: ${what}`;
  $('crackerBtn').dataset.tip = `Burst a cracker (${what})`;
}
syncLook();
const stylePop = $('stylePop');
function openStyle(open) { stylePop.hidden = !open; $('styleBtn').setAttribute('aria-expanded', String(open)); }
$('styleBtn').addEventListener('click', () => openStyle(stylePop.hidden));
addEventListener('pointerdown', (e) => { if (!stylePop.hidden && !e.target.closest('.pop-wrap')) openStyle(false); });
addEventListener('keydown', (e) => { if (e.key === 'Escape') openStyle(false); });

$('crackerBtn').addEventListener('click', () => {
  if (!me || !canAct(1200)) return;
  const name = clean(nameInput.value, 24) || store.get('dg.name', '') || 'Someone';
  ensureAudio();
  const k = pick(CRACKER_TYPES);
  const look = { h: crackerH };
  if (crackerCol != null) look.col = crackerCol;
  const ev = publish({ t: 'c', n: name, city: me.city, cc: me.cc, la: me.lat, lo: me.lng, k, ...look });
  const wasClose = altitude() < 1.0;
  pullBack();
  setTimeout(() => ingest(ev, true), wasClose ? 700 : 0);
});

// ============================================================
// UI bits
// ============================================================
function escapeHtml(s) { return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function updateStats() {
  $('diyaCount').textContent = totals.diyas.toLocaleString();
  $('crackerCount').textContent = totals.crackers.toLocaleString();
  $('cityCount').textContent = cities.size.toLocaleString();
  $('diyaStat').dataset.tip = totals.diyas === 1 ? 'diya lit' : 'diyas lit';
  $('crackerStat').dataset.tip = totals.crackers === 1 ? 'cracker burst' : 'crackers burst';
  $('cityStat').dataset.tip = cities.size === 1 ? 'city' : 'cities';
}

function toast(e) {
  const where = e.city || countryName(e.cc) || 'somewhere';
  const msg = e.type === 'd'
    ? `<b>${escapeHtml(e.name)}</b> lit a diya in ${escapeHtml(where)}${e.wish ? ': “' + escapeHtml(e.wish) + '”' : ''}`
    : `<b>${escapeHtml(e.name)}</b> burst a cracker over ${escapeHtml(where)}`;
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
  let html = `<div class="city">${escapeHtml(where)}</div><div class="counts">${c.diyas} diya${c.diyas === 1 ? '' : 's'} · ${c.crackers} cracker${c.crackers === 1 ? '' : 's'}</div>`;
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
const shareText = () => `🪔 Every light on this globe is a diya someone lit for Diwali. I just added mine${me && me.city ? ' in ' + me.city : ''}. Come light yours and fill the map ✨\n${shareUrl()}`;
$('waBtn').addEventListener('click', () => { $('waBtn').href = 'https://wa.me/?text=' + encodeURIComponent(shareText()); });
$('waBtn').href = 'https://wa.me/?text=' + encodeURIComponent(shareText());
$('copyBtn').addEventListener('click', async () => {
  const url = shareUrl();
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: 'Diwali Globe', text: 'Light up your city this Diwali 🪔', url }); return; }
    await navigator.clipboard.writeText(url);
    const b = $('copyBtn');
    b.dataset.tip = 'Copied'; b.classList.add('tip-now');
    setTimeout(() => { b.dataset.tip = 'Copy link'; b.classList.remove('tip-now'); }, 1600);
  } catch { prompt('Copy this link:', url); }
});

// ============================================================
// Sound (WebAudio, generated, no files)
// ============================================================
let muted = store.get('dg.muted', false);
const muteBtn = $('muteBtn');
const SPK = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9.5h3.5L12 5v14l-4.5-4.5H4z"/>';
const syncMute = () => { muteBtn.innerHTML = SPK + (muted ? '<path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>' : '<path d="M15.5 9a4 4 0 0 1 0 6M18 6.5a7.5 7.5 0 0 1 0 11"/></svg>'); };
syncMute();
muteBtn.addEventListener('click', () => { muted = !muted; store.set('dg.muted', muted); syncMute(); ensureAudio(); });
let ac = null, master = null, reverbIn = null;
// Two real recordings: the whistle while the rocket climbs, then the launch-and-explosion clip for the bang
const SFX = {};
const sfxFiles = ['whistle', 'firework', 'bell'];
const BANG = 2.52; // seconds into firework.mp3 where the shell explodes
const sfxBytes = sfxFiles.map((n) => fetch(`sfx/${n}.mp3`).then((r) => (r.ok ? r.arrayBuffer() : null)).catch(() => null));
let sfxDecoding = false;
function ensureAudio() {
  try {
    if (!ac) {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = 0.9;
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -14; comp.ratio.value = 6;
      master.connect(comp).connect(ac.destination);
      // night-air echo: a generated reverb tail shared by every burst
      const conv = ac.createConvolver(); conv.buffer = impulse(3.2);
      const wet = ac.createGain(); wet.gain.value = 0.5;
      reverbIn = ac.createGain();
      reverbIn.connect(conv).connect(wet).connect(master);
    }
    // 'interrupted' is iOS after a call or app switch
    if (ac.state !== 'running') ac.resume().catch(() => {});
    unmuteIOS();
    if (!sfxDecoding) {
      sfxDecoding = true;
      sfxFiles.forEach((n, i) => sfxBytes[i].then((buf) => buf && new Promise((ok, bad) => ac.decodeAudioData(buf.slice(0), ok, bad)))
        .then((d) => { if (d) SFX[n] = d; }).catch(() => {}));
    }
  } catch { ac = null; }
}
// Sound starts after a user gesture (autoplay rules). iOS only counts some events as
// gestures (touchend, click), so try on each until the context is actually running.
for (const t of ['pointerdown', 'touchend', 'click', 'keydown']) {
  addEventListener(t, () => { if (!ac || ac.state !== 'running') ensureAudio(); }, { capture: true, passive: true });
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && ac && ac.state !== 'running') ac.resume().catch(() => {}); });
// iPhones mute Web Audio when the ringer switch is on silent. Declaring this page as
// media playback (like a video) lets the sound through; older iOS needs a silent
// <audio> element played once during a tap to switch the audio session.
let iosUnmuted = false;
function unmuteIOS() {
  if (iosUnmuted) return;
  iosUnmuted = true;
  try { if (navigator.audioSession) { navigator.audioSession.type = 'playback'; return; } } catch { /* fall through */ }
  if (!/iP(hone|ad|od)|Macintosh.*Mobile/.test(navigator.userAgent) && !(navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent))) return;
  try {
    const n = 4410, b = new ArrayBuffer(44 + n * 2), v = new DataView(b);
    const w = (o, str) => { for (let i = 0; i < str.length; i++) v.setUint8(o + i, str.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVEfmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 44100, true); v.setUint32(28, 88200, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    const el = new Audio(URL.createObjectURL(new Blob([b], { type: 'audio/wav' })));
    el.setAttribute('playsinline', ''); el.setAttribute('x-webkit-airplay', 'deny');
    el.play().catch(() => { iosUnmuted = false; });
  } catch { iosUnmuted = false; }
}
function impulse(sec) {
  const len = Math.floor(ac.sampleRate * sec), b = ac.createBuffer(2, len, ac.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.5);
  }
  return b;
}
function noiseBuffer(sec) {
  const b = ac.createBuffer(1, ac.sampleRate * sec, ac.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}
const soundOn = () => !muted && ac && ac.state === 'running' && !document.hidden;
function out(vol, send) {
  const g = ac.createGain(); g.gain.value = vol;
  g.connect(master);
  if (send) { const s = ac.createGain(); s.gain.value = send; g.connect(s).connect(reverbIn); }
  return g;
}
let recentBooms = [];
// Whistle while the rocket climbs: stretched to the climb, gliding up in pitch, cut at the bang
let recentWhistles = [];
function playWhistle(fuse, vol) {
  if (!soundOn() || !SFX.whistle) return;
  const t0 = ac.currentTime;
  recentWhistles = recentWhistles.filter((t) => t0 - t < 1.5);
  if (recentWhistles.length >= 3 && vol < 0.5) return;
  recentWhistles.push(t0);
  const len = SFX.whistle.duration - 0.05;
  const rate = clamp(len / fuse, 0.8, 1.4) * rand(0.95, 1.05);
  const src = ac.createBufferSource(); src.buffer = SFX.whistle;
  src.playbackRate.setValueAtTime(rate * 0.9, t0);
  src.playbackRate.linearRampToValueAtTime(rate * 1.1, t0 + fuse);
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = vol < 0.5 ? 3500 : 16000;
  const peak = (vol < 0.5 ? 0.5 : 0.75) * vol;
  const g = out(0, 0.25);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.1);
  g.gain.setValueAtTime(peak, t0 + Math.max(0.12, fuse - 0.06));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + fuse + 0.02);
  src.connect(lp).connect(g); src.start(t0); src.stop(t0 + fuse + 0.05);
}
// Play the recording so its explosion lands exactly when the rocket bursts on screen
function playFirework(fuse, vol) {
  if (!soundOn() || !SFX.firework) return false;
  const now = ac.currentTime;
  recentBooms = recentBooms.filter((t) => now - t < 1.5);
  if (recentBooms.length >= 4 && vol < 0.5) return true; // busy sky: skip quiet ones, no fallback either
  recentBooms.push(now);
  const rate = rand(0.94, 1.06); // small pitch/tempo variety per rocket
  const offset = Math.max(0, BANG - fuse * rate);
  const src = ac.createBufferSource(); src.buffer = SFX.firework;
  src.playbackRate.value = rate;
  const lp = ac.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.value = vol < 0.5 ? 2200 : 16000; // distance takes the edge off
  const g = out(0, vol < 0.5 ? 0.6 : 0.35);
  if (offset > 0) { g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(vol, now + 0.08); }
  else g.gain.setValueAtTime(vol, now);
  src.connect(lp).connect(g); src.start(now, offset);
  return true;
}
function playBoom(vol, type, clip) {
  if (!soundOn()) return;
  const t0 = ac.currentTime;
  if (!clip) { // recording not loaded yet: synthesized thump + bang
    if (vol < 0.5 && recentBooms.filter((t) => t0 - t < 1).length >= 4) return;
    recentBooms.push(t0);
    const o = ac.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t0); o.frequency.exponentialRampToValueAtTime(38, t0 + 0.5);
    const og = out(0, 0.3);
    og.gain.setValueAtTime(0.0001, t0); og.gain.exponentialRampToValueAtTime(0.7 * vol, t0 + 0.012); og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.7);
    o.connect(og); o.start(t0); o.stop(t0 + 0.75);
    const n = ac.createBufferSource(); n.buffer = noiseBuffer(1.4);
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(1800, t0); lp.frequency.exponentialRampToValueAtTime(120, t0 + 1.1);
    const g = out(0, 0.6); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.6 * vol, t0 + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.3);
    n.connect(lp).connect(g); n.start(t0);
  }
  // glittering shells get a crackling tail on top (only your own, close by)
  if (vol >= 0.5 && (type === 'glitter' || type === 'willow' || type === 'double')) {
    const cr = ac.createBufferSource(); cr.buffer = noiseBuffer(1.6);
    const hp = ac.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2500;
    const cg = out(0, 0.4); cg.gain.setValueAtTime(0, t0);
    for (let i = 0, tt = t0 + 0.35; i < 26; i++, tt += rand(0.025, 0.07)) { cg.gain.setValueAtTime(rand(0.06, 0.22) * vol, tt); cg.gain.setValueAtTime(0, tt + 0.012); }
    cr.connect(hp).connect(cg); cr.start(t0 + 0.3);
  }
}
// Lighting a diya: one soft strike of a real brass puja bell (ghanta)
function chime() {
  if (muted || !ac) return;
  const t0 = ac.currentTime;
  if (SFX.bell) {
    const src = ac.createBufferSource(), g = ac.createGain();
    src.buffer = SFX.bell;
    src.playbackRate.value = rand(0.95, 1.03); // no two strikes quite alike
    g.gain.value = 0.7;
    src.connect(g).connect(ac.destination);
    src.start(t0);
    return;
  }
  // fallback until the recording has loaded
  [[880, 0.12], [1320, 0.06]].forEach(([f, v]) => {
    const o = ac.createOscillator(), g = ac.createGain();
    o.frequency.value = f;
    g.gain.setValueAtTime(0, t0); g.gain.linearRampToValueAtTime(v, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 1.6);
    o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + 1.7);
  });
}

// ============================================================
// New version check: a tab left open keeps running old code, so look for a
// newer deploy every few minutes. Reload quietly if nobody is looking,
// otherwise offer a refresh.
// ============================================================
const VERSION = typeof __VERSION__ === 'string' ? __VERSION__ : 'dev';
async function checkVersion() {
  if (VERSION === 'dev') return;
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    const { v } = await r.json();
    if (!v || v === VERSION) return;
    if (document.hidden) { location.reload(); return; }
    $('update').hidden = false;
  } catch { /* offline: try later */ }
}
$('updateBtn').addEventListener('click', () => location.reload());
setInterval(checkVersion, 5 * 60 * 1000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });

// ============================================================
// Diagnostics: add ?debug to the URL (handy on phones, which have no console).
// Tap the box to copy its text.
// ============================================================
if (params.has('debug')) {
  const errs = [];
  addEventListener('error', (e) => errs.push(String(e.message).slice(0, 90)));
  addEventListener('unhandledrejection', (e) => errs.push(String(e.reason).slice(0, 90)));
  const box = document.createElement('pre');
  box.style.cssText = 'position:fixed;left:8px;right:8px;top:42%;z-index:99;margin:0;padding:8px 10px;background:rgba(0,0,0,.85);color:#9fe;font:11px/1.45 ui-monospace,Menlo,monospace;white-space:pre-wrap;border-radius:8px;max-height:36vh;overflow:auto';
  document.body.append(box);
  box.addEventListener('click', () => navigator.clipboard?.writeText(box.textContent).then(() => { box.style.color = '#fe9'; }));
  const gl = renderer.getContext();
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const gpu = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown';
  setInterval(() => {
    const lines = [
      `v ${VERSION}  room ${room}  ${innerWidth}x${innerHeight}@${devicePixelRatio}`,
      `diyas ${totals.diyas}  crackers ${totals.crackers}  cities ${cities.size}  queue ${inq.length}  rockets ${rockets.length}`,
      `audio ${ac ? ac.state : 'not started'}  muted ${muted}  sfx ${Object.keys(SFX).join(',') || 'none'}  session ${navigator.audioSession ? navigator.audioSession.type : 'n/a'}`,
      `gpu ${gpu}`,
      ...relays.map((r) => `${r.open ? 'open ' : 'DOWN '}${r.reader ? 'R' : ' '} ${r.url.slice(6).padEnd(18)} got ${String(r.got).padStart(4)}  pages ${r.pagers.d.pages}${r.pagers.d.done ? '✓' : ''}  drops ${r.fails}${r.notes.length ? '  ' + r.notes.join(' | ') : ''}`),
      ...(errs.length ? ['errors:', ...errs.slice(-5)] : []),
      navigator.userAgent.replace(/Mozilla\/5.0 /, '').slice(0, 110),
    ];
    box.textContent = lines.join('\n');
  }, 1000);
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
// The seed ("Diwali Globe" diyas) also ships with the site, because public relays
// prune bulk events from a new key. Same signed events, checked like any other.
fetch(`seed/${room}.json`, { cache: 'no-cache' })
  .then((r) => (r.ok ? r.json() : []))
  .then((evs) => { if (Array.isArray(evs)) for (const e of evs) if (e && e.pubkey === SEED_PUB) enqueue(e); })
  .catch(() => {});
intro();

// Debug hook for automated checks
window.__dg = { globe, scene, rockets, cities, totals, relays, contrib, showQ, inq, ingest, enqueue, launch, sfx: SFX, get ac() { return ac; }, get me() { return me; }, altitude };
