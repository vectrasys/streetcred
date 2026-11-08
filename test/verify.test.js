import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyClaim, decodePng, readQr } from '../src/verify.js';
import { SPOTS } from '../src/scenes-photo.js';
import { frames, png } from './helpers.js';

const T = 'CP-7F3A-91';
const IDS = Object.keys(SPOTS);
const run = (spotId, f, used) => verifyClaim({ spotId, token: T, frames: f, used, spots: SPOTS });
const failed = (r) => r.checks.filter((c) => !c.ok).map((c) => c.id);

for (const id of IDS) {
  test(`${id}: работа сделана — пиксели подтверждают изменение в зоне задания`, () => {
    const r = run(id, frames(id, T));
    assert.equal(r.ok, true, JSON.stringify(r.checks));
  });
  test(`${id}: освещение не мешает`, () => {
    for (const light of [0.6, 0.8, 1.15]) assert.equal(run(id, frames(id, T, { light })).ok, true, `light ${light}`);
  });
  test(`${id}: «ничего не сделал» отклоняется при любом освещении`, () => {
    for (const light of [0.6, 1, 1.15]) {
      const r = run(id, frames(id, T, { done: false, light }));
      assert.deepEqual(failed(r), ['change'], `light ${light}: ${JSON.stringify(r.checks)}`);
    }
  });
  test(`${id}: чужой QR-код отклоняется`, () => {
    assert.deepEqual(failed(run(id, frames(id, T, { qr: 'CP-OTHER-00' }))), ['qr']);
  });
  test(`${id}: кадр «после» с другой камеры отклоняется`, () => {
    const other = IDS.find((s) => s !== id);
    const r = run(id, { ...frames(id, T), after: png(other, { done: true }) });
    assert.ok(failed(r).includes('scene'), JSON.stringify(r.checks));
  });
}

test('повторно погашенный QR-код отклоняется', () => {
  const r = run('tires', frames('tires', T), new Set([T]));
  assert.deepEqual(failed(r), ['qr']);
});

test('QR читается с кадра камеры поверх фото', () => {
  assert.equal(readQr(decodePng(png('lot', { qrToken: 'CP-ABCD-42' }))), 'CP-ABCD-42');
});

test('тепловая карта изменений отдаётся для наложения', () => {
  const r = run('lot', frames('lot', T));
  assert.equal(r.heat.cells.length, r.heat.cols * r.heat.rows);
  assert.ok(Math.max(...r.heat.cells) > 0.2);
});

test('подписи камер с «&» и «<» не ломают кадр', async () => {
  const { renderFrame } = await import('../src/scenes-photo.js');
  assert.match(renderFrame('sidewalk'), /HARBOR AVE &amp; 3RD ST/);
});

test('QR читается на 40 случайных токенах при любом освещении и шуме', async () => {
  const rand = () => Math.random().toString(36).slice(2, 6).toUpperCase();
  const ids = Object.keys(SPOTS);
  for (let i = 0; i < 40; i += 1) {
    const t = `CP-${rand()}-${rand()}`;
    const got = readQr(decodePng(png(ids[i % 4], { qrToken: t, seed: 1 + (i % 9), light: [0.6, 0.8, 1, 1.15][i % 4] })));
    assert.equal(got, t);
  }
});

test('зона задания вырезается для модели с полями и остаётся PNG', async () => {
  const { cropRoiPng } = await import('../src/verify.js');
  const roi = SPOTS.tires.roi;
  const out = decodePng(cropRoiPng(png('tires', {}), roi));
  assert.equal(out.width, roi.w + 80);
  assert.equal(out.height, roi.h + 80);
});

test('время в кадре — тихоокеанское', async () => {
  const { renderFrame } = await import('../src/scenes-photo.js');
  // 2026-10-03 14:22:31 UTC = 07:22:31 PDT
  assert.match(renderFrame('lot', { when: Date.UTC(2026, 9, 3, 14, 22, 31) }), /10-03-2026 07:22:31 PT/);
});
