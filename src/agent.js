// Treasury Copilot — AI-помощник руководителя программы на PayPal Agent Toolkit.
// Читает PayPal (заказы-добавки, транзакции, споры, счета) и данные программы.
// Действия, двигающие деньги или пишущие наружу (возврат, счёт спонсору),
// агент только готовит: выполняются они после кнопки «Approve» в админке.
import { generateText, tool } from 'ai';
import { z } from 'zod';
import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk';
import { createWorkersAI } from 'workers-ai-provider';
import { createOllama } from 'ollama-ai-provider';
import axios from 'axios';

// Боевые адреса PayPal: токен toolkit берёт с api.paypal.com, остальное — с api-m.
const LIVE_HOSTS = new Set(['api-m.paypal.com', 'api.paypal.com']);

// Toolkit по умолчанию ходит в боевой PayPal; здесь sandbox зашит, а любой
// запрос к боевому адресу блокируется и в axios (им пользуется toolkit), и в fetch.
let guarded = false;
// axios может быть загружен дважды (ES-модуль и CommonJS) — toolkit берёт CommonJS.
export function axiosCopies() {
  const list = [axios];
  try {
    const req = globalThis.process?.getBuiltinModule?.('module')?.createRequire?.(import.meta.url);
    const cjs = req && req('axios');
    const inst = cjs && (cjs.default || cjs);
    if (inst && !list.includes(inst)) list.push(inst);
  } catch { /* среды без require: в бандле Worker копия одна */ }
  return list;
}
export const isLive = (url) => { try { return LIVE_HOSTS.has(new URL(url).host); } catch { return false; } };
export function guardLivePayPal() {
  if (guarded) return;
  guarded = true;
  for (const ax of axiosCopies()) {
    // В Workers fetch не поддерживает cache: 'default', которую axios ставит по умолчанию.
    ax.defaults.fetchOptions = { ...(ax.defaults.fetchOptions || {}), cache: 'no-store' };
    ax.interceptors.request.use((cfg) => {
      if (isLive(cfg.baseURL ? new URL(cfg.url || '', cfg.baseURL).href : cfg.url)) throw new Error('Live PayPal is blocked: sandbox only');
      return cfg;
    });
  }
  const real = globalThis.fetch;
  globalThis.fetch = (input, init) => {
    if (isLive(typeof input === 'string' ? input : input.url)) return Promise.reject(new Error('Live PayPal is blocked: sandbox only'));
    return real(input, init);
  };
}

const READ = {
  orders: { get: true },
  transactions: { list: true },
  payments: { getRefunds: true },
  disputes: { list: true, get: true },
  invoices: { list: true, get: true },
};
// Инструменты toolkit, которые агент не выполняет сам — только предлагает.
export const NEEDS_APPROVAL = {
  create_refund: { actions: { payments: { createRefund: true } }, label: 'Refund a boost' },
  create_invoice: { actions: { invoices: { create: true } }, label: 'Create a sponsor invoice (draft)' },
  send_invoice: { actions: { invoices: { send: true } }, label: 'Send an invoice' },
};

export function paypalTools({ clientId, clientSecret, actions }) {
  guardLivePayPal();
  const kit = new PayPalAgentToolkit({ clientId, clientSecret, configuration: { actions, context: { sandbox: true } } });
  return kit.getTools();
}

export function agentModel(env) {
  if (env.AI) return { name: 'Workers AI · glm-4.7-flash', model: createWorkersAI({ binding: env.AI })('@cf/zai-org/glm-4.7-flash') };
  if (env.OLLAMA_URL) {
    const id = env.OLLAMA_AGENT_MODEL || 'qwen3:4b-instruct-2507-q4_K_M';
    return { name: `Ollama · ${id}`, model: createOllama({ baseURL: `${env.OLLAMA_URL}/api` })(id) };
  }
  return null;
}

const SYSTEM = `You are Treasury Copilot for the StreetCred program in Port Calloway (a fictional demo city).
You help the program manager reconcile money with PayPal. All PayPal calls go to the PayPal SANDBOX.
Money in: neighbors "boost" task rewards via PayPal Checkout orders. Money out: residents are paid with PayPal Payouts in a daily batch.
Rules:
- Use tools to look things up; never invent IDs, amounts or statuses.
- For "reconcile boosts" use reconcile_boosts. Report its counts as they are.
- If a tool returns an error, say exactly which lookup failed and why. Never claim something was verified with PayPal unless a PayPal tool confirmed it.
- Refunds and sponsor invoices are only PROPOSED by you with propose_boost_refund / propose_sponsor_invoice; a human approves them. Say so plainly and give the proposal ID.
- Be brief: short sentences, amounts in USD, mention order/transaction IDs you used.
Today is {today}.`;

/** Инструменты программы: только чтение данных города. */
function programTools(p, read) {
  return {
    reconcile_boosts: tool({
      description: 'Check every reward boost against its PayPal order (get_order): status must be COMPLETED and the amount must match. Sample boosts have no PayPal order and are reported separately.',
      parameters: z.object({}),
      execute: async () => {
        const rows = [];
        for (const t of p.tasks) for (const b of t.boosts || []) {
          if (b.sample) { rows.push({ taskId: t.id, amount: b.amount, by: b.by, result: 'sample data — no PayPal order' }); continue; }
          if (!read.get_order) { rows.push({ taskId: t.id, orderId: b.orderId, result: 'not checked — PayPal is not configured' }); continue; }
          const o = await read.get_order.execute({ id: b.orderId }, { toolCallId: `rec-${b.orderId}`, messages: [] }).catch((e) => ({ error: e.message }));
          const order = typeof o === 'string' ? JSON.parse(o) : o;
          const paid = order?.purchase_units?.[0]?.payments?.captures?.[0]?.amount?.value || order?.purchase_units?.[0]?.amount?.value;
          rows.push({ taskId: t.id, orderId: b.orderId, amount: b.amount, by: b.by,
            result: order?.error ? `PayPal lookup failed: ${order.error.message || order.error}` : order?.status === 'COMPLETED' && Number(paid) === Number(b.amount) ? 'matches PayPal' : `MISMATCH: PayPal status ${order?.status}, amount ${paid}` });
        }
        const count = (re) => rows.filter((r) => re.test(r.result)).length;
        return { total: rows.length, matched: count(/^matches/), mismatched: count(/^MISMATCH/), failed: count(/failed|not checked/), sample: count(/^sample/), rows };
      },
    }),
    program_overview: tool({
      description: 'Program balances (double-entry ledger), monthly budget and spend, and task counts.',
      parameters: z.object({}),
      execute: async () => ({ balances: p.balances(), monthlyBudget: p.state.settings.monthlyBudget, monthSpend: p.monthSpend().toFixed(2),
        openTasks: p.tasks.filter((t) => t.status === 'open').length, approvedUnpaid: p.payable().length }),
    }),
    list_boosts: tool({
      description: 'Reward boosts received through PayPal Checkout: task, amount, payer, PayPal order ID and capture ID. Sample entries have sample=true and no real PayPal order.',
      parameters: z.object({}),
      execute: async () => p.tasks.flatMap((t) => (t.boosts || []).map((b) => ({ taskId: t.id, task: t.title, amount: b.amount, by: b.by,
        orderId: b.orderId, captureId: b.captureId || null, sample: Boolean(b.sample), at: new Date(b.at).toISOString() }))),
    }),
    next_payout_batch: tool({
      description: 'Deeds approved and ready for the next PayPal Payouts batch, plus items on hold (for example, W-9 missing).',
      parameters: z.object({}),
      execute: async () => { const b = p.prepareBatch(); return { ready: b.ready.map(({ taskId, name, wallet, amount }) => ({ taskId, name, wallet, amount })), held: b.held, total: b.total }; },
    }),
    payout_exceptions: tool({
      description: 'All payout items across ALL batches that did not settle (UNCLAIMED, RETURNED, ONHOLD, FAILED, DENIED, PENDING), with what each status means and the next step. Use this for any question about problem payouts.',
      parameters: z.object({}),
      execute: async () => p.payoutExceptions(),
    }),
    recent_payout_batches: tool({
      description: 'The latest PayPal Payouts batches with item statuses (SUCCESS, UNCLAIMED, RETURNED, ONHOLD, PENDING).',
      parameters: z.object({ limit: z.number().int().min(1).max(10).default(5) }),
      execute: async ({ limit }) => [...p.state.batches].reverse().slice(0, limit).map((b) => ({ id: b.id, payoutBatchId: b.payoutBatchId, source: p.batchSource(b),
        date: new Date(b.createdAt).toISOString().slice(0, 10), status: b.status,
        items: b.items.map((i) => ({ id: i.id, residentId: i.residentId, amount: i.amount, status: i.status })) })),
    }),
  };
}

/**
 * Действия с деньгами агент только предлагает, через простые инструменты:
 * точные параметры PayPal собирает код, а не модель — маленькие модели
 * путают сложные схемы и выдумывают ID.
 */
function proposalTools(propose, p) {
  return {
    propose_boost_refund: tool({
      description: 'Propose refunding a reward boost to the person who paid it (PayPal refund of the captured payment). Needs human approval; nothing is executed now.',
      parameters: z.object({ task_id: z.string().describe('Task ID, for example T-2041'), reason: z.string().describe('Short reason shown to the payer') }),
      execute: async ({ task_id, reason }) => {
        const t = p.taskById(task_id);
        const b = t && (t.boosts || []).find((x) => x.captureId && !x.refunded);
        if (!b) return { error: `No refundable boost on ${task_id}: only boosts paid through PayPal Checkout have a capture to refund (sample boosts do not).` };
        const args = { capture_id: b.captureId, amount: { currency_code: 'USD', value: b.amount }, note_to_payer: `StreetCred · Port Calloway: ${reason}`.slice(0, 255) };
        return { status: 'proposed', proposalId: propose('create_refund', `Refund $${b.amount} boost on ${task_id} to ${b.by}`, args) };
      },
    }),
    propose_sponsor_invoice: tool({
      description: 'Propose a PayPal invoice to a local business that sponsors the program. Creates a DRAFT after human approval; sending is a separate approval.',
      parameters: z.object({ business_name: z.string(), email: z.string().describe('Billing email of the business'), amount: z.number().describe('USD amount'),
        purpose: z.string().describe('What the sponsorship pays for') }),
      execute: async ({ business_name, email, amount, purpose }) => {
        if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) return { error: 'A valid billing email is required' };
        if (!(amount >= 5 && amount <= 5000)) return { error: 'Sponsorship invoices are $5–$5,000' };
        const value = Number(amount).toFixed(2);
        const args = { currency_code: 'USD', note: purpose.slice(0, 500), invoicer_business_name: 'City of Port Calloway — StreetCred',
          primary_recipients: [{ billing_info: { business_name, email_address: email } }],
          items: [{ name: 'StreetCred sponsorship', description: purpose.slice(0, 200), quantity: '1', unit_amount: { currency_code: 'USD', value } }] };
        return { status: 'proposed', proposalId: propose('create_invoice', `Invoice draft · ${business_name} · $${value}`, args) };
      },
    }),
  };
}

const READ_ONLY_SYSTEM = `You analyze local demo records of the StreetCred program in Port Calloway (a fictional demo city). Read-only: you cannot propose, refund, invoice or contact PayPal.
Rules:
- Call the tools first; answer only from their results.
- Give exact amounts and counts per status from byStatus. The total of all exceptions is not the RETURNED total.
- Records marked "seeded sample record" are fictional examples, not proof of any PayPal payment or delivery; say so.
- If the tool data does not give a reason, say the reason is unknown. Do not invent causes.
- Be brief. Today is {today}.`;

// Режим только чтения: локальные записи программы; ни PayPal, ни предложений.
export const READ_ONLY_TOOLS = ['program_overview', 'list_boosts', 'next_payout_batch', 'payout_exceptions', 'recent_payout_batches'];

export async function runCopilot({ env, program, messages, propose, readOnly = false, makeTools = paypalTools, model = agentModel(env) }) {
  if (!model) throw new Error('No model configured (Workers AI binding or OLLAMA_URL)');
  let tools;
  if (readOnly) {
    const all = programTools(program, {});
    tools = Object.fromEntries(READ_ONLY_TOOLS.map((k) => [k, all[k]]));
  } else {
    const creds = { clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET };
    const read = creds.clientId ? makeTools({ ...creds, actions: READ }) : {};
    tools = { ...programTools(program, read), ...read, ...proposalTools(propose, program) };
  }
  const steps = [];
  const res = await generateText({
    model: model.model, tools, maxSteps: 6, temperature: 0.2,
    system: (readOnly ? READ_ONLY_SYSTEM : SYSTEM).replace('{today}', new Date().toISOString().slice(0, 10)),
    messages,
    onStepFinish: (s) => { for (const c of s.toolCalls || []) steps.push({ tool: c.toolName, args: c.args }); },
  });
  return { text: res.text, steps, model: model.name };
}

/** Выполнение одобренного предложения настоящим инструментом toolkit (sandbox). */
export async function executeProposal({ env, name, args, makeTools = paypalTools }) {
  const meta = NEEDS_APPROVAL[name];
  if (!meta) throw new Error('Unknown action');
  const tools = makeTools({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET, actions: meta.actions });
  return tools[name].execute(args, { toolCallId: `approved-${Date.now()}`, messages: [] });
}
