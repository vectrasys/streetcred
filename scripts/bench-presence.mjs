#!/usr/bin/env node
// Маленькие модели плохо сравнивают «до | после», поэтому проверяем другой
// режим: простой вопрос да/нет по одному кадру.
import { writeFileSync } from 'node:fs';
import { SPOTS } from '../src/scenes.js';
import { png } from '../test/helpers.js';

const models = process.argv.slice(2);
const results = {};
async function ask(model, question, image) {
  try { return await askOnce(model, question, image); } catch { return null; } // таймаут = нет ответа
}
async function askOnce(model, question, image) {
  const res = await fetch('http://127.0.0.1:11434/api/chat', {
    signal: AbortSignal.timeout(120000),
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0 },
      messages: [{ role: 'user', images: [Buffer.from(image).toString('base64')],
        content: `${question}\nLook carefully at the image. Reply with exactly one JSON object: {"answer": true or false, "confidence": number from 0 to 1}` }] }),
  });
  const d = await res.json().catch(() => ({}));
  try { const v = JSON.parse(d.message.content); return typeof v.answer === 'boolean' ? v.answer : null; } catch { return null; }
}
for (const model of models) {
  await ask(model, 'Is there a wall?', png('wall', {}));
  let right = 0; let total = 0; const t0 = Date.now(); const wrong = [];
  for (const [id, spot] of Object.entries(SPOTS)) {
    // Для «исчезнуть» объект есть в «до»; для «появиться» — в «после».
    // Вопрос про скамейку — о целой спинке, то есть о результате.
    // Вопрос либо о проблеме (её не должно остаться), либо о результате.
    const objectWhenDone = spot.questionAbout === 'result';
    for (const light of [1, 0.75]) {
      for (const done of [false, true]) {
        const truth = objectWhenDone ? done : !done;
        const got = await ask(model, spot.question, png(id, { done, light }));
        total += 1;
        if (got === truth) right += 1; else wrong.push(`${id} done=${done} light=${light} → ${got}`);
      }
    }
  }
  const ms = Math.round((Date.now() - t0) / total);
  results[model] = { accuracy: right / total, right, total, avg_ms: ms, wrong };
  console.log(`${model}: ${right}/${total} (${Math.round(right / total * 100)}%), ${ms} мс${wrong.length ? '\n   ошибки: ' + wrong.join('; ') : ''}`);
}
writeFileSync(new URL('../bench-presence.json', import.meta.url), `${JSON.stringify(results, null, 2)}\n`);
