#!/usr/bin/env node
// Встраивает кадры из assets/ в src/assets-data.js (base64), чтобы их видели
// и Worker, и тесты в Node. Файл генерируется и в git не попадает.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const meta = JSON.parse(readFileSync(new URL('assets/assets.json', root), 'utf8'));
const out = {};
for (const spot of Object.keys(meta)) {
  const read = (f) => readFileSync(new URL(`assets/${spot}/${f}`, root)).toString('base64');
  out[spot] = { roi: meta[spot].roi, before: read('before.jpg'), after: read('after.jpg') };
}
// Портреты жителей (FLUX.1-schnell, люди вымышленные) отдаются статикой из
// public/avatar; серверу нужен только список, у кого портрет есть.
const avatars = readdirSync(new URL('public/avatar/', root)).filter((f) => f.endsWith('.jpg')).map((f) => f.slice(0, -4)).sort();
writeFileSync(new URL('src/assets-data.js', root),
  `// Сгенерировано scripts/embed-assets.mjs — не редактировать.\nexport const ASSETS = ${JSON.stringify(out)};\nexport const AVATAR_IDS = ${JSON.stringify(avatars)};\n`);
console.log('embedded', Object.keys(out).join(', '), '| avatars:', avatars.length);
