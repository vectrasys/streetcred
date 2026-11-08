#!/usr/bin/env node
// Собственная подложка карты из геометрии OpenStreetMap (ODbL): здания,
// парки, пляжи, вода, дорожки, улицы. Без единого настоящего названия.
//   node scripts/build-basemap.mjs <layers.json> <osm.json>
import { readFileSync, writeFileSync } from 'node:fs';

const layers = JSON.parse(readFileSync(process.argv[2], 'utf8')).elements;
const roads = JSON.parse(readFileSync(process.argv[3], 'utf8')).elements.filter((e) => e.type === 'way');
const city = JSON.parse(readFileSync(new URL('../data/city.json', import.meta.url), 'utf8'));
const BB = { s: 36.575, w: -121.955, n: 36.638, e: -121.868 };
const Q = 1e5;
const enc = (pts) => {
  // Целые 1e-5° с разностным кодированием: компактно и без потери точности.
  const out = []; let pl = 0; let pn = 0;
  for (const [lat, lon] of pts) {
    const a = Math.round(lat * Q); const b = Math.round(lon * Q);
    out.push(a - pl, b - pn); pl = a; pn = b;
  }
  return out;
};
const inBox = (g) => g.some((p) => p.lat > BB.s && p.lat < BB.n && p.lon > BB.w && p.lon < BB.e);
const pts = (g) => g.map((p) => [p.lat, p.lon]);

const out = { bbox: [BB.s, BB.w, BB.n, BB.e], q: Q, building: [], park: [], wood: [], sand: [], water: [], pitch: [], path: [], service: [], road: [], major: [], ocean: [] };
for (const e of layers) {
  if (!e.geometry || !inBox(e.geometry)) continue;
  const t = e.tags || {};
  let cls = null;
  if (t.building) cls = 'building';
  else if (t.natural === 'coastline') continue;
  else if (['park', 'garden', 'playground', 'recreation_ground'].includes(t.leisure) || ['grass', 'meadow', 'recreation_ground', 'cemetery'].includes(t.landuse)) cls = 'park';
  else if (t.leisure === 'golf_course') cls = 'park';
  else if (t.leisure === 'pitch') cls = 'pitch';
  else if (['wood', 'scrub'].includes(t.natural) || t.landuse === 'forest') cls = 'wood';
  else if (['beach', 'sand'].includes(t.natural)) cls = 'sand';
  else if (t.natural === 'water') cls = 'water';
  else if (['footway', 'path', 'pedestrian', 'cycleway'].includes(t.highway)) cls = 'path';
  else if (t.highway === 'service') cls = 'service';
  if (cls) out[cls].push(enc(pts(e.geometry)));
}
for (const w of roads) {
  if (!inBox(w.geometry)) continue;
  out[['primary', 'secondary'].includes(w.tags.highway) ? 'major' : 'road'].push(enc(pts(w.geometry)));
}

// Вода: склеиваем участки береговой линии и замыкаем по краю рамки.
const coast = layers.filter((e) => e.tags && e.tags.natural === 'coastline').map((e) => pts(e.geometry));
const key = (p) => `${p[0].toFixed(7)},${p[1].toFixed(7)}`;
const lines = [...coast];
let merged = true;
while (merged) {
  merged = false;
  outer: for (let i = 0; i < lines.length; i += 1) {
    for (let j = 0; j < lines.length; j += 1) {
      if (i !== j && key(lines[i].at(-1)) === key(lines[j][0])) {
        lines[i] = lines[i].concat(lines[j].slice(1)); lines.splice(j, 1); merged = true; break outer;
      }
    }
  }
}
const BIG = { s: 36.50, w: -122.05, n: 36.72, e: -121.78 };
const clip = (line) => line.filter((p) => p[0] > BIG.s && p[0] < BIG.n && p[1] > BIG.w && p[1] < BIG.e);
const longest = lines.map(clip).sort((a, b) => b.length - a.length)[0];
const inside = (pt, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const [yi, xi] = poly[i]; const [yj, xj] = poly[j];
    if ((yi > pt[0]) !== (yj > pt[0]) && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};
const corners = [[BIG.n, BIG.w], [BIG.n, BIG.e], [BIG.s, BIG.e], [BIG.s, BIG.w]];
const WATER_PT = [36.6255, -121.889]; // залив
const LAND_PT = [36.600, -121.920];   // город
let ocean = null;
for (let start = 0; start < 4 && !ocean; start += 1) {
  for (const dir of [1, -1]) {
    for (let k = 1; k <= 3; k += 1) {
      const path = Array.from({ length: k }, (_, m) => corners[((start + dir * m) % 4 + 4) % 4]);
      const poly = longest.concat(path);
      if (inside(WATER_PT, poly) && !inside(LAND_PT, poly)) { ocean = poly; break; }
    }
    if (ocean) break;
  }
}
if (ocean) out.ocean.push(enc(ocean));
console.log('береговых линий после склейки:', lines.length, '| вода:', ocean ? `${ocean.length} точек` : 'НЕ ПОСТРОЕНА');
for (const k of Object.keys(out)) if (Array.isArray(out[k]) && k !== 'bbox') console.log(k.padEnd(9), out[k].length);
writeFileSync(new URL('../data/basemap.json', import.meta.url), JSON.stringify(out));
// Публикуется с хешем в имени: node scripts/version-basemap.mjs
