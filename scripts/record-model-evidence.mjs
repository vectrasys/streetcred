#!/usr/bin/env node
// Записывает настоящие ответы локальной модели (Ollama) на вопрос «здесь чисто?» по зоне задания
// для 4 мест × кадры «до/после». Демо показывает их как сохранённые доказательства, если модель
// недоступна во время показа. Ничего не придумывается: сохраняются сырые ответы и время.
//   node scripts/record-model-evidence.mjs [http://127.0.0.1:11434] [qwen2.5vl:3b]
import { writeFileSync } from 'node:fs';
import { frames } from '../test/helpers.js';
import { SPOTS } from '../src/scenes-photo.js';
import { cropRoiPng } from '../src/verify.js';
import { ollamaVision, parsePresence } from '../src/ai.js';

const url = process.argv[2] || 'http://127.0.0.1:11434';
const model = process.argv[3] || 'qwen2.5vl:3b';
const vision = ollamaVision({ url, model, timeoutMs: 120000 });
const runs = [];
for (const spot of ['sidewalk', 'alley', 'lot', 'tires']) {
  const f = frames(spot, 'CP-EVID-0000');
  for (const [kind, expected] of [['before', false], ['after', true]]) {
    const t0 = Date.now();
    let raw = null; let error = null;
    try { raw = await vision.ask(SPOTS[spot].cleanQuestion, cropRoiPng(f[kind], SPOTS[spot].roi)); } catch (err) { error = err.message; }
    const parsed = raw ? parsePresence(raw) : null;
    runs.push({ spot, frame: kind, question: SPOTS[spot].cleanQuestion, expectedClean: expected, raw, parsed, error, ms: Date.now() - t0 });
    console.log(spot, kind, parsed ? `${parsed.answer} ${parsed.confidence}` : `error ${error}`, `${Date.now() - t0}ms`);
  }
}
const correct = runs.filter((r) => r.parsed && r.parsed.answer === r.expectedClean).length;
writeFileSync(new URL('../data/recorded-model-evidence.json', import.meta.url), `${JSON.stringify({
  recordedAt: new Date().toISOString(), provider: 'ollama (local)', model, input: 'cropped work zone (ROI + 40 px), PNG', correct, total: runs.length, runs,
}, null, 2)}\n`);
console.log(`${model}: ${correct}/${runs.length}`);
