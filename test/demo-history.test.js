import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import CITY from '../data/city.json' with { type: 'json' };
import { DEMO_HISTORY, demoHistoryTotals, withDemoHistory } from '../src/demo-history.js';

const DAY = 86400000;
const { events, period } = DEMO_HISTORY;
const residents = new Map(CITY.residents.map((r) => [r.id, r]));
const kinds = new Set(CITY.tasks.map((t) => t.kind));

test('демо-история: каждое событие валидно (житель, тип, дата в периоде и после регистрации, награда)', () => {
  assert.equal(DEMO_HISTORY.label, 'Fictional demo history');
  assert.equal(period.days, (Date.parse(period.to) - Date.parse(period.from)) / DAY + 1);
  assert.equal(new Set(events.map((e) => e.id)).size, events.length, 'ID уникальны');
  events.forEach((e, i) => {
    assert.equal(e.id, `DH-${String(i + 1).padStart(4, '0')}`);
    const r = residents.get(e.residentId); assert.ok(r, e.id);
    assert.ok(kinds.has(e.kind), `${e.id}: ${e.kind}`);
    assert.match(e.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(e.date >= period.from && e.date <= period.to, e.id);
    assert.ok(Date.parse(e.date) >= Math.floor(r.joined / DAY) * DAY, `${e.id}: до регистрации`);
    assert.ok(Number.isInteger(e.reward) && e.reward >= 10 && e.reward <= 60 && e.reward % 5 === 0, e.id);
  });
});

test('демо-история: естественный разброс активности и наград', () => {
  const by = demoHistoryTotals();
  const n = CITY.residents.map((r) => by.get(r.id)?.deeds ?? 0);
  assert.ok(n.filter((x) => x >= 18 && x <= 35).length >= 3, 'несколько лидеров');
  assert.ok(n.filter((x) => x <= 3).length >= 3, 'новички');
  assert.ok(n.filter((x) => x >= 4 && x <= 15).length > CITY.residents.length / 2, 'большинство 4–15');
  assert.ok(n.every((x) => x <= 35));
  assert.ok(new Set(events.map((e) => e.reward)).size >= 8, 'награды разные');
  assert.ok(new Set([...by.values()].map((t) => t.cents)).size >= 20, 'суммы у жителей не однотипные');
});

test('демо-история детерминирована: генератор даёт тот же файл', () => {
  assert.equal(execFileSync('node', ['scripts/build-demo-history.mjs', '--check']).toString().trim(), 'same');
});

test('агрегатор: суммы строго из событий; подтверждённые дела всегда выше, сумма не влияет', () => {
  const rows = withDemoHistory(CITY.residents.map((r) => ({ id: r.id, name: r.name, confirmedDeeds: r.id === 'quinn' ? 1 : 0, paidSample: r.id === 'felix' ? '99999.00' : '0.00' })));
  assert.equal(rows[0].id, 'quinn', 'подтверждённое дело важнее демо-истории');
  assert.equal(rows.reduce((s, x) => s + x.demoHistoryDeeds, 0), events.length);
  assert.equal(rows.reduce((s, x) => s + Math.round(Number(x.demoHistoryRewards) * 100), 0), events.reduce((s, e) => s + e.reward * 100, 0));
  for (const x of rows) {
    const own = events.filter((e) => e.residentId === x.id);
    assert.equal(x.demoHistoryDeeds, own.length); assert.equal(x.demoHistoryRewards, own.reduce((s, e) => s + e.reward, 0).toFixed(2));
    assert.equal(x.demoHistoryFrom, period.from); assert.equal(x.demoHistoryTo, period.to);
  }
  for (let i = 2; i < rows.length; i += 1) assert.ok(rows[i - 1].demoHistoryDeeds >= rows[i].demoHistoryDeeds || rows[i - 1].confirmedDeeds > rows[i].confirmedDeeds);
});
