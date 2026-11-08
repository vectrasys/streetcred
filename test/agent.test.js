import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MockLanguageModelV1 } from 'ai/test';
import { z } from 'zod';
import { tool } from 'ai';
import worker from '../src/worker.js';
import { guardLivePayPal, paypalTools, axiosCopies } from '../src/agent.js';

const ADMIN = `cp_session=${encodeURIComponent(btoa(JSON.stringify({ role: 'admin' })))}`;
const env = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 'secret' };

// Модель-заглушка: по очереди отдаёт заранее заданные шаги (вызов инструмента или текст).
function scripted(steps) {
  let i = 0;
  return { name: 'mock', model: new MockLanguageModelV1({
    doGenerate: async () => {
      const s = steps[Math.min(i++, steps.length - 1)];
      const base = { rawCall: { rawPrompt: null, rawSettings: {} }, usage: { promptTokens: 1, completionTokens: 1 } };
      return s.tool
        ? { ...base, finishReason: 'tool-calls', toolCalls: [{ toolCallType: 'function', toolCallId: `c${i}`, toolName: s.tool, args: JSON.stringify(s.args || {}) }] }
        : { ...base, finishReason: 'stop', text: s.text };
    },
  }) };
}
const executed = [];
const fakeTools = ({ actions }) => {
  const mk = (name) => tool({ description: name, parameters: z.object({}).passthrough(), execute: async (args) => { executed.push({ name, args }); return { id: `R-${executed.length}`, status: 'COMPLETED' }; } });
  const out = {};
  if (actions.orders?.get) out.get_order = mk('get_order');
  if (actions.payments?.createRefund) out.create_refund = mk('create_refund');
  if (actions.invoices?.create) out.create_invoice = mk('create_invoice');
  if (actions.invoices?.send) out.send_invoice = mk('send_invoice');
  return out;
};
const call = async (path, body, copilot) => {
  const res = await worker.fetch(new Request(`https://x.dev${path}`, body === undefined ? { headers: { cookie: ADMIN } }
    : { method: 'POST', headers: { cookie: ADMIN, 'content-type': 'application/json' }, body: JSON.stringify(body) }), env, { copilot });
  return { status: res.status, body: await res.json() };
};
beforeEach(() => { worker.reset(); executed.length = 0; });

test('copilot смотрит данные программы и отвечает', async () => {
  const model = scripted([{ tool: 'list_boosts' }, { text: 'Six boosts, all sample data.' }]);
  const r = await call('/api/admin/copilot', { messages: [{ role: 'user', content: 'Reconcile boosts' }] }, { model, makeTools: fakeTools });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.text, 'Six boosts, all sample data.');
  assert.deepEqual(r.body.steps.map((s) => s.tool), ['list_boosts']);
});

test('возврат только предлагается и выполняется после одобрения', async () => {
  // Настоящая добавка через Checkout: у неё есть capture.
  const t = worker.program().tasks.find((x) => x.status === 'open' && !x.verifiable);
  worker.program().boost(t.id, { amount: '10.00', by: 'Rosa R', orderId: 'O-1', captureId: 'CAP-1234567890ABCDE', source: 'paypal' });
  const before = t.reward;
  const model = scripted([{ tool: 'propose_boost_refund', args: { task_id: t.id, reason: 'Task was cancelled' } }, { text: 'Proposed a refund.' }]);
  const r = await call('/api/admin/copilot', { messages: [{ role: 'user', content: 'Refund CAP-1' }] }, { model, makeTools: fakeTools });
  assert.equal(r.body.proposals.length, 1);
  assert.equal(executed.length, 0, 'ничего не выполнено без одобрения');
  const id = r.body.proposals[0].id;
  const no = await call('/api/admin/copilot/decide', { id: 'AP-999', approve: true }, { makeTools: fakeTools });
  assert.equal(no.status, 409);
  const ok = await call('/api/admin/copilot/decide', { id, approve: true }, { makeTools: fakeTools });
  assert.equal(ok.body.action.status, 'done');
  assert.deepEqual(executed.map((e) => e.name), ['create_refund']);
  assert.equal(executed[0].args.capture_id, 'CAP-1234567890ABCDE', 'capture берётся из данных, а не у модели');
  assert.equal(t.reward, (Number(before) - 10).toFixed(2), 'награда уменьшилась после возврата');
  assert.equal((await call('/api/admin/copilot/decide', { id, approve: true }, { makeTools: fakeTools })).status, 409, 'повтор не выполняется');
});

test('copilot доступен только администратору', async () => {
  const res = await worker.fetch(new Request('https://x.dev/api/admin/copilot', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"messages":[]}' }), env, {});
  assert.equal(res.status, 401);
});

test('toolkit ходит только в sandbox, боевой PayPal заблокирован', async () => {
  guardLivePayPal();
  for (const ax of axiosCopies()) for (const u of ['https://api-m.paypal.com/v1/x', 'https://api.paypal.com/v1/oauth2/token']) await assert.rejects(ax.get(u), /sandbox only/);
  const seen = [];
  const ids = axiosCopies().map((ax) => [ax, ax.interceptors.request.use((cfg) => { seen.push(new URL(cfg.url, cfg.baseURL).host); throw new Error('stop'); })]);
  try {
    const t = paypalTools({ clientId: 'a', clientSecret: 'b', actions: { orders: { get: true } } });
    await t.get_order.execute({ id: 'X' }, { toolCallId: 't', messages: [] }).catch(() => {});
  } finally { ids.forEach(([ax, i]) => ax.interceptors.request.eject(i)); }
  assert.ok(seen.length > 0, 'toolkit делал запрос через axios');
  assert.ok(seen.every((hst) => /^api(-m)?\.sandbox\.paypal\.com$/.test(hst)), seen.join(','));
});

test('счёт спонсору: черновик после одобрения, отправка — отдельным шагом с ID от PayPal', async () => {
  const model = scripted([{ tool: 'propose_sponsor_invoice', args: { business_name: 'Harbor Street Bakery', email: 'billing@harborstreetbakery.example', amount: 250, purpose: 'Old Wharf cleanups, November' } }, { text: 'Drafted.' }]);
  const r = await call('/api/admin/copilot', { messages: [{ role: 'user', content: 'Invoice the bakery' }] }, { model, makeTools: fakeTools });
  const a = r.body.proposals[0];
  assert.equal(a.name, 'create_invoice');
  assert.equal(a.args.items[0].unit_amount.value, '250.00');
  await call('/api/admin/copilot/decide', { id: a.id, approve: true }, { makeTools: fakeTools });
  const list = (await call('/api/admin/copilot')).body.actions;
  const send = list.find((x) => x.name === 'send_invoice');
  assert.equal(send.status, 'pending');
  assert.equal(send.args.invoice_id, 'R-1');
});

test('возврат добавки-примера невозможен: у неё нет оплаты в PayPal', async () => {
  const t = worker.program().tasks.find((x) => x.boosts.some((b) => b.sample));
  const model = scripted([{ tool: 'propose_boost_refund', args: { task_id: t.id, reason: 'x' } }, { text: 'Cannot.' }]);
  const r = await call('/api/admin/copilot', { messages: [{ role: 'user', content: 'refund' }] }, { model, makeTools: fakeTools });
  assert.equal(r.body.proposals.length, 0);
});
