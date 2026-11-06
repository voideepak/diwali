(() => {
  'use strict';

  // ---------- Config ----------
  const NT = window.NostrTools;
  const RELAYS = [
    'wss://relay.damus.io',
    'wss://nos.lol',
    'wss://relay.primal.net',
    'wss://nostr.mom',
    'wss://relay.snort.social',
  ];
  const KIND = 7462; // custom regular-event kind for Diya Chain
  const params = new URLSearchParams(location.search);
  const room = (params.get('c') || 'everyone').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 48) || 'everyone';
  const TAG = 'diyachain:v1:' + room;
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  const PALETTE = [
    { name: 'Marigold', c: '#ffb627', d: '#b8620a' },
    { name: 'Rose', c: '#ff5c93', d: '#9e1d50' },
    { name: 'Peacock', c: '#22c3b5', d: '#0b6b67' },
    { name: 'Royal', c: '#8a6bff', d: '#3d2899' },
    { name: 'Vermilion', c: '#ff5a36', d: '#9a2410' },
    { name: 'Emerald', c: '#3fd77f', d: '#13703b' },
  ];

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
  };
  const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  const unhex = (s) => new Uint8Array(s.match(/../g).map((h) => parseInt(h, 16)));
  const clean = (s, n) => (typeof s === 'string' ? s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n) : '');
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const now = () => performance.now() / 1000;
  const rand = (a, b) => a + Math.random() * (b - a);
  const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  function timeAgo(sec) {
    const diff = sec - Date.now() / 1000;
    const a = Math.abs(diff);
    if (a < 60) return 'just now';
    if (a < 3600) return rtf.format(Math.round(diff / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(diff / 3600), 'hour');
    return rtf.format(Math.round(diff / 86400), 'day');
  }
  function hashIndex(str, n) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return Math.abs(h) % n; }
  const shareUrl = () => location.origin + location.pathname + (room !== 'everyone' ? '?c=' + room : '');
  const prettyRoom = room === 'everyone' ? '' : room.replace(/-[a-z0-9]{4}$/, '').split('-').filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

  // ---------- Identity ----------
  const secret = (() => {
    const s = store.get('dc.sk', null);
    if (typeof s === 'string' && /^[0-9a-f]{64}$/.test(s)) return unhex(s);
    const k = NT.generateSecretKey();
    store.set('dc.sk', hex(k));
    return k;
  })();
  const myPub = NT.getPublicKey(secret);
  const mineKey = 'dc.mine.' + room;

  // ---------- State ----------
  const diyas = []; // sorted by (created, id)
  const byId = new Map();
  let initialDone = false;
  const loadTime = Date.now() / 1000;
  let myHue = clamp(store.get('dc.hue', Math.floor(Math.random() * PALETTE.length)) | 0, 0, PALETTE.length - 1);
  const comets = [];
  const particles = [];

  // ---------- Canvas setup ----------
  const canvas = $('sky');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, dpr = 1;
  let cx = 0, cy = 0; // mandala centre on screen (before pan)
  let S = 60, D = 40; // ring spacing, diya width (world px)
  let rings = 1;
  const view = { zoom: 1, px: 0, py: 0 };
  let viewTarget = null;
  let stars = [];
  let bg = null;
  let rangoli = null, rangoliSize = 0;
  let focusPulse = null; // {id, until}

  // Sprites (drawn once, at high resolution, scaled at draw time)
  const SPR = 3;
  function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = Math.ceil(w * SPR); c.height = Math.ceil(h * SPR); const g = c.getContext('2d'); g.scale(SPR, SPR); return [c, g]; }

  // Bowl: unit space x -34..34, y -10..32; rim centre at (0,0) -> sprite offset (34,10)
  function makeBowl(color, dark, unlit) {
    const [c, g] = makeCanvas(68, 42);
    g.translate(34, 10);
    // foot
    g.fillStyle = unlit ? '#2b2236' : dark;
    g.beginPath(); g.ellipse(0, 26, 10, 3.2, 0, 0, Math.PI * 2); g.fill();
    // body
    const body = new Path2D();
    body.moveTo(-31, 0);
    body.bezierCurveTo(-29, 17, -13, 26, 0, 26);
    body.bezierCurveTo(13, 26, 29, 17, 31, 0);
    body.closePath();
    const gr = g.createLinearGradient(0, 0, 0, 26);
    if (unlit) { gr.addColorStop(0, '#5a4a6a'); gr.addColorStop(1, '#2a2036'); }
    else { gr.addColorStop(0, color); gr.addColorStop(1, dark); }
    g.fillStyle = gr; g.fill(body);
    // side shine
    g.save(); g.clip(body);
    const sh = g.createRadialGradient(-12, 6, 1, -12, 6, 18);
    sh.addColorStop(0, 'rgba(255,255,255,0.35)'); sh.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = sh; g.fillRect(-31, 0, 62, 26);
    g.restore();
    // painted dots
    if (!unlit) {
      g.fillStyle = '#ffe9a3';
      for (let i = -3; i <= 3; i++) { const x = i * 7.5; const y = 11 + Math.abs(i) * -0.9 + (i * i) * 0.08; g.beginPath(); g.arc(x, y, 1.6, 0, Math.PI * 2); g.fill(); }
      g.strokeStyle = 'rgba(255,233,163,0.7)'; g.lineWidth = 1;
      g.beginPath(); g.moveTo(-24, 17); g.quadraticCurveTo(0, 25, 24, 17); g.stroke();
    }
    // rim + oil
    g.fillStyle = unlit ? '#1c1526' : '#3a1606';
    g.beginPath(); g.ellipse(0, 0, 31, 6.5, 0, 0, Math.PI * 2); g.fill();
    g.strokeStyle = unlit ? '#6b5a7d' : '#ffd977'; g.lineWidth = 1.6; g.stroke();
    if (!unlit) {
      const oil = g.createRadialGradient(0, 0, 1, 0, 0, 26);
      oil.addColorStop(0, 'rgba(255,200,90,0.85)'); oil.addColorStop(1, 'rgba(160,80,10,0.2)');
      g.fillStyle = oil; g.beginPath(); g.ellipse(0, 0.5, 26, 4.6, 0, 0, Math.PI * 2); g.fill();
      // wick
      g.strokeStyle = '#2a1204'; g.lineWidth = 2; g.lineCap = 'round';
      g.beginPath(); g.moveTo(0, 0); g.lineTo(0.5, -3); g.stroke();
    }
    return c;
  }
  // Flame: unit space x -10..10, y -34..4; base at (0,0)
  function makeFlame() {
    const [c, g] = makeCanvas(20, 38);
    g.translate(10, 34);
    const p = new Path2D();
    p.moveTo(0, -33);
    p.bezierCurveTo(5, -20, 9.5, -10, 7.5, -3);
    p.quadraticCurveTo(0, 5, -7.5, -3);
    p.bezierCurveTo(-9.5, -10, -5, -20, 0, -33);
    const gr = g.createRadialGradient(0, -6, 0, 0, -10, 26);
    gr.addColorStop(0, '#fffbe6');
    gr.addColorStop(0.25, '#ffe27a');
    gr.addColorStop(0.55, '#ffa52e');
    gr.addColorStop(1, 'rgba(255,70,0,0.6)');
    g.fillStyle = gr; g.fill(p);
    // blue base
    const bl = g.createRadialGradient(0, -1, 0, 0, -1, 5);
    bl.addColorStop(0, 'rgba(90,140,255,0.55)'); bl.addColorStop(1, 'rgba(90,140,255,0)');
    g.fillStyle = bl; g.beginPath(); g.ellipse(0, -1.5, 5, 3.5, 0, 0, Math.PI * 2); g.fill();
    // white core
    const core = g.createRadialGradient(0, -8, 0, 0, -8, 6);
    core.addColorStop(0, 'rgba(255,255,255,0.95)'); core.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = core; g.beginPath(); g.ellipse(0, -8, 3.6, 7, 0, 0, Math.PI * 2); g.fill();
    return c;
  }
  function makeGlow() {
    const [c, g] = makeCanvas(120, 120);
    const gr = g.createRadialGradient(60, 60, 0, 60, 60, 60);
    gr.addColorStop(0, 'rgba(255,200,110,0.65)');
    gr.addColorStop(0.25, 'rgba(255,150,50,0.28)');
    gr.addColorStop(0.6, 'rgba(255,110,30,0.07)');
    gr.addColorStop(1, 'rgba(255,90,20,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 120, 120);
    return c;
  }
  const bowls = PALETTE.map((p) => makeBowl(p.c, p.d, false));
  const unlitBowl = makeBowl('', '', true);
  const flame = makeFlame();
  const glow = makeGlow();

  // ---------- Layout ----------
  let headerBottom = 120, panelTop = 0;
  function measure() {
    W = window.innerWidth; H = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    headerBottom = $('header').getBoundingClientRect().bottom;
    panelTop = $('panel').getBoundingClientRect().top;
    $('toasts').style.top = (headerBottom + 6) + 'px';
    bg = ctx.createRadialGradient(W / 2, H * 0.55, 0, W / 2, H * 0.55, Math.max(W, H) * 0.8);
    bg.addColorStop(0, '#2a1146');
    bg.addColorStop(0.45, '#160a30');
    bg.addColorStop(1, '#07031a');
    if (!stars.length || stars.W !== W || stars.H !== H) {
      const n = Math.round((W * H) / 6000);
      stars = Array.from({ length: n }, () => ({ x: Math.random() * W, y: Math.random() * H, r: rand(0.3, 1.3), p: rand(0, 6.28), s: rand(0.6, 2) }));
      stars.W = W; stars.H = H;
    }
    relayout();
  }

  function slotPos(i) {
    let k = 1;
    while (3 * k * (k + 1) <= i) k++;
    const j = i - 3 * k * (k - 1);
    const cap = 6 * k;
    const a = -Math.PI / 2 + (k % 2 ? 0 : Math.PI / cap) + (2 * Math.PI * j) / cap;
    return { x: Math.cos(a) * k * S, y: Math.sin(a) * k * S, k, a };
  }

  function relayout() {
    const n = diyas.length;
    let K = 1;
    while (3 * K * (K + 1) < n + 1) K++;
    rings = K;
    let top = headerBottom + 6, bottom = panelTop - 6;
    if (bottom - top < 180) { top = headerBottom; bottom = H; }
    cx = W / 2; cy = (top + bottom) / 2;
    const R = Math.max(70, Math.min(W / 2 - 8, (bottom - top) / 2));
    S = Math.min(R / (K + 0.55), 86);
    D = Math.min(S * 0.68, 54);
    diyas.forEach((d, i) => {
      const p = slotPos(i);
      d.tx = p.x; d.ty = p.y;
      if (d.x == null) { d.x = p.x; d.y = p.y; }
    });
    const key = rings + '|' + S.toFixed(2) + '|' + dpr;
    if (key !== rangoliKey) { rangoliKey = key; buildRangoli(); }
  }

  let rangoliKey = '';
  function buildRangoli() {
    const R = (rings + 0.6) * S;
    const scale = Math.min(dpr, 2);
    rangoliSize = Math.ceil(R * 2);
    const c = rangoli && rangoli.width === Math.ceil(rangoliSize * scale) ? rangoli : document.createElement('canvas');
    c.width = c.height = Math.ceil(rangoliSize * scale);
    const g = c.getContext('2d');
    g.setTransform(scale, 0, 0, scale, rangoliSize * scale / 2, rangoliSize * scale / 2);
    g.clearRect(-R, -R, R * 2, R * 2);
    for (let k = 1; k <= rings; k++) {
      // dashed orbit
      g.strokeStyle = 'rgba(255,200,120,0.09)'; g.lineWidth = 1; g.setLineDash([2, 6]);
      g.beginPath(); g.arc(0, 0, k * S, 0, Math.PI * 2); g.stroke();
      g.setLineDash([]);
      const cap = 6 * k;
      for (let j = 0; j < cap; j++) {
        const a = -Math.PI / 2 + (k % 2 ? 0 : Math.PI / cap) + (2 * Math.PI * j) / cap;
        const col = PALETTE[(j + k) % PALETTE.length].c;
        // petal pointing outward toward the diya slot
        g.save(); g.rotate(a);
        const r0 = (k - 0.92) * S + (k === 1 ? S * 0.35 : 0), r1 = (k - 0.28) * S, w = Math.min(S * 0.17, (Math.PI * (k - 0.6) * S) / cap * 0.55);
        g.beginPath();
        g.moveTo(r0, 0);
        g.quadraticCurveTo((r0 + r1) / 2, w, r1, 0);
        g.quadraticCurveTo((r0 + r1) / 2, -w, r0, 0);
        g.fillStyle = col; g.globalAlpha = 0.14; g.fill();
        g.globalAlpha = 0.32; g.strokeStyle = col; g.lineWidth = 0.8; g.stroke();
        g.restore();
        // dot between slots
        const b = a + Math.PI / cap;
        g.globalAlpha = 0.4; g.fillStyle = '#ffd977';
        g.beginPath(); g.arc(Math.cos(b) * k * S, Math.sin(b) * k * S, Math.max(0.8, S * 0.035), 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
      }
    }
    rangoli = c;
  }

  // ---------- Events from relays ----------
  function parseEvent(ev) {
    if (!ev || ev.kind !== KIND || typeof ev.content !== 'string' || typeof ev.id !== 'string') return null;
    if (!Array.isArray(ev.tags) || !ev.tags.some((t) => t[0] === 't' && t[1] === TAG)) return null;
    let c;
    try { c = JSON.parse(ev.content); } catch { return null; }
    if (!c || typeof c !== 'object') return null;
    const created = Math.min(ev.created_at | 0, Math.floor(Date.now() / 1000) + 60);
    return {
      id: ev.id,
      pub: ev.pubkey,
      name: clean(c.n, 24) || 'A friend',
      wish: clean(c.w, 100),
      hue: Number.isInteger(c.h) ? ((c.h % PALETTE.length) + PALETTE.length) % PALETTE.length : hashIndex(ev.id, PALETTE.length),
      created,
      x: null, y: null, tx: 0, ty: 0,
      appear: Infinity, litAt: Infinity,
      phase: Math.random() * 100,
    };
  }

  function insertSorted(d) {
    let i = diyas.length;
    while (i > 0 && (diyas[i - 1].created > d.created || (diyas[i - 1].created === d.created && diyas[i - 1].id > d.id))) i--;
    diyas.splice(i, 0, d);
    return i;
  }

  function onEvent(ev, opts = {}) {
    if (byId.has(ev && ev.id)) return;
    const d = parseEvent(ev);
    if (!d) return;
    byId.set(d.id, d);
    const idx = insertSorted(d);
    const oldRings = rings;
    relayout();
    if (!initialDone) return;
    const t = now();
    const mine = d.pub === myPub;
    const live = opts.local || (!document.hidden && d.created >= loadTime - 45);
    if (live && !reduceMotion) {
      const prev = idx > 0 ? diyas[idx - 1] : null;
      const from = prev ? { x: prev.x, y: prev.y - D * 0.45 } : { x: 0, y: -D * 0.6 };
      d.appear = t;
      d.litAt = t + 1.0;
      comets.push({ fx: from.x, fy: from.y, d, start: t + (oldRings !== rings ? 0.35 : 0.05), dur: 0.95 });
    } else {
      d.appear = t; d.litAt = t + 0.15;
    }
    if (live && !mine) toast(d);
    updateCount();
    renderList();
  }

  function reveal() {
    if (initialDone) return;
    initialDone = true;
    const t = now();
    const n = diyas.length;
    const step = reduceMotion ? 0 : Math.min(0.11, 2.6 / Math.max(n, 1));
    diyas.forEach((d, i) => { d.appear = t + i * step * 0.6; d.litAt = t + 0.35 + i * step; });
    // Make sure my own diyas reached the relays (e.g. if I lit one while offline)
    const mine = store.get(mineKey, []);
    if (Array.isArray(mine)) {
      for (const ev of mine) {
        if (!byId.has(ev.id)) { publish(ev); onEvent(ev); }
      }
    }
    updateCount();
    renderList();
    syncPanel();
  }

  // ---------- Relay client ----------
  let eoseCount = 0;
  const acks = new Map(); // event id -> ok count
  class Relay {
    constructor(url) { this.url = url; this.ws = null; this.open = false; this.backoff = 1500; this.queue = []; this.connect(); }
    connect() {
      let ws;
      try { ws = new WebSocket(this.url); } catch { this.retry(); return; }
      this.ws = ws;
      ws.onopen = () => {
        this.open = true; this.backoff = 1500; updateNet();
        ws.send(JSON.stringify(['REQ', 'dc', { kinds: [KIND], '#t': [TAG], limit: 1500 }]));
        const q = this.queue; this.queue = [];
        q.forEach((m) => ws.send(m));
      };
      ws.onmessage = (e) => {
        let m; try { m = JSON.parse(e.data); } catch { return; }
        if (m[0] === 'EVENT' && m[1] === 'dc') onEvent(m[2]);
        else if (m[0] === 'EOSE' && m[1] === 'dc') { eoseCount++; if (eoseCount === 1) setTimeout(reveal, 700); if (eoseCount >= 3) reveal(); }
        else if (m[0] === 'OK' && acks.has(m[1])) { if (m[2]) { acks.set(m[1], acks.get(m[1]) + 1); $('warn').hidden = true; } }
      };
      ws.onclose = () => { this.open = false; updateNet(); this.retry(); };
      ws.onerror = () => {};
    }
    retry() { setTimeout(() => this.connect(), this.backoff); this.backoff = Math.min(this.backoff * 2, 30000); }
    send(msg) { if (this.open && this.ws && this.ws.readyState === 1) this.ws.send(msg); else this.queue.push(msg); }
  }
  const relays = RELAYS.map((u) => new Relay(u));
  setTimeout(reveal, 4500); // fallback if relays are slow / offline

  function updateNet() {
    const n = relays.filter((r) => r.open).length;
    $('netDot').classList.toggle('on', n > 0);
    $('netStatus').textContent = n > 0
      ? `Connected to ${n} of ${relays.length} open Nostr relays. Free and open, no accounts.`
      : 'Reconnecting to the network…';
  }

  function publish(ev) {
    if (!acks.has(ev.id)) acks.set(ev.id, 0);
    const msg = JSON.stringify(['EVENT', ev]);
    relays.forEach((r) => r.send(msg));
    setTimeout(() => {
      if (acks.get(ev.id) === 0) {
        const w = $('warn');
        w.textContent = 'Having trouble reaching the network. Your diya will be sent as soon as you\'re back online.';
        w.hidden = false;
      }
    }, 9000);
  }

  function lightDiya(name, wish) {
    const ev = NT.finalizeEvent({
      kind: KIND,
      created_at: Math.floor(Date.now() / 1000),
      tags: [['t', TAG], ['client', 'diya-chain']],
      content: JSON.stringify({ n: name, w: wish, h: myHue }),
    }, secret);
    const mine = store.get(mineKey, []);
    mine.push(ev);
    store.set(mineKey, mine.slice(-12));
    publish(ev);
    onEvent(ev, { local: true });
    chime();
    const d = byId.get(ev.id);
    if (d) setTimeout(() => { focusOn(d, false); }, 200);
  }

  // ---------- Rendering ----------
  let last = now();
  let emberClock = 0;
  let shooting = null, nextShoot = now() + rand(4, 9);

  function drawDiya(d, x, y, s, t, alphaBowl, flameAmt, isCenter) {
    // bowl
    const bowl = alphaBowl < 0 ? unlitBowl : bowls[d.hue];
    ctx.globalAlpha = Math.abs(alphaBowl);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * x, dpr * y);
    ctx.drawImage(bowl, -34, -10, 68, 42);
    if (flameAmt <= 0) return;
    const ph = d.phase;
    const flick = 1 + 0.07 * Math.sin(t * 7.3 + ph) + 0.05 * Math.sin(t * 13.1 + ph * 1.7) + 0.03 * Math.sin(t * 23 + ph * 0.3);
    const sway = 0.09 * Math.sin(t * 2.6 + ph) + 0.04 * Math.sin(t * 5.9 + ph * 2);
    // glow
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = clamp(flameAmt, 0, 1) * (isCenter ? 0.75 : 0.5) * (0.85 + 0.15 * flick);
    const gs = s * (isCenter ? 1.4 : 1) * (0.9 + 0.1 * flick);
    ctx.setTransform(dpr * gs, 0, 0, dpr * gs, dpr * x, dpr * (y - 12 * s));
    ctx.drawImage(glow, -60, -60, 120, 120);
    ctx.globalCompositeOperation = 'source-over';
    // flame
    ctx.globalAlpha = clamp(flameAmt, 0, 1);
    const fs = s * flameAmt;
    ctx.setTransform(dpr * fs * (1 - 0.03 * (flick - 1)), 0, dpr * fs * sway, dpr * fs * flick, dpr * x, dpr * (y - 2 * s));
    ctx.drawImage(flame, -10, -34, 20, 38);
  }

  const centerDiya = { hue: 0, phase: 3.3 };

  function frame() {
    const t = now();
    const dt = Math.min(0.05, t - last); last = t;

    // view animation
    if (viewTarget) {
      const k = Math.min(1, dt * 4);
      view.zoom += (viewTarget.zoom - view.zoom) * k;
      view.px += (viewTarget.px - view.px) * k;
      view.py += (viewTarget.py - view.py) * k;
      if (Math.abs(viewTarget.zoom - view.zoom) < 0.002 && Math.abs(viewTarget.px - view.px) < 0.5 && Math.abs(viewTarget.py - view.py) < 0.5) viewTarget = null;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);

    // stars
    ctx.fillStyle = '#fff';
    for (const st of stars) {
      ctx.globalAlpha = reduceMotion ? 0.5 : 0.25 + 0.55 * (0.5 + 0.5 * Math.sin(t * st.s + st.p));
      ctx.fillRect(st.x + view.px * 0.04, st.y + view.py * 0.04, st.r, st.r);
    }
    // shooting star
    if (!reduceMotion) {
      if (!shooting && t > nextShoot) shooting = { x: rand(W * 0.1, W * 0.9), y: rand(0, H * 0.3), a: rand(2.4, 2.8), start: t };
      if (shooting) {
        const e = (t - shooting.start) / 0.9;
        if (e >= 1) { shooting = null; nextShoot = t + rand(6, 12); }
        else {
          const len = 120, dist = e * 380;
          const hx = shooting.x + Math.cos(shooting.a) * dist, hy = shooting.y + Math.sin(shooting.a) * dist;
          const g2 = ctx.createLinearGradient(hx, hy, hx - Math.cos(shooting.a) * len, hy - Math.sin(shooting.a) * len);
          g2.addColorStop(0, 'rgba(255,240,210,0.9)'); g2.addColorStop(1, 'rgba(255,240,210,0)');
          ctx.globalAlpha = Math.sin(e * Math.PI); ctx.strokeStyle = g2; ctx.lineWidth = 1.4;
          ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - Math.cos(shooting.a) * len, hy - Math.sin(shooting.a) * len); ctx.stroke();
        }
      }
    }

    const z = view.zoom;
    const ox = cx + view.px, oy = cy + view.py;
    const sx = (wx) => ox + wx * z;
    const sy = (wy) => oy + wy * z;

    // rangoli
    if (rangoli) {
      ctx.globalAlpha = 0.85 + 0.15 * Math.sin(t * 0.8);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.drawImage(rangoli, ox - (rangoliSize / 2) * z, oy - (rangoliSize / 2) * z, rangoliSize * z, rangoliSize * z);
    }
    // centre flower (slowly rotating)
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * ox, dpr * oy);
    ctx.rotate(reduceMotion ? 0 : t * 0.12);
    for (let i = 0; i < 12; i++) {
      ctx.rotate(Math.PI / 6);
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = PALETTE[i % PALETTE.length].c;
      ctx.beginPath();
      ctx.ellipse(S * 0.28, 0, S * 0.2, S * 0.07, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // centre diya
    const s0 = (D * z) / 64;
    drawDiya(centerDiya, ox, oy + 8 * s0 * 1.3, s0 * 1.3, t, 1, 1, true);

    // diyas
    const s = (D * z) / 64;
    const lerpK = Math.min(1, dt * 5);
    for (let i = 0; i < diyas.length; i++) {
      const d = diyas[i];
      d.x += (d.tx - d.x) * lerpK; d.y += (d.ty - d.y) * lerpK;
      if (t < d.appear) continue;
      const x = sx(d.x), y = sy(d.y) + 6 * s;
      if (x < -60 || x > W + 60 || y < -60 || y > H + 60) continue;
      const appearA = clamp((t - d.appear) / 0.35, 0, 1);
      const e = (t - d.litAt) / 0.7;
      const flameAmt = e <= 0 ? 0 : e >= 1 ? 1 : easeOutBack(e);
      if (e > 0 && !d.burst) { d.burst = true; if (t - d.litAt < 0.5) burst(d.x, d.y - D * 0.25, d.hue, d === lastFocus ? 34 : 14); }
      // my diya: soft pulsing ring
      const isFocus = focusPulse && focusPulse.id === d.id && t < focusPulse.until;
      if ((d.pub === myPub || isFocus) && flameAmt > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.globalAlpha = (isFocus ? 0.7 : 0.35) * (0.6 + 0.4 * Math.sin(t * 3));
        ctx.strokeStyle = '#ffd977'; ctx.lineWidth = isFocus ? 2 : 1.2;
        ctx.beginPath(); ctx.arc(x, y - 4 * s, S * z * 0.42, 0, Math.PI * 2); ctx.stroke();
      }
      drawDiya(d, x, y, s, t, appearA, flameAmt, false);
    }

    // unlit slots for the next friends
    if (initialDone) {
      const cap = 3 * rings * (rings + 1);
      const shown = Math.min(cap - diyas.length, 6 * rings);
      for (let i = diyas.length; i < diyas.length + shown; i++) {
        const p = slotPos(i);
        const x = sx(p.x), y = sy(p.y) + 6 * s;
        const pulse = i === diyas.length && !reduceMotion ? 0.32 + 0.14 * Math.sin(t * 2.5) : 0.18;
        drawDiya(centerDiya, x, y, s * 0.9, t, -pulse, 0, false);
      }
    }

    // comets (flame travelling along the chain)
    ctx.globalCompositeOperation = 'lighter';
    for (let i = comets.length - 1; i >= 0; i--) {
      const c = comets[i];
      const e = (t - c.start) / c.dur;
      if (e < 0) continue;
      const tx = c.d.x, ty = c.d.y - D * 0.25;
      if (e >= 1) { comets.splice(i, 1); continue; }
      const k = 1 - Math.pow(1 - e, 2);
      const mx = (c.fx + tx) / 2, my = Math.min(c.fy, ty) - S * 0.9;
      const wx = (1 - k) * (1 - k) * c.fx + 2 * (1 - k) * k * mx + k * k * tx;
      const wy = (1 - k) * (1 - k) * c.fy + 2 * (1 - k) * k * my + k * k * ty;
      ctx.globalAlpha = 0.9;
      const cs = s * 0.55;
      ctx.setTransform(dpr * cs, 0, 0, dpr * cs, dpr * sx(wx), dpr * sy(wy));
      ctx.drawImage(glow, -60, -60, 120, 120);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#fff6d8';
      ctx.beginPath(); ctx.arc(sx(wx), sy(wy), Math.max(1.5, 2.6 * s), 0, Math.PI * 2); ctx.fill();
      for (let n = 0; n < 2; n++) particles.push({ x: wx, y: wy, vx: rand(-12, 12), vy: rand(-12, 12), life: rand(0.35, 0.7), max: 0.7, c: '#ffcf6a', r: rand(0.8, 1.8) });
    }

    // ambient embers rising from diyas
    if (!reduceMotion && diyas.length) {
      emberClock += dt;
      while (emberClock > 0.09) {
        emberClock -= 0.09;
        const d = diyas[(Math.random() * diyas.length) | 0];
        if (d && t > d.litAt + 0.7 && particles.length < 220) {
          particles.push({ x: d.x + rand(-2, 2), y: d.y - D * 0.45, vx: rand(-4, 4), vy: rand(-28, -14), life: rand(1.2, 2.4), max: 2.4, c: '#ffbe55', r: rand(0.6, 1.3), g: -2 });
        }
      }
    }

    // particles
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.life -= dt;
      if (p.life <= 0) { particles.splice(i, 1); continue; }
      p.vy += (p.g != null ? p.g : 70) * dt;
      p.x += p.vx * dt; p.y += p.vy * dt;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.c;
      const r = p.r * Math.max(0.6, z);
      ctx.fillRect(sx(p.x) - r / 2, sy(p.y) - r / 2, r, r);
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    positionTooltip();
    requestAnimationFrame(frame);
  }

  function burst(wx, wy, hue, n) {
    if (reduceMotion) return;
    const cols = ['#ffe27a', '#ffb627', '#fff3c4', PALETTE[hue].c];
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2), v = rand(25, 95);
      particles.push({ x: wx, y: wy, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: rand(0.6, 1.2), max: 1.2, c: cols[i % cols.length], r: rand(1, 2.2) });
    }
  }

  // ---------- Interaction: pan / zoom / tap ----------
  const pointers = new Map();
  let dragMoved = false, pinchStart = null, lastFocus = null;
  function toWorld(px, py) { return { x: (px - cx - view.px) / view.zoom, y: (py - cy - view.py) / view.zoom }; }
  function hitTest(px, py) {
    const w = toWorld(px, py);
    let best = null, bd = (S * 0.5) ** 2;
    for (const d of diyas) {
      const dx = d.x - w.x, dy = d.y - D * 0.1 - w.y, dd = dx * dx + dy * dy;
      if (dd < bd && now() > d.appear) { bd = dd; best = d; }
    }
    return best;
  }
  function clampZoom(z) { return clamp(z, 0.6, 7); }
  function zoomAt(px, py, factor) {
    const w = toWorld(px, py);
    const nz = clampZoom(view.zoom * factor);
    view.zoom = nz;
    view.px = px - cx - w.x * nz;
    view.py = py - cy - w.y * nz;
  }

  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY });
    dragMoved = false; viewTarget = null;
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom: view.zoom };
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') { const d = hitTest(e.clientX, e.clientY); showTooltip(d); canvas.style.cursor = d ? 'pointer' : ''; }
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 5) dragMoved = true;
    if (pointers.size === 1 && dragMoved) {
      view.px += dx; view.py += dy; canvas.classList.add('dragging'); showTooltip(null);
    } else if (pointers.size === 2 && pinchStart) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (pinchStart.zoom * dist / pinchStart.dist) / view.zoom);
      view.px += dx / 2; view.py += dy / 2;
    }
  });
  function endPointer(e) {
    const p = pointers.get(e.pointerId);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    canvas.classList.remove('dragging');
    if (p && !dragMoved && e.type === 'pointerup') {
      const d = hitTest(e.clientX, e.clientY);
      showTooltip(d && d !== tipDiya ? d : (e.pointerType === 'mouse' ? d : null));
    }
  }
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', endPointer);
  canvas.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !pointers.size) showTooltip(null); });
  canvas.addEventListener('wheel', (e) => { e.preventDefault(); viewTarget = null; zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  canvas.addEventListener('dblclick', () => { viewTarget = { zoom: 1, px: 0, py: 0 }; });

  // ---------- Tooltip ----------
  let tipDiya = null;
  const tip = $('tooltip');
  function showTooltip(d) {
    tipDiya = d;
    if (!d) { tip.hidden = true; return; }
    $('ttName').textContent = d.name + (d.pub === myPub ? ' (you)' : '');
    $('ttWish').textContent = d.wish ? '“' + d.wish + '”' : 'lit a diya 🪔';
    $('ttTime').textContent = 'Lit ' + timeAgo(d.created);
    tip.hidden = false;
    positionTooltip();
  }
  function positionTooltip() {
    if (!tipDiya || tip.hidden) return;
    const x = cx + view.px + tipDiya.x * view.zoom;
    const y = cy + view.py + tipDiya.y * view.zoom - D * view.zoom * 0.55;
    const w = tip.offsetWidth;
    tip.style.left = clamp(x, w / 2 + 8, W - w / 2 - 8) + 'px';
    tip.style.top = Math.max(y, tip.offsetHeight + 22) + 'px';
  }

  function focusOn(d, zoomIn = true) {
    lastFocus = d;
    focusPulse = { id: d.id, until: now() + 4 };
    const z = zoomIn ? Math.max(view.zoom, clampZoom(Math.min(2.4, 70 / S))) : view.zoom;
    if (zoomIn) viewTarget = { zoom: z, px: -d.tx * z, py: -d.ty * z };
    setTimeout(() => showTooltip(d), zoomIn ? 450 : 1100);
  }

  // ---------- Toasts ----------
  function toast(d) {
    const el = document.createElement('div');
    el.className = 'toast';
    const b = document.createElement('b'); b.textContent = d.name;
    el.append('🪔 ', b, ' just lit a diya' + (d.wish ? ': “' + d.wish + '”' : ''));
    const box = $('toasts');
    box.prepend(el);
    while (box.children.length > 3) box.lastChild.remove();
    setTimeout(() => el.remove(), 4600);
  }

  // ---------- Count & list ----------
  let shownCount = 0, countAnim = null;
  function updateCount() {
    const target = diyas.length;
    $('countLabel').textContent = target === 1 ? 'diya glowing' : 'diyas glowing';
    cancelAnimationFrame(countAnim);
    const from = shownCount, t0 = performance.now();
    const step = () => {
      const e = Math.min(1, (performance.now() - t0) / 1200);
      shownCount = Math.round(from + (target - from) * (1 - Math.pow(1 - e, 3)));
      $('count').textContent = shownCount.toLocaleString();
      if (e < 1) countAnim = requestAnimationFrame(step);
    };
    step();
  }

  let listTimer = null;
  function renderList() {
    clearTimeout(listTimer);
    listTimer = setTimeout(() => {
      const ol = $('wishList');
      ol.replaceChildren();
      if (!diyas.length) {
        const li = document.createElement('li'); li.className = 'empty';
        li.textContent = 'No diyas yet. Be the first to light one!';
        ol.append(li);
        return;
      }
      for (let i = diyas.length - 1; i >= 0; i--) {
        const d = diyas[i];
        const li = document.createElement('li');
        const dot = document.createElement('span'); dot.className = 'swatch-dot'; dot.style.background = PALETTE[d.hue].c;
        const body = document.createElement('div');
        const nm = document.createElement('div'); nm.className = 'w-name'; nm.textContent = d.name + (d.pub === myPub ? ' (you)' : '');
        const sm = document.createElement('small'); sm.textContent = timeAgo(d.created); nm.append(sm);
        body.append(nm);
        if (d.wish) { const w = document.createElement('div'); w.className = 'w-wish'; w.textContent = d.wish; body.append(w); }
        li.append(dot, body);
        li.addEventListener('click', () => { closeDrawer(); focusOn(d); });
        ol.append(li);
      }
    }, 150);
  }

  // ---------- Panel / UI ----------
  const drawer = $('drawer');
  function closeDrawer() { drawer.classList.remove('open'); drawer.setAttribute('aria-hidden', 'true'); }
  $('wishesBtn').addEventListener('click', () => { renderList(); drawer.classList.add('open'); drawer.setAttribute('aria-hidden', 'false'); });
  $('closeDrawer').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { closeDrawer(); showTooltip(null); } });

  if (prettyRoom) $('circleName').textContent = ' · ' + prettyRoom;
  if (prettyRoom) document.title = prettyRoom + ' · Diya Chain';

  // swatches
  const swRow = $('swatches');
  const lbl = document.createElement('span'); lbl.textContent = 'Diya colour'; lbl.style.marginRight = '4px';
  swRow.append(lbl);
  PALETTE.forEach((p, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'swatch'; b.title = p.name;
    b.setAttribute('role', 'radio'); b.setAttribute('aria-label', p.name);
    b.style.background = `linear-gradient(180deg, ${p.c}, ${p.d})`;
    b.addEventListener('click', () => { myHue = i; store.set('dc.hue', i); syncSwatches(); });
    swRow.append(b);
  });
  function syncSwatches() { [...swRow.querySelectorAll('.swatch')].forEach((b, i) => b.setAttribute('aria-checked', String(i === myHue))); }
  syncSwatches();

  const nameInput = $('nameInput'), wishInput = $('wishInput');
  nameInput.value = store.get('dc.name', '');

  let forceForm = false;
  function syncPanel() {
    const lit = diyas.some((d) => d.pub === myPub) || store.get(mineKey, []).length > 0;
    const showLit = lit && !forceForm;
    $('lightForm').hidden = showLit;
    $('litView').hidden = !showLit;
    if (showLit) {
      const nm = store.get('dc.name', '');
      $('litTitle').textContent = nm ? `✨ Your diya is glowing, ${nm}!` : '✨ Your diya is glowing!';
    }
    const text = `🪔 I just lit a diya in our Diwali Diya Chain${prettyRoom ? ' (' + prettyRoom + ')' : ''}. Come light yours and make it glow brighter! ✨\n${shareUrl()}`;
    $('waBtn').href = 'https://wa.me/?text=' + encodeURIComponent(text);
    requestAnimationFrame(measure);
  }

  let cooldownUntil = 0;
  $('lightForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const name = clean(nameInput.value, 24);
    if (!name) { nameInput.focus(); return; }
    if (Date.now() < cooldownUntil) return;
    cooldownUntil = Date.now() + 8000;
    store.set('dc.name', name);
    if (!initialDone) reveal();
    lightDiya(name, clean(wishInput.value, 100));
    wishInput.value = '';
    forceForm = false;
    syncPanel();
  });

  $('copyBtn').addEventListener('click', async () => {
    const url = shareUrl();
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: 'Diya Chain', text: 'Light a diya with me this Diwali 🪔', url }); return; }
      await navigator.clipboard.writeText(url);
      $('copyBtn').textContent = 'Copied ✓';
    } catch {
      prompt('Copy this link:', url);
    }
    setTimeout(() => { $('copyBtn').textContent = 'Copy link'; }, 2000);
  });
  $('againBtn').addEventListener('click', () => { forceForm = true; syncPanel(); wishInput.placeholder = 'A wish for someone you love'; setTimeout(() => wishInput.focus(), 50); });

  const dlg = $('circleDialog');
  const openCircle = () => { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute('open', ''); setTimeout(() => $('circleInput').focus(), 50); };
  $('newCircleBtn').addEventListener('click', openCircle);
  $('circleLink').addEventListener('click', openCircle);
  $('circleCancel').addEventListener('click', () => dlg.close());
  $('circleForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const slug = $('circleInput').value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'friends';
    const id = slug + '-' + Math.random().toString(36).slice(2, 6).padEnd(4, 'x');
    location.href = location.pathname + '?c=' + id;
  });

  // ---------- Chime ----------
  function chime() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ac = chime.ac || (chime.ac = new AC());
      const t0 = ac.currentTime;
      [[880, 0.18], [1320, 0.1], [1760, 0.06], [2640, 0.03]].forEach(([f, v], i) => {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0, t0 + i * 0.01);
        g.gain.linearRampToValueAtTime(v, t0 + 0.02 + i * 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 2.2);
        o.connect(g).connect(ac.destination); o.start(t0); o.stop(t0 + 2.3);
      });
    } catch { /* sound is optional */ }
  }

  // ---------- Boot ----------
  window.addEventListener('resize', measure);
  if ('ResizeObserver' in window) new ResizeObserver(() => measure()).observe($('panel'));
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(measure);
  measure();
  updateNet();
  syncPanel();
  requestAnimationFrame(frame);
  setInterval(renderList, 60000);
})();
