// Экран выбора задания: карта на весь экран, лента кадров с камер, панель задания.
import { $, $$, h, money, ago, api, chrome, toast, modal, camView, DEMO_TAG, DEMO_BADGE, payoutState, stateBadge } from './common.js';

const KIND_LABEL = { bags: 'Garbage bags', graffiti: 'Graffiti', couch: 'Couch', mattress: 'Mattress', tires: 'Tires',
  cart: 'Shopping cart', branches: 'Branches', boxes: 'Boxes', litter: 'Litter', drain: 'Storm drain',
  weeds: 'Weeds', bin: 'Overflowing bin', flyers: 'Flyers', debris: 'Debris', butts: 'Cigarette butts', leaves: 'Fallen leaves',
  windblown: 'Wind-blown trash', beach: 'Beach litter', stickers: 'Stickers', other: 'Other' };
const KIND_HOW = {
  bags: 'Bag anything loose and move the bags to the curb for Thursday pickup.', graffiti: 'Paint over the tag with the matching color from the Public Works yard.',
  couch: 'Move it to the curb and book a free bulky pickup at the yard desk.', mattress: 'Move it to the curb, wrapped, for bulky pickup.',
  tires: 'Roll the tires to the curb; Public Works collects them the next morning.', cart: 'Return the cart to the store it belongs to.',
  branches: 'Clear the path and stack branches by the curb for green-waste pickup.', boxes: 'Break the boxes down and put them in a blue recycling bin.',
  litter: 'Pick up the litter in the marked area; bags and grabbers are free at the yard.', drain: 'Rake the leaves off the drain and bag them — never open the drain.',
  weeds: 'Pull the weeds along the sidewalk edge and bag them.', bin: 'Bag the overflow around the bin and report if the bin is damaged.',
  flyers: 'Remove old flyers and staples from the pole.', debris: 'Stack the debris by the curb; leave anything hazardous for a crew.',
  butts: 'Sweep up the butts with a broom and dustpan and bag them.', leaves: 'Rake the leaves off the sidewalk and bag them for green-waste pickup.',
  windblown: 'Collect the trash caught along the fence and bag it.', beach: 'Pick up the litter on the sand; untangle fishing line carefully and bag it.',
  stickers: 'Scrape the stickers off with a plastic scraper; leave no residue.', other: 'Follow the description and leave the spot clean.' };
// Значок типа задания на метке карты (12×12, штрих currentColor).
const ICON_PATH = {
  bags: 'M3 5h6l1 6H2zM4.5 5V3.5a1.5 1.5 0 013 0V5', litter: 'M3 4h6M4 4l.5 7h3L8 4M5 2h2', bin: 'M2.5 4h7M3.5 4l.5 7h4l.5-7M5 2h2',
  boxes: 'M2 4l4-2 4 2v5l-4 2-4-2zM2 4l4 2 4-2M6 6v5', graffiti: 'M3 10l2-6h2l2 6M4 7.5h4', couch: 'M2 7V5h8v2M1.5 7h9v3h-9zM3 10v1M9 10v1',
  mattress: 'M1.5 5h9v4h-9zM3 7h6', tires: 'M6 2.5a3.5 3.5 0 100 7 3.5 3.5 0 000-7zM6 5a1 1 0 100 2 1 1 0 000-2z', cart: 'M1.5 2.5h2l1.5 6h5l1-4.5H4M5 10.5h.1M9 10.5h.1',
  branches: 'M2 10L9 3M5 7l-2-2M7 5l2 2', drain: 'M2 3h8v6H2zM4 3v6M6 3v6M8 3v6', weeds: 'M6 11V6M6 6C6 3 3 3 2.5 3c0 2 1.5 3 3.5 3M6 7c0-2 2-3 3.5-3 0 2-1.5 3-3.5 3',
  flyers: 'M3 1.5h5l1.5 1.5v7.5H3zM4.5 5h3M4.5 7h3', done: 'M2.5 6.5l2.5 2.5 4.5-5.5', debris: 'M1.5 10h9M2.5 10V7h3v3M5.5 10V5h4v5',
  butts: 'M1.5 7h7v2h-7zM7 7v2M9.5 6c0-1-1-1.5-1-2.5', leaves: 'M2.5 9.5C2.5 5 5 2.5 9.5 2.5 9.5 7 7 9.5 2.5 9.5zM2.5 9.5L7 5',
  windblown: 'M1.5 4.5h6a1.5 1.5 0 10-1.5-1.5M1.5 7.5h8a1.5 1.5 0 11-1.5 1.5', beach: 'M1.5 9.5c1.5-1 3-1 4.5 0s3 1 4.5 0M5 2h2v1.5l.5 3.5h-3l.5-3.5z',
  stickers: 'M2.5 2.5h7v4l-3 3h-4zM9.5 6.5h-3v3', other: 'M6 2v5M6 9.5h.1',
};
const kindIcon = (k) => `<svg class="ki" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="${ICON_PATH[k] || ICON_PATH.other}" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
// Руководство демо-программы (task.guide): инструменты и «справится ли один». Неизвестное — not specified.
const soloText = (g) => (g.solo === true ? 'Solo-friendly' : g.solo === false ? 'Needs 2+ people' : 'Team size not specified');
const toolsLine = (g) => (!g.tools ? 'Tools: not specified' : g.tools.length ? g.tools.join(' · ') : 'No tools needed');
const guideChips = (g) => `<span class="gchip ${g.solo === true ? 'solo' : g.solo === false ? 'team' : ''}">${soloText(g)}</span>${g.basicKit === true ? '<span class="gchip">Basic kit</span>' : g.basicKit === false ? '<span class="gchip">Special tools</span>' : ''}`;
const DONE = new Set(['approved', 'paid', 'completed']);
const pinIcon = (t) => kindIcon(DONE.has(t.status) ? 'done' : t.kind);
const GROUPS = { open: ['open'], active: ['claimed', 'in_review'], done: ['approved', 'paid', 'completed'] };

performance.mark('cp:module');
// Подложка — статичный файл с хешем в имени (кэш навсегда, см. public/_headers); её URL берётся из
// <link rel="preload"> в index.html, так что запрос уже идёт с начала разбора страницы. Если ответ из
// кэша оказался негодным — один повтор из сети. Город и задания — динамика, без кэша.
const BASEMAP_URL = document.getElementById('basemap-src').href;
async function loadBasemap() {
  try {
    const r = await fetch(BASEMAP_URL);
    if (!r.ok) throw new Error(`basemap ${r.status}`);
    return await r.json();
  } catch {
    const r = await fetch(BASEMAP_URL, { cache: 'reload' });
    if (!r.ok) throw new Error(`basemap ${r.status}`);
    return r.json();
  }
}
const basePromise = loadBasemap();
const cityPromise = api('/api/public/city');
const statsPromise = api('/api/public/stats');
// Вступление показывается при первом визите; после знакомства — свёрнуто в кнопку.
const INTRO_KEY = 'cp_intro_seen';
const introSeen = () => { try { return localStorage.getItem(INTRO_KEY) === '1'; } catch { return false; } };
// На телефоне фильтры стоят под вступлением (полным или свёрнутым), без перекрытия.
function placeToolbar() {
  const tb = $('.toolbar');
  const box = $('.explore').getBoundingClientRect();
  const mini = $('#intro-open');
  if (innerWidth > 900) {
    // Свёрнутое вступление: фильтры справа от About / Try the demo, если строка помещается; иначе — под ними.
    // Открытое вступление на узком desktop: фильтры под ним.
    const room = box.width - 360 - 64 - (mini.hidden ? 0 : mini.getBoundingClientRect().right - box.left + 12);
    const under = mini.hidden ? innerWidth <= 1100 : room < 520;
    const over = mini.hidden ? $('#intro') : mini;
    tb.style.top = under ? `${over.getBoundingClientRect().bottom - box.top + 10}px` : '';
    tb.style.left = under ? '20px' : !mini.hidden ? `${mini.getBoundingClientRect().right - box.left + 12}px` : '';
    return;
  }
  tb.style.left = '';
  const over = $('#intro').classList.contains('hidden') ? mini : $('#intro');
  tb.style.top = `${Math.max(56, over.getBoundingClientRect().bottom - box.top + 8)}px`;
}
addEventListener('resize', placeToolbar);
$('#intro').addEventListener('transitionend', (e) => { if (e.propertyName === 'transform') placeToolbar(); });
function hideIntro() { $('#intro').classList.add('hidden'); $('#intro-open').hidden = false; placeToolbar(); try { localStorage.setItem(INTRO_KEY, '1'); } catch { /* приватный режим */ } }
function showIntro() { document.documentElement.classList.remove('intro-seen'); $('#intro').classList.remove('hidden'); $('#intro-open').hidden = true; placeToolbar(); }
if (introSeen()) { $('#intro').classList.add('hidden'); $('#intro-open').hidden = false; }
$('#intro-x').onclick = hideIntro; $('#intro-about').onclick = showIntro;
placeToolbar(); document.fonts?.ready.then(placeToolbar);
const user = await chrome('map');
performance.mark('cp:session');
const setHH = () => document.documentElement.style.setProperty('--hh', `${document.querySelector('header.site').offsetHeight}px`);
setHH(); addEventListener('resize', setHH); placeToolbar();
// Высота ленты — для ограничения вступления сверху.
const setDeck = () => document.documentElement.style.setProperty('--deck', `${document.querySelector('.deck-wrap').offsetHeight}px`);
addEventListener('resize', setDeck);
const wide = innerWidth > 900;
// На компьютере лента — колонка справа, на телефоне — полоса снизу.
const vertical = () => innerWidth > 900 || document.querySelector('.explore').classList.contains('listview');
const COL = 360;
// Ошибка загрузки: сообщение и «Try again» в ленте; повтор — те же GET-запросы, карта не пересоздаётся.
function loadFailed() {
  $('#deck').setAttribute('aria-busy', 'false');
  $('#deck-count').textContent = "Couldn't load spots";
  $('#deck').innerHTML = '<div class="state" role="alert"><p>Check your connection and try again.</p><button class="btn primary" id="retry">Try again</button></div>';
  return new Promise((ok) => { $('#retry').onclick = () => { $('#deck-count').textContent = 'Loading spots…'; $('#deck').setAttribute('aria-busy', 'true'); $('#deck').innerHTML = ''; ok(); }; });
}
let city; let base;
for (let attempt = 0; !city; attempt += 1) {
  try { [city, base] = await Promise.all([attempt ? api('/api/public/city') : cityPromise, attempt ? loadBasemap() : basePromise]); }
  catch { await loadFailed(); }
}
performance.mark('cp:data');
const D = Object.fromEntries(city.districts.map((d) => [d.id, d]));
const camById = new Map(city.cameras.map((c) => [c.id, c]));
const taskById = (id) => city.tasks.find((t) => t.id === id);
const camOf = (t) => camById.get(t.cameraId);

// Статистика для вступления — когда придёт; карта её не ждёт.
statsPromise.then((stats) => {
  // Засеянные числа демо-города — подписаны как Demo data, не реальные выплаты.
  $('#stats').innerHTML = [[stats.openTasks, 'open tasks'], [`${stats.online}`, 'cameras online'], [money(stats.paidOut).replace('.00', ''), 'sample payouts']]
    .map(([b, s2]) => `<div><b>${h(b)}</b><span>${h(s2)}</span></div>`).join('');
  $('#stats').title = stats.demoData ? stats.demoData.note : 'Demo data';
}).catch(() => {});

// ---------- карта ----------
const [s, w, n, e] = city.bbox;
// Телефон: город между нижним краем фильтров и реальной высотой ленты (а не фиксированными 110/330 px), с полями по бокам.
function mobilePad() {
  const top = $('.toolbar').getBoundingClientRect().bottom - $('.explore').getBoundingClientRect().top;
  return { paddingTopLeft: [48, Math.round(top) + 12], paddingBottomRight: [48, $('.deck-wrap').offsetHeight + 12] };
}
const map = L.map('map', { zoomControl: false, minZoom: 13, maxZoom: 19, zoomSnap: 0.25, zoomDelta: 0.5, wheelPxPerZoomLevel: 90, maxBounds: [[s - 0.02, w - 0.03], [n + 0.02, e + 0.03]] })
  .fitBounds(L.latLngBounds(city.cameras.map((c) => [c.lat, c.lon])), wide ? { paddingTopLeft: [8, 40], paddingBottomRight: [COL + 90, 110] } : mobilePad());
L.control.zoom({ position: 'topright' }).addTo(map);
window.__map = map; // для проверок раскладки в e2e
map.attributionControl.setPrefix(false).addAttribution('© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> (ODbL) · names fictional');

// Подложка из геометрии OSM: приглушённая, почти графическая.
const dec = (arr) => { const o = []; let a = 0; let b = 0; for (let i = 0; i < arr.length; i += 2) { a += arr[i]; b += arr[i + 1]; o.push([a / base.q, b / base.q]); } return o; };
['land', 'relief', 'roads', 'bldg'].forEach((p, i) => { map.createPane(p).style.zIndex = 201 + i; map.getPane(p).style.pointerEvents = 'none'; });
const R = Object.fromEntries(['land', 'relief', 'roads', 'bldg'].map((p) => [p, L.canvas({ pane: p, padding: 0.4 })]));
const poly = (k, st, r) => L.polygon(base[k].map(dec), { renderer: r, interactive: false, smoothFactor: 0.6, ...st });
const line = (k, st, r) => L.polyline(base[k].map(dec), { renderer: r, interactive: false, smoothFactor: 0.8, lineCap: 'round', lineJoin: 'round', ...st });
L.polygon([[[30, -130], [30, -110], [45, -110], [45, -130]], ...base.ocean.map(dec)], { renderer: R.land, interactive: false, stroke: false, fillColor: '#efebe2', fillOpacity: 1 }).addTo(map);
poly('sand', { stroke: false, fillColor: '#ece2c9', fillOpacity: 1 }, R.land).addTo(map);
poly('wood', { stroke: false, fillColor: '#d3dbc4', fillOpacity: 1 }, R.land).addTo(map);
poly('park', { stroke: false, fillColor: '#dfe5d0', fillOpacity: 1 }, R.land).addTo(map);
poly('pitch', { stroke: false, fillColor: '#d6dfc8', fillOpacity: 1 }, R.land).addTo(map);
poly('water', { stroke: false, fillColor: '#cdd9d7', fillOpacity: 1 }, R.land).addTo(map);
// Рельефные линии на пустой суше — только декор: готовые линии грузятся отдельно и не задерживают
// карту; если модуль не загрузился, карта просто остаётся без них.
import('./relief-lines.js').then(({ default: rel }) => {
  const asPts = (arr, from) => { const o = []; let a = 0; let b = 0; for (let i = from; i < arr.length; i += 2) { a += arr[i]; b += arr[i + 1]; o.push(L.latLng(a / rel.q, b / rel.q)); } return o; };
  const runs = rel.runs.map((r) => ({ a: r[0] / rel.steps, index: r[1] === 1, ll: asPts(r, 2) }));
  const holes = [...base.ocean, ...base.water].map((r) => dec(r).map((p) => L.latLng(p[0], p[1])));
  const edge = rel.edge.map((p) => L.latLng(p[0], p[1]));
  const Relief = L.Path.extend({
    options: { interactive: false },
    initialize(options) { L.setOptions(this, options); }, // у L.Path нет своего — без него renderer не применится
    getBounds: () => L.latLngBounds(edge), // путь покрывает весь вид; границы нужны только Leaflet
    _project() {
      const m = this._map; const pp = (ll) => m.latLngToLayerPoint(ll);
      this._runs = runs.map((r) => { const p = r.ll.map(pp); return { a: r.a, index: r.index, p, b: L.bounds(p) }; });
      this._holes = holes.map((h) => h.map(pp)); this._edge = edge.map(pp);
      this._pxBounds = L.bounds([-1e9, -1e9], [1e9, 1e9]);
    },
    _update() { if (this._map) this._updatePath(); },
    _updatePath() {
      const r = this._renderer; if (!r._drawing) return;
      const ctx = r._ctx; const bb = r._bounds; const mpp = 40075016 * Math.cos(36.6 * Math.PI / 180) / (256 * 2 ** this._map.getZoom());
      ctx.save();
      // Маска: суша = рамка минус океан и озёра (evenodd) — линии никогда не ложатся на воду.
      ctx.beginPath(); ctx.rect(bb.min.x, bb.min.y, bb.max.x - bb.min.x, bb.max.y - bb.min.y);
      for (const h of this._holes) { h.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath(); }
      ctx.clip('evenodd');
      // Прямой край выгрузки береговой линии растворяется в воду широкой мягкой полосой (~300 м).
      const [e1, e2] = this._edge; ctx.strokeStyle = '#cdd9d7'; ctx.lineCap = 'round';
      for (let k = 1; k <= 8; k += 1) { ctx.globalAlpha = 0.13; ctx.lineWidth = (2 * 300 / mpp) * (k / 8); ctx.beginPath(); ctx.moveTo(e1.x, e1.y); ctx.lineTo(e2.x, e2.y); ctx.stroke(); }
      ctx.strokeStyle = '#b3a68d'; ctx.lineJoin = 'round';
      for (const run of this._runs) {
        if (!run.b.intersects(bb)) continue;
        const p = run.p; ctx.globalAlpha = run.a * (run.index ? 0.62 : 0.46); ctx.lineWidth = run.index ? 1.35 : 0.9;
        ctx.beginPath(); ctx.moveTo(p[0].x, p[0].y);
        for (let i = 1; i < p.length - 1; i += 1) ctx.quadraticCurveTo(p[i].x, p[i].y, (p[i].x + p[i + 1].x) / 2, (p[i].y + p[i + 1].y) / 2);
        ctx.lineTo(p[p.length - 1].x, p[p.length - 1].y); ctx.stroke();
      }
      ctx.restore();
    },
  });
  new Relief({ renderer: R.relief }).addTo(map);
  performance.mark('cp:relief');
}).catch(() => { /* декор необязателен */ });
const casing = line('road', { color: '#ddd7cb' }, R.roads).addTo(map);
const roads = line('road', { color: '#fbf9f4' }, R.roads).addTo(map);
const service = line('service', { color: '#f7f4ee' }, R.roads);
const paths = line('path', { color: '#c8bfae', weight: 1, dashArray: '2 4' }, R.roads);
const majorCase = line('major', { color: '#d3cab9' }, R.roads).addTo(map);
const major = line('major', { color: '#ffffff' }, R.roads).addTo(map);
const buildings = poly('building', { color: '#d4cdbf', weight: 0.6, fillColor: '#e3ddd1', fillOpacity: 1 }, R.bldg);
function baseByZoom() {
  const z = map.getZoom(); const k = Math.max(0.35, (z - 12) / 4.5);
  casing.setStyle({ weight: 6.5 * k }); roads.setStyle({ weight: 5 * k }); majorCase.setStyle({ weight: 9 * k }); major.setStyle({ weight: 7.5 * k });
  service.setStyle({ weight: 2.4 * k });
  [[buildings, 15], [service, 15], [paths, 16]].forEach(([l, min]) => (z >= min ? l.addTo(map) : l.remove()));
}
map.on('zoomend', baseByZoom); baseByZoom();
performance.mark('cp:basemap-layers');

// Районы — только подпись курсивом, без границ.
const districtLayer = L.layerGroup().addTo(map);
for (const d of city.districts) {
  const pts = city.cameras.filter((c) => c.district === d.id);
  if (!pts.length) continue;
  const c = pts.reduce((a, p) => [a[0] + p.lat / pts.length, a[1] + p.lon / pts.length], [0, 0]);
  L.marker(c, { interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="district-label">${h(d.name)}</div>` }) }).addTo(districtLayer);
}
// Подписи улиц вдоль длинных участков.
const M_LAT = 111320; const M_LON = 111320 * Math.cos(36.6 * Math.PI / 180);
const streetLabels = L.layerGroup(); const majorLabels = L.layerGroup(); const seen = new Map();
for (const st of city.streets) {
  let best = null; let bestLen = 0;
  for (let i = 1; i < st.path.length; i += 1) {
    const [a, b] = [st.path[i - 1], st.path[i]];
    const seg = Math.hypot((b[0] - a[0]) * M_LAT, (b[1] - a[1]) * M_LON);
    if (seg > bestLen) { bestLen = seg; best = [a, b]; }
  }
  if (!best || bestLen < (st.major ? 110 : 150) || (seen.get(st.name) || 0) >= 2) continue;
  seen.set(st.name, (seen.get(st.name) || 0) + 1);
  const [a, b] = best;
  let ang = Math.atan2(-(b[0] - a[0]) * M_LAT, (b[1] - a[1]) * M_LON) * 180 / Math.PI;
  if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
  L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { interactive: false, icon: L.divIcon({ className: '', iconSize: [0, 0],
    html: `<div class="street-label ${st.major ? 'major' : ''}" style="transform:translate(-50%,-50%) rotate(${ang.toFixed(1)}deg)">${h(st.name)}</div>` }) })
    .addTo(st.major ? majorLabels : streetLabels);
}
function labelsByZoom() {
  const z = map.getZoom();
  z >= 15 ? majorLabels.addTo(map) : majorLabels.remove();
  z >= 17 ? streetLabels.addTo(map) : streetLabels.remove();
  z >= 16 ? districtLayer.remove() : districtLayer.addTo(map);
}
map.on('zoomend', labelsByZoom); labelsByZoom();

// ---------- камеры ----------
const camLayer = L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 40, disableClusteringAtZoom: 18,
  iconCreateFunction: (c) => L.divIcon({ className: 'marker-cluster', iconSize: [22, 22], html: `<div><span>${c.getChildCount()}</span></div>` }) });
const taken = new Set(city.tasks.map((t) => t.cameraId));
for (const c of city.cameras) {
  if (taken.has(c.id)) continue;
  L.marker([c.lat, c.lon], { icon: L.divIcon({ className: '', iconSize: [13, 13], html: `<div class="cam-pin ${c.status}"></div>` }) })
    .bindPopup(() => camPopup(c), { maxWidth: 314 }).addTo(camLayer);
}
const camsSync = () => ($('#f-cams').checked && map.getZoom() >= 16 ? camLayer.addTo(map) : camLayer.remove());
$('#f-cams').onchange = camsSync; map.on('zoomend', camsSync); camsSync();
function camPopup(c) {
  const el = document.createElement('div'); el.className = 'pop';
  el.innerHTML = `${camView(c, { district: D[c.district].name })}<h4>${h(c.streets[0])} &amp; ${h(c.streets[1])}</h4>
<div class="meta">${h(c.id)} · ${h(D[c.district].name)} · <span class="pill ${c.status}">${c.status}</span></div>
<div class="actions"><button class="btn sm primary" data-propose>Report a problem here</button></div>`;
  el.querySelector('[data-propose]').onclick = () => propose(c);
  return el;
}

// ---------- задания: метки ----------
let active = null;
const markers = new Map();
// Суммы видны уже на виде всего города (компактные), крупнее — при приближении;
// точки — только если отдалить карту дальше города.
// Порог — от стартового масштаба: на телефоне город помещается при меньшем зуме.
const SUMS_FROM = Math.min(13.5, map.getZoom() - 0.01);
const mode = () => (map.getZoom() < SUMS_FROM ? 'dot' : map.getZoom() < 15 ? 'sm' : 'lg');
// Раскладка меток без налезаний. Ширина считается по самой подписи; метки
// ставятся по приоритету (выбранная, затем по сумме), всё, что задевает уже
// поставленную, уходит в её группу; группы проверяются повторно, пока
// пересечений нет. Выбранная метка всегда видна, соседи — значком «+N».
const taskLayer = L.layerGroup().addTo(map);
const label = (t) => money(t.reward).replace('.00', '');
// Ширина подписи — измерение тем же шрифтом, что и в CSS (.reward-pin.sm/.lg), плюс отступы и рамка.
const measure = document.createElement('canvas').getContext('2d');
const textW = (txt, sz) => { measure.font = `600 ${sz === 'lg' ? 12.5 : 11}px Geist, sans-serif`; return Math.ceil(measure.measureText(txt).width + (sz === 'lg' ? 18 : 14) + 3); };
const GAP = 3;
function groupBox(g, sz) {
  const lead = g.tasks[0];
  const H = (sz === 'lg' ? 24 : 20) * (lead.id === active ? 1.3 : 1);
  const txt = g.tasks.length === 1 ? label(lead) : lead.id === active ? `${label(lead)} +${g.tasks.length - 1}`
    : `${g.tasks.length} · ${money(g.tasks.reduce((s2, t) => s2 + Number(t.reward), 0)).replace('.00', '')}`;
  const k = lead.id === active ? 1.3 : 1; // выбранная метка увеличена
  const w = (textW(txt, sz) + (g.tasks.length === 1 || lead.id === active ? 15 : 0) + (g.tasks.length > 1 && lead.id === active ? 10 : 0)) * k;
  return { x1: g.pt.x - w / 2 - GAP, x2: g.pt.x + w / 2 + GAP, y1: g.pt.y - H / 2 - GAP, y2: g.pt.y + H / 2 + GAP };
}
const hit = (a, b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
function layoutGroups(items, sz, project) {
  const order = items.slice().sort((a, b) => (b.id === active) - (a.id === active) || Number(b.reward) - Number(a.reward) || a.id.localeCompare(b.id));
  let groups = [];
  for (const t of order) {
    const g = { pt: project(t), tasks: [t] };
    const other = groups.find((x) => hit(groupBox(x, sz), groupBox(g, sz)));
    if (other) other.tasks.push(t); else groups.push(g);
  }
  // Группа выросла — подпись шире: сливаем до устойчивости. Каждое слияние
  // уменьшает число групп, поэтому проходов не больше items.length − 1.
  for (let pass = 0; pass < Math.max(1, items.length); pass += 1) {
    let merged = false;
    outer: for (let i = 0; i < groups.length; i += 1) {
      for (let j = i + 1; j < groups.length; j += 1) {
        if (hit(groupBox(groups[i], sz), groupBox(groups[j], sz))) {
          groups[i].tasks.push(...groups[j].tasks); groups.splice(j, 1); merged = true; break outer;
        }
      }
    }
    if (!merged) break;
  }
  return groups;
}
function layoutPins() {
  taskLayer.clearLayers(); markers.clear();
  const items = visible(); const sz = mode();
  if (sz === 'dot') {
    for (const t of items) addMarker([t], L.divIcon({ className: '', iconSize: [0, 0], html: `<div class="task-dot ${t.status} ${active === t.id ? 'active' : ''}"></div>` }));
    return;
  }
  const z = map.getZoom();
  const groups = layoutGroups(items, sz, (t) => map.project([camOf(t).lat, camOf(t).lon], z));
  for (const g of groups) {
    const lead = g.tasks[0];
    let html;
    const kinds = [...new Set(g.tasks.map((t) => KIND_LABEL[t.kind] || t.kind))].join(', ');
    if (g.tasks.length === 1) html = `<div class="reward-pin ${sz} ${lead.status} ${active === lead.id ? 'active' : ''}" title="${h(KIND_LABEL[lead.kind] || lead.kind)} · ${label(lead)}${DONE.has(lead.status) ? ' · done' : ''}">${pinIcon(lead)}${label(lead)}</div>`;
    else if (lead.id === active) html = `<div class="reward-pin ${sz} ${lead.status} active">${pinIcon(lead)}${label(lead)}<span class="more" data-more title="${g.tasks.length - 1} more nearby: ${h(kinds)}">+${g.tasks.length - 1}</span></div>`;
    else html = `<div class="pin-cluster ${sz}" title="${g.tasks.length} tasks: ${h(kinds)}"><b>${g.tasks.length}</b> · ${money(g.tasks.reduce((s2, t) => s2 + Number(t.reward), 0)).replace('.00', '')}</div>`;
    addMarker(g.tasks, L.divIcon({ className: '', iconSize: [0, 0], html }), g.pt);
  }
}
function addMarker(tasks, icon, pt) {
  const lead = tasks[0];
  const ll = pt ? map.unproject(pt, map.getZoom()) : [camOf(lead).lat, camOf(lead).lon];
  const m = L.marker(ll, { icon, keyboard: true, title: tasks.length > 1 ? `${tasks.length} tasks` : lead.title,
    zIndexOffset: tasks.some((t) => t.id === active) ? 2000 : lead.status === 'open' ? 1000 : 0 });
  m.on('click', (ev) => {
    const more = ev.originalEvent && ev.originalEvent.target.closest('[data-more]');
    if (tasks.length === 1 || (lead.id === active && !more)) { select(lead.id, { scroll: true, fly: false }); openSheet(lead); return; }
    expandGroup(tasks, m);
  });
  m.addTo(taskLayer);
  for (const t of tasks) markers.set(t.id, m);
}
// Группа: приближение к ней; если точки совпадают или масштаб предельный — список.
function expandGroup(tasks, m) {
  const pts = tasks.map((t) => L.latLng(camOf(t).lat, camOf(t).lon));
  const b = L.latLngBounds(pts);
  const span = map.distance(b.getSouthWest(), b.getNorthEast());
  if (span < 8 || map.getZoom() >= map.getMaxZoom() - 1) {
    const el = document.createElement('div'); el.className = 'pop grouplist';
    el.innerHTML = `<h4>${tasks.length} tasks here</h4>${tasks.map((t) => `<button data-id="${t.id}"><b>${label(t)}</b> ${h(t.title)}<span class="muted small">${h(t.address)}</span></button>`).join('')}`;
    el.querySelectorAll('[data-id]').forEach((x) => (x.onclick = () => { const t = taskById(x.dataset.id); map.closePopup(); select(t.id, { scroll: true, fly: false }); openSheet(t); }));
    m.bindPopup(el, { maxWidth: 300 }).openPopup();
    return;
  }
  map.flyToBounds(b, { paddingTopLeft: [60, 120], paddingBottomRight: [vertical() ? COL + 60 : 60, vertical() ? 60 : 200], maxZoom: Math.min(map.getMaxZoom(), map.getZoom() + 2.5), duration: 0.6 });
}
const drawPins = layoutPins;
const refreshIcons = layoutPins;
map.on('zoomend', layoutPins);

// ---------- фильтры ----------
let status = 'open'; let kind = '';
const practical = { near: false, kit: false, solo: false };
// Nearby: геолокация только по нажатию; вне Port Calloway — помеченная демо-точка (Mission Plaza).
const DEMO_REF = { lat: 36.59727, lon: -121.89575, label: 'demo reference point (Mission Plaza)' };
let ref = null;
const NEAR_M = 900;
const distM = (t) => (ref ? map.distance([ref.lat, ref.lon], [camOf(t).lat, camOf(t).lon]) : null);
async function locate() {
  const [s2, w2, n2, e2] = city.bbox;
  const pos = await new Promise((ok) => {
    if (!navigator.geolocation) { ok(null); return; }
    navigator.geolocation.getCurrentPosition((p2) => ok(p2.coords), () => ok(null), { timeout: 8000, maximumAge: 60000 });
  });
  const inside = pos && pos.latitude > s2 && pos.latitude < n2 && pos.longitude > w2 && pos.longitude < e2;
  ref = inside ? { lat: pos.latitude, lon: pos.longitude, label: 'you' } : DEMO_REF;
  toast(inside ? 'Showing tasks near you'
    : pos ? `Your location is outside the Port Calloway demo city — using the ${DEMO_REF.label}`
      : `Location unavailable — using the ${DEMO_REF.label}`);
}
$$('#f-practical [data-f]').forEach((b) => (b.onclick = async () => {
  const f = b.dataset.f;
  if (f === 'near' && !practical.near) { b.disabled = true; await locate(); b.disabled = false; }
  practical[f] = !practical[f];
  if (f === 'near' && !practical.near) ref = null;
  render();
}));
$('#f-district').innerHTML += city.districts.map((d) => `<option value="${d.id}">${h(d.name)}</option>`).join('');
// Все условия, кроме выбранного типа: на нём считаются честные счётчики чипов типа.
function matchesBase(t) {
  const d = $('#f-district').value;
  return GROUPS[status].includes(t.status) && (!d || t.district === d)
    && (!practical.kit || t.guide?.basicKit === true) && (!practical.solo || t.guide?.solo === true) && (!practical.near || distM(t) <= NEAR_M);
}
function visible() {
  return city.tasks.filter((t) => matchesBase(t) && (!kind || t.kind === kind))
    .sort((a, b) => (practical.near ? distM(a) - distM(b)
      : $('#f-sort').value === 'reward' ? Number(b.reward) - Number(a.reward) || b.createdAt - a.createdAt : b.createdAt - a.createdAt));
}
const PRACTICAL_LABEL = { near: 'Nearby', kit: 'No special tools', solo: 'Solo-friendly' };
// Активные фильтры: [ключ, подпись, сброс]. Сортировка — не фильтр, но тоже видна и снимается.
function activeFilters() {
  const out = Object.keys(practical).filter((k) => practical[k]).map((k) => [k, PRACTICAL_LABEL[k], () => { practical[k] = false; if (k === 'near') ref = null; }]);
  if (kind) out.push(['kind', KIND_LABEL[kind] || kind, () => { kind = ''; }]);
  const d = $('#f-district').value;
  if (d) out.push(['district', D[d].name, () => { $('#f-district').value = ''; }]);
  return out;
}
function clearFilters() { for (const k of Object.keys(practical)) practical[k] = false; ref = null; kind = ''; $('#f-district').value = ''; $('#f-sort').value = 'reward'; }
function drawChips() {
  const pool = city.tasks.filter(matchesBase);
  const counts = pool.reduce((m, t) => ({ ...m, [t.kind]: (m[t.kind] || 0) + 1 }), {});
  if (kind && !counts[kind]) counts[kind] = 0;
  $('#f-kind').innerHTML = `<button class="chip ${kind ? '' : 'on'}" data-k="" aria-pressed="${!kind}">All <i>${pool.length}</i></button>`
    + Object.entries(counts).sort((a, b) => b[1] - a[1] || (KIND_LABEL[a[0]] || a[0]).localeCompare(KIND_LABEL[b[0]] || b[0]))
      .map(([k, c]) => `<button class="chip ${kind === k ? 'on' : ''}" data-k="${k}" aria-pressed="${kind === k}">${h(KIND_LABEL[k] || k)} <i>${c}</i></button>`).join('');
  $$('#f-kind .chip').forEach((b) => (b.onclick = () => { kind = b.dataset.k; render(); }));
  $$('#f-practical [data-f]').forEach((b) => { b.classList.toggle('on', practical[b.dataset.f]); b.setAttribute('aria-pressed', String(practical[b.dataset.f])); });
  // Видимые на карте признаки: число на кнопке, токены с крестиком, на телефоне — строка в шапке ленты.
  const act = activeFilters(); const sortNew = $('#f-sort').value === 'new';
  $('#f-count').hidden = !act.length; $('#f-count').textContent = act.length;
  $('#f-open').setAttribute('aria-label', act.length ? `Filters, ${act.length} active` : 'Filters');
  $('#f-open').classList.toggle('on', act.length > 0);
  const MAX = innerWidth < 1200 ? 2 : 3;
  const tokens = [...act, ...(sortNew ? [['sort', 'Newest first', () => { $('#f-sort').value = 'reward'; }]] : [])];
  $('#f-tokens').innerHTML = tokens.slice(0, MAX).map(([k, l], i) => `<button class="ftoken" data-i="${i}" aria-label="Remove filter: ${h(l)}">${h(l)}<span aria-hidden="true">×</span></button>`).join('')
    + (tokens.length > MAX ? `<button class="ftoken more" data-more>+${tokens.length - MAX}</button>` : '')
    + (tokens.length ? '<button class="fclear" data-clear>Clear</button>' : '');
  $$('#f-tokens [data-i]').forEach((b) => (b.onclick = () => { tokens[Number(b.dataset.i)][2](); render(); }));
  $('#f-tokens [data-more]')?.addEventListener('click', openFilters);
  $('#f-tokens [data-clear]')?.addEventListener('click', () => { clearFilters(); render(); });
  $('#deck-filters').innerHTML = act.length ? `${act.map(([, l]) => h(l)).join(', ')} · <button class="linkbtn" data-clear>Clear</button>` : '';
  $('#deck-filters [data-clear]')?.addEventListener('click', () => { clearFilters(); render(); });
}
$$('#f-status button').forEach((b) => (b.onclick = () => {
  $$('#f-status button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', String(x === b)); });
  status = b.dataset.v; kind = ''; render();
}));
['#f-district', '#f-sort'].forEach((x) => ($(x).onchange = render));

// Панель Filters: модальный диалог. Фокус внутри, Esc/фон/кнопка закрывают и возвращают фокус на «Filters».
function placeFilters() {
  const panel = $('#filters');
  if (innerWidth <= 900) { panel.style.left = ''; panel.style.top = ''; panel.style.maxHeight = ''; return; }
  const box = $('.explore').getBoundingClientRect(); const r = $('#f-open').getBoundingClientRect();
  panel.style.left = `${Math.max(12, Math.min(r.left - box.left, box.width - COL - panel.offsetWidth - 12))}px`;
  // Под кнопкой, если помещается хотя бы 360 px; иначе — от верха карты. Остальное прокручивается внутри.
  let top = r.bottom - box.top + 8;
  if (box.height - top - 12 < 360) top = 12;
  panel.style.top = `${top}px`; panel.style.maxHeight = `${box.height - top - 12}px`;
}
function openFilters() {
  $('#filters').hidden = false; $('#filters-bg').hidden = false; $('#f-open').setAttribute('aria-expanded', 'true');
  placeFilters();
  ($('#f-practical .chip') || $('#f-close')).focus();
}
function closeFilters() {
  if ($('#filters').hidden) return;
  $('#filters').hidden = true; $('#filters-bg').hidden = true; $('#f-open').setAttribute('aria-expanded', 'false');
  $('#f-open').focus();
}
$('#f-open').onclick = () => ($('#filters').hidden ? openFilters() : closeFilters());
$('#f-close').onclick = closeFilters; $('#f-done').onclick = closeFilters; $('#filters-bg').onclick = closeFilters;
$('#f-clear').onclick = () => { clearFilters(); render(); };
$('#filters').addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); closeFilters(); return; }
  if (ev.key !== 'Tab') return;
  const f = $$('#filters button:not([disabled]), #filters select, #filters input').filter((x) => x.offsetParent);
  const first = f[0]; const last = f[f.length - 1];
  if (ev.shiftKey && document.activeElement === first) { ev.preventDefault(); last.focus(); } else if (!ev.shiftKey && document.activeElement === last) { ev.preventDefault(); first.focus(); }
});
addEventListener('resize', () => { if (!$('#filters').hidden) placeFilters(); });

// ---------- лента ----------
// Перерисовка заменяет кнопки через innerHTML: фокус возвращается на ту же кнопку (по data-k/data-f/id),
// а если её больше нет — на понятную опору (кнопка Filters или первая карточка), не на body.
function focusKey(el) {
  if (!el || el === document.body) return null;
  if (el.closest('#filters')) return el.dataset.k !== undefined ? `#f-kind [data-k="${el.dataset.k}"]` : el.dataset.f ? `#f-practical [data-f="${el.dataset.f}"]` : el.id ? `#${el.id}` : '#f-close';
  if (el.closest('#f-tokens')) return '#f-tokens [data-i], #f-open';
  if (el.closest('#deck') && !el.closest('.tcard')) return '#deck .tcard, #f-open';
  if (el.closest('#deck-filters')) return '#deck .tcard, #f-open';
  return null;
}
function render() {
  const fk = focusKey(document.activeElement);
  renderNow();
  if (fk && (!document.activeElement || document.activeElement === document.body)) {
    const el = $(fk.split(', ')[0]) || $(fk.split(', ')[1] || '#f-open');
    if (el) { if (el.classList.contains('tcard') && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1'); el.focus({ preventScroll: true }); }
  }
}
function renderNow() {
  drawChips(); drawPins();
  const items = visible();
  const total = items.reduce((s2, t) => s2 + Number(t.reward), 0);
  $('#deck-count').innerHTML = items.length
    ? `${items.length} ${status === 'open' ? 'spots need you' : status === 'active' ? 'in progress' : 'done'} · <em>${money(total).replace('.00', '')}</em> in rewards ${DEMO_BADGE}${practical.near ? `<span class="nearnote">near the ${h(ref.label === 'you' ? 'your location' : ref.label)}</span>` : ''}`
    : activeFilters().length ? 'No spots match these filters' : `No ${status === 'open' ? 'open spots' : status === 'active' ? 'spots in progress' : 'finished spots'} right now`;
  $('#f-done').textContent = `Show ${items.length} ${items.length === 1 ? 'spot' : 'spots'}`;
  $('#deck').setAttribute('aria-busy', 'false');
  $('.deck-head').classList.toggle('single', items.length <= 1);
  $('#deck').innerHTML = items.map((t) => {
    const c = camOf(t);
    return `<article class="tcard" data-id="${t.id}"><div class="ph">${camView(c, { frame: t.frame, district: D[t.district].name })}
<span class="rw">${money(t.reward).replace('.00', '')}</span>${t.boosts.length ? `<span class="bst">+${money(t.boosts.reduce((a, b) => a + Number(b.amount), 0)).replace('.00', '')} boosted</span>` : ''}</div>
<div class="body"><div class="kind">${h(KIND_LABEL[t.kind] || t.kind)}${t.verifiable ? ' · <span class="verif">instant AI check</span>' : ''}</div>
<h4>${h(t.title)}</h4><div class="where">${h(D[t.district].name)} · ${h(String(t.address).split(' & ')[0])}</div><div class="guide">${guideChips(t.guide || {})}</div><div class="tools">${h(toolsLine(t.guide || {}))}</div><div class="meta">${h(D[t.district].name)} · ${h(t.address)}${practical.near ? ` · ≈${Math.round(distM(t) / 10) * 10} m from ${ref.label === 'you' ? 'you' : 'demo reference'}` : ''}</div>
<div class="meta">${status === 'open' ? `posted ${ago(t.createdAt)}` : `${stateBadge(payoutState({ status: t.status }))}${t.claimedBy ? ` · ${h(t.claimedBy.name)}` : ''}`}</div></div></article>`;
  }).join('') || (activeFilters().length
    ? '<div class="state"><p>Nothing matches every filter at once.</p><button class="btn" data-clear-all>Clear filters</button></div>'
    : `<div class="state"><p>${status === 'open' ? 'New spots appear when cameras or residents report them.' : 'Nothing here yet.'}</p>${status !== 'open' ? '<button class="btn" data-to-open>Show open spots</button>' : ''}</div>`);
  $('#deck [data-clear-all]')?.addEventListener('click', () => { clearFilters(); render(); });
  $('#deck [data-to-open]')?.addEventListener('click', () => $('#f-status [data-v="open"]').click());
  $$('#deck .tcard').forEach((el) => (el.onclick = () => { const t = taskById(el.dataset.id); select(t.id, { fly: true }); openSheet(t); }));
  if (items.length) select(items.find((t) => t.id === active) ? active : items[0].id, { fly: false, scroll: true });
}

// Выбор задания: подсветка карточки и метки, перелёт карты с учётом ленты внизу.
function select(id, { fly = true, scroll = false } = {}) {
  active = id; refreshIcons();
  $$('#deck .tcard').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  const el = $(`#deck .tcard[data-id="${id}"]`);
  if (scroll && el) {
    // Программная прокрутка не должна сама менять выбор: флаг снимается по её окончании.
    scrolling = true; clearTimeout(scrollGuard);
    const deck = $('#deck');
    const done = () => { clearTimeout(scrollGuard); scrollGuard = setTimeout(() => { scrolling = false; }, 120); };
    deck.addEventListener('scrollend', done, { once: true });
    scrollGuard = setTimeout(() => { scrolling = false; }, 1500);
    deck.scrollTo(vertical() ? { top: el.offsetTop - 12, behavior: 'smooth' } : { left: el.offsetLeft - 24, behavior: 'smooth' });
  }
  if (fly) flyTo(taskById(id));
}
function flyTo(t) {
  const c = camOf(t); const z = Math.max(map.getZoom(), 15);
  const sheetW = $('#sheet').classList.contains('open') && innerWidth > 700 ? 450 : 0;
  // Центр — в видимой части карты: без колонки/панели справа или полосы снизу.
  const shift = vertical() ? [Math.max(COL, sheetW) / 2, 0] : [sheetW / 2, $('.deck-wrap').offsetHeight / 2 - 20];
  const p = map.project([c.lat, c.lon], z).add(shift);
  map.flyTo(map.unproject(p, z), z, { duration: 0.7 });
}
// Прокрутка ленты сама выбирает задание у левого края.
let scrolling = false; let st = null; let scrollGuard = null;
$('#deck').addEventListener('scroll', () => {
  if (scrolling) return;
  clearTimeout(st);
  st = setTimeout(() => {
    const cards = $$('#deck .tcard'); const box = $('#deck').getBoundingClientRect();
    const pos = (el) => (vertical() ? el.getBoundingClientRect().top - box.top - 12 : el.getBoundingClientRect().left - box.left - 24);
    const near = cards.reduce((best, el) => (Math.abs(pos(el)) < Math.abs(pos(best)) ? el : best), cards[0]);
    if (near && near.dataset.id !== active) select(near.dataset.id, { fly: !$('.explore').classList.contains('listview') });
  }, 160);
});
const step = (dir) => { const items = visible(); const i = items.findIndex((t) => t.id === active); const t = items[(i + dir + items.length) % items.length]; if (t) select(t.id, { fly: true, scroll: true }); };
$('#prev').onclick = () => step(-1); $('#next').onclick = () => step(1);
addEventListener('keydown', (ev) => { if (ev.target.closest('input,select,textarea') || !$('#filters').hidden) return; if (ev.key === 'ArrowRight') step(1); if (ev.key === 'ArrowLeft') step(-1); if (ev.key === 'Escape') closeSheet(); });
$('#surprise').onclick = () => {
  const pool = city.tasks.filter((t) => t.status === 'open');
  const t = pool[Math.floor(Math.random() * pool.length)];
  if (!t) return;
  if (status !== 'open' || activeFilters().length) { status = 'open'; clearFilters(); $$('#f-status button').forEach((x) => { x.classList.toggle('on', x.dataset.v === 'open'); x.setAttribute('aria-pressed', String(x.dataset.v === 'open')); }); render(); }
  hideIntro();
  select(t.id, { fly: false, scroll: true }); openSheet(t);
};

// Телефон: явный выбор «карта» или «список».
$$('#viewtoggle button').forEach((b) => (b.onclick = () => {
  $$('#viewtoggle button').forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-selected', String(x === b)); });
  $('.explore').classList.toggle('listview', b.dataset.view === 'list');
  if (b.dataset.view === 'map') { map.invalidateSize(); if (active) flyTo(taskById(active)); }
}));

// ---------- панель задания ----------
const PP = '<span class="pp-word">Pay<i>Pal</i></span>';
// Полный кадр без обрезки; выделение — только там, где зона задания действительно известна.
function frameFigure(t, c, d, { zoom = true } = {}) {
  const live = Boolean(c.spot);
  const src = live ? `/api/frame?spot=${c.spot}&t=${Date.now()}` : t.frame ? `/img/tasks/${t.frame}.jpg` : `/img/views/${c.view}.jpg`;
  const [W, H] = live ? [1280, 720] : [1024, 576];
  const r = t.roi;
  return `<figure class="frame" style="aspect-ratio:${W}/${H}"><img src="${src}" alt="Demo camera frame: ${h(t.title)}, ${h(t.address)}">
${r ? `<div class="roi" style="left:${(r.x / W) * 100}%;top:${(r.y / H) * 100}%;width:${(r.w / W) * 100}%;height:${(r.h / H) * 100}%"><span>Problem area</span></div>` : ''}
${live ? '' : `<div class="osd"><span>${h(c.id)} · ${h(c.streets[0]).toUpperCase()}</span></div>`}${DEMO_TAG}
${zoom ? '<button class="zoom" data-zoom aria-label="Enlarge camera frame"><svg viewBox="0 0 16 16" width="14" height="14"><path d="M9 2h5v5M7 14H2V9M14 2L9 7M2 14l5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg></button>' : ''}</figure>`;
}
function openSheet(t) {
  const c = camOf(t); const d = D[t.district];
  const mine = user && user.role === 'resident' && t.claimedBy && t.claimedBy.id === user.id;
  const near = city.tasks.filter((x) => x.id !== t.id && x.status === 'open')
    .map((x) => ({ x, m: Math.hypot((camOf(x).lat - c.lat) * M_LAT, (camOf(x).lon - c.lon) * M_LON) }))
    .filter((o) => o.m < 900).sort((a, b) => a.m - b.m).slice(0, 4);
  const boosted = t.boosts.reduce((s2, b) => s2 + Number(b.amount), 0);
  const canBoost = ['open', 'claimed'].includes(t.status);
  const sheet = $('#sheet');
  const reward = money(t.reward).replace('.00', '');
  const action = t.status === 'open' ? (user && user.role === 'resident' ? '<button class="btn lg accent" data-claim>Claim this spot</button>' : '<a class="btn lg accent" href="/signin.html?next=/">Sign in to claim</a>')
    : mine ? '<a class="btn lg primary" href="/account.html">Open in my account</a>' : stateBadge(payoutState({ status: t.status }));
  sheet.innerHTML = `<button class="grab" aria-label="Expand details"><span></span></button>
<div class="hero">${frameFigure(t, c, d)}<button class="x" aria-label="Close">
<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 3l10 10M13 3L3 13" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button></div>
<p class="framecap">${t.roi ? 'Outlined: the area this camera checks before and after.' : 'Demo frame of the spot. The problem area isn’t outlined for this camera — look for what the task describes.'}</p>
<div class="in"><div class="eyebrow">${h(KIND_LABEL[t.kind] || t.kind)} · ${h(d.name)}</div>
<h2>${h(t.title)}</h2><div class="muted">${h(t.address)}</div>
<div class="payline">${boosted ? `<span>Includes +${money(boosted).replace('.00', '')} from neighbors.</span> ` : ''}Paid out by ${PP} to your PayPal or <span class="venmo-word">venmo</span> after the camera confirms it.</div>
<section class="todo">
<h3>Tools and team <span class="srcnote">${h((t.guide || {}).source || 'Demo program guidance by task type')}</span></h3>
<div class="guide">${guideChips(t.guide || {})}</div>
<p>${h(toolsLine(t.guide || {}))}.
${(t.guide || {}).basicKit === true ? ' A basic kit is enough: gloves and bags (free at the Public Works yard, 1400 Mill Road) or household items like a broom.' : ''}</p>
<p class="muted">Time: not specified by the organizer.</p>
<h3>What to do</h3><p>${h(KIND_HOW[t.kind] || KIND_HOW.other)}</p>
<h3>How it’s checked</h3>
<ol class="checkflow"><li><b>Claim</b> — the spot is yours for 48 hours.</li>
<li><b>Show your one-time QR code</b> to camera ${h(c.id)} when you arrive.</li>
<li><b>${c.spot ? 'Camera + AI compare' : 'A reviewer compares'}</b> the frames before and after${c.spot ? ', usually in under a minute' : ', usually within one business day'}.</li>
<li><b>Get ${reward}</b> in the next daily PayPal payout.</li></ol>
<a class="small" href="/how.html#verify">See how a confirmed result looks (demo frames) →</a></section>
<dl class="facts"><dt>Posted</dt><dd>${t.source === 'resident' ? 'Reported by a neighbor' : 'Public Works'}, ${ago(t.createdAt)}</dd>
<dt>Status</dt><dd>${stateBadge(payoutState({ status: t.status }))}${t.claimedBy ? ` · ${h(t.claimedBy.name)}` : ''}</dd></dl>
${canBoost ? `<section class="boost"><div class="bhead"><div><div class="eyebrow">Not up for it yourself?</div><h3>Boost this reward</h3></div>${PP}</div>
<p class="small">Add to the reward with PayPal, Pay Later or a card — or Venmo on eligible devices. The full amount goes to whoever fixes it.</p>
${t.boosts.length ? `<ul class="blist">${t.boosts.map((b) => `<li><span>${h(b.by)}</span><b>+${money(b.amount).replace('.00', '')}</b></li>`).join('')}</ul>` : ''}
<div class="amounts">${['5.00', '10.00', '25.00'].map((a, i) => `<button class="amt ${i === 1 ? 'on' : ''}" data-amt="${a}">+$${Number(a)}</button>`).join('')}</div>
<div id="pp-buttons"><button class="btn lg pp-start" data-boost>Boost with ${PP}</button></div>
<p class="muted small" style="margin:8px 0 0">Sandbox demo: use a PayPal sandbox buyer account; no real money moves.</p></section>` : ''}
${near.length ? `<div class="eyebrow" style="margin:22px 0 8px">Also nearby</div><div class="near">${near.map(({ x, m }) => `<button data-near="${x.id}"><b>${money(x.reward).replace('.00', '')}</b>${h(KIND_LABEL[x.kind] || x.kind)} · ${Math.round(m / 10) * 10} m</button>`).join('')}</div>` : ''}
</div>
<div class="sheet-cta"><div class="reward"><b>${reward}</b><span>reward</span></div>${action}</div>`;
  sheet.classList.add('open'); $('.explore').classList.add('sheet-open'); sheet.setAttribute('aria-hidden', 'false'); sheet.scrollTop = 0;
  hideIntro();
  sheet.querySelector('.x').onclick = closeSheet;
  sheet.classList.remove('full');
  sheet.querySelector('.grab').onclick = () => { const f = sheet.classList.toggle('full'); sheet.querySelector('.grab').setAttribute('aria-label', f ? 'Collapse details' : 'Expand details'); };
  const z = sheet.querySelector('[data-zoom]');
  if (z) z.onclick = () => modal(`<div class="zoomed">${frameFigure(t, c, d, { zoom: false })}</div><p class="muted small">${t.roi ? 'Outlined: the area the camera checks.' : 'The problem area isn’t outlined for this camera.'} Demo camera frame.</p><div style="text-align:right"><button class="btn" data-close>Close</button></div>`,
    (m, close) => { m.classList.add('wide'); m.querySelector('[data-close]').onclick = close; });
  $$('[data-near]', sheet).forEach((b) => (b.onclick = () => { const x = taskById(b.dataset.near); select(x.id, { fly: true, scroll: true }); openSheet(x); }));
  const cb = sheet.querySelector('[data-claim]');
  if (cb) cb.onclick = () => claim(t);
  let amount = '10.00';
  $$('[data-amt]', sheet).forEach((b) => (b.onclick = () => { amount = b.dataset.amt; $$('[data-amt]', sheet).forEach((x) => x.classList.toggle('on', x === b)); }));
  const bb = sheet.querySelector('[data-boost]');
  if (bb) bb.onclick = () => mountPayPal(t, () => amount);
  flyTo(t);
}

// Официальные кнопки PayPal JS SDK (sandbox): PayPal, Venmo, Pay Later, карта.
let sdk = null;
async function loadSdk() {
  if (sdk) return sdk;
  const cfg = await api('/api/public/paypal');
  if (!cfg.clientId) throw new Error('PayPal sandbox is not configured');
  sdk = new Promise((ok, fail) => {
    const el = document.createElement('script');
    // buyer-country=US работает только в sandbox: показывает кнопки Venmo и Pay Later для покупателя из США.
    el.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cfg.clientId)}&currency=USD&intent=capture&components=buttons&enable-funding=venmo,paylater&buyer-country=US`;
    el.onload = () => ok(window.paypal); el.onerror = () => { sdk = null; fail(new Error('PayPal could not be loaded')); };
    document.head.appendChild(el);
  });
  return sdk;
}
async function mountPayPal(t, amount) {
  const box = $('#pp-buttons');
  box.innerHTML = '<p class="muted small">Loading PayPal…</p>';
  try {
    const paypal = await loadSdk();
    box.innerHTML = '';
    await paypal.Buttons({
      style: { shape: 'pill', height: 44, label: 'pay' },
      createOrder: async () => (await api('/api/boost/order', { taskId: t.id, amount: amount() })).id,
      onApprove: async (data) => {
        const r = await api('/api/boost/capture', { orderId: data.orderID });
        Object.assign(t, r.task); render(); select(t.id, { fly: false, scroll: true }); openSheet(t);
        toast(`Thank you! The reward is now ${money(t.reward)}.`);
      },
      onError: (err) => toast(err.message || 'PayPal error'),
    }).render(box);
  } catch (err) { box.innerHTML = `<p class="small" style="color:var(--bad)">${h(err.message)}</p>`; }
}
function closeSheet() { $('.explore').classList.remove('sheet-open'); $('#sheet').classList.remove('open'); $('#sheet').setAttribute('aria-hidden', 'true'); }

async function claim(t) {
  try {
    const r = await api('/api/me/claim', { taskId: t.id });
    Object.assign(t, r.task); render(); openSheet(t);
    modal(`<div class="eyebrow">Claimed · ${h(t.id)}</div><h3>It’s yours for 48 hours.</h3>
<p>When you’re on site, open <b>My account</b> and show your one-time QR code (ending in <code>${h(r.tokenTail)}</code>) to camera <b>${h(t.cameraId)}</b>.</p>
<p class="muted small">The camera confirms the result, not your face. ${money(t.reward)} goes to your PayPal in the next daily payout after approval.</p>
<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:16px"><button class="btn" data-x>Close</button><a class="btn primary" href="/account.html">Go to my account</a></div>`,
    (m, close) => { m.querySelector('[data-x]').onclick = close; });
  } catch (err) { toast(err.message); }
}

function propose(c) {
  if (!user || user.role !== 'resident') { location.href = '/signin.html?next=/'; return; }
  modal(`<div class="eyebrow">Camera ${h(c.id)} · ${h(D[c.district].name)}</div><h3>Report a problem near ${h(c.streets[0])}</h3>
<p class="muted small">Public Works reviews reports within one business day and sets the reward.</p>
<label class="f">What needs doing?</label><select class="f" id="p-kind">${Object.entries(KIND_LABEL).map(([k, v]) => `<option value="${k}">${h(v)}</option>`).join('')}</select>
<label class="f">Describe it</label><textarea class="f" id="p-text" placeholder="e.g. Two old tires dumped by the fence since Monday"></textarea>
<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px"><button class="btn" data-x>Cancel</button><button class="btn primary" data-send>Send for review</button></div>`,
  (m, close) => {
    m.querySelector('[data-x]').onclick = close;
    m.querySelector('[data-send]').onclick = async () => {
      try {
        const r = await api('/api/me/proposals', { cameraId: c.id, kind: m.querySelector('#p-kind').value, text: m.querySelector('#p-text').value });
        close(); toast(`Thanks! Report ${r.proposal.id} is with Public Works.`);
      } catch (err) { toast(err.message); }
    };
  });
}

render(); setDeck();
// Телефон: при minZoom весь город не всегда помещается с полями, и выбранная метка могла оказаться за краем.
// Один раз сдвигаем карту (без смены масштаба), чтобы камера выбранного задания была между фильтрами и лентой.
if (!wide && active) {
  const c = camOf(taskById(active)); const pad = mobilePad();
  map.panInside([c.lat, c.lon], { paddingTopLeft: [72, pad.paddingTopLeft[1] + 16], paddingBottomRight: [72, pad.paddingBottomRight[1] + 16], animate: false });
}
performance.mark('cp:ready');
// Ссылка /?task=T-2041 открывает задание.
const deep = new URLSearchParams(location.search).get('task');
if (deep && taskById(deep)) {
  const t = taskById(deep);
  status = Object.keys(GROUPS).find((g) => GROUPS[g].includes(t.status)) || 'open';
  $$('#f-status button').forEach((x) => x.classList.toggle('on', x.dataset.v === status));
  render(); select(t.id, { fly: false, scroll: true }); openSheet(t);
}

// Отметка «прошёл демо» (пишет /demo только после Approved; удаляется при новом запуске, rejected и human review).
// Это симуляция: реальное задание и учёт не меняются, поэтому отдельный бейдж и отдельная метка, а не статус задания.
let demoDone = null;
try { demoDone = JSON.parse(sessionStorage.getItem('streetcred.demoCompleted') || 'null'); } catch { /* sessionStorage недоступен */ }
if (demoDone && demoDone.simulated === true && demoDone.status === 'approved') {
  const lbl = 'Completed in your demo · Simulated';
  $('#demo-done').innerHTML = `<a class="st st-proof demo-done" href="/demo.html" title="Simulated in the guided demo; no real task or payout changed">${lbl}</a>`;
  const t = demoDone.taskId && taskById(demoDone.taskId);
  if (t) {
    L.marker([camOf(t).lat, camOf(t).lon], { keyboard: false, interactive: false, zIndexOffset: -500,
      icon: L.divIcon({ className: 'demo-done-pin', html: `<span class="st st-proof">✓ ${lbl}</span>`, iconSize: null, iconAnchor: [0, 34] }) }).addTo(map);
  }
}
