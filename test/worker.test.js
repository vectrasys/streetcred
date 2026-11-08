import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import worker from '../src/worker.js';

const env = { PAYPAL_BUYER_EMAIL: 'buyer@personal.example.com' };
const sent = [];
const fakeVision = () => { let n = 0; return { name: 'fake-vision', async ask() { n += 1; return n % 2 ? '{"answer":false,"confidence":0.92}' : '{"answer":true,"confidence":0.9}'; } }; };
const ctx = {
  vision: fakeVision(),
  payouts: {
    async send(batchId, items) { sent.push({ batchId, items }); return { payoutBatchId: `PPB-${sent.length}`, status: 'PENDING' }; },
    async status() { return { status: 'SUCCESS', items: sent.at(-1).items.map((i) => ({ claimId: i.claimId, status: 'SUCCESS' })) }; },
  },
};
const cookie = (s) => `cp_session=${encodeURIComponent(btoa(JSON.stringify(s)))}`;
const ADMIN = cookie({ role: 'admin' });
const as = (id) => cookie({ role: 'resident', userId: id });
const call = async (path, body, who = null, c = ctx) => {
  const headers = { 'content-type': 'application/json', ...(who ? { cookie: who } : {}) };
  const res = await worker.fetch(new Request(`https://x.dev${path}`, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) }), env, c);
  return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
};
const snap = async (q) => Buffer.from(new Resvg((await call(`/api/frame?${q}`)).body).render().asPng()).toString('base64');

const orders = {
  made: [], paid: new Map(),
  async create({ taskId, amount }) { const id = `O-${this.made.length + 1}`; this.made.push({ id, taskId, amount }); return { id, status: 'CREATED' }; },
  async capture(id) { const o = this.made.find((x) => x.id === id); return { status: this.paid.get(id) || 'COMPLETED', taskId: o.taskId, amount: o.amount, captureId: `C-${id}`, payer: 'Rosa R', source: 'venmo' }; },
};
ctx.orders = orders;

beforeEach(() => {
  orders.made.length = 0; orders.paid.clear(); worker.reset(); sent.length = 0; ctx.vision = fakeVision(); });

// Житель на месте: кадр ДО → QR → (работа) → ПОСЛЕ → проверка.
async function deed(taskId, spot, who, { work = true, light = 1, c = ctx } = {}) {
  const cl = await call('/api/me/claim', { taskId }, as(who), c);
  assert.equal(cl.status, 200, JSON.stringify(cl.body));
  const before = await snap(`spot=${spot}&seed=1`);
  const qr = await snap(`spot=${spot}&qr=${taskId}&seed=2`);
  if (work) await call('/api/world', { spot, done: true });
  const after = await snap(`spot=${spot}&light=${light}&seed=3`);
  await call('/api/world', { spot, done: false });
  return (await call('/api/verify', { taskId, frames: { before, qr, after } }, as(who), c)).body;
}

test('город: сотни камер, полсотни заданий, вымышленные названия', async () => {
  const { body } = await call('/api/public/city');
  assert.ok(body.cameras.length >= 500);
  assert.ok(body.tasks.length >= 50);
  assert.equal(body.districts.length, 7);
  assert.ok(body.tasks.every((t) => body.cameras.some((c) => c.id === t.cameraId && c.status === 'online')));
});

test('полный путь: дела одобрены камерой → один пакет PayPal → книга сходится', async () => {
  const r1 = await deed('T-2001', 'sidewalk', 'maya');
  const r2 = await deed('T-2003', 'lot', 'luis', { light: 0.7 });
  assert.equal(r1.verification.status, 'approved');
  assert.equal(r2.verification.status, 'approved');
  const p = await call('/api/admin/payouts', {}, ADMIN);
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].items.map((i) => i.amount).sort(), ['25.00', '40.00']);
  assert.ok(sent[0].items.every((i) => i.receiver === env.PAYPAL_BUYER_EMAIL && i.wallet === 'paypal'), 'в sandbox всё уходит тестовому PayPal-получателю');
  const before = (await call('/api/admin/ledger', undefined, ADMIN)).body.balances;
  assert.equal(before.payable, '0.00');
  await call(`/api/admin/payouts/${p.body.batch.id}/refresh`, {}, ADMIN);
  const after = (await call('/api/admin/ledger', undefined, ADMIN)).body.balances;
  assert.equal((Number(after.paid_out) - Number(before.paid_out)).toFixed(2), '65.00');
  const sum = Object.values(after).reduce((s, v) => s + Number(v), 0);
  assert.ok(Math.abs(sum) < 0.005, 'двойная запись сходится');
  const me = (await call('/api/me', undefined, as('maya'))).body;
  assert.ok(me.payouts.some((x) => x.taskId === 'T-2001' && x.status === 'SUCCESS'));
});

test('ничего не сделал — отказ, модель даже не спрашивают', async () => {
  let asked = false;
  const c = { ...ctx, vision: { name: 'v', async ask() { asked = true; return '{"answer":true,"confidence":1}'; } } };
  const r = await deed('T-2002', 'alley', 'jordan', { work: false, c });
  assert.equal(r.verification.status, 'rejected');
  assert.equal(asked, false);
});

test('модель недоступна — заявка ждёт человека, а не оплачивается', async () => {
  const r = await deed('T-2004', 'tires', 'priya', { c: { ...ctx, vision: null } });
  assert.equal(r.verification.status, 'review');
  assert.equal(r.task.status, 'in_review');
  const p = await call('/api/admin/payouts', undefined, ADMIN);
  assert.ok(!p.body.prepared.ready.some((x) => x.taskId === 'T-2004'));
  const ok = await call('/api/admin/review', { taskId: 'T-2004', approve: true }, ADMIN);
  assert.equal(ok.body.task.status, 'approved');
});

test('QR одноразовый: повторная проверка отклоняется', async () => {
  await deed('T-2001', 'sidewalk', 'maya');
  const r = await call('/api/verify', { taskId: 'T-2001', frames: {} }, as('maya'));
  assert.equal(r.status, 409);
});

test('доступы: чужое задание, админка без входа, QR только владельцу', async () => {
  await call('/api/me/claim', { taskId: 'T-2001' }, as('maya'));
  assert.equal((await call('/api/verify', { taskId: 'T-2001', frames: {} }, as('luis'))).status, 403);
  assert.equal((await call('/api/admin/overview')).status, 401);
  assert.equal((await call('/api/admin/overview', undefined, as('maya'))).status, 401);
  assert.equal((await call('/api/me/qr?task=T-2001', undefined, as('luis'))).status, 404);
  const qr = await call('/api/me/qr?task=T-2001', undefined, as('maya'));
  assert.equal(qr.status, 200);
  assert.match(qr.body, /<svg/);
  const claim = await call('/api/me/claim', { taskId: 'T-2003' }, as('maya'));
  assert.ok(!JSON.stringify(claim.body).includes('CP-'), 'токен целиком не уходит в ответ');
});

test('не больше 3 активных заданий на жителя', async () => {
  const open = (await call('/api/public/city')).body.tasks.filter((t) => t.status === 'open').slice(0, 4);
  const res = [];
  for (const t of open) res.push((await call('/api/me/claim', { taskId: t.id }, as('nadia'))).status); // у засеянных «взятых» заданий — первые 20 жителей
  assert.deepEqual(res, [200, 200, 200, 409]);
});

test('заявка жителя → модерация → новое задание на карте', async () => {
  const short = await call('/api/me/proposals', { cameraId: 'CAM-0100', kind: 'bags', text: 'trash' }, as('mei'));
  assert.equal(short.status, 400);
  const p = await call('/api/me/proposals', { cameraId: 'CAM-0100', kind: 'bags', text: 'Three garbage bags left by the bench since Monday' }, as('mei'));
  assert.equal(p.status, 200);
  const big = await call('/api/admin/moderate', { proposalId: p.body.proposal.id, approve: true, reward: 500 }, ADMIN);
  assert.equal(big.status, 400, 'награда выше лимита не проходит');
  const ok = await call('/api/admin/moderate', { proposalId: p.body.proposal.id, approve: true, reward: 25, title: 'Clear dumped garbage bags' }, ADMIN);
  assert.equal(ok.body.task.status, 'open');
  const city = (await call('/api/public/city')).body;
  assert.ok(city.tasks.some((t) => t.id === ok.body.task.id && t.source === 'resident'));
});

test('без W-9 выше порога — удержание, а не выплата', async () => {
  await call('/api/admin/settings', { w9ThresholdYear: 10 }, ADMIN);
  // У Priya W-9 не требовался (not_required) — порог её касается.
  await deed('T-2004', 'tires', 'priya');
  const p = (await call('/api/admin/payouts', undefined, ADMIN)).body.prepared;
  assert.ok(p.held.some((x) => x.taskId === 'T-2004'));
  assert.ok(!p.ready.some((x) => x.taskId === 'T-2004'));
});

test('повторное «выплатить» не платит за те же дела', async () => {
  await deed('T-2001', 'sidewalk', 'maya');
  assert.equal((await call('/api/admin/payouts', {}, ADMIN)).status, 200);
  assert.equal((await call('/api/admin/payouts', {}, ADMIN)).status, 409);
  assert.equal(sent.length, 1);
});

test('webhook без проверки подписи только записывается', async () => {
  await deed('T-2001', 'sidewalk', 'maya');
  const b = (await call('/api/admin/payouts', {}, ADMIN)).body.batch;
  await call('/api/webhooks/paypal', { event_type: 'PAYMENT.PAYOUTS-ITEM.SUCCEEDED', resource: { payout_item_id: 'X' } });
  const after = (await call('/api/admin/payouts', undefined, ADMIN)).body.batches.find((x) => x.id === b.id);
  assert.equal(after.items[0].status, 'PENDING');
  const wh = (await call('/api/admin/webhooks', undefined, ADMIN)).body;
  assert.equal(wh[0].verified, false);
});

test('Community impact: по числу подтверждённых дел, а не по долларам; образцы помечены', async () => {
  await deed('T-2001', 'sidewalk', 'maya');
  const hs = (await call('/api/public/heroes')).body;
  assert.equal(hs.length, (await call('/api/public/stats')).body.residents, 'полный список жителей, без top20');
  const key = (x) => [x.confirmedDeeds, x.demoHistoryDeeds];
  for (let i = 1; i < hs.length; i += 1) {
    const [a, b] = [key(hs[i - 1]), key(hs[i])];
    assert.ok(a[0] > b[0] || (a[0] === b[0] && a[1] >= b[1]));
  }
  assert.equal(hs[0].name.split(' ')[0], 'Maya');
  assert.equal(hs.reduce((n, x) => n + x.confirmedDeeds, 0), 1, 'история пакетов не считается делами');
  assert.equal(hs.reduce((n, x) => n + x.sampleCompletedTasks, 0), 6);
});

test('Heroes: вымышленная демо-история отдельно от подтверждений и денег', async () => {
  const before = (await call('/api/public/heroes')).body;
  const me0 = (await call('/api/me', undefined, as('maya'))).body;
  assert.ok(before.every((x) => Number.isInteger(x.demoHistoryDeeds) && /^\d+\.\d{2}$/.test(x.demoHistoryRewards) && x.demoHistoryFrom === '2026-07-06' && x.demoHistoryTo === '2026-10-03'));
  assert.ok(!('demoHistoryDeeds' in me0.earnings), 'кабинет и деньги жителя не получают демо-историю');
  assert.equal(before.find((x) => x.id === 'maya').paidSample, me0.earnings.paidSample);
  assert.equal(before.reduce((n, x) => n + x.confirmedDeeds, 0), 0);
  await deed('T-2003', 'lot', 'luis', { light: 0.7 });
  const after = (await call('/api/public/heroes')).body;
  assert.equal(after[0].id, 'luis', 'подтверждённое дело выше лидера демо-истории');
  assert.equal(after[0].confirmedDeeds, 1);
  const luis = (x) => x.find((h) => h.id === 'luis');
  assert.equal(luis(after).demoHistoryDeeds, luis(before).demoHistoryDeeds, 'проверка не меняет демо-историю');
  assert.equal(luis(after).demoHistoryRewards, luis(before).demoHistoryRewards);
});

test('/api/me: источник выплат, руководство по типу задания, Demo data в статистике', async () => {
  const me = (await call('/api/me', undefined, as('maya'))).body;
  assert.ok(me.payouts.length && me.payouts.every((x) => x.source === 'seeded_sample' && /unavailable/.test(x.evidence)));
  assert.equal(me.earnings.confirmedDeeds, 0);
  const city = (await call('/api/public/city')).body;
  const g = city.tasks.find((t) => t.kind === 'mattress').guide;
  assert.equal(g.solo, false); assert.equal(g.estimateMinutes, null); assert.match(g.source, /Demo program guidance/);
  assert.equal(city.tasks.find((t) => t.kind === 'other')?.guide.solo ?? null, null);
  const stats = (await call('/api/public/stats')).body;
  assert.equal(stats.demoData.seeded, true);
});

test('доказательство дела: ROI-кадры только после approved, только владельцу/админу, без кэша', async () => {
  await deed('T-2001', 'sidewalk', 'maya');
  const t = (await call('/api/me', undefined, as('maya'))).body.tasks.find((x) => x.id === 'T-2001');
  assert.equal(t.status, 'approved');
  assert.match(t.evidence.caption, /not real-world work/);
  const get = (q, who) => worker.fetch(new Request(`https://x.dev${q}`, { headers: who ? { cookie: who } : {} }), env, ctx);
  const ok = await get(t.evidence.afterUrl, as('maya'));
  assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/png'); assert.match(ok.headers.get('cache-control'), /no-store/);
  assert.equal((await get(t.evidence.beforeUrl, ADMIN)).status, 200);
  assert.equal((await get(t.evidence.afterUrl, as('luis'))).status, 404);
  assert.equal((await get(t.evidence.afterUrl, null)).status, 404);
  assert.equal((await get('/api/me/evidence?task=T-2001&shot=qr', as('maya'))).status, 404);
  // засеянные завершённые задания кадров не получают
  const seeded = (await call('/api/public/city')).body.tasks.find((x) => x.status === 'completed');
  assert.equal((await get(`/api/me/evidence?task=${seeded.id}&shot=after`, ADMIN)).status, 404);
  // отказ — кадров нет
  const r = await deed('T-2003', 'lot', 'luis', { work: false });
  assert.notEqual(r.verification.status, 'approved');
  assert.equal((await call('/api/me', undefined, as('luis'))).body.tasks.find((x) => x.id === 'T-2003').evidence, null);
});

test('добавка к награде через PayPal Checkout: сумма с сервера, повтор не засчитывается', async () => {
  const before = (await call('/api/public/city')).body.tasks.find((t) => t.id === 'T-2041');
  assert.equal((await call('/api/boost/order', { taskId: 'T-2041', amount: '7.00' })).status, 400, 'только $5/$10/$25');
  const o = await call('/api/boost/order', { taskId: 'T-2041', amount: '10.00' });
  assert.equal(o.status, 200);
  const c = await call('/api/boost/capture', { orderId: o.body.id });
  assert.equal(c.status, 200);
  assert.equal(c.body.task.reward, (Number(before.reward) + 10).toFixed(2));
  assert.ok(c.body.task.boosts.some((b) => b.by === 'Rosa R' && b.source === 'venmo'));
  assert.equal((await call('/api/boost/capture', { orderId: o.body.id })).status, 404, 'второй capture того же заказа не проходит');
  const led = (await call('/api/admin/ledger', undefined, ADMIN)).body;
  assert.ok(led.entries.some((e) => e.debit === 'sponsor_funds' && e.ref === o.body.id && e.amount === '10.00'));
});

test('неоплаченный заказ не меняет награду', async () => {
  const o = await call('/api/boost/order', { taskId: 'T-2041', amount: '5.00' });
  orders.paid.set(o.body.id, 'PAYER_ACTION_REQUIRED');
  assert.equal((await call('/api/boost/capture', { orderId: o.body.id })).status, 402);
});

test('житель выбирает Venmo: выплата уходит с recipient_wallet Venmo', async () => {
  const bad = await call('/api/me/profile', { wallet: 'venmo', phone: '12345' }, as('maya'));
  assert.equal(bad.status, 400);
  const ok = await call('/api/me/profile', { wallet: 'venmo', phone: '(555) 014-2049' }, as('maya'));
  assert.equal(ok.body.wallet.type, 'venmo');
  await deed('T-2001', 'sidewalk', 'maya');
  const p = (await call('/api/admin/payouts', undefined, ADMIN)).body;
  const item = p.preview.items.find((i) => i.sender_item_id === 'T-2001');
  assert.deepEqual([item.recipient_type, item.recipient_wallet, item.receiver], ['PHONE', 'Venmo', '+1 (555) 014-2049']);
});

// Камера (edge) считает наблюдения сама; сервер получает только их и вырезки зоны.
async function edgeDeed(taskId, spot, who, { work = true, c = ctx } = {}) {
  const { observe } = await import('../src/verify.js');
  await call('/api/me/claim', { taskId }, as(who), c);
  const city = (await call('/api/public/city')).body;
  const roi = city.tasks.find((t) => t.id === taskId).roi;
  const png = async (q) => Buffer.from(new Resvg((await call(`/api/frame?${q}`)).body).render().asPng());
  const before = await png(`spot=${spot}&seed=1`);
  const qr = await png(`spot=${spot}&qr=${taskId}&seed=2`);
  if (work) await call('/api/world', { spot, done: true });
  const after = await png(`spot=${spot}&seed=3`);
  await call('/api/world', { spot, done: false });
  const obs = observe({ frames: { before, qr, after }, roi, crops: true });
  const edge = { ...obs, crops: { before: Buffer.from(obs.crops.before).toString('base64'), after: Buffer.from(obs.crops.after).toString('base64') } };
  return { edge, res: await call('/api/verify', { taskId, edge }, as(who), c) };
}

test('edge-камера: честное дело одобрено, полные кадры на сервер не уходят', async () => {
  const { edge, res } = await edgeDeed('T-2001', 'sidewalk', 'maya');
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.verification.status, 'approved');
  assert.equal(res.body.verification.by, 'edge camera + cloud AI');
  assert.ok(!('before' in edge && typeof edge.before === 'string'), 'полных кадров в запросе нет');
});

test('edge-камера: ничего не сделано — отказ; чужой QR — отказ; мусор — 400', async () => {
  const lazy = await edgeDeed('T-2002', 'alley', 'jordan', { work: false });
  assert.equal(lazy.res.body.verification.status, 'rejected');
  const { edge } = await edgeDeed('T-2003', 'lot', 'luis');
  worker.reset();
  await call('/api/me/claim', { taskId: 'T-2003' }, as('luis'));
  const forged = await call('/api/verify', { taskId: 'T-2003', edge }, as('luis'));
  assert.equal(forged.body.verification.status, 'rejected', 'QR от прошлой заявки не подходит к новой');
  await call('/api/me/claim', { taskId: 'T-2004' }, as('priya'));
  const bad = await call('/api/verify', { taskId: 'T-2004', edge: { qr: 1, sim: 'x' } }, as('priya'));
  assert.equal(bad.status, 400);
});
