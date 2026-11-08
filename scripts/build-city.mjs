#!/usr/bin/env node
// Собирает данные города Port Calloway из геометрии улиц OpenStreetMap.
// Настоящие названия используются только для группировки участков улиц и в
// результат не попадают: каждой улице даётся вымышленное имя в духе района.
//   node scripts/build-city.mjs <osm.json>
// Результат — data/city.json. Геометрия © участники OpenStreetMap (ODbL).
import { readFileSync, writeFileSync } from 'node:fs';
import { makeRng } from './rng.mjs';
import { DISTRICTS } from './districts.mjs';

const osm = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const rng = makeRng(20261003);
const pick = (arr) => arr[Math.floor(rng() * arr.length)];


// Районы — по ближайшему центру (в метрах): границы идут по реальной застройке.
const M_LAT = 111320;
const M_LON = 111320 * Math.cos(36.6 * Math.PI / 180);
const dist = (a, b) => Math.hypot((a[0] - b[0]) * M_LAT, (a[1] - b[1]) * M_LON);
const districtOf = (p) => DISTRICTS.reduce((best, d) => (dist(p, d.center) < dist(p, best.center) ? d : best));

// Лесной массив в середине — без района: там почти нет улиц.
const WOODS = { center: [36.6005, -121.9155], r: 650 };

const ways = osm.elements.filter((e) => e.type === 'way');
// Настоящие названия этого места — под запретом даже при случайном совпадении.
const REAL = new Set(ways.map((w) => w.tags && w.tags.name).filter(Boolean));
const nodes = osm.elements.filter((e) => e.type === 'node');

// Вымышленные имена улиц: группа участков с одним настоящим именем — одно имя.
const used = new Set();
const fake = new Map();
const MAJOR = ['Calloway Boulevard', 'Bayfront Highway', 'Old Coast Road', 'Harbor Boulevard', 'Cannery Road',
  'Mission Boulevard', 'Ridge Road', 'Pinecrest Drive', 'Founders Avenue', 'Tidewater Avenue', 'Prospect Avenue'];
function suffix(way) {
  const g = way.geometry;
  const straight = dist([g[0].lat, g[0].lon], [g.at(-1).lat, g.at(-1).lon]);
  let len = 0;
  for (let i = 1; i < g.length; i += 1) len += dist([g[i - 1].lat, g[i - 1].lon], [g[i].lat, g[i].lon]);
  const curvy = len > straight * 1.15;
  if (curvy) return pick(['Drive', 'Way', 'Lane', 'Road', 'Circle']);
  if (len < 120) return pick(['Court', 'Place', 'Lane']);
  return pick(['Street', 'Avenue', 'Street', 'Avenue', 'Way']);
}
function fakeName(way) {
  const key = way.tags.name || `#${way.id}`;
  if (fake.has(key)) return fake.get(key);
  const mid = way.geometry[Math.floor(way.geometry.length / 2)];
  const d = districtOf([mid.lat, mid.lon]);
  let name = null;
  if (['primary', 'secondary'].includes(way.tags.highway)) {
    name = MAJOR.find((n) => !used.has(n) && !REAL.has(n)) || null;
  }
  for (let i = 0; !name && i < 40; i += 1) {
    const cand = `${pick(d.names)} ${suffix(way)}`;
    if (!used.has(cand) && !REAL.has(cand)) name = cand;
  }
  for (let i = 0; !name && i < 40; i += 1) {
    const cand = `${pick(d.names)} ${pick(['Row', 'Walk', 'Terrace', 'Alley', 'Close', 'Rise'])}`;
    if (!used.has(cand) && !REAL.has(cand)) name = cand;
  }
  if (!name) name = `${pick(d.names)} Lane No. ${used.size}`;
  used.add(name);
  fake.set(key, name);
  return name;
}
const wayName = new Map(ways.map((w) => [w.id, fakeName(w)]));
const nodeWays = new Map();
for (const w of ways) for (const n of w.nodes) {
  if (!nodeWays.has(n)) nodeWays.set(n, new Set());
  nodeWays.get(n).add(wayName.get(w.id));
}

// Камеры: перекрёстки не ближе 85 м друг к другу.
const cands = nodes
  .map((n) => ({ id: n.id, p: [n.lat, n.lon], streets: [...(nodeWays.get(n.id) || [])] }))
  .filter((c) => c.streets.length >= 2 && dist(c.p, WOODS.center) > WOODS.r);
for (let i = cands.length - 1; i > 0; i -= 1) { const j = Math.floor(rng() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
const cams = [];
for (const c of cands) {
  if (cams.every((k) => dist(k.p, c.p) > 85)) cams.push(c);
}
const VIEWS = 40;
const cameras = cams.map((c, i) => {
  const d = districtOf(c.p);
  const r = rng();
  return {
    id: `CAM-${String(i + 1).padStart(4, '0')}`,
    lat: Number(c.p[0].toFixed(6)), lon: Number(c.p[1].toFixed(6)),
    district: d.id,
    streets: c.streets.slice(0, 2),
    status: r < 0.93 ? 'online' : r < 0.975 ? 'maintenance' : 'offline',
    view: `v${String(1 + Math.floor(rng() * VIEWS)).padStart(2, '0')}`,
    mirror: rng() < 0.5,
    installed: 2019 + Math.floor(rng() * 7),
  };
});

// ---------- задания ----------
const KINDS = {
  bags: { title: 'Clear dumped garbage bags', reward: [15, 25], where: ['heights', 'seaview', 'grove', 'wharf'] },
  graffiti: { title: 'Paint over graffiti', reward: [30, 45], where: ['cooperage', 'plaza', 'wharf', 'millworks'] },
  couch: { title: 'Haul away an abandoned couch', reward: [40, 60], where: ['heights', 'seaview', 'grove'] },
  mattress: { title: 'Remove a dumped mattress', reward: [35, 50], where: ['seaview', 'heights', 'millworks'] },
  tires: { title: 'Remove dumped tires', reward: [20, 30], where: ['millworks', 'seaview', 'heights'] },
  cart: { title: 'Return an abandoned shopping cart', reward: [10, 15], where: ['plaza', 'wharf', 'seaview'] },
  branches: { title: 'Clear fallen branches from the sidewalk', reward: [20, 35], where: ['heights', 'grove', 'seaview'] },
  boxes: { title: 'Break down and recycle dumped boxes', reward: [15, 20], where: ['plaza', 'cooperage', 'wharf'] },
  litter: { title: 'Pick up litter', reward: [10, 20], where: ['grove', 'plaza', 'heights'] },
  drain: { title: 'Clear leaves from a storm drain before the rain', reward: [25, 35], where: ['wharf', 'cooperage', 'plaza'] },
  weeds: { title: 'Pull weeds blocking the sidewalk', reward: [15, 25], where: ['seaview', 'grove', 'heights'] },
  bin: { title: 'Clean up around an overflowing trash can', reward: [10, 15], where: ['plaza', 'wharf', 'cooperage'] },
  flyers: { title: 'Remove old flyers from a pole', reward: [10, 12], where: ['plaza', 'grove', 'cooperage'] },
  debris: { title: 'Haul away construction debris', reward: [45, 60], where: ['millworks', 'cooperage', 'heights', 'seaview'] },
  butts: { title: 'Sweep up cigarette butts', reward: [10, 15], where: ['plaza', 'cooperage', 'wharf'] },
  leaves: { title: 'Rake fallen leaves off the sidewalk', reward: [15, 25], where: ['grove', 'heights', 'seaview', 'plaza'] },
  windblown: { title: 'Collect wind-blown trash along a fence', reward: [10, 20], where: ['seaview', 'millworks'] },
  beach: { title: 'Pick up litter on the beach', reward: [15, 25], where: ['wharf', 'seaview'] },
  stickers: { title: 'Scrape off stickers', reward: [10, 15], where: ['plaza', 'cooperage', 'wharf', 'millworks'] },
};
const batch = JSON.parse(readFileSync(new URL('../data/batch-prompts.json', import.meta.url), 'utf8'));
const takenCams = new Set();
const camIn = (district) => {
  const pool = cameras.filter((c) => c.district === district && c.status === 'online' && !takenCams.has(c.id));
  const c = pool[Math.floor(rng() * pool.length)];
  takenCams.add(c.id);
  return c;
};
const STATUSES = [...Array(34).fill('open'), ...Array(6).fill('claimed'), ...Array(4).fill('in_review'), ...Array(6).fill('completed')];
const NOW = Date.UTC(2026, 9, 3, 17, 0, 0);
const DAY = 86400000;
const tasks = batch.tasks.map((t, i) => {
  const k = KINDS[t.kind];
  const district = t.district;
  const cam = camIn(district);
  const [lo, hi] = k.reward;
  return {
    id: `T-${String(2040 + i)}`, frame: t.id, kind: t.kind, title: k.title, cameraId: cam.id,
    district, address: `${cam.streets[0]} & ${cam.streets[1]}`,
    reward: (Math.round((lo + rng() * (hi - lo)) / 5) * 5).toFixed(2),
    status: STATUSES[i], source: rng() < 0.4 ? 'resident' : 'city',
    createdAt: NOW - Math.floor(rng() * 9 * DAY),
  };
});

// ---------- жители ----------
const FIRST = ['Maya', 'Jordan', 'Luis', 'Priya', 'Ethan', 'Sofia', 'Marcus', 'Hannah', 'Diego', 'Grace', 'Kenji', 'Amara', 'Noah', 'Isabel',
  'Tyrone', 'Mei', 'Owen', 'Fatima', 'Caleb', 'Rosa', 'Andre', 'Leah', 'Samir', 'Chloe', 'Mateo', 'Naomi', 'Wyatt', 'Aaliyah', 'Hiro', 'Elena',
  'Dante', 'Ruby', 'Omar', 'Zoe', 'Felix', 'Imani', 'Quinn', 'Lucia', 'Theo', 'Nadia'];
const LAST = ['Okafor', 'Reyes', 'Brennan', 'Patel', 'Nguyen', 'Kowalski', 'Haddad', 'Lindqvist', 'Moreno', 'Takahashi', 'Delgado', 'Fischer',
  'Abara', 'Castillo', 'Sullivan', 'Chen', 'Mbeki', 'Ortega', 'Novak', 'Ramirez', 'Yamamoto', 'Duarte', 'Hollis', 'Sato'];
const residents = FIRST.map((f, i) => {
  const last = LAST[i % LAST.length];
  return {
    id: f.toLowerCase(), name: `${f} ${last[0]}.`, fullName: `${f} ${last}`,
    paypal: `${f.toLowerCase()}.${last.toLowerCase()}@example.com`,
    joined: NOW - Math.floor((30 + rng() * 300) * DAY),
    district: DISTRICTS[Math.floor(rng() * DISTRICTS.length)].id,
    w9: rng() < 0.7 ? 'on_file' : 'not_required',
  };
});

// ---------- история выплат: ежедневные пакеты Payouts (будни, 17:00 PT) ----------
// Невостребованные выплаты PayPal возвращает через 30 дней: UNCLAIMED бывает
// только у свежих пакетов, RETURNED — только у старых.
const history = [];
const pad = (n) => String(n).padStart(2, '0');
for (let d = 56; d >= 1; d -= 1) {
  const day = new Date(NOW - d * DAY);
  if ([0, 6].includes(day.getUTCDay())) continue;
  const at = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate() + 1, 0, 4); // 17:04 PDT
  const age = (NOW - at) / DAY;
  const items = [];
  const n = 1 + Math.floor(rng() * 5);
  for (let j = 0; j < n; j += 1) {
    const r = residents[Math.floor(Math.pow(rng(), 1.8) * residents.length)];
    const kind = pick(Object.keys(KINDS));
    const [lo, hi] = KINDS[kind].reward;
    const x = rng();
    const status = x < 0.93 ? 'SUCCESS' : x < 0.97 ? (age > 30 ? 'RETURNED' : 'UNCLAIMED') : age < 10 ? 'ONHOLD' : 'SUCCESS';
    items.push({ residentId: r.id, kind, amount: (Math.round((lo + rng() * (hi - lo)) / 5) * 5).toFixed(2), status });
  }
  history.push({
    id: `PB-${day.getUTCFullYear()}${pad(day.getUTCMonth() + 1)}${pad(day.getUTCDate())}-001`,
    payoutBatchId: `HIST${Math.floor(rng() * 1e10).toString(36).toUpperCase()}`, createdAt: at, status: 'SUCCESS', items,
  });
}

// ---------- предложения жителей на модерации ----------
const PROPOSAL_TEXT = [
  'Someone dumped a broken recliner next to the bus stop last night.',
  'Graffiti on the side of the old cannery wall facing the bike path.',
  'Storm drain fully blocked with leaves, the street floods every time it rains.',
  'Pile of tires behind the auto shop fence, been there two weeks.',
  'Overflowing can at the corner, trash blowing into the street.',
  'Fallen eucalyptus branch blocking half of the sidewalk.',
  'Old mattress leaning on the fence by the playground.',
  'Shopping carts abandoned in the creek access path.',
];
const proposals = PROPOSAL_TEXT.map((text, i) => {
  const cam = cameras[Math.floor(rng() * cameras.length)];
  return { id: `P-${880 + i}`, residentId: residents[Math.floor(rng() * 20)].id, cameraId: cam.id, district: cam.district,
    text, status: 'pending', createdAt: NOW - Math.floor(rng() * 3 * DAY) };
});

// ---------- улицы для подписей на карте (геометрия упрощена) ----------
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts.at(-1)];
  let idx = 0; let dmax = 0;
  for (let i = 1; i < pts.length - 1; i += 1) {
    const p = pts[i];
    const dx = (b[1] - a[1]) * M_LON; const dy = (b[0] - a[0]) * M_LAT;
    const len = Math.hypot(dx, dy) || 1;
    const d = Math.abs(dx * (a[0] - p[0]) * M_LAT - (a[1] - p[1]) * M_LON * dy) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= tol) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), tol).slice(0, -1), ...simplify(pts.slice(idx), tol)];
}
const streets = ways.map((w) => ({
  name: wayName.get(w.id),
  major: ['primary', 'secondary', 'tertiary'].includes(w.tags.highway),
  path: simplify(w.geometry.map((g) => [Number(g.lat.toFixed(5)), Number(g.lon.toFixed(5))]), 4),
}));

// Вид камеры — один из сгенерированных кадров её района (data/batch-prompts.json).
{
  const views = JSON.parse(readFileSync(new URL('../data/batch-prompts.json', import.meta.url), 'utf8')).views;
  const byDistrict = views.reduce((m, v) => ({ ...m, [v.district]: [...(m[v.district] || []), v.id] }), {});
  for (const c of cameras) {
    const list = byDistrict[c.district];
    if (list) c.view = list[(Number(c.view.slice(1)) - 1) % list.length];
  }
}
const out = {
  name: 'Port Calloway', state: 'CA', founded: 1849,
  bbox: [36.585, -121.945, 36.628, -121.880],
  districts: DISTRICTS.map(({ names, ...d }) => d),
  cameras, tasks, residents, history, proposals, streets,
  streetCount: used.size,
  generatedAt: NOW,
};
writeFileSync(new URL('../data/city.json', import.meta.url), `${JSON.stringify(out)}\n`);
console.log('камер:', cameras.length, '| заданий:', tasks.length, '| жителей:', residents.length, '| пакетов:', history.length, '| улиц:', used.size,
  '| по районам:', JSON.stringify(Object.fromEntries(DISTRICTS.map((d) => [d.id, cameras.filter((c) => c.district === d.id).length]))));
