// Проверка камерой: снимок кадров с городской камеры → сервер (пиксели + модель).
// Кадры — PNG того, что камера показывает сейчас; сервер видит только их.
import { $, h, api, money, DEMO_TAG } from './common.js';

const W = 1280; const H = 720;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export { sleep };

/** Кадр с камеры: SVG с сервера → canvas → PNG (data URL). */
export async function capture(spot, q = '') {
  const svg = await (await fetch(`/api/frame?spot=${spot}${q}&t=${Date.now()}`)).text();
  const img = new Image();
  await new Promise((ok, fail) => { img.onload = ok; img.onerror = fail; img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); });
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').drawImage(img, 0, 0, W, H);
  return c.toDataURL('image/png');
}

/** Плитка камеры для живой проверки: кадр, тепловая карта, значки проверок, штамп. */
export function camTile(task) {
  const el = document.createElement('div'); el.className = 'livecam'; el.id = `live-${task.id}`;
  el.innerHTML = `<div class="screen"><img alt="Live camera ${h(task.cameraId)}" src="/api/frame?spot=${task.spot}&t=${Date.now()}">
<div class="heat"></div><div class="qrbox">QR</div><div class="verdict"></div><div class="stamp"></div>${DEMO_TAG}
</div>
<div class="cap"><b>${h(task.title)}</b><span class="muted small">${h(task.address)} · ${money(task.reward)}</span></div>`;
  return el;
}
export function showFrame(el, spot, q = '') {
  el.querySelector('.screen img').src = `/api/frame?spot=${spot}${q}&t=${Date.now()}`;
}
export function clearTile(el) {
  el.querySelector('.verdict').innerHTML = ''; el.querySelector('.heat').innerHTML = '';
  el.querySelector('.stamp').className = 'stamp';
}

/** Анимация решения: тепловая карта изменений, проверки по одной, вердикт модели, штамп. */
export async function animateVerdict(el, v) {
  const heat = el.querySelector('.heat');
  if (v.heat) {
    heat.style.gridTemplateColumns = `repeat(${v.heat.cols},1fr)`;
    heat.innerHTML = v.heat.cells.map(() => '<i></i>').join('');
    await sleep(80);
    heat.querySelectorAll('i').forEach((cell, i) => { const x = v.heat.cells[i];
      cell.style.background = x > 0.08 ? `rgba(57,217,138,${Math.min(0.45, x * 0.8)})` : 'transparent'; });
  }
  const names = { qr: 'QR TOKEN', scene: 'SAME VIEW', change: 'CHANGE IN AREA' };
  const box = el.querySelector('.verdict');
  for (const c of v.checks || []) {
    const b = document.createElement('div'); b.className = `badge ${c.ok ? 'ok' : 'bad'}`; b.title = c.detail || '';
    b.textContent = `${c.ok ? '✓' : '✗'} ${names[c.id] || c.id}`; box.appendChild(b);
    await sleep(60); b.classList.add('show'); await sleep(320);
  }
  const ai = v.ai || {};
  const usable = ai.before && ai.after;
  const good = usable && !ai.before.answer && ai.after.answer;
  const b = document.createElement('div'); b.className = `badge ${usable ? (good ? 'ok' : 'bad') : 'warn'}`;
  b.textContent = usable ? `${good ? '✓' : '✗'} AI ${Math.round(Math.min(ai.before.confidence, ai.after.confidence) * 100)}%` : '? AI';
  box.appendChild(b); await sleep(60); b.classList.add('show'); await sleep(280);
  const st = el.querySelector('.stamp');
  st.textContent = v.status === 'approved' ? 'APPROVED' : v.status === 'rejected' ? 'REJECTED' : 'HUMAN REVIEW';
  st.className = `stamp ${v.status === 'approved' ? 'ok' : v.status === 'rejected' ? 'bad' : 'warn'}`;
  await sleep(30); st.classList.add('show');
}

/**
 * Полный цикл на месте: кадр ДО → QR жителя в кадре → (работа) → кадр ПОСЛЕ → проверка.
 * work=false — житель ничего не сделал (попытка обмана), light — освещение кадра ПОСЛЕ.
 */
export async function runDeed(el, task, { work = true, light = 1, onStep = () => {} } = {}) {
  clearTile(el); el.classList.add('active');
  await api('/api/world', { spot: task.spot, done: false });
  onStep('Camera frame BEFORE captured');
  const before = await capture(task.spot); showFrame(el, task.spot); await sleep(600);
  showFrame(el, task.spot, `&qr=${task.id}`); el.querySelector('.qrbox').classList.add('on');
  const qr = await capture(task.spot, `&qr=${task.id}`);
  onStep('Resident shows the one-time QR code to the camera');
  await sleep(1200); el.querySelector('.qrbox').classList.remove('on');
  if (work) await api('/api/world', { spot: task.spot, done: true });
  const lq = light !== 1 ? `&light=${light}` : '';
  showFrame(el, task.spot, lq); await sleep(900);
  const after = await capture(task.spot, lq);
  onStep('Camera frame AFTER captured');
  // Работа с пикселями — на камере (edge): QR, ракурс, изменение зоны, вырезки.
  const { observe } = await import('./edge-camera.js');
  const bytes = (dataUrl) => Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
  const b64 = (u8) => { let s2 = ''; for (let i = 0; i < u8.length; i += 0x8000) s2 += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s2); };
  const obs = observe({ frames: { before: bytes(before), qr: bytes(qr), after: bytes(after) }, roi: task.roi, crops: true });
  onStep('Edge camera checked QR, view and work zone — asking the cloud AI');
  const r = await api('/api/verify', { taskId: task.id, edge: { ...obs, crops: { before: b64(obs.crops.before), after: b64(obs.crops.after) } } });
  await animateVerdict(el, r.verification);
  el.classList.remove('active');
  return r;
}
