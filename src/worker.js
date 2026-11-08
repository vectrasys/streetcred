// StreetCred (Port Calloway demo city) — сервер: публичный сайт, кабинет жителя,
// админка ведомства, проверка камерами и выплаты PayPal Payouts (sandbox).
import { createProgram } from './program.js';
import { SPOTS, renderFrame, qrSvg } from './scenes-photo.js';
import { verifyClaim, cropRoiPng, judge } from './verify.js';
import { askModel, decide, ollamaVision, workersAiVision } from './ai.js';
import { createPayouts, createOrders, payoutBody } from './paypal.js';
import { runCopilot, executeProposal, agentModel } from './agent.js';
import { AVATAR_IDS } from './assets-data.js';
import { withDemoHistory } from './demo-history.js';
import MODEL_EVIDENCE from '../data/recorded-model-evidence.json' with { type: 'json' };
import SANDBOX_EVIDENCE from '../data/recorded-sandbox-evidence.json' with { type: 'json' };

// Программа создаётся при первом запросе: в Workers при загрузке модуля Date.now() = 0.
let program = null;
let payouts = null;
let orders = null;
const ADMIN = { id: 'dana', name: 'Dana Whitfield', title: 'Program Manager, Department of Public Works' };

// Ответы API — динамика (сессия, город, задания, деньги): браузер не должен их хранить.
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
const fromB64 = (s) => {
  const bin = atob(String(s || '').replace(/^data:image\/png;base64,/, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

// Демо-вход: роль и пользователь в cookie. Настоящей аутентификации нет — это
// подписано на странице входа.
function session(request) {
  const m = (request.headers.get('cookie') || '').match(/cp_session=([^;]+)/);
  if (!m) return null;
  try { return JSON.parse(atob(decodeURIComponent(m[1]))); } catch { return null; }
}
const setSession = (s) => `cp_session=${encodeURIComponent(btoa(JSON.stringify(s)))}; Path=/; HttpOnly; SameSite=Lax`;

function vision(env, ctx) {
  if (ctx.noVision) return null; // демо: явно включённая «модель недоступна»
  if (ctx.vision) return ctx.vision;
  if (env.AI) return workersAiVision(env.AI, env.WORKERS_AI_VISION_MODEL ? { model: env.WORKERS_AI_VISION_MODEL } : undefined);
  if (env.OLLAMA_URL && env.OLLAMA_VISION_MODEL) return ollamaVision({ url: env.OLLAMA_URL, model: env.OLLAMA_VISION_MODEL });
  return null;
}
function payoutsClient(env, ctx) {
  if (ctx.payouts) return ctx.payouts;
  if (!payouts && env.PAYPAL_CLIENT_ID) payouts = createPayouts({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET });
  return payouts;
}

function ordersClient(env, ctx) {
  if (ctx.orders) return ctx.orders;
  if (!orders && env.PAYPAL_CLIENT_ID) orders = createOrders({ clientId: env.PAYPAL_CLIENT_ID, clientSecret: env.PAYPAL_CLIENT_SECRET });
  return orders;
}
// Что уходит в PayPal для пакета: в sandbox все элементы получает тестовый
// PayPal-аккаунт; в рабочем режиме — PayPal или Venmo жителя.
const sandboxItems = (env, ready) => ready.map((x) => ({ claimId: x.taskId, amount: x.amount, currency: 'USD',
  wallet: env.PAYPAL_BUYER_EMAIL ? 'paypal' : x.wallet, receiver: env.PAYPAL_BUYER_EMAIL || x.receiver,
  note: `StreetCred · Port Calloway · ${x.taskId}` }));
const productionItems = (ready) => ready.map((x) => ({ claimId: x.taskId, amount: x.amount, currency: 'USD', wallet: x.wallet, receiver: x.receiver,
  note: `StreetCred · Port Calloway · ${x.taskId}` }));

const mask = (email) => email.replace(/^(.)(.*)(@.*)$/, (_, a, b, c) => `${a}${'•'.repeat(Math.min(6, b.length))}${c}`);
const AVATAR_SET = new Set(AVATAR_IDS);
const maskWallet = (w) => (w.type === 'venmo' ? `+1 (•••) •••-${w.receiver.slice(-4)}` : mask(w.receiver));
const photo = (id) => (AVATAR_SET.has(id) ? `/avatar/${id}.jpg` : null);

// Руководство демо-программы по типу работы (не оценка организатора для каждого задания):
// инструменты, «справится один человек», хватит ли базового набора. Неизвестное — null («not specified»).
// Базовый набор: перчатки и мешки (бесплатно во дворе Public Works) или бытовое — метла, грабли.
const GUIDE = {
  bags: { tools: ['Gloves', 'Bags'], solo: true, basicKit: true },
  litter: { tools: ['Gloves', 'Bags'], solo: true, basicKit: true },
  boxes: { tools: ['Gloves'], solo: true, basicKit: true },
  weeds: { tools: ['Gloves', 'Bags'], solo: true, basicKit: true },
  bin: { tools: ['Gloves', 'Bags'], solo: true, basicKit: true },
  flyers: { tools: ['Gloves'], solo: true, basicKit: true },
  cart: { tools: [], solo: true, basicKit: true },
  drain: { tools: ['Gloves', 'Broom or rake'], solo: true, basicKit: true },
  graffiti: { tools: ['Paint and roller from the Public Works yard'], solo: true, basicKit: false },
  branches: { tools: ['Gloves'], solo: null, basicKit: null },
  couch: { tools: ['Gloves', 'A second person'], solo: false, basicKit: true },
  mattress: { tools: ['Gloves', 'A second person'], solo: false, basicKit: true },
  tires: { tools: ['Gloves'], solo: false, basicKit: true },
  debris: { tools: ['Heavy-duty gloves', 'Sturdy shoes'], solo: false, basicKit: false },
  butts: { tools: ['Gloves', 'Broom and dustpan'], solo: true, basicKit: true },
  leaves: { tools: ['Gloves', 'Rake', 'Bags'], solo: true, basicKit: true },
  windblown: { tools: ['Gloves', 'Bags'], solo: true, basicKit: true },
  beach: { tools: ['Gloves', 'Bags'], solo: true, basicKit: true },
  stickers: { tools: ['Gloves', 'Plastic scraper'], solo: true, basicKit: false },
  other: { tools: null, solo: null, basicKit: null },
};
const guideFor = (kind) => ({ ...(GUIDE[kind] || GUIDE.other), estimateMinutes: null, source: 'Demo program guidance by task type' });

function publicTask(t, p) {
  const r = t.claimedBy ? p.resById.get(t.claimedBy) : null;
  return { id: t.id, title: t.title, kind: t.kind, cameraId: t.cameraId, district: t.district, address: t.address,
    reward: t.reward, status: t.status, source: t.source, createdAt: t.createdAt, frame: t.frame, spot: t.spot || null,
    guide: guideFor(t.kind), verifiable: Boolean(t.verifiable), roi: t.spot && SPOTS[t.spot] ? SPOTS[t.spot].roi : null, claimedBy: r ? { id: r.id, name: r.name } : null,
    boosts: (t.boosts || []).map((b) => ({ by: b.by, amount: b.amount, at: b.at, source: b.source })) };
}

/** Проверка задания: наблюдения камеры (edge) или кадры → пороги и одноразовый QR → модель → решение. */
// Доказательство выполненного дела: ROI-вырезки PNG, по которым проверка приняла решение.
// Только в памяти текущей программы города (не в ledger и не в хранилище), только для approved,
// без полных кадров; у засеянных заданий его нет. Изолированное демо сюда не пишет.
const EVIDENCE = new WeakMap();
const EVIDENCE_CAPTION = 'Demo camera ROI frames used in this session’s verification — not real-world work.';
const isPng = (b) => b instanceof Uint8Array && b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
function taskEvidence(p, t) {
  const e = EVIDENCE.get(p)?.get(t.id);
  if (!e || !['approved', 'paid'].includes(t.status)) return null;
  const u = (shot) => `/api/me/evidence?task=${encodeURIComponent(t.id)}&shot=${shot}`;
  return { beforeUrl: u('before'), afterUrl: u('after'), provenance: `${e.by} · ${new Date(e.at).toISOString()}`, caption: EVIDENCE_CAPTION };
}

async function verifyTask(p, t, body, env, ctx, { keepEvidence = false } = {}) {
  try {
    let pixels; let crops;
    if (body.edge) {
      // Камера (edge) прислала наблюдения и вырезки зоны: решение — здесь.
      // Тяжёлых операций с пикселями на сервере нет — укладывается в лимит
      // процессора бесплатного тарифа Workers.
      const o = body.edge;
      const num = (v, lo, hi) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
      if (!(o.qr === null || typeof o.qr === 'string') || !num(o.sim, -1, 1) || !num(o.inside, 0, 255) || !num(o.outside, 0, 255)
        || !o.crops || typeof o.crops.before !== 'string' || typeof o.crops.after !== 'string' || o.crops.before.length > 2e6 || o.crops.after.length > 2e6) {
        return json({ error: 'Malformed camera observation' }, 400);
      }
      const heat = o.heat && Array.isArray(o.heat.cells) && o.heat.cells.length <= 512 ? { cols: Number(o.heat.cols) || 16, rows: Number(o.heat.rows) || 8, cells: o.heat.cells.map(Number) } : null;
      pixels = judge({ qr: o.qr, sim: o.sim, inside: o.inside, outside: o.outside, heat, roi: SPOTS[t.spot].roi }, p.token(t.id), p.state.used);
      crops = { before: fromB64(o.crops.before), after: fromB64(o.crops.after) };
    } else {
      const frames = { before: fromB64(body.frames.before), qr: fromB64(body.frames.qr), after: fromB64(body.frames.after) };
      pixels = verifyClaim({ spotId: t.spot, token: p.token(t.id), frames, used: p.state.used, spots: SPOTS });
      if (pixels.ok) crops = { before: cropRoiPng(frames.before, SPOTS[t.spot].roi), after: cropRoiPng(frames.after, SPOTS[t.spot].roi) };
    }
    const ai = pixels.ok ? await askModel(vision(env, ctx), SPOTS[t.spot].cleanQuestion, crops)
      : { before: null, after: null, error: 'not asked: pixel checks failed' };
    const decision = decide(pixels, ai);
    if (pixels.checks.find((c) => c.id === 'qr' && c.ok)) p.state.used.add(p.token(t.id));
    if (!EVIDENCE.has(p)) EVIDENCE.set(p, new Map());
    if (keepEvidence && decision.status === 'approved' && crops && isPng(crops.before) && isPng(crops.after)) {
      EVIDENCE.get(p).set(t.id, { before: crops.before, after: crops.after, at: Date.now(), by: body.edge ? 'edge camera + AI check' : 'camera + AI check' });
    } else EVIDENCE.get(p).delete(t.id);
    p.recordVerification(t.id, { status: decision.status, reason: decision.reason, checks: pixels.checks, heat: pixels.heat, ai,
      by: body.edge ? 'edge camera + cloud AI' : 'cameras+ai' });
    return json({ task: publicTask(t, p), verification: t.verification, roi: pixels.roi });
  } catch (err) {
    return json({ error: `Frames could not be read: ${err.message}` }, 400);
  }
}

// ---------- публичное демо: отдельная программа на посетителя ----------
// Демо не трогает программу города: своя createProgram(), свои задания, книга и QR.
// Деньги в демо только симулируются — запросов к PayPal нет.
const demos = new Map();
const DEMO_TTL = 30 * 60 * 1000;
const DEMO_MAX = 50;
const DEMO_RESIDENT = 'nadia';
function demoGet(id) {
  const d = demos.get(String(id || ''));
  if (!d || Date.now() - d.at > DEMO_TTL) { demos.delete(id); return null; }
  return d;
}
/** Доступна ли модель зрения сейчас; ответ не дольше ~1,5 с, без бесконечной загрузки. */
async function aiStatus(env, ctx) {
  if (ctx.vision) return { available: true, provider: ctx.vision.name || 'test vision' };
  if (env.AI) return { available: true, provider: `Workers AI · ${env.WORKERS_AI_VISION_MODEL || '@cf/meta/llama-3.2-11b-vision-instruct'}` };
  if (env.OLLAMA_URL && env.OLLAMA_VISION_MODEL) {
    const provider = `Ollama (local) · ${env.OLLAMA_VISION_MODEL}`;
    try {
      const res = await fetch(`${env.OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
      const names = ((await res.json()).models || []).map((m) => m.name);
      return names.includes(env.OLLAMA_VISION_MODEL) ? { available: true, provider } : { available: false, provider, reason: 'Model is not installed in Ollama' };
    } catch { return { available: false, provider, reason: 'Local Ollama is not reachable' }; }
  }
  return { available: false, provider: null, reason: 'No vision model is configured on this server' };
}

async function handle(request, env, ctx) {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;
  const body = method === 'POST' ? await request.json().catch(() => null) : null;
  if (method === 'POST' && body === null) return json({ error: 'bad json' }, 400);
  if (!program) program = createProgram();
  const p = program;
  const me = session(request);

  // ---------- сессия ----------
  if (path === '/api/session' && method === 'GET') {
    if (!me) return json({ user: null });
    if (me.role === 'admin') return json({ user: { role: 'admin', ...ADMIN } });
    const r = p.resById.get(me.userId);
    return json({ user: r ? { role: 'resident', id: r.id, name: r.fullName, photo: photo(r.id) } : null });
  }
  if (path === '/api/session' && method === 'POST') {
    if (body.role === 'admin') return json({ ok: true }, 200, { 'set-cookie': setSession({ role: 'admin' }) });
    if (!p.resById.has(body.userId)) return json({ error: 'Unknown resident' }, 404);
    return json({ ok: true }, 200, { 'set-cookie': setSession({ role: 'resident', userId: body.userId }) });
  }
  if (path === '/api/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'set-cookie': 'cp_session=; Path=/; Max-Age=0' });
  }

  // ---------- публичное ----------
  if (path === '/api/public/city') {
    return json({
      name: p.city.name, state: p.city.state, founded: p.city.founded, bbox: p.city.bbox, districts: p.city.districts,
      cameras: p.cams.map((c) => ({ id: c.id, lat: c.lat, lon: c.lon, district: c.district, streets: c.streets,
        status: c.status, view: c.view, mirror: c.mirror, installed: c.installed, spot: c.spot || null })),
      tasks: p.tasks.filter((t) => !['rejected'].includes(t.status)).map((t) => publicTask(t, p)),
      streets: p.city.streets,
    });
  }
  if (path === '/api/public/heroes') {
    return json(withDemoHistory(p.heroes()).map((h) => ({ ...h, photo: photo(h.id) })));
  }
  if (path === '/api/public/stats') {
    const done = p.state.batches.reduce((s, b) => s + b.items.filter((i) => i.status === 'SUCCESS').length, 0);
    return json({
      cameras: p.cams.length, online: p.cams.filter((c) => c.status === 'online').length,
      openTasks: p.tasks.filter((t) => t.status === 'open').length, deedsPaid: done,
      paidOut: p.balances().paid_out, residents: p.residents.length,
      demoData: { seeded: true, note: 'Includes seeded sample history (fictional demo data); not real PayPal payouts.',
        paidOutSample: p.state.batches.filter(p.isSample).reduce((s2, b) => s2 + b.items.filter((i) => i.status === 'SUCCESS').reduce((a, i) => a + Number(i.amount), 0), 0).toFixed(2) },
    });
  }
  if (path === '/api/public/residents') {
    return json(p.residents.map((r) => ({ id: r.id, name: r.fullName, district: r.district, photo: photo(r.id) })));
  }

  // ---------- PayPal Checkout: добавка к награде ----------
  // client-id публичный по определению (его видит JS SDK в браузере).
  if (path === '/api/public/paypal') {
    return json({ env: 'sandbox', clientId: env.PAYPAL_CLIENT_ID || null, boosts: p.BOOSTS });
  }
  if (path === '/api/boost/order' && method === 'POST') {
    const ok = p.boostable(body.taskId, String(body.amount));
    if (ok.error) return json(ok, ok.status);
    const client = ordersClient(env, ctx);
    if (!client) return json({ error: 'PayPal sandbox is not configured' }, 503);
    try {
      const o = await client.create({ taskId: ok.task.id, amount: String(body.amount), requestId: `boost-${ok.task.id}-${crypto.randomUUID()}`,
        description: `Boost: ${ok.task.title} (${ok.task.id})`.slice(0, 127) });
      p.state.pendingOrders.set(o.id, { taskId: ok.task.id, amount: String(body.amount) });
      return json({ id: o.id });
    } catch (err) { return json({ error: err.message }, 502); }
  }
  if (path === '/api/boost/capture' && method === 'POST') {
    const pend = p.state.pendingOrders.get(body.orderId);
    if (!pend) return json({ error: 'Unknown order' }, 404);
    const client = ordersClient(env, ctx);
    try {
      const c = await client.capture(body.orderId);
      // Засчитываем только то, что PayPal подтвердил: статус, задание и сумму.
      if (c.status !== 'COMPLETED' || c.taskId !== pend.taskId || Number(c.amount) !== Number(pend.amount)) {
        return json({ error: `Payment not completed (${c.status})` }, 402);
      }
      p.state.pendingOrders.delete(body.orderId);
      const res = p.boost(pend.taskId, { amount: pend.amount, by: c.payer, orderId: body.orderId, captureId: c.captureId, source: c.source });
      return json({ task: publicTask(res.task, p), captureId: c.captureId });
    } catch (err) { return json({ error: err.message }, 502); }
  }

  // ---------- публичное демо ----------
  if (path.startsWith('/api/demo/')) {
    if (path === '/api/demo/start' && method === 'POST') {
      for (const [k, d] of demos) if (Date.now() - d.at > DEMO_TTL) demos.delete(k);
      while (demos.size >= DEMO_MAX) demos.delete(demos.keys().next().value);
      const id = crypto.randomUUID();
      const dp = createProgram();
      const t = dp.tasks.find((x) => x.spot === 'sidewalk');
      // noModel: посетитель сам выбирает показать ветку «модель недоступна» — подписано как симуляция.
      const noModel = body.noModel === true;
      demos.set(id, { at: Date.now(), program: dp, taskId: t.id, receipt: null, noModel });
      const ai = noModel ? { available: false, provider: null, reason: 'Model switched off for this run (simulated outage)', simulatedOutage: true } : await aiStatus(env, ctx);
      return json({ id, simulated: true, task: publicTask(t, dp), resident: { name: 'Nadia C.', note: 'demo resident' }, ai });
    }
    const d = demoGet(method === 'POST' ? body.id : url.searchParams.get('id'));
    if (path === '/api/demo/evidence') {
      return json({ ai: await aiStatus(env, ctx), recordedModel: MODEL_EVIDENCE, recordedSandboxPayout: SANDBOX_EVIDENCE });
    }
    if (!d) return json({ error: 'Demo expired — start again' }, 404);
    const dp = d.program; const t = dp.taskById(d.taskId);
    if (path === '/api/demo/claim' && method === 'POST') {
      const res = dp.claim(DEMO_RESIDENT, t.id);
      return res.error ? json(res, res.status) : json({ task: publicTask(t, dp), tokenTail: dp.token(t.id).slice(-4) });
    }
    if (path === '/api/demo/frame') {
      // before — как есть; qr — житель показывает код; after — работа сделана (или нет: cheat=1).
      const shot = url.searchParams.get('shot');
      const cam = dp.cams.find((c) => c.spot === t.spot);
      const svg = renderFrame(t.spot, {
        label: `${cam.id}  ${cam.streets[0]} & ${cam.streets[1]}`.toUpperCase(),
        done: shot === 'after' && url.searchParams.get('cheat') !== '1',
        qrToken: shot === 'qr' && t.status === 'claimed' ? dp.token(t.id) : null,
        seed: { before: 11, qr: 12, after: 13 }[shot] || 7, when: Date.now(),
      });
      return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } });
    }
    if (path === '/api/demo/verify' && method === 'POST') {
      if (t.status !== 'claimed') return json({ error: 'Claim the task first' }, 409);
      if (!body.edge) return json({ error: 'Camera observation required' }, 400);
      return verifyTask(dp, t, { edge: body.edge }, env, d.noModel ? { ...ctx, noVision: true } : ctx);
    }
    if (path === '/api/demo/payout' && method === 'POST') {
      if (t.status !== 'approved') return json({ error: t.status === 'in_review' ? 'Waiting for a human reviewer — no payout yet' : 'Only approved deeds are paid' }, 409);
      d.receipt = d.receipt || { simulated: true, id: `SIM-${crypto.randomUUID().slice(0, 8).toUpperCase()}`, at: Date.now(), amount: t.reward, currency: 'USD',
        status: 'SIMULATED — not sent', wallet: 'PayPal (demo resident)', via: 'PayPal Payouts (simulated in this demo; no API call)' };
      return json({ receipt: d.receipt, task: publicTask(t, dp) });
    }
    return json({ error: 'not found' }, 404);
  }

  // ---------- кадры камер ----------
  if (path === '/api/frame') {
    const spot = url.searchParams.get('spot');
    if (!SPOTS[spot]) return json({ error: 'unknown spot' }, 404);
    const task = p.tasks.find((t) => t.spot === spot);
    const qrTask = url.searchParams.get('qr') && task && task.id === url.searchParams.get('qr') ? task : null;
    const cam = p.cams.find((c) => c.spot === spot);
    const svg = renderFrame(spot, {
      label: cam ? `${cam.id}  ${cam.streets[0]} & ${cam.streets[1]}`.toUpperCase() : null,
      done: Boolean(task && p.state.world && p.state.world[spot]),
      qrToken: qrTask ? p.token(qrTask.id) : null,
      light: Math.min(1.2, Math.max(0.6, Number(url.searchParams.get('light')) || 1)),
      seed: Number(url.searchParams.get('seed')) || 7,
      when: Number(url.searchParams.get('when')) || Date.now(),
    });
    return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } });
  }
  // ---------- кадры доказательства: только владелец задания или админ ----------
  if (path === '/api/me/evidence' && method === 'GET') {
    const t = p.taskById(url.searchParams.get('task'));
    const shot = url.searchParams.get('shot');
    if (!me || !(me.role === 'admin' || (me.role === 'resident' && t && t.claimedBy === me.userId))) return json({ error: 'Not available' }, 404);
    const e = t && taskEvidence(p, t) && EVIDENCE.get(p).get(t.id);
    if (!e || !['before', 'after'].includes(shot)) return json({ error: 'Not available' }, 404);
    return new Response(e[shot], { headers: { 'content-type': 'image/png', 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff' } });
  }
  // ---------- кабинет жителя ----------
  if (path.startsWith('/api/me')) {
    if (!me || me.role !== 'resident') return json({ error: 'Sign in as a resident' }, 401);
    const r = p.resById.get(me.userId);
    if (path === '/api/me' && method === 'GET') {
      const myTasks = p.tasks.filter((t) => t.claimedBy === r.id).map((t) => ({ ...publicTask(t, p), verification: t.verification, evidence: taskEvidence(p, t) }));
      const myPayouts = p.state.batches.flatMap((b) => b.items.filter((i) => i.residentId === r.id)
        .map((i) => ({ ...i, batchId: b.id, payoutBatchId: b.payoutBatchId, date: b.createdAt,
          source: p.isSample(b) ? 'seeded_sample' : 'sandbox_record',
          evidence: p.isSample(b) ? 'unavailable — seeded sample history (fictional)' : `PayPal sandbox batch ${b.payoutBatchId}` })))
        .sort((a, b) => b.date - a.date);
      return json({
        profile: { id: r.id, name: r.fullName, paypal: r.paypal, paypalMasked: mask(r.paypal), district: r.district, joined: r.joined,
          w9: r.w9, photo: photo(r.id), wallet: { type: r.wallet.type, masked: maskWallet(r.wallet) } },
        earnings: p.earnings(r.id), tasks: myTasks, payouts: myPayouts,
        proposals: p.state.proposals.filter((x) => x.residentId === r.id),
        settings: { w9ThresholdYear: p.state.settings.w9ThresholdYear, unclaimedDays: p.state.settings.unclaimedDays },
      });
    }
    if (path === '/api/me/qr') {
      // Одноразовый QR жителя для показа камере; виден только владельцу задания.
      const t = p.taskById(url.searchParams.get('task'));
      if (!t || t.claimedBy !== r.id || t.status !== 'claimed' || !p.token(t.id)) return json({ error: 'No active QR for this task' }, 404);
      return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">${qrSvg(p.token(t.id), 0, 0, 240)}</svg>`,
        { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'no-store' } });
    }
    if (path === '/api/me/claim' && method === 'POST') {
      const res = p.claim(r.id, body.taskId);
      return res.error ? json(res, res.status) : json({ task: publicTask(res.task, p), tokenTail: p.token(res.task.id).slice(-4) });
    }
    if (path === '/api/me/submit' && method === 'POST') {
      const res = p.submitForReview(r.id, body.taskId, body.note);
      return res.error ? json(res, res.status) : json({ task: publicTask(res.task, p) });
    }
    if (path === '/api/me/proposals' && method === 'POST') {
      const res = p.propose(r.id, body);
      return res.error ? json(res, res.status) : json(res);
    }
    if (path === '/api/me/profile' && method === 'POST') {
      if (body.paypal && /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(body.paypal)) r.paypal = body.paypal;
      if (body.w9 === 'on_file') r.w9 = 'on_file';
      if (body.wallet === 'paypal') r.wallet = { type: 'paypal', receiver: r.paypal };
      if (body.wallet === 'venmo') {
        const digits = String(body.phone || '').replace(/\D/g, '').replace(/^1(?=\d{10}$)/, '');
        if (digits.length !== 10) return json({ error: 'Venmo needs a 10-digit US mobile number' }, 400);
        r.wallet = { type: 'venmo', receiver: `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}` };
      }
      p.log(r.fullName, 'updated payout profile', mask(r.paypal));
      return json({ ok: true, paypalMasked: mask(r.paypal), w9: r.w9, wallet: { type: r.wallet.type, masked: maskWallet(r.wallet) } });
    }
  }

  // ---------- проверка камерами (задания с парой кадров) ----------
  if (path === '/api/verify' && method === 'POST') {
    const t = p.taskById(body.taskId);
    if (!me) return json({ error: 'Sign in first' }, 401);
    if (!t || !t.verifiable || t.status !== 'claimed') return json({ error: 'Task is not awaiting camera verification' }, 409);
    if (me.role === 'resident' && t.claimedBy !== me.userId) return json({ error: 'Not your task' }, 403);
    return verifyTask(p, t, body, env, ctx, { keepEvidence: true });
  }
  // Демо: «реальность» — житель сделал работу на месте с камерой.
  if (path === '/api/world' && method === 'POST') {
    if (!SPOTS[body.spot]) return json({ error: 'unknown spot' }, 404);
    p.state.world = p.state.world || {};
    p.state.world[body.spot] = Boolean(body.done);
    return json({ ok: true });
  }

  // ---------- админка ----------
  if (path.startsWith('/api/admin')) {
    if (!me || me.role !== 'admin') return json({ error: 'Admin sign-in required' }, 401);
    if (path === '/api/admin/overview') {
      const bal = p.balances();
      return json({
        admin: ADMIN, balances: bal, monthSpend: p.monthSpend().toFixed(2), budget: p.state.settings.monthlyBudget,
        counts: {
          cameras: p.cams.length, online: p.cams.filter((c) => c.status === 'online').length,
          offline: p.cams.filter((c) => c.status !== 'online').length,
          open: p.tasks.filter((t) => t.status === 'open').length, claimed: p.tasks.filter((t) => t.status === 'claimed').length,
          review: p.tasks.filter((t) => t.status === 'in_review').length, approved: p.tasks.filter((t) => t.status === 'approved').length,
          proposals: p.state.proposals.filter((x) => x.status === 'pending').length,
        },
        audit: p.state.audit.slice(0, 12),
      });
    }
    if (path === '/api/admin/proposals') return json(p.state.proposals.map((x) => ({ ...x, resident: p.resById.get(x.residentId)?.fullName, camera: p.camById.get(x.cameraId) })));
    if (path === '/api/admin/moderate' && method === 'POST') {
      const res = p.moderate(ADMIN.name, body.proposalId, body);
      return res.error ? json(res, res.status) : json(res);
    }
    if (path === '/api/admin/tasks') return json(p.tasks.map((t) => ({ ...publicTask(t, p), verification: t.verification })));
    if (path === '/api/admin/review' && method === 'POST') {
      const res = p.review(ADMIN.name, body.taskId, body.approve === true, body.note);
      return res.error ? json(res, res.status) : json({ task: publicTask(res.task, p) });
    }
    if (path === '/api/admin/claim' && method === 'POST') {
      // Live Ops: сотрудник может провести задание за жителя (демо на месте).
      const res = p.claim(body.residentId, body.taskId);
      return res.error ? json(res, res.status) : json({ task: publicTask(res.task, p), tokenTail: p.token(res.task.id).slice(-4) });
    }
    if (path === '/api/admin/payouts' && method === 'GET') {
      const prepared = p.prepareBatch();
      const preview = payoutBody(`PB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(p.state.batches.length + 1).padStart(3, '0')}`, productionItems(prepared.ready));
      return json({ prepared, preview, batches: [...p.state.batches].reverse(), receiverNote: env.PAYPAL_BUYER_EMAIL || null });
    }
    if (path === '/api/admin/payouts' && method === 'POST') {
      const { ready } = p.prepareBatch();
      if (!ready.length) return json({ error: 'Nothing is ready to pay' }, 409);
      const client = payoutsClient(env, ctx);
      if (!client) return json({ error: 'PayPal sandbox is not configured' }, 503);
      const batchId = `PB-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(p.state.batches.length + 1).padStart(3, '0')}`;
      try {
        // В sandbox все выплаты идут тестовому получателю; в рабочем режиме — на PayPal жителя.
        const sent = await client.send(batchId, sandboxItems(env, ready));
        return json({ batch: p.recordBatch(ADMIN.name, batchId, sent, ready) });
      } catch (err) {
        p.log(ADMIN.name, 'payout batch failed', err.message);
        return json({ error: err.message }, 502);
      }
    }
    const refresh = path.match(/^\/api\/admin\/payouts\/([\w-]+)\/refresh$/);
    if (refresh && method === 'POST') {
      const b = p.state.batches.find((x) => x.id === refresh[1]);
      const client = payoutsClient(env, ctx);
      if (!b || !client || b.payoutBatchId.startsWith('HIST')) return json({ error: 'Batch cannot be refreshed' }, 409);
      const s = await client.status(b.payoutBatchId);
      return json({ batch: p.applyBatchStatus(b.id, s.status, s.items.map((i) => ({ taskId: i.claimId, status: i.status }))) });
    }
    if (path === '/api/admin/payout-exceptions') return json(p.payoutExceptions());
    if (path === '/api/admin/ledger') return json({ balances: p.balances(), entries: [...p.state.ledger].reverse().slice(0, 300) });
    if (path === '/api/admin/audit') return json(p.state.audit);
    if (path === '/api/admin/webhooks') return json(p.state.webhooks);
    if (path === '/api/admin/residents') return json(p.residents.map((r) => ({ ...r, ...p.earnings(r.id), photo: photo(r.id) })));
    if (path === '/api/admin/cameras') return json(p.cams);
    if (path === '/api/admin/settings') return json(p.settings(ADMIN.name, method === 'POST' ? body : null));
    // ---------- Treasury Copilot (PayPal Agent Toolkit) ----------
    if (path === '/api/admin/copilot' && method === 'GET') {
      const m = agentModel(env);
      return json({ model: m ? m.name : null, sandbox: true, paypal: Boolean(env.PAYPAL_CLIENT_ID), actions: p.state.aiActions });
    }
    if (path === '/api/admin/copilot' && method === 'POST') {
      const messages = (Array.isArray(body.messages) ? body.messages : []).slice(-12)
        .filter((x) => ['user', 'assistant'].includes(x.role) && typeof x.content === 'string')
        .map((x) => ({ role: x.role, content: x.content.slice(0, 2000) }));
      if (!messages.length || messages.at(-1).role !== 'user') return json({ error: 'Ask a question' }, 400);
      const created = [];
      const propose = (name, label, args) => {
        const a = { id: `AP-${p.state.aiActions.length + 1}`, name, label, args, status: 'pending', at: Date.now() };
        p.state.aiActions.unshift(a); created.push(a);
        p.log('Treasury Copilot', 'proposed action', `${a.id} · ${label}`);
        return a.id;
      };
      try {
        // readOnly: только чтение записей программы — без PayPal, без предложений возврата/счёта.
        const readOnly = body.readOnly === true;
        const r = await runCopilot({ env, program: p, messages, propose: readOnly ? null : propose, readOnly, ...(ctx.copilot || {}) });
        return json({ ...r, readOnly, proposals: readOnly ? [] : created });
      } catch (err) { return json({ error: `Copilot failed: ${err.message}` }, 502); }
    }
    if (path === '/api/admin/copilot/decide' && method === 'POST') {
      const a = p.state.aiActions.find((x) => x.id === body.id);
      if (!a || a.status !== 'pending') return json({ error: 'Nothing to decide' }, 409);
      if (!body.approve) { a.status = 'rejected'; p.log(ADMIN.name, 'rejected AI proposal', a.id); return json({ action: a }); }
      try {
        const result = await executeProposal({ env, name: a.name, args: a.args, ...(ctx.copilot || {}) });
        a.status = 'done'; a.result = result; a.decidedBy = ADMIN.name;
        p.log(ADMIN.name, 'approved AI proposal', `${a.id} · ${a.label}`);
        const r = typeof result === 'string' ? JSON.parse(result) : result;
        if (r && r.error) { a.status = 'failed'; return json({ action: a }, 502); }
        if (a.name === 'create_refund') p.refundBoost(a.args.capture_id, r.id);
        // Черновик счёта создан — отправка отдельным шагом, с настоящим ID от PayPal.
        const invoiceId = a.name === 'create_invoice' && (r.id || String(r.href || '').split('/').pop());
        if (invoiceId) {
          const s2 = { id: `AP-${p.state.aiActions.length + 1}`, name: 'send_invoice', label: `Send invoice ${invoiceId} · ${a.label.split('·')[1] || ''}`.trim(),
            args: { invoice_id: invoiceId, send_to_recipient: true, note: 'Thank you for sponsoring StreetCred in Port Calloway.' }, status: 'pending', at: Date.now() };
          p.state.aiActions.unshift(s2);
        }
        return json({ action: a });
      } catch (err) { a.status = 'failed'; a.result = { error: err.message }; return json({ action: a }, 502); }
    }
    if (path === '/api/admin/reset' && method === 'POST') { program = createProgram(); return json({ ok: true }); }
  }

  // ---------- webhooks PayPal ----------
  // Без проверки подписи (нужен PAYPAL_WEBHOOK_ID и verify-webhook-signature)
  // событие записывается в журнал, но статусы выплат по нему не меняются:
  // статусы берутся только из опроса PayPal.
  if (path === '/api/webhooks/paypal' && method === 'POST') {
    p.state.webhooks.unshift({ at: Date.now(), event: body.event_type || 'unknown', resource: body.resource?.payout_item_id || body.resource?.batch_header?.payout_batch_id || null,
      verified: false, note: env.PAYPAL_WEBHOOK_ID ? 'signature verification pending' : 'PAYPAL_WEBHOOK_ID not configured — logged only' });
    return json({ received: true });
  }

  return null;
}

/**
 * Один экземпляр города на всех: на Cloudflare запросы обслуживают разные
 * копии Worker, и состояние в памяти расходилось бы. Durable Object (вариант
 * на SQLite есть и на бесплатном тарифе) получает все запросы /api/*.
 * Состояние живёт в памяти объекта: после простоя город сбрасывается к демо-данным.
 */
export class City {
  constructor(state, env) { this.env = env; }
  async fetch(request) {
    return (await handle(request, this.env, {})) || json({ error: 'not found' }, 404);
  }
}

export default {
  async fetch(request, env = {}, ctx = {}) {
    if (env.CITY && new URL(request.url).pathname.startsWith('/api/')) {
      return env.CITY.get(env.CITY.idFromName('port-calloway')).fetch(request);
    }
    const res = await handle(request, env, ctx);
    if (res) return res;
    // Статика сайта (public/) — через привязку ASSETS.
    if (env.ASSETS) return env.ASSETS.fetch(request);
    return json({ error: 'not found' }, 404);
  },
  reset() { program = createProgram(); },
  program() { if (!program) program = createProgram(); return program; }, // для тестов
};
