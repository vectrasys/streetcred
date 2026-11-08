#!/usr/bin/env node
// Декоративный рельеф подложки считается здесь, а не в браузере (~100 мс на M-серии — дорого для
// загрузки карты). Линии упрощаются (Douglas–Peucker, 4 м), режутся на участки с постоянной
// прозрачностью (6 ступеней) и пишутся компактно, как подложка: целые 1e-5° с разностями.
//   node scripts/build-relief.mjs   → public/js/relief-lines.js (статичный модуль, грузится картой лениво)
import { readFileSync, writeFileSync } from 'node:fs';
import { buildRelief } from './relief-field.mjs';

const base = JSON.parse(readFileSync(new URL('../data/basemap.json', import.meta.url), 'utf8'));
const Q = base.q;
const dec = (arr) => { const o = []; let a = 0; let b = 0; for (let i = 0; i < arr.length; i += 2) { a += arr[i]; b += arr[i + 1]; o.push([a / Q, b / Q]); } return o; };
// Прямой край воды — самый длинный явный отрезок кольца океана (замыкание по углу рамки выгрузки).
const ring = dec(base.ocean[0]);
let edge = null; let edgeLen = 0;
for (let i = 1; i < ring.length; i += 1) {
  const l = Math.hypot(ring[i][0] - ring[i - 1][0], ring[i][1] - ring[i - 1][1]);
  if (l > edgeLen) { edgeLen = l; edge = [ring[i - 1], ring[i]]; }
}
const lines = buildRelief(base, dec, edge);

const M_LAT = 111320; const M_LON = M_LAT * Math.cos(36.6 * Math.PI / 180);
const TOL = 4; // метров
function simplify(pts) {
  const keep = new Uint8Array(pts.length); keep[0] = 1; keep[pts.length - 1] = 1;
  const xy = pts.map((p) => [p[1] * M_LON, p[0] * M_LAT]);
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let far = -1; let fd = TOL;
    const [ax, ay] = xy[a]; const dx = xy[b][0] - ax; const dy = xy[b][1] - ay; const len = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i += 1) {
      const d = Math.abs((xy[i][0] - ax) * dy - (xy[i][1] - ay) * dx) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}
const STEPS = 6;
const runs = []; let before = 0; let after = 0;
for (const l of lines) {
  before += l.pts.length;
  const pts = l.pts.map((p) => [p[0], p[1], Math.round(p[2] * STEPS)]);
  // Сначала участки постоянной ступени (соседние делят общую точку, чтобы линия не рвалась),
  // потом упрощение каждого — так границы ступеней не смещаются.
  let start = 0;
  for (let i = 1; i <= pts.length; i += 1) {
    if (i < pts.length && pts[i][2] === pts[start][2]) continue;
    const lvl = pts[start][2];
    const seg = simplify(pts.slice(start, Math.min(i + 1, pts.length)));
    if (lvl > 0 && seg.length > 1) {
      const out = [lvl, l.index ? 1 : 0]; let pa = 0; let pb = 0;
      for (const [lat, lon] of seg) { const a = Math.round(lat * Q); const b = Math.round(lon * Q); out.push(a - pa, b - pb); pa = a; pb = b; }
      runs.push(out); after += seg.length;
    }
    start = i;
  }
}
const out = { q: Q, steps: STEPS, edge, runs };
writeFileSync(new URL('../public/js/relief-lines.js', import.meta.url),
  `// Сгенерировано scripts/build-relief.mjs из data/basemap.json — не править руками.\nexport default ${JSON.stringify(out)};\n`);
console.log('relief: линий', lines.length, '| точек', before, '→', after, '| участков', runs.length, '|', JSON.stringify(out).length, 'байт');
