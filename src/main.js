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
  const scale = opts.scale || fxScale();
  const start = globe.getCoords(lat, lng, 0.004);
  const n = new THREE.Vector3(start.x, start.y, start.z).normalize();
  const height = rand(5, 8) * scale + 1.5;
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
    if (r.t === 0 && r.snd) r.clip = playFirework(r.fuse, r.snd);
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


let cityListTimer = null;
function refreshCities() {
  clearTimeout(cityListTimer);
  cityListTimer = setTimeout(() => { globe.customLayerData([...cities.values()]); renderBoard(); }, 60);
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

const pendingLocal = new Set(); // my own events, waiting for the camera to pull back
function ingest(ev, local = false) {
  if (!ev || seen.has(ev.id)) return;
  if (pendingLocal.has(ev.id) && !local) return; // relay echo beat us to it; the local copy plays the show
  pendingLocal.delete(ev.id);
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
  const live = local || (initialDone && !document.hidden && e.created >= loadTime - 30);
  let spot = null;
  if (e.type === 'd') {
    c.diyas++; totals.diyas++;
    spot = addDot(e, live);
    if (e.wish || e.name) { c.wishes.push(e); c.wishes.sort((a, b) => b.created - a.created); c.wishes.length = Math.min(c.wishes.length, 6); }
  } else {
    c.crackers++; totals.crackers++;
    crackerPool.push(e);
    if (crackerPool.length > 2000) crackerPool.shift();
  }
  refreshCities();
  updateStats();

  if (!live) return;
  const jl = e.lat + rand(-0.15, 0.15), jg = e.lng + rand(-0.15, 0.15);
  if (e.type === 'c') {
    if (local) {
      // your own cracker is the hero: a bigger volley right above your city
      const s = Math.max(fxScale(), 1.5) * 1.8;
      launch(jl, jg, { type: e.kind || undefined, scale: s, fuse: BANG, snd: 1 });
      launch(jl + rand(-0.4, 0.4), jg + rand(-0.4, 0.4), { delay: 0.45, scale: s * 0.8, fuse: 1.3, snd: 0.6 });
      launch(jl + rand(-0.4, 0.4), jg + rand(-0.4, 0.4), { delay: 0.9, scale: s * 0.9, fuse: 1.4, snd: 0.7 });
    } else {
      launch(jl, jg, { type: e.kind || undefined, snd: 0.3 });
      if (Math.random() < 0.5) launch(jl + rand(-0.2, 0.2), jg + rand(-0.2, 0.2), { delay: rand(0.2, 0.6), snd: 0.2 });
    }
  } else {
    const p = globe.getCoords(spot.lat, spot.lng, 0.004);
    const pos = new THREE.Vector3(p.x, p.y, p.z);
    sparkle(pos, pos.clone().normalize(), fxScale() * 0.6);
    addRing(spot.lat, spot.lng);
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
  .ringMaxRadius(1.1)
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
  pendingLocal.add(ev.id);
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
    launch(e.lat + rand(-0.25, 0.25), e.lng + rand(-0.25, 0.25), { type: e.kind || undefined, snd: 0.12 });
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
  return `${[l.city, country].filter((x, i, a) => x && a.indexOf(x) === i).join(', ')}`;
}
function setMe(l) {
  me = { ...l, lat: round1(l.lat), lng: round1(l.lng) };
  store.set('dg.loc', me);
  $('locLabel').textContent = placeLabel(me);
  renderBoard();
}

$('locFix').addEventListener('click', async () => {
  if (!navigator.geolocation) { alert('Location is not available in this browser.'); return; }
  $('locLabel').textContent = 'Finding you…';
  try {
    setMe(await preciseLocation());
    flyToMe(1800);
    toastText(`Moved you to <b>${escapeHtml(me.city || 'your spot')}</b>. Only your city is shared, never your exact location.`);
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
  toastText(`Your diya is lit in <b>${escapeHtml(me.city || 'your city')}</b>. That new dot is you.`);
});
$('crackerBtn').addEventListener('click', () => {
  if (!me || !canAct(1200)) return;
  const name = clean(nameInput.value, 24) || store.get('dg.name', '') || 'Someone';
  ensureAudio();
  const k = pick(CRACKER_TYPES);
  const ev = publish({ t: 'c', n: name, city: me.city, cc: me.cc, la: me.lat, lo: me.lng, k });
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
  $('diyaLabel').textContent = totals.diyas === 1 ? 'diya' : 'diyas';
  $('crackerLabel').textContent = totals.crackers === 1 ? 'cracker' : 'crackers';
  $('cityLabel').textContent = cities.size === 1 ? 'city' : 'cities';
  $('crackerCount').textContent = totals.crackers.toLocaleString();
  $('cityCount').textContent = cities.size.toLocaleString();
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
    $('copyBtn').textContent = 'Copied ✓';
    setTimeout(() => { $('copyBtn').textContent = 'Copy link'; }, 1800);
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
// One real recording: launch thump, the rocket's climb, then the explosion
const SFX = {};
const sfxFiles = ['firework'];
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
    if (ac.state === 'suspended') ac.resume();
    if (!sfxDecoding) {
      sfxDecoding = true;
      sfxFiles.forEach((n, i) => sfxBytes[i].then((buf) => buf && new Promise((ok, bad) => ac.decodeAudioData(buf.slice(0), ok, bad)))
        .then((d) => { if (d) SFX[n] = d; }).catch(() => {}));
    }
  } catch { ac = null; }
}
// sound starts working after the first tap or drag anywhere (browser autoplay rules)
addEventListener('pointerdown', ensureAudio, { once: true });
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
window.__dg = { globe, scene, rockets, cities, totals, launch, sfx: SFX, get ac() { return ac; }, get me() { return me; }, altitude };
