#!/usr/bin/env node
// Замер модели на кадрах «Города»: весь кадр против увеличенной зоны задания,
// прямой вопрос («есть проблема?») против обратного («здесь чисто?»).
import { Resvg } from '@resvg/resvg-js';
import { SPOTS, renderFrame } from '../src/scenes-photo.js';

const model = process.argv[2] || 'qwen2.5vl:3b';
const CLEAN = {
  sidewalk: 'Is the sidewalk around the utility pole clean, with no garbage bags?',
  alley: 'Is the brick wall clean, with no graffiti on it?',
  lot: 'Is the grass area clean, with no dumped debris?',
  tires: 'Is the sidewalk clear, with no tires lying on it?',
};
function frame(spot, done, roiOnly) {
  const svg = renderFrame(spot, { done, seed: 5 });
  const r = new Resvg(svg);
  if (!roiOnly) return r.render().asPng();
  const { x, y, w, h } = SPOTS[spot].roi;
  const pad = 40;
  const vx = Math.max(0, x - pad); const vy = Math.max(0, y - pad);
  const cropped = svg.replace(/viewBox="[^"]*"/, `viewBox="${vx} ${vy} ${Math.min(1280 - vx, w + 2 * pad)} ${Math.min(720 - vy, h + 2 * pad)}"`)
    .replace(/width="1280" height="720" viewBox/, 'width="768" height="512" preserveAspectRatio="xMidYMid slice" viewBox');
  return new Resvg(cropped).render().asPng();
}
async function ask(q, png) {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/chat', { method: 'POST', signal: AbortSignal.timeout(120000),
      body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0 },
        messages: [{ role: 'user', images: [Buffer.from(png).toString('base64')],
          content: `${q}\nLook carefully at this street camera image. Reply with exactly one JSON object: {"answer": true or false}` }] }) });
    const v = JSON.parse((await res.json()).message.content);
    return typeof v.answer === 'boolean' ? v.answer : null;
  } catch { return null; }
}
const score = {};
for (const roiOnly of [false, true]) {
  for (const spot of Object.keys(SPOTS)) {
    for (const done of [false, true]) {
      const png = frame(spot, done, roiOnly);
      const p = await ask(SPOTS[spot].question, png);   // правда: true, если не сделано
      const c = await ask(CLEAN[spot], png);            // правда: true, если сделано
      const key = roiOnly ? 'зона' : 'кадр';
      score[key] ??= { problem: 0, clean: 0, both: 0, n: 0 };
      score[key].n += 1;
      if (p === !done) score[key].problem += 1;
      if (c === done) score[key].clean += 1;
      if (p === !done && c === done) score[key].both += 1;
      console.log(`${key} ${spot.padEnd(8)} done=${done}: «есть проблема?» ${p}  «чисто?» ${c}`);
    }
  }
}
for (const [k, v] of Object.entries(score)) console.log(`${k}: прямой ${v.problem}/${v.n}, обратный ${v.clean}/${v.n}, оба верны ${v.both}/${v.n}`);
