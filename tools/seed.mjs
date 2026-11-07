// Seed the map with diyas lit openly by "Diwali Globe", so it isn't empty on day one.
//
//   node tools/seed.mjs            publish the seed (diyas + cracker tally)
//   node tools/seed.mjs --dry      print what would be published
//   node tools/seed.mjs --resend   publish the saved seed again, skipping what each relay already has
//     --relays=wss://a,wss://b  only these relays    --gap=3000  ms between events (damus needs ~3000)
//   node tools/seed.mjs --delete   ask relays to delete everything seeded earlier
//
// The page labels anything signed by the seed key as "Diwali Globe" and never
// shows it as live activity. The secret key lives in .seed-key (git-ignored);
// published events are kept in seed-events.json (git-ignored) for --resend and --delete.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';

const room = (process.argv.find((a) => a.startsWith('--room=')) || '--room=world').slice(7);
const TAG = 'diwali-globe:v1:' + room;
const arg = (name) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || '').slice(name.length + 3);
const RELAYS = arg('relays') ? arg('relays').split(',')
  : ['wss://nos.lol', 'wss://relay.primal.net', 'wss://nostr.mom', 'wss://relay.snort.social', 'wss://relay.damus.io'];
const GAP = Number(arg('gap')) || 300; // ms between events; damus needs much more (e.g. --gap=3000)
const dry = process.argv.includes('--dry');
const del = process.argv.includes('--delete');
const resend = process.argv.includes('--resend');
const SAVED = 'seed-events.' + room + '.json';
const saved = existsSync(SAVED) ? JSON.parse(readFileSync(SAVED, 'utf8')) : [];
const sk = Uint8Array.from(Buffer.from(readFileSync(new URL('../.seed-key', import.meta.url), 'utf8').trim(), 'hex'));
console.log('seed pubkey', getPublicKey(sk), 'room', room);

// [city, country, lat, lng, diyas]
const CITIES = [
  ['Mumbai', 'IN', 19.08, 72.88, 18], ['Delhi', 'IN', 28.61, 77.21, 18], ['Bengaluru', 'IN', 12.97, 77.59, 12],
  ['Hyderabad', 'IN', 17.39, 78.49, 10], ['Kolkata', 'IN', 22.57, 88.36, 10], ['Chennai', 'IN', 13.08, 80.27, 9],
  ['Pune', 'IN', 18.52, 73.86, 8], ['Ahmedabad', 'IN', 23.02, 72.57, 8], ['Jaipur', 'IN', 26.91, 75.79, 7],
  ['Lucknow', 'IN', 26.85, 80.95, 6], ['Varanasi', 'IN', 25.32, 82.97, 6], ['Ayodhya', 'IN', 26.79, 82.2, 6],
  ['Patna', 'IN', 25.59, 85.14, 5], ['Amritsar', 'IN', 31.63, 74.87, 5], ['Surat', 'IN', 21.17, 72.83, 4],
  ['Indore', 'IN', 22.72, 75.86, 4], ['Bhopal', 'IN', 23.26, 77.41, 4], ['Chandigarh', 'IN', 30.73, 76.78, 4],
  ['Kochi', 'IN', 9.93, 76.27, 4], ['Guwahati', 'IN', 26.14, 91.74, 3], ['Bhubaneswar', 'IN', 20.3, 85.82, 3],
  ['Nagpur', 'IN', 21.15, 79.09, 3], ['Coimbatore', 'IN', 11.02, 76.96, 3], ['Udaipur', 'IN', 24.59, 73.71, 3],
  ['Mysuru', 'IN', 12.3, 76.64, 3], ['Vadodara', 'IN', 22.31, 73.18, 3], ['Visakhapatnam', 'IN', 17.69, 83.22, 3],
  ['Dehradun', 'IN', 30.32, 78.03, 2], ['Ranchi', 'IN', 23.34, 85.31, 2], ['Panaji', 'IN', 15.49, 73.83, 2],
  ['London', 'GB', 51.51, -0.13, 8], ['Leicester', 'GB', 52.64, -1.13, 4], ['Dubai', 'AE', 25.2, 55.27, 7],
  ['Singapore', 'SG', 1.35, 103.82, 6], ['Toronto', 'CA', 43.65, -79.38, 6], ['New York', 'US', 40.71, -74.01, 6],
  ['Edison', 'US', 40.52, -74.41, 4], ['San Jose', 'US', 37.34, -121.89, 4], ['Houston', 'US', 29.76, -95.37, 3],
  ['Chicago', 'US', 41.88, -87.63, 3], ['Sydney', 'AU', -33.87, 151.21, 4], ['Melbourne', 'AU', -37.81, 144.96, 4],
  ['Auckland', 'NZ', -36.85, 174.76, 2], ['Kathmandu', 'NP', 27.72, 85.32, 4], ['Port Louis', 'MU', -20.16, 57.5, 3],
  ['Durban', 'ZA', -29.86, 31.02, 3], ['Kuala Lumpur', 'MY', 3.14, 101.69, 3], ['Nairobi', 'KE', -1.29, 36.82, 2],
  ['Doha', 'QA', 25.29, 51.53, 2], ['Suva', 'FJ', -18.14, 178.44, 2], ['Port of Spain', 'TT', 10.65, -61.51, 2],
  ['Paramaribo', 'SR', 5.85, -55.2, 1],
];
const WISHES = [
  'Shubh Deepavali', 'Tamaso mā jyotirgamaya: from darkness, lead us to light', 'May every home be full of light',
  'Light over darkness, always', 'Happy Diwali', 'Wishing you light, laughter and sweets', 'May Lakshmi bless your home',
  'Sending light to everyone far from home', 'One more light on the map', 'Shubh Deepavali to all',
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = Math.floor(Date.now() / 1000);
let events = [];

if (resend) {
  events = saved;
} else if (del) {
  const ids = saved.filter((e) => e.kind === 7462).map((e) => e.id);
  if (!ids.length) { console.log('nothing saved for room', room); process.exit(0); }
  for (let i = 0; i < ids.length; i += 100) {
    events.push(finalizeEvent({ kind: 5, created_at: now, tags: ids.slice(i, i + 100).map((id) => ['e', id]).concat([['k', '7462'], ['k', '37462']]), content: 'removing seed diyas' }, sk));
  }
  // an empty tally replaces the seeded one
  events.push(finalizeEvent({ kind: 37462, created_at: now, tags: [['t', TAG], ['d', TAG]], content: JSON.stringify({ v: 1, c: [] }) }, sk));
} else {
  if (saved.length) { console.log(`room ${room} is already seeded; use --resend or --delete first`); process.exit(1); }
  let i = 0;
  for (const [city, cc, la, lo, n] of CITIES) {
    for (let j = 0; j < n; j++, i++) {
      events.push(finalizeEvent({
        kind: 7462,
        created_at: now - 3600 * 30 + Math.floor((i * 3600 * 28) / 280), // spread over the last ~30 hours
        tags: [['t', TAG], ['client', 'diwali-globe'], ['seed', '1']],
        content: JSON.stringify({ t: 'd', n: 'Diwali Globe', w: j < 2 ? WISHES[(i + j) % WISHES.length] : '', city, cc, la, lo }),
      }, sk));
    }
  }
  // cracker counts, roughly proportional to each city's diyas, so the sky starts alive
  const rows = CITIES.map(([city, cc, la, lo, n]) => ({ city, cc, la, lo, n: n * 3 + (city.length % 4) }));
  events.push(finalizeEvent({ kind: 37462, created_at: now, tags: [['t', TAG], ['d', TAG], ['seed', '1']], content: JSON.stringify({ v: 1, c: rows }) }, sk));
}

const diyas = events.filter((e) => e.kind === 7462).length;
console.log(`${events.length} events (${diyas} diyas)`);
if (dry) { console.log(events.slice(0, 2), events.at(-1).content.slice(0, 200)); process.exit(0); }

// Publish slowly, one event at a time: public relays rate-limit (and briefly ban) bulk senders.
// On "rate-limited" back off and retry the same event; on "banned" give up on that relay.
const results = await Promise.all(RELAYS.map((url) => new Promise((done) => {
  const ws = new WebSocket(url);
  const res = { url, ok: 0, bad: 0, why: new Set() };
  let waiting = null;
  const finish = () => { try { ws.close(); } catch {} done(res); };
  ws.onerror = finish;
  ws.onclose = () => done(res);
  const have = new Set();
  let listed;
  const listing = new Promise((r) => { listed = r; setTimeout(r, 10000); });
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d[0] === 'EVENT' && d[1] === 'have') have.add(d[2].id);
    else if ((d[0] === 'EOSE' || d[0] === 'CLOSED') && d[1] === 'have') listed();
    else if (d[0] === 'OK' && waiting && d[1] === waiting.id) { const w = waiting; waiting = null; w.resolve(d); }
  };
  const send = (e) => new Promise((resolve) => {
    waiting = { id: e.id, resolve };
    ws.send(JSON.stringify(['EVENT', e]));
    setTimeout(() => { if (waiting?.id === e.id) { waiting = null; resolve(['OK', e.id, false, 'timeout']); } }, 15000);
  });
  ws.onopen = async () => {
    // skip what this relay already has (cheap on retries; kind-5 deletes are always sent)
    ws.send(JSON.stringify(['REQ', 'have', { ids: events.map((e) => e.id), limit: events.length }]));
    await listing;
    let gap = GAP;
    for (let i = 0; i < events.length; i++) {
      if (have.has(events[i].id)) { res.ok++; continue; }
      const [, , ok, msg = ''] = await send(events[i]);
      if (ok) { res.ok++; gap = Math.max(GAP, gap * 0.9); }
      else if (/^banned/.test(msg)) { res.bad += events.length - i; res.why.add(msg.slice(0, 60)); break; }
      else if (/rate-limit/.test(msg) && gap < 120000) { gap *= 2; console.log(`${url}: rate-limited at ${i}, slowing to ${gap} ms`); await sleep(gap * 5); i--; continue; }
      else { res.bad++; res.why.add(msg.slice(0, 60)); }
      if ((i + 1) % 50 === 0) console.log(`${url}: ${i + 1}/${events.length}`);
      await sleep(gap);
    }
    finish();
  };
})));
for (const r of results) console.log(`${r.url.padEnd(28)} ok=${r.ok} rejected=${r.bad} ${[...r.why].join(' | ')}`);

if (del) writeFileSync(SAVED, '[]');
else if (!resend) { writeFileSync(SAVED, JSON.stringify(events)); console.log('saved to', SAVED); }
process.exit(0);
