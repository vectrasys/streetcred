// Вымышленная история помощи за 90 дней для страницы Heroes → data/demo-contributions.json.
// Детерминированно (фиксированный seed и окно): одни и те же события при каждой сборке.
// Это не задания CITY.tasks, не выплаты и не PayPal sandbox — только демо-история для рейтинга.
import { readFileSync, writeFileSync } from 'node:fs';
import { makeRng } from './rng.mjs';

const CITY = JSON.parse(readFileSync(new URL('../data/city.json', import.meta.url)));
const rnd = makeRng(20261005);
const DAY = 86400000;
const TO = Date.UTC(2026, 9, 3); // 2026-10-03 — дата генерации города
const FROM = TO - 89 * DAY; // 90 дней включительно: 2026-07-06 … 2026-10-03
const iso = (t) => new Date(t).toISOString().slice(0, 10);

// Тип дела: частота и награда (min–max с шагом $5), как у похожих заданий города.
const KINDS = [
  ['litter', 22, 10, 25], ['butts', 8, 10, 15], ['bin', 7, 10, 20], ['leaves', 9, 15, 30],
  ['weeds', 8, 15, 25], ['flyers', 5, 10, 15], ['stickers', 6, 10, 20], ['beach', 9, 15, 30],
  ['bags', 6, 15, 25], ['boxes', 4, 15, 25], ['branches', 4, 20, 30], ['graffiti', 6, 30, 50],
  ['drain', 3, 25, 35], ['debris', 2, 45, 60], ['tires', 1, 30, 35], ['mattress', 1, 40, 45], ['couch', 1, 45, 50],
];
const weight = KINDS.reduce((s, k) => s + k[1], 0);
const pickKind = () => { let x = rnd() * weight; for (const k of KINDS) { x -= k[1]; if (x < 0) return k; } return KINDS[0]; };
const between = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// Активность: несколько лидеров (давние жители), новички (присоединились после 1 августа), остальные — середина.
const LEADERS = { maya: 33, kenji: 27, sofia: 24, isabel: 21, fatima: 19 };
const count = (r) => LEADERS[r.id] ?? (r.joined >= Date.UTC(2026, 7, 1) ? between(0, 3) : between(4, 15));

const events = [];
for (const r of CITY.residents) {
  const n = count(r), start = Math.max(FROM, Math.floor(r.joined / DAY) * DAY);
  for (let i = 0; i < n; i += 1) {
    const [kind, , lo, hi] = pickKind();
    events.push({ residentId: r.id, kind, date: iso(start + Math.floor(rnd() * ((TO - start) / DAY + 1)) * DAY), reward: lo + 5 * between(0, (hi - lo) / 5) });
  }
}
events.sort((a, b) => a.date.localeCompare(b.date) || a.residentId.localeCompare(b.residentId) || a.kind.localeCompare(b.kind));
events.forEach((e, i) => { e.id = `DH-${String(i + 1).padStart(4, '0')}`; });

const OUT = new URL('../data/demo-contributions.json', import.meta.url);
const text = `${JSON.stringify({
  schema: 'streetcred-demo-history/v1',
  label: 'Fictional demo history',
  note: 'Invented help history for the fictional demo city. Not verified work, not CITY.tasks, not payouts, not PayPal sandbox.',
  period: { from: iso(FROM), to: iso(TO), days: 90 },
  seed: 20261005,
  events: events.map(({ id, residentId, kind, date, reward }) => ({ id, residentId, kind, date, reward })),
}, null, 1)}\n`;
// --check: только сравнить с файлом (тест детерминизма), ничего не записывать.
if (process.argv.includes('--check')) { const same = readFileSync(OUT, 'utf8') === text; console.log(same ? 'same' : 'differs'); process.exit(same ? 0 : 1); }
writeFileSync(OUT, text);
console.log('событий:', events.length, '| период:', iso(FROM), '…', iso(TO));
