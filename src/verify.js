// Проверка доказательств по пикселям кадров камеры. На вход — только PNG,
// никакого знания о «мире»: так же работала бы настоящая городская камера.
import { decode, encode } from 'fast-png';
import jsQR from 'jsqr';

export function decodePng(bytes) {
  const img = decode(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  // Приводим к RGBA: fast-png отдаёт столько каналов, сколько есть в файле.
  const n = img.width * img.height;
  const rgba = new Uint8ClampedArray(n * 4);
  const ch = img.channels;
  for (let i = 0; i < n; i += 1) {
    rgba[i * 4] = img.data[i * ch];
    rgba[i * 4 + 1] = img.data[i * ch + (ch >= 3 ? 1 : 0)];
    rgba[i * 4 + 2] = img.data[i * ch + (ch >= 3 ? 2 : 0)];
    rgba[i * 4 + 3] = ch === 4 || ch === 2 ? img.data[i * ch + ch - 1] : 255;
  }
  return { width: img.width, height: img.height, data: rgba };
}

/**
 * Похожесть кадров вне зоны задания: корреляция яркости по сетке. Ловит
 * подмену кадра другой камерой и смещение камеры, но переживает освещение.
 */
export function sceneSimilarity(a, b, roi) {
  const xs = [];
  const ys = [];
  for (let y = 0; y < a.height; y += 8) {
    for (let x = 0; x < a.width; x += 8) {
      if (x >= roi.x && x < roi.x + roi.w && y >= roi.y && y < roi.y + roi.h) continue;
      const i = (y * a.width + x) * 4;
      xs.push(a.data[i] + a.data[i + 1] + a.data[i + 2]);
      ys.push(b.data[i] + b.data[i + 1] + b.data[i + 2]);
    }
  }
  const mean = (v) => v.reduce((s, x) => s + x, 0) / v.length;
  const mx = mean(xs); const my = mean(ys);
  let num = 0; let dx = 0; let dy = 0;
  for (let i = 0; i < xs.length; i += 1) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}

/**
 * Приводит кадр к освещению эталона. Вне зоны задания сцена не меняется,
 * поэтому по этим пикселям для каждого канала подбирается y = a·x + b
 * (затемнение — множитель, засветка — сдвиг) и применяется обратное
 * преобразование. Без этого яркое солнце «стирало» тёмные мусорные пакеты.
 */
export function matchLighting(reference, img, roi) {
  const fit = [0, 1, 2].map((ch) => {
    let n = 0; let sx = 0; let sy = 0; let sxx = 0; let sxy = 0;
    for (let y = 0; y < img.height; y += 4) {
      for (let x = 0; x < img.width; x += 4) {
        if (x >= roi.x && x < roi.x + roi.w && y >= roi.y && y < roi.y + roi.h) continue;
        const i = (y * img.width + x) * 4 + ch;
        const xv = reference.data[i]; const yv = img.data[i];
        n += 1; sx += xv; sy += yv; sxx += xv * xv; sxy += xv * yv;
      }
    }
    const den = n * sxx - sx * sx;
    const a = den ? (n * sxy - sx * sy) / den : 1;
    const b = (sy - a * sx) / n;
    return { a: Math.abs(a) < 0.05 ? 1 : a, b };
  });
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    for (let ch = 0; ch < 3; ch += 1) out[i + ch] = (img.data[i + ch] - fit[ch].b) / fit[ch].a;
    out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out, fit };
}

function crop(img, x0, y0, w, h) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) {
    const src = ((y + y0) * img.width + x0) * 4;
    out.set(img.data.subarray(src, src + w * 4), y * w * 4);
  }
  return { width: w, height: h, data: out };
}

function threshold(img) {
  const out = new Uint8ClampedArray(img.data.length);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (img.data[i] + img.data[i + 1] + img.data[i + 2]) / 3 > 128 ? 255 : 0;
    out[i] = v; out[i + 1] = v; out[i + 2] = v; out[i + 3] = 255;
  }
  return { width: img.width, height: img.height, data: out };
}

/**
 * QR с кадра. Если с полного кадра не читается — пробуем центр кадра, где
 * житель держит телефон, и чёрно-белую версию: шум сенсора и сглаживание
 * иногда ломают распознавание, а отказ честному человеку недопустим.
 */
export function readQr(img) {
  const tries = [img];
  const c = crop(img, Math.floor(img.width * 0.25), Math.floor(img.height * 0.05),
    Math.floor(img.width * 0.5), Math.floor(img.height * 0.9));
  tries.push(c, threshold(c));
  for (const t of tries) {
    const code = jsQR(t.data, t.width, t.height, { inversionAttempts: 'dontInvert' });
    if (code) return code.data;
  }
  return null;
}

/** Средняя разница яркости внутри и вне зоны задания, по сетке с шагом step. */
export function changeStats(before, after, roi, step = 3) {
  let inSum = 0; let inN = 0; let outSum = 0; let outN = 0;
  for (let y = 0; y < before.height; y += step) {
    for (let x = 0; x < before.width; x += step) {
      const i = (y * before.width + x) * 4;
      const d = (Math.abs(before.data[i] - after.data[i]) + Math.abs(before.data[i + 1] - after.data[i + 1])
        + Math.abs(before.data[i + 2] - after.data[i + 2])) / 3;
      const inside = x >= roi.x && x < roi.x + roi.w && y >= roi.y && y < roi.y + roi.h;
      if (inside) { inSum += d; inN += 1; } else { outSum += d; outN += 1; }
    }
  }
  return { inside: inN ? inSum / inN : 0, outside: outN ? outSum / outN : 0 };
}

/** Тепловая карта изменения по сетке зоны задания — для наложения на кадр. */
export function diffGrid(before, after, roi, cols = 16, rows = 8) {
  const cells = [];
  const cw = Math.max(1, Math.floor(roi.w / cols));
  const ch = Math.max(1, Math.floor(roi.h / rows));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const cell = { x: roi.x + c * cw, y: roi.y + r * ch, w: cw, h: ch };
      const { inside } = changeStats(before, after, cell, 4);
      cells.push(Number(Math.min(1, inside / 60).toFixed(2)));
    }
  }
  return { cols, rows, cells };
}

export const THRESHOLDS = {
  sameScene: 0.85,   // корреляция кадров вне зоны задания
  minChange: 6,      // средняя разница яркости в зоне задания
  changeRatio: 2.5,  // во сколько раз зона должна измениться сильнее фона
};

/**
 * Проверка по пикселям. Пиксели доказывают: камера та же, QR верный, в зоне
 * задания что-то изменилось, а вокруг — нет. Что именно изменилось — вопрос
 * к модели (ai.js): пиксели не знают, что такое мусор на настоящем фото.
 */
export function verifyClaim({ spotId, token, frames, used = new Set(), spots }) {
  const spot = spots[spotId];
  if (!spot) return { ok: false, checks: [{ id: 'spot', ok: false, detail: 'Unknown location' }] };
  return judge(observe({ frames, roi: spot.roi }), token, used);
}

/**
 * Наблюдения камеры: что прочитано в QR, похож ли ракурс, насколько изменилась
 * зона задания и фон. Тяжёлая работа с пикселями — её делает камера (edge).
 * Токен камера не знает: сверяет его сервер в judge().
 */
export function observe({ frames, roi, crops = false }) {
  const before = decodePng(frames.before);
  const qrImg = decodePng(frames.qr);
  const rawAfter = decodePng(frames.after);
  const sim = sceneSimilarity(before, rawAfter, roi);
  const after = matchLighting(before, rawAfter, roi);
  const stats = changeStats(before, after, roi);
  const obs = { qr: readQr(qrImg), sim: Number(sim.toFixed(4)), inside: Number(stats.inside.toFixed(2)), outside: Number(stats.outside.toFixed(2)),
    heat: diffGrid(before, after, roi), roi };
  if (crops) obs.crops = { before: cropRoiPng(frames.before, roi), after: cropRoiPng(frames.after, roi) };
  return obs;
}

/** Решение по наблюдениям: пороги и одноразовый QR — на сервере, это дёшево. */
export function judge(obs, token, used = new Set()) {
  const { qr, sim, inside, outside } = obs;
  const changed = inside >= THRESHOLDS.minChange && inside >= THRESHOLDS.changeRatio * outside;
  const checks = [
    { id: 'qr', ok: qr === token && !used.has(token),
      detail: qr === null ? 'No QR code found in the frame'
        : qr !== token ? 'QR code belongs to a different claim'
          : used.has(token) ? 'This QR code was already redeemed' : 'Volunteer checked in with their QR code' },
    { id: 'scene', ok: sim >= THRESHOLDS.sameScene, value: Number(Number(sim).toFixed(3)),
      detail: sim >= THRESHOLDS.sameScene ? 'Before and after come from the same camera view'
        : 'Frames differ outside the work zone — swapped frame or moved camera' },
    { id: 'change', ok: changed, value: Number(Number(inside).toFixed(1)), background: Number(Number(outside).toFixed(1)),
      detail: changed ? 'The work zone changed; the rest of the scene did not'
        : 'Nothing changed in the work zone' },
  ];
  return { ok: checks.every((c) => c.ok), checks, heat: obs.heat, roi: obs.roi };
}

/**
 * Зона задания с полями — для модели. Маленькие модели на весь кадр отвечают
 * хуже: на увеличенной зоне qwen2.5vl 3B ответил верно 8 из 8, на кадре — 7 из 8.
 */
export function cropRoiPng(bytes, roi, pad = 40) {
  const img = decodePng(bytes);
  const x0 = Math.max(0, roi.x - pad);
  const y0 = Math.max(0, roi.y - pad);
  const w = Math.min(img.width - x0, roi.w + 2 * pad);
  const h = Math.min(img.height - y0, roi.h + 2 * pad);
  const c = crop(img, x0, y0, w, h);
  return encode({ width: w, height: h, data: c.data, channels: 4, depth: 8 });
}
