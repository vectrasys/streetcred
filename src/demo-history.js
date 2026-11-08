// Вымышленная история помощи (data/demo-contributions.json) → агрегаты для /api/public/heroes.
// Чистая функция: суммы только из событий. Не трогает задания, выплаты, sandbox и подтверждения.
import HISTORY from '../data/demo-contributions.json' with { type: 'json' };

export const DEMO_HISTORY = HISTORY;

export function demoHistoryTotals(events = HISTORY.events) {
  const by = new Map();
  for (const e of events) {
    const t = by.get(e.residentId) || { deeds: 0, cents: 0 };
    t.deeds += 1; t.cents += Math.round(Number(e.reward) * 100);
    by.set(e.residentId, t);
  }
  return by;
}

// Добавляет demoHistory* к строкам героев и сортирует: подтверждённые → дела из демо-истории → имя. Суммы не влияют.
export function withDemoHistory(heroes, history = HISTORY) {
  const by = demoHistoryTotals(history.events);
  return heroes.map((h) => {
    const t = by.get(h.id) || { deeds: 0, cents: 0 };
    return { ...h, demoHistoryDeeds: t.deeds, demoHistoryRewards: (t.cents / 100).toFixed(2),
      demoHistoryFrom: history.period.from, demoHistoryTo: history.period.to };
  }).sort((a, b) => b.confirmedDeeds - a.confirmedDeeds || b.demoHistoryDeeds - a.demoHistoryDeeds || a.name.localeCompare(b.name));
}
