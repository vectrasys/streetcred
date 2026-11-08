// Публичное демо: изолировано от программы города, проверка тем же конвейером, выплата только симулируется.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { Resvg } from '@resvg/resvg-js';
import { MockLanguageModelV1 } from 'ai/test';
import worker from '../src/worker.js';
import { observe } from '../src/verify.js';

const ADMIN = `cp_session=${encodeURIComponent(btoa(JSON.stringify({ role: 'admin' })))}`;
const yesNo = () => { let n = 0; return { name: 'fake-vision', async ask() { n += 1; return n % 2 ? '{"answer":false,"confidence":0.9}' : '{"answer":true,"confidence":0.9}'; } }; };
let sent = [];
const payouts = { async send(...a) { sent.push(a); return { payoutBatchId: 'X', status: 'PENDING' }; }, async status() { return { status: 'SUCCESS', items: [] }; } };
const call = async (path, body, { ctx = {}, env = {}, cookie } = {}) => {
  const headers = { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) };
  const res = await worker.fetch(new Request(`https://x.dev${path}`, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) }), env, { payouts, ...ctx });
  return { status: res.status, body: (res.headers.get('content-type') || '').includes('json') ? await res.json() : await res.text() };
};
const png = async (q) => Buffer.from(new Resvg((await call(`/api/demo/frame?${q}`)).body).render().asPng());
async function runDemo({ cheat = false, ctx = { vision: yesNo() } } = {}) {
  const s = (await call('/api/demo/start', {}, { ctx })).body;
  await call('/api/demo/claim', { id: s.id });
  const frames = { before: await png(`id=${s.id}&shot=before`), qr: await png(`id=${s.id}&shot=qr`), after: await png(`id=${s.id}&shot=after${cheat ? '&cheat=1' : ''}`) };
  const o = observe({ frames, roi: s.task.roi, crops: true });
  const edge = { ...o, crops: { before: Buffer.from(o.crops.before).toString('base64'), after: Buffer.from(o.crops.after).toString('base64') } };
  const v = (await call('/api/demo/verify', { id: s.id, edge }, { ctx })).body;
  return { s, v };
}
beforeEach(() => { worker.reset(); sent = []; });

test('честное демо: одобрено тем же конвейером, выплата симулирована, программа города не тронута', async () => {
  const main = worker.program();
  const before = { status: main.taskById('T-2001').status, ledger: main.state.ledger.length, batches: main.state.batches.length };
  const { s, v } = await runDemo();
  assert.equal(v.verification.status, 'approved', JSON.stringify(v).slice(0, 300));
  assert.ok(v.verification.checks.every((c) => c.ok));
  const pay = await call('/api/demo/payout', { id: s.id });
  assert.equal(pay.status, 200);
  assert.equal(pay.body.receipt.simulated, true);
  assert.match(pay.body.receipt.status, /SIMULATED/);
  assert.equal(sent.length, 0, 'в демо нет запросов к PayPal');
  assert.deepEqual({ status: main.taskById('T-2001').status, ledger: main.state.ledger.length, batches: main.state.batches.length }, before, 'программа города не изменилась');
});

test('демо: попытка обмана отклонена, выплаты нет', async () => {
  const { s, v } = await runDemo({ cheat: true });
  assert.equal(v.verification.status, 'rejected');
  assert.equal((await call('/api/demo/payout', { id: s.id })).status, 409);
});

test('демо без модели: явное состояние и ручная проверка, без выплаты', async () => {
  const s = (await call('/api/demo/start', {}, { ctx: {} })).body;
  assert.equal(s.ai.available, false);
  assert.ok(s.ai.reason);
  const { s: s2, v } = await runDemo({ ctx: {} });
  assert.equal(v.verification.status, 'review');
  const pay = await call('/api/demo/payout', { id: s2.id });
  assert.equal(pay.status, 409);
  assert.match(pay.body.error, /human reviewer/);
});

test('сохранённые доказательства: 8 ответов модели и sandbox-пакет с источником', async () => {
  const e = (await call('/api/demo/evidence?id=x')).body;
  assert.equal(e.recordedModel.runs.length, 8);
  assert.ok(e.recordedModel.recordedAt && e.recordedModel.model);
  assert.equal(e.recordedSandboxPayout.payoutBatch.environment, 'PayPal sandbox');
  assert.ok(e.recordedSandboxPayout.payoutBatch.source);
});

test('исключения по выплатам — только администратору', async () => {
  assert.equal((await call('/api/admin/payout-exceptions')).status, 401);
  const r = await call('/api/admin/payout-exceptions', undefined, { cookie: ADMIN });
  assert.equal(r.status, 200);
  assert.ok(r.body.rows.every((x) => x.status !== 'SUCCESS' && x.meaning && x.nextStep));
});

test('Copilot readOnly: предложения возврата/счёта невозможны, чтение исключений работает', async () => {
  const scripted = (steps) => { let i = 0; return { name: 'mock', model: new MockLanguageModelV1({ doGenerate: async () => {
    const st = steps[Math.min(i++, steps.length - 1)];
    const base = { rawCall: { rawPrompt: null, rawSettings: {} }, usage: { promptTokens: 1, completionTokens: 1 } };
    return st.tool ? { ...base, finishReason: 'tool-calls', toolCalls: [{ toolCallType: 'function', toolCallId: `c${i}`, toolName: st.tool, args: JSON.stringify(st.args || {}) }] } : { ...base, finishReason: 'stop', text: st.text };
  } }) }; };
  const env = { PAYPAL_CLIENT_ID: 'id', PAYPAL_CLIENT_SECRET: 's' };
  const ok = await call('/api/admin/copilot', { readOnly: true, messages: [{ role: 'user', content: 'Why did payouts not arrive?' }] },
    { cookie: ADMIN, env, ctx: { copilot: { model: scripted([{ tool: 'payout_exceptions' }, { text: '7 items.' }]) } } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.readOnly, true);
  assert.deepEqual(ok.body.steps.map((x) => x.tool), ['payout_exceptions']);
  const bad = await call('/api/admin/copilot', { readOnly: true, messages: [{ role: 'user', content: 'invoice the bakery' }] },
    { cookie: ADMIN, env, ctx: { copilot: { model: scripted([{ tool: 'propose_sponsor_invoice', args: { business_name: 'B', email: 'b@b.example', amount: 50, purpose: 'x' } }, { text: 'done' }]) } } });
  assert.notEqual(bad.body.proposals?.length, 1);
  assert.equal(worker.program().state.aiActions.length, 0, 'ни одного предложения не создано');
});
