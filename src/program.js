// Программа StreetCred: задания, жители, модерация, проверка, выплаты,
// бухгалтерская книга и журнал действий. Состояние — в памяти изолята,
// засеяно данными города (data/city.json); для деплоя нужен Durable Object.
import CITY from '../data/city.json' with { type: 'json' };
import { SPOTS } from './scenes-photo.js';

const DAY = 86400000;

export const SETTINGS_DEFAULT = {
  monthlyBudget: 7500,
  maxReward: 75,
  dailyCutoff: '17:00 PT',
  claimHoldHours: 48,
  w9ThresholdYear: 600,     // политика программы, настраивается
  payoutCurrency: 'USD',
  unclaimedDays: 30,        // PayPal возвращает невостребованную выплату через 30 дней
};

// Четыре задания с отлаженной парой кадров «до/после» — проходят полную
// автоматическую проверку камерами и моделью.
const VERIFIABLE = [
  { spot: 'sidewalk', district: 'heights', kind: 'bags', title: 'Clear dumped garbage bags' },
  { spot: 'alley', district: 'cooperage', kind: 'graffiti', title: 'Paint over graffiti' },
  { spot: 'lot', district: 'millworks', kind: 'debris', title: 'Haul away construction debris' },
  { spot: 'tires', district: 'seaview', kind: 'tires', title: 'Remove dumped tires' },
];

export function createProgram(now = () => Date.now()) {
  const cams = CITY.cameras.map((c) => ({ ...c }));
  const camById = new Map(cams.map((c) => [c.id, c]));
  const taken = new Set(CITY.tasks.map((t) => t.cameraId));
  // Кошелёк для выплат: PayPal (email) или Venmo (телефон, только США).
  const residents = CITY.residents.map((r, i) => ({ ...r, holds: [],
    wallet: i % 3 === 1 ? { type: 'venmo', receiver: `+1 (555) 01${String(10 + i).padStart(2, '0')}-${String(2000 + i * 37).slice(-4)}` } : { type: 'paypal', receiver: r.paypal } }));
  const resById = new Map(residents.map((r) => [r.id, r]));

  // Данные города посчитаны на момент CITY.generatedAt; возраст заданий и
  // заявок сдвигается к текущему времени, чтобы «posted 3 h ago» было правдой.
  const shift = now() - CITY.generatedAt;
  const tasks = CITY.tasks.map((t) => ({ ...t, createdAt: t.createdAt + shift, claimedBy: null, claimedAt: null, verification: null }));
  // Засеянные «взятые/на проверке/выполненные» задания — на чьих-то именах.
  tasks.forEach((t, i) => {
    if (t.status !== 'open') { t.claimedBy = residents[(i * 7) % 20].id; t.claimedAt = t.createdAt + DAY; }
  });
  VERIFIABLE.forEach((v, i) => {
    const cam = cams.find((c) => c.district === v.district && c.status === 'online' && !taken.has(c.id));
    taken.add(cam.id);
    cam.spot = v.spot;
    tasks.unshift({
      id: `T-${2001 + i}`, frame: null, spot: v.spot, kind: v.kind, title: v.title, cameraId: cam.id,
      district: v.district, address: `${cam.streets[0]} & ${cam.streets[1]}`, reward: SPOTS[v.spot].reward,
      status: 'open', source: 'city', createdAt: now() - (i + 1) * 3600000,
      claimedBy: null, claimedAt: null, verification: null, verifiable: true,
    });
  });
  const taskById = (id) => tasks.find((t) => t.id === id);
  tasks.forEach((t) => { t.boosts = []; });
  // Пример добавок от соседей и местных бизнесов (вымышленных) через PayPal Checkout.
  const SPONSORS = [['Harbor Street Bakery', '10.00'], ['Pine Heights Hardware', '15.00'], ['A neighbor', '5.00'], ['Cannery Row Coffee', '10.00'], ['A neighbor', '5.00'], ['Mission Plaza Books', '10.00']];
  tasks.filter((t) => t.status === 'open' && !t.verifiable).filter((_, i) => i % 5 === 2).slice(0, SPONSORS.length).forEach((t, i) => {
    const [by, amount] = SPONSORS[i];
    t.boosts.push({ by, amount, at: t.createdAt + 7200000, orderId: `SAMPLE-${i + 1}`, source: 'paypal', sample: true });
    t.reward = (Number(t.reward) + Number(amount)).toFixed(2);
  });

  const state = {
    settings: { ...SETTINGS_DEFAULT },
    proposals: CITY.proposals.map((p) => ({ ...p, createdAt: p.createdAt + shift })),
    batches: CITY.history.map((b) => ({ ...b, items: b.items.map((it, j) => ({ ...it, id: `${b.id}-${j + 1}` })) })),
    ledger: [],
    audit: [],
    webhooks: [],
    tokens: new Map(),   // taskId -> одноразовый QR-токен
    used: new Set(),
    aiActions: [],            // предложения Treasury Copilot, ждущие одобрения
    pendingOrders: new Map(), // заказ PayPal → задание и сумма, заданные сервером
  };

  // ---------- книга: двойная запись ----------
  const ACCOUNTS = ['sponsor_funds', 'program_budget', 'payable', 'in_transit', 'paid_out', 'returned'];
  function post(memo, debit, credit, amount, ref, at = now()) {
    state.ledger.push({ id: state.ledger.length + 1, at, memo, debit, credit, amount: Number(amount).toFixed(2), ref });
  }
  for (const b of state.batches) {
    for (const it of b.items) {
      post('Deed approved', 'program_budget', 'payable', it.amount, it.id, b.createdAt - 5 * 3600000);
      post('Payout sent to PayPal', 'payable', 'in_transit', it.amount, it.id, b.createdAt);
      if (it.status === 'SUCCESS') post('Payout settled', 'in_transit', 'paid_out', it.amount, it.id, b.createdAt + 120000);
      if (it.status === 'RETURNED') post('Payout returned by PayPal', 'in_transit', 'returned', it.amount, it.id, b.createdAt + 30 * DAY);
    }
  }
  for (const t of tasks) for (const b of t.boosts) post('Reward boost received via PayPal', 'sponsor_funds', 'program_budget', b.amount, b.orderId, b.at);
  state.ledger.sort((a, b) => a.at - b.at).forEach((e, k) => { e.id = k + 1; });
  function balances() {
    const bal = Object.fromEntries(ACCOUNTS.map((a) => [a, 0]));
    for (const e of state.ledger) { bal[e.debit] -= Number(e.amount); bal[e.credit] += Number(e.amount); }
    return Object.fromEntries(Object.entries(bal).map(([k, v]) => [k, v.toFixed(2)]));
  }

  function log(actor, action, detail) {
    state.audit.unshift({ at: now(), actor, action, detail });
    if (state.audit.length > 500) state.audit.length = 500;
  }

  // ---------- жители ----------
  // Засеянная история (HIST…) — пример, не доказательство; пакеты этой сессии — записи PayPal sandbox.
  const isSample = (b) => String(b.payoutBatchId).startsWith('HIST');
  function earnings(residentId) {
    let paid = 0; let pending = 0; let inTransit = 0; let paidSample = 0; let paidSandbox = 0; let sampleHistoryItems = 0;
    for (const b of state.batches) for (const it of b.items) {
      if (it.residentId !== residentId) continue;
      if (isSample(b)) sampleHistoryItems += 1; // записи о выплатах без задания — только деньги и происхождение
      if (it.status === 'SUCCESS') { paid += Number(it.amount); if (isSample(b)) paidSample += Number(it.amount); else paidSandbox += Number(it.amount); }
      else if (['PENDING', 'PROCESSING', 'UNCLAIMED', 'ONHOLD'].includes(it.status)) inTransit += Number(it.amount);
    }
    // Подтверждённые дела — уникальные задания, проверенные в этом сеансе (камера + модель или проверяющий).
    // Засеянные задания со статусом completed — примеры для интерфейса, без доказательств.
    const confirmed = []; let sampleCompletedTasks = 0;
    for (const t of tasks) {
      if (t.claimedBy !== residentId) continue;
      if (t.status === 'approved') pending += Number(t.reward);
      if (['approved', 'paid'].includes(t.status) && t.verification) confirmed.push(t.id);
      if (t.status === 'completed' && !t.verification) sampleCompletedTasks += 1;
    }
    return { paid: paid.toFixed(2), pending: pending.toFixed(2), inTransit: inTransit.toFixed(2),
      paidSample: paidSample.toFixed(2), paidSandbox: paidSandbox.toFixed(2),
      confirmedDeeds: confirmed.length, confirmedTaskIds: confirmed, sampleCompletedTasks, sampleHistoryItems,
      sampleEvidence: 'unavailable — seeded sample data (fictional)',
      deeds: confirmed.length + sampleCompletedTasks }; // deeds: прежнее поле — проверенные + примерные задания
  }
  // Рейтинг по делам (подтверждённые, затем вклады из примерной истории), не по долларам.
  function heroes() {
    return residents.map((r) => ({ id: r.id, name: r.name, district: r.district, ...earnings(r.id) }))
      .sort((a, b) => b.confirmedDeeds - a.confirmedDeeds || b.sampleCompletedTasks - a.sampleCompletedTasks || a.name.localeCompare(b.name));
  }

  // ---------- задания ----------
  const part = () => Math.random().toString(36).slice(2, 6).toUpperCase().padEnd(4, '7');
  const newToken = () => `CP-${part()}-${part()}`;
  // QR выдаётся при взятии; у засеянных «взятых» заданий — при первом обращении.
  function token(taskId) {
    const t = taskById(taskId);
    if (!state.tokens.has(taskId) && t && t.claimedBy) state.tokens.set(taskId, newToken());
    return state.tokens.get(taskId);
  }
  function claim(residentId, taskId) {
    const t = taskById(taskId);
    if (!resById.has(residentId)) return { error: 'Unknown resident', status: 404 };
    if (!t) return { error: 'Unknown task', status: 404 };
    if (t.status !== 'open') return { error: 'This task is no longer open', status: 409 };
    const active = tasks.filter((x) => x.claimedBy === residentId && x.status === 'claimed').length;
    if (active >= 3) return { error: 'You can hold at most 3 active tasks', status: 409 };
    t.status = 'claimed'; t.claimedBy = residentId; t.claimedAt = now();
    state.tokens.set(t.id, newToken());
    log(resById.get(residentId).name, 'claimed task', `${t.id} · ${t.title}`);
    return { task: t };
  }

  function submitForReview(residentId, taskId, note) {
    const t = taskById(taskId);
    if (!t || t.claimedBy !== residentId || t.status !== 'claimed') return { error: 'Task is not yours to submit', status: 409 };
    t.status = 'in_review';
    t.verification = { at: now(), by: 'human', reason: note || 'Submitted by resident; camera after-frame queued for review' };
    log(resById.get(residentId).name, 'submitted for review', t.id);
    return { task: t };
  }

  function recordVerification(taskId, result) {
    const t = taskById(taskId);
    t.verification = { at: now(), ...result };
    t.status = result.status === 'approved' ? 'approved' : result.status === 'rejected' ? 'rejected' : 'in_review';
    if (t.status === 'approved') post('Deed approved', 'program_budget', 'payable', t.reward, t.id);
    log('verifier', `verification ${result.status}`, `${t.id} · ${result.reason || ''}`);
    return t;
  }

  function review(adminName, taskId, approve, note) {
    const t = taskById(taskId);
    if (!t || t.status !== 'in_review') return { error: 'Task is not awaiting review', status: 409 };
    t.status = approve ? 'approved' : 'rejected';
    t.verification = { ...(t.verification || {}), reviewedBy: adminName, reviewNote: note || '', reviewedAt: now() };
    if (approve) post('Deed approved', 'program_budget', 'payable', t.reward, t.id);
    log(adminName, approve ? 'approved deed' : 'rejected deed', `${t.id}${note ? ` · ${note}` : ''}`);
    return { task: t };
  }

  // ---------- предложения ----------
  function propose(residentId, { cameraId, kind, text }) {
    if (!camById.has(cameraId)) return { error: 'Unknown camera', status: 404 };
    if (!text || String(text).trim().length < 15) return { error: 'Please describe the problem (15+ characters)', status: 400 };
    const p = { id: `P-${880 + state.proposals.length}`, residentId, cameraId, district: camById.get(cameraId).district,
      kind: kind || 'other', text: String(text).trim().slice(0, 500), status: 'pending', createdAt: now() };
    state.proposals.unshift(p);
    log(resById.get(residentId).name, 'proposed task', `${p.id} at ${cameraId}`);
    return { proposal: p };
  }

  function moderate(adminName, proposalId, { approve, reward, title, reason }) {
    const p = state.proposals.find((x) => x.id === proposalId);
    if (!p || p.status !== 'pending') return { error: 'Proposal is not pending', status: 409 };
    if (!approve) {
      p.status = 'rejected'; p.reason = reason || 'Not eligible for the program';
      log(adminName, 'rejected proposal', `${p.id} · ${p.reason}`);
      return { proposal: p };
    }
    const r = Number(reward);
    if (!(r >= 5 && r <= state.settings.maxReward)) return { error: `Reward must be $5–$${state.settings.maxReward}`, status: 400 };
    const cam = camById.get(p.cameraId);
    const t = { id: `T-${2100 + tasks.length}`, frame: null, kind: p.kind, title: title || 'Resident-reported cleanup',
      cameraId: cam.id, district: cam.district, address: `${cam.streets[0]} & ${cam.streets[1]}`,
      reward: r.toFixed(2), status: 'open', source: 'resident', proposalId: p.id, createdAt: now(),
      claimedBy: null, claimedAt: null, verification: null };
    tasks.unshift(t);
    p.status = 'approved'; p.taskId = t.id;
    log(adminName, 'approved proposal', `${p.id} → ${t.id} · $${t.reward}`);
    return { proposal: p, task: t };
  }

  // ---------- добавки к награде (PayPal Checkout) ----------
  const BOOSTS = ['5.00', '10.00', '25.00'];
  function boostable(taskId, amount) {
    const t = taskById(taskId);
    if (!t || !['open', 'claimed'].includes(t.status)) return { error: 'Only open tasks can be boosted', status: 409 };
    if (!BOOSTS.includes(amount)) return { error: 'Boost must be $5, $10 or $25', status: 400 };
    return { task: t };
  }
  /** Деньги пришли: заказ PayPal оплачен. Повтор того же заказа не засчитывается. */
  function boost(taskId, { amount, by, orderId, captureId, source }) {
    const t = taskById(taskId);
    if (!t) return { error: 'Unknown task', status: 404 };
    if (tasks.some((x) => x.boosts.some((b) => b.orderId === orderId))) return { task: t, duplicate: true };
    t.boosts.push({ by, amount, at: now(), orderId, captureId, source });
    t.reward = (Number(t.reward) + Number(amount)).toFixed(2);
    post('Reward boost received via PayPal', 'sponsor_funds', 'program_budget', amount, orderId);
    log(by, 'boosted reward', `${t.id} +$${amount} · order ${orderId}`);
    return { task: t };
  }

  /** Возврат добавки прошёл в PayPal: награда и книга уменьшаются. */
  function refundBoost(captureId, refundId) {
    for (const t of tasks) {
      const b = (t.boosts || []).find((x) => x.captureId === captureId && !x.refunded);
      if (!b) continue;
      b.refunded = refundId || true;
      t.reward = Math.max(0, Number(t.reward) - Number(b.amount)).toFixed(2);
      post('Boost refunded via PayPal', 'program_budget', 'sponsor_funds', b.amount, refundId || captureId);
      log('Treasury Copilot', 'boost refunded', `${t.id} −$${b.amount} · capture ${captureId}`);
      return { task: t, boost: b };
    }
    return null;
  }

  /** Выплаты, не дошедшие до получателя, с объяснением статуса PayPal и следующим шагом. */
  const EXC = {
    UNCLAIMED: ['The recipient has no PayPal/Venmo account for that email or phone yet.', 'Ask the resident to claim it or update their payout wallet; PayPal returns it after 30 days.'],
    RETURNED: ['Returned to the program; the exact cause is not supplied in these records.', 'Review the item details and the resident wallet before any human-approved re-issue.'],
    ONHOLD: ['PayPal is reviewing the payment or has it on hold; the reason is not supplied in these records.', 'Wait for PayPal; check the item details before taking any action.'],
    FAILED: ['PayPal could not complete the payment.', 'Inspect the provider error in the item details before any re-issue.'],
    DENIED: ['PayPal denied the payment.', 'Contact PayPal support before re-issuing.'],
    PENDING: ['PayPal is still processing.', 'Refresh the batch status later.'],
  };
  // Откуда запись: засеянная демо-история (HIST…) или пакет, отправленный в этой сессии.
  const batchSource = (b) => (String(b.payoutBatchId).startsWith('HIST') ? 'seeded sample record (fictional demo history)' : 'sent in this server session (PayPal sandbox)');
  function payoutExceptions() {
    const rows = [];
    for (const b of state.batches) for (const i of b.items) {
      if (i.status === 'SUCCESS') continue;
      const r = resById.get(i.residentId);
      rows.push({ itemId: i.id, batch: b.id, payoutBatchId: b.payoutBatchId, date: new Date(b.createdAt).toISOString().slice(0, 10), resident: r ? r.fullName : i.residentId,
        amount: i.amount, status: i.status, source: batchSource(b), meaning: EXC[i.status]?.[0] || 'Unknown status', nextStep: EXC[i.status]?.[1] || 'Check the batch in PayPal.' });
    }
    const byStatus = {};
    for (const r of rows) {
      const x = byStatus[r.status] || (byStatus[r.status] = { count: 0, total: 0 });
      x.count += 1; x.total += Number(r.amount);
    }
    for (const x of Object.values(byStatus)) x.total = x.total.toFixed(2);
    return {
      provenance: 'Program records: seeded sample history (fictional demo data) plus batches sent in this server session. Statuses are as recorded by the program; they are not an independent confirmation of delivery.',
      count: rows.length, total: rows.reduce((s2, r) => s2 + Number(r.amount), 0).toFixed(2), byStatus,
      sources: [...new Set(rows.map((r) => r.source))], rows,
    };
  }

  // ---------- выплаты ----------
  function payable() {
    return tasks.filter((t) => t.status === 'approved').map((t) => {
      const r = resById.get(t.claimedBy);
      return { taskId: t.id, residentId: r.id, name: r.fullName, email: r.paypal, wallet: r.wallet.type, receiver: r.wallet.receiver, amount: t.reward, w9: r.w9 };
    });
  }

  function ytdPaid(residentId) {
    const year = new Date(now()).getUTCFullYear();
    let s = 0;
    for (const b of state.batches) {
      if (new Date(b.createdAt).getUTCFullYear() !== year) continue;
      for (const it of b.items) if (it.residentId === residentId && it.status !== 'RETURNED') s += Number(it.amount);
    }
    return s;
  }

  /** Отбор к выплате: без W-9 сверх порога — удержание, а не выплата. */
  function prepareBatch() {
    const ready = []; const held = [];
    for (const p of payable()) {
      const r = resById.get(p.residentId);
      if (r.w9 !== 'on_file' && ytdPaid(r.id) + Number(p.amount) > state.settings.w9ThresholdYear) {
        held.push({ ...p, reason: `W-9 required above $${state.settings.w9ThresholdYear}/yr` });
      } else ready.push(p);
    }
    return { ready, held, total: ready.reduce((s, x) => s + Number(x.amount), 0).toFixed(2) };
  }

  function recordBatch(adminName, batchId, sent, items) {
    const b = { id: batchId, payoutBatchId: sent.payoutBatchId, createdAt: now(), status: sent.status, createdBy: adminName,
      items: items.map((p, j) => ({ id: `${batchId}-${j + 1}`, taskId: p.taskId, residentId: p.residentId, amount: p.amount, wallet: p.wallet, status: 'PENDING' })) };
    state.batches.push(b);
    for (const it of b.items) {
      taskById(it.taskId).status = 'paid';
      post('Payout sent to PayPal', 'payable', 'in_transit', it.amount, it.id);
    }
    log(adminName, 'sent payout batch', `${batchId} · ${b.items.length} items · $${items.reduce((s, x) => s + Number(x.amount), 0).toFixed(2)}`);
    return b;
  }

  function applyBatchStatus(batchId, status, itemStatuses) {
    const b = state.batches.find((x) => x.id === batchId);
    if (!b) return null;
    b.status = status;
    for (const s of itemStatuses) {
      const it = b.items.find((x) => x.id === s.itemId || x.taskId === s.taskId);
      if (!it || it.status === s.status) continue;
      const was = it.status;
      it.status = s.status;
      if (s.status === 'SUCCESS') post('Payout settled', 'in_transit', 'paid_out', it.amount, it.id);
      if (s.status === 'RETURNED') post('Payout returned by PayPal', 'in_transit', 'returned', it.amount, it.id);
      log('paypal', 'payout item status', `${it.id}: ${was} → ${s.status}`);
    }
    return b;
  }

  function settings(adminName, patch) {
    if (patch) {
      for (const k of Object.keys(SETTINGS_DEFAULT)) if (k in patch) state.settings[k] = patch[k];
      log(adminName, 'updated settings', JSON.stringify(patch));
    }
    return state.settings;
  }

  function monthSpend() {
    const d = new Date(now());
    const start = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    return state.ledger.filter((e) => e.debit === 'program_budget' && e.at >= start)
      .reduce((s, e) => s + Number(e.amount), 0);
  }

  return {
    city: CITY, cams, camById, tasks, taskById, residents, resById, state,
    claim, submitForReview, recordVerification, review, propose, moderate, boostable, boost, refundBoost, BOOSTS, payoutExceptions, batchSource, isSample,
    payable, prepareBatch, recordBatch, applyBatchStatus, balances, heroes, earnings, settings, monthSpend, log,
    token,
  };
}
