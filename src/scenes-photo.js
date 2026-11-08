// Камеры Port Calloway. Кадры «до»: настоящее фото под CC0 (пустырь) и
// кадры, сгенерированные FLUX.1-schnell (Apache-2.0). Кадры «после» — те же
// кадры с удалённой проблемой (LaMa, scripts/prepare_assets.py). Поверх — вид камеры наблюдения:
// цветокоррекция, шум сенсора, виньетка и вшитая подпись камеры.
import qrcode from 'qrcode-generator';
import { ASSETS } from './assets-data.js';

export const W = 1280;
export const H = 720;

export const SPOTS = {
  sidewalk: {
    cam: 'CAM 14', street: 'HARBOR AVE & 3RD ST',
    title: 'Harbor Ave & 3rd St',
    map: { x: 300, y: 330, district: 'Harbor' }, task: 'Clear the garbage bags dumped by the utility pole', reward: '25.00',
    question: 'Are there black garbage bags on the sidewalk or around the utility pole?',
    cleanQuestion: 'Is the sidewalk around the utility pole clean, with no garbage bags?',
  },
  alley: {
    cam: 'CAM 07', street: 'ALDER ALLEY',
    title: 'Alder Alley',
    map: { x: 520, y: 210, district: 'Downtown' }, task: 'Paint over the graffiti on the brick wall', reward: '35.00',
    question: 'Is there a large spray-painted graffiti tag on the brick wall?',
    cleanQuestion: 'Is the brick wall clean, with no graffiti on it?',
  },
  lot: {
    cam: 'CAM 22', street: 'MILL RD VACANT LOT',
    title: 'Mill Rd vacant lot',
    map: { x: 830, y: 380, district: 'Millworks' }, task: 'Haul away the illegally dumped debris', reward: '40.00',
    question: 'Is there a pile of dumped debris, boards or scrap metal on the grass?',
    cleanQuestion: 'Is the grass area clean, with no dumped debris?',
  },
  tires: {
    cam: 'CAM 03', street: 'ELM ST & CEDAR AVE',
    title: 'Elm St & Cedar Ave',
    map: { x: 690, y: 95, district: 'Elm Heights' }, task: 'Remove the old tires dumped on the sidewalk', reward: '20.00',
    question: 'Are there old car tires lying on the sidewalk?',
    cleanQuestion: 'Is the sidewalk clear, with no tires lying on it?',
  },
};
for (const id of Object.keys(SPOTS)) SPOTS[id].roi = ASSETS[id].roi;

/** QR на экране телефона, поднесённого к камере. Жёсткие края — для распознавания. */
export function qrSvg(text, x, y, size) {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const n = qr.getModuleCount();
  const cell = size / (n + 8);
  let rects = '';
  for (let r = 0; r < n; r += 1) {
    for (let c = 0; c < n; c += 1) {
      if (qr.isDark(r, c)) rects += `<rect x="${((c + 4) * cell).toFixed(2)}" y="${((r + 4) * cell).toFixed(2)}" width="${(cell + 0.05).toFixed(2)}" height="${(cell + 0.05).toFixed(2)}"/>`;
    }
  }
  return `<g transform="translate(${x},${y})" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#f4f6f7"/><g fill="#0b0b0b">${rects}</g></g>`;
}

const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Город в Калифорнии: время камер — тихоокеанское.
const PT = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

function osd(spot, when, label) {
  const p = Object.fromEntries(PT.formatToParts(new Date(when)).map((x) => [x.type, x.value]));
  const ts = `${p.month}-${p.day}-${p.year} ${p.hour === '24' ? '00' : p.hour}:${p.minute}:${p.second} PT`;
  const t = (x, y, s, anchor = 'start') => `<text x="${x}" y="${y}" font-family="Menlo,Consolas,monospace" font-size="22" font-weight="700"
fill="#f2f2f2" stroke="#000" stroke-width="3" paint-order="stroke" text-anchor="${anchor}">${xml(s)}</text>`;
  return t(24, 40, label || `${spot.cam}  ${spot.street}`) + t(W - 24, 40, ts, 'end') + t(24, H - 22, 'PORT CALLOWAY DPW');
}

/**
 * Кадр камеры. done — проблема устранена (кадр «после»), qrToken — у камеры
 * телефон с QR, light — освещение 0.6…1.2, seed — шум сенсора, when — время OSD.
 */
export function renderFrame(spotId, { label = null, done = false, qrToken = null, light = 1, seed = 7, when = Date.UTC(2026, 9, 3, 14, 22, 31) } = {}) {
  const spot = SPOTS[spotId];
  const asset = ASSETS[spotId];
  if (!spot || !asset) throw new Error(`unknown spot ${spotId}`);
  const photo = done ? asset.after : asset.before;
  const phone = qrToken ? `<g transform="rotate(-2 640 380)"><rect x="460" y="60" width="360" height="620" rx="40" fill="#141518"/>
<rect x="476" y="110" width="328" height="520" rx="10" fill="#e9eef1"/>${qrSvg(qrToken, 488, 190, 304)}
<text x="640" y="580" font-family="Helvetica,Arial" font-size="24" font-weight="700" fill="#1a1a1a" text-anchor="middle">STREETCRED</text></g>` : '';
  const dim = light < 1 ? `<rect width="${W}" height="${H}" fill="#000" opacity="${(1 - light).toFixed(2)}"/>` : '';
  const bright = light > 1 ? `<rect width="${W}" height="${H}" fill="#fff" opacity="${(light - 1).toFixed(2)}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<defs>
<filter id="cctv" x="0" y="0" width="100%" height="100%" color-interpolation-filters="sRGB">
  <feColorMatrix type="matrix" values="0.80 0.16 0.04 0 0.01  0.10 0.86 0.06 0 0.015  0.10 0.16 0.78 0 0.03  0 0 0 1 0"/>
  <feComponentTransfer><feFuncR type="linear" slope="1.08" intercept="-0.03"/><feFuncG type="linear" slope="1.08" intercept="-0.03"/><feFuncB type="linear" slope="1.08" intercept="-0.02"/></feComponentTransfer>
</filter>
<filter id="grain" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="${seed}"/>
  <feColorMatrix type="saturate" values="0"/><feComponentTransfer><feFuncA type="linear" slope="0.10"/></feComponentTransfer></filter>
<radialGradient id="vig" cx="50%" cy="50%" r="72%"><stop offset="62%" stop-color="#000" stop-opacity="0"/><stop offset="100%" stop-color="#000" stop-opacity="0.55"/></radialGradient>
</defs>
<g filter="url(#cctv)"><image href="data:image/jpeg;base64,${photo}" width="${W}" height="${H}" preserveAspectRatio="none"/></g>
${dim}${bright}
<rect width="${W}" height="${H}" filter="url(#grain)"/>
<rect width="${W}" height="${H}" fill="url(#vig)"/>
${phone}
${osd(spot, when, label)}
</svg>`;
}
