// Готовится офлайн (scripts/build-relief.mjs), в браузере не считается.
// Декоративный рельеф для пустой земли вокруг города: абстрактные изолинии без высот и подписей
// (DEM у нас нет — это картографическая фактура, а не топография). Поле — детерминированный набор
// холмов, линии — marching squares. Прозрачность каждой вершины гаснет у города (по растру улиц и
// зданий) и у прямого края выгрузки береговой линии, так что линии живут только на пустой суше.
const M_LAT = 111320;

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// base — подложка (dec — её декодер), edge — искусственный отрезок края воды [[lat, lon], [lat, lon]].
export function buildRelief(base, dec, edge) {
  const [s, w, n, e] = base.bbox;
  const G = { s: s - 0.035, n: n + 0.035, w: w - 0.05, e: e + 0.05 };
  const lat0 = (G.s + G.n) / 2; const lon0 = (G.w + G.e) / 2;
  const M_LON = M_LAT * Math.cos(lat0 * Math.PI / 180);
  const STEP = 50; // метров между узлами сетки
  const dLat = STEP / M_LAT; const dLon = STEP / M_LON;
  const R = Math.ceil((G.n - G.s) / dLat) + 1; const C = Math.ceil((G.e - G.w) / dLon) + 1;
  const X = (j) => (G.w + j * dLon - lon0) * M_LON; const Y = (i) => (G.s + i * dLat - lat0) * M_LAT;

  // Поле высот: вытянутые холмы разного размера плюс мягкая волна, чтобы линии не были кругами.
  const rnd = rng(20261004);
  const hills = Array.from({ length: 90 }, () => {
    const big = rnd() < 0.3;
    const r = big ? 1100 + rnd() * 1500 : 350 + rnd() * 750; const k = 1 + rnd() * 1.6; const a = rnd() * Math.PI;
    return { x: (rnd() - 0.5) * (C * STEP), y: (rnd() - 0.5) * (R * STEP), h: (rnd() < 0.2 ? -0.6 : 1) * (big ? 1 : 0.35 + rnd() * 0.5),
      ca: Math.cos(a), sa: Math.sin(a), ir1: 1 / (2 * r * r), ir2: 1 / (2 * (r / k) * (r / k)) };
  });
  const v = new Float32Array(R * C);
  for (let i = 0; i < R; i += 1) {
    for (let j = 0; j < C; j += 1) {
      const y0 = Y(i); const x0 = X(j);
      const x = x0 + 160 * Math.sin(y0 / 900); const y = y0 + 140 * Math.sin(x0 / 1150);
      let f = 0.25 * (x / 4000);
      for (const hl of hills) {
        const dx = x - hl.x; const dy = y - hl.y;
        const u = dx * hl.ca + dy * hl.sa; const q = -dx * hl.sa + dy * hl.ca;
        const ex = u * u * hl.ir1 + q * q * hl.ir2;
        if (ex < 9) f += hl.h * Math.exp(-ex);
      }
      v[i * C + j] = f;
    }
  }

  // Растр «здесь город»: вершины зданий и отрезки улиц/дорожек, затем расстояние (chamfer) в метрах.
  const INF = 1e9; const dist = new Float32Array(R * C).fill(INF);
  const mark = (lat, lon) => {
    const i = Math.round((lat - G.s) / dLat); const j = Math.round((lon - G.w) / dLon);
    if (i >= 0 && i < R && j >= 0 && j < C) dist[i * C + j] = 0;
  };
  for (const k of ['road', 'major', 'service', 'path']) {
    for (const enc of base[k]) {
      const p = dec(enc);
      for (let t = 1; t < p.length; t += 1) {
        const steps = Math.ceil(Math.max(Math.abs(p[t][0] - p[t - 1][0]) / dLat, Math.abs(p[t][1] - p[t - 1][1]) / dLon) * 2) || 1;
        for (let m = 0; m <= steps; m += 1) mark(p[t - 1][0] + (p[t][0] - p[t - 1][0]) * m / steps, p[t - 1][1] + (p[t][1] - p[t - 1][1]) * m / steps);
      }
    }
  }
  for (const enc of base.building) for (const p of dec(enc)) mark(p[0], p[1]);
  const D1 = STEP; const D2 = STEP * Math.SQRT2;
  for (let i = 0; i < R; i += 1) for (let j = 0; j < C; j += 1) {
    const o = i * C + j; let d = dist[o];
    if (j > 0) d = Math.min(d, dist[o - 1] + D1);
    if (i > 0) { d = Math.min(d, dist[o - C] + D1); if (j > 0) d = Math.min(d, dist[o - C - 1] + D2); if (j < C - 1) d = Math.min(d, dist[o - C + 1] + D2); }
    dist[o] = d;
  }
  for (let i = R - 1; i >= 0; i -= 1) for (let j = C - 1; j >= 0; j -= 1) {
    const o = i * C + j; let d = dist[o];
    if (j < C - 1) d = Math.min(d, dist[o + 1] + D1);
    if (i < R - 1) { d = Math.min(d, dist[o + C] + D1); if (j < C - 1) d = Math.min(d, dist[o + C + 1] + D2); if (j > 0) d = Math.min(d, dist[o + C - 1] + D2); }
    dist[o] = d;
  }
  // Расстояние до прямого края воды (в метрах), чтобы линии растворялись, не упираясь в диагональ.
  const ex1 = (edge[0][1] - lon0) * M_LON; const ey1 = (edge[0][0] - lat0) * M_LAT;
  const ex2 = (edge[1][1] - lon0) * M_LON; const ey2 = (edge[1][0] - lat0) * M_LAT;
  const edgeDist = (x, y) => {
    const dx = ex2 - ex1; const dy = ey2 - ey1; const t = Math.max(0, Math.min(1, ((x - ex1) * dx + (y - ey1) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - ex1 - t * dx, y - ey1 - t * dy);
  };

  // Marching squares. Рёбра: горизонтальное (i,j)→(i,j+1) = 2·o, вертикальное (i,j)→(i+1,j) = 2·o+1.
  let lo = Infinity; let hi = -Infinity;
  for (const x of v) { if (x < lo) lo = x; if (x > hi) hi = x; }
  const LEVELS = 26; const gap = (hi - lo) / (LEVELS + 1);
  const T = [null, [3, 2], [2, 1], [3, 1], [0, 1], null, [0, 2], [3, 0], [3, 0], [0, 2], null, [0, 1], [3, 1], [2, 1], [3, 2], null];
  const lines = [];
  for (let L = 1; L <= LEVELS; L += 1) {
    const lv = lo + L * gap;
    const segs = []; const at = new Map();
    const edgeId = (i, j, side) => (side === 0 ? (i * C + j) * 2 : side === 1 ? (i * C + j + 1) * 2 + 1 : side === 2 ? ((i + 1) * C + j) * 2 : (i * C + j) * 2 + 1);
    const add = (a, b) => { const k = segs.length; segs.push([a, b]); for (const id of [a, b]) { const l = at.get(id); l ? l.push(k) : at.set(id, [k]); } };
    for (let i = 0; i < R - 1; i += 1) for (let j = 0; j < C - 1; j += 1) {
      const a = v[i * C + j]; const b = v[i * C + j + 1]; const c = v[(i + 1) * C + j + 1]; const d = v[(i + 1) * C + j];
      const idx = (a > lv) * 8 | (b > lv) * 4 | (c > lv) * 2 | (d > lv);
      if (idx === 0 || idx === 15) continue;
      if (idx === 5 || idx === 10) {
        const up = (a + b + c + d) / 4 > lv;
        const pairs = (idx === 5) === up ? [[3, 0], [2, 1]] : [[3, 2], [0, 1]];
        for (const [p, q] of pairs) add(edgeId(i, j, p), edgeId(i, j, q));
      } else add(edgeId(i, j, T[idx][0]), edgeId(i, j, T[idx][1]));
    }
    // Точка на ребре и её прозрачность по двум полям расстояний.
    const point = (id) => {
      const o = id >> 1; const i = Math.floor(o / C); const j = o % C; const o2 = id & 1 ? o + C : o + 1;
      const t = (lv - v[o]) / (v[o2] - v[o]);
      const lat = G.s + (i + (id & 1 ? t : 0)) * dLat; const lon = G.w + (j + (id & 1 ? 0 : t)) * dLon;
      const dc = dist[o] + (dist[o2] - dist[o]) * t;
      const al = smooth(140, 560, dc) * smooth(60, 520, edgeDist((lon - lon0) * M_LON, (lat - lat0) * M_LAT));
      return [lat, lon, al];
    };
    const used = new Uint8Array(segs.length);
    const walk = (k, from) => {
      const out = []; let cur = k; let id = from;
      while (cur !== undefined && !used[cur]) {
        used[cur] = 1; const [a, b] = segs[cur]; const next = a === id ? b : a;
        out.push(next); id = next; cur = (at.get(next) || []).find((x) => !used[x]);
      }
      return out;
    };
    for (let k = 0; k < segs.length; k += 1) {
      if (used[k]) continue;
      const [a] = segs[k];
      const fwd = walk(k, a); const other = (at.get(a) || []).find((x) => !used[x]);
      const back = other === undefined ? [] : walk(other, a);
      const ids = [...back.reverse(), a, ...fwd];
      const pts = ids.map(point);
      if (pts.some((p) => p[2] > 0.02) && pts.length > 3) lines.push({ pts, index: L % 5 === 0 });
    }
  }
  return lines;
}
