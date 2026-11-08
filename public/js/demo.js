// Пошаговое демо StreetCred: грязный кадр → Claim → QR → работа → проверка камерой и моделью → доказательство → статус выплаты.
// Работает на изолированной копии программы (/api/demo/*). Деньги только симулируются, PayPal не вызывается.
import { $, $$, h, money, api, chrome, DEMO_TAG } from './common.js';

await chrome('demo');
const W = 1280; const H = 720;
let S = null; // { id, task, resident, ai }
let obs = null; let verdict = null; let cheat = false;
const frameUrl = (shot) => `/api/demo/frame?id=${S.id}&shot=${shot}${shot === 'after' && cheat ? '&cheat=1' : ''}&t=${Date.now()}`;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const STEPS = ['spot', 'claim', 'qr', 'work', 'check', 'result', 'payout'];
const STEP_NAMES = { spot: 'Dirty spot', claim: 'Claim', qr: 'QR check-in', work: 'The work', check: 'Camera + AI check', result: 'Proof', payout: 'Payout status' };

function step(name) {
  const i = STEPS.indexOf(name);
  $$('#stepper li').forEach((li, k) => { li.classList.toggle('done', k < i); li.classList.toggle('on', k === i); li.setAttribute('aria-current', k === i ? 'step' : 'false'); });
  $('#steptext').textContent = `Step ${i + 1} of 7 · ${STEP_NAMES[name]}`;
}
function roiBox(roi, label = 'Problem area') {
  return `<div class="roi" style="left:${(roi.x / W) * 100}%;top:${(roi.y / H) * 100}%;width:${(roi.w / W) * 100}%;height:${(roi.h / H) * 100}%"><span>${h(label)}</span></div>`;
}
function frame(src, { roi = true, tag = DEMO_TAG, extra = '', alt } = {}) {
  return `<figure class="frame" style="aspect-ratio:${W}/${H}"><img src="${src}" alt="${h(alt || `Demo camera frame of ${S.task.address}`)}">${roi ? roiBox(S.task.roi) : ''}${extra}${tag}</figure>`;
}
// Шаг: кадр слева (на мобильном сверху), панель с коротким текстом и главным действием.
// Панель действий (.actbar) на мобильном прилипает к низу экрана, но только в пределах шага — футер не перекрывается.
function card({ media, cap = '', eyebrow, title, body = '', actions = '', after = '' }) {
  return `<div class="dstep"><div class="media">${media}${cap ? `<p class="cap">${cap}</p>` : ''}</div>
<div class="panel"><div class="eyebrow">${eyebrow}</div><h2>${title}</h2>${body}${actions ? `<div class="actbar">${actions}</div>` : ''}${after}</div></div>`;
}
function toStageTop() { $('#stage').scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' }); }
function stage(html) { $('#stage').innerHTML = html; $('#stage').querySelector('.actbar button, .actbar a, button, a')?.focus({ preventScroll: true }); }
// Любое действие: кнопки шага блокируются до ответа (без повторных запросов), ошибка — понятным текстом.
const errText = (err) => (err && err.message) || (err && err.type ? `${err.type} event` : String(err || 'Unknown error'));
function fail(err, where) {
  stage(`<div class="panel solo"><div class="eyebrow">Demo stopped</div><h2>Something went wrong${where ? ` while ${h(where)}` : ''}</h2>
<p class="bad">${h(errText(err))}</p><p class="small muted">Nothing was paid. Start again to get a fresh isolated demo.</p>
<div class="actbar"><button class="btn lg accent" data-retry>Start again</button></div></div>`);
  $('[data-retry]').onclick = act(start, 'starting');
}
function act(fn, where) {
  return async (ev) => {
    $$('#stage button').forEach((b) => { b.disabled = true; });
    try { await fn(ev); } catch (err) { fail(err, where); }
  };
}

// Кадр с «камеры»: SVG с сервера → canvas → PNG (как в шлюзе камеры).
async function capture(shot) {
  const res = await fetch(frameUrl(shot));
  if (!res.ok) throw new Error(`The ${shot} camera frame could not be loaded (HTTP ${res.status})`);
  const svg = await res.text();
  const img = new Image();
  await new Promise((ok, no) => { img.onload = ok; img.onerror = () => no(new Error(`The ${shot} camera frame could not be decoded`)); img.src = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })); });
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  c.getContext('2d').drawImage(img, 0, 0, W, H);
  const blob = await new Promise((ok) => c.toBlob(ok, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s); };
const blobUrl = (u8) => URL.createObjectURL(new Blob([u8], { type: 'image/png' }));

// Состояние модели: коротко в «About this demo», подробности (провайдер, причина) — внутри раскрытия.
function aiState(ai) {
  $('#aichip').className = `aichip ${ai.available ? 'on' : 'off'}`;
  $('#aichip').textContent = ai.available ? 'AI check: online' : `AI check: unavailable${ai.simulatedOutage ? ' (simulated)' : ''}`;
  $('#aistate').innerHTML = ai.available
    ? `<b>AI check online.</b> ${h(ai.provider)} · runs on this machine.`
    : `<b>AI model unavailable${ai.simulatedOutage ? ' (simulated)' : ''}.</b> ${h(ai.reason || '')}. The check goes to a human reviewer; recorded model evidence is shown instead.`;
  $('#outagelink').innerHTML = outage ? 'This run simulates a model outage. <a href="/demo.html">Run with the model</a>' : '<a href="/demo.html?model=off">Show what happens when the AI model is unavailable</a>';
}

// Контракт с картой (sessionStorage, та же вкладка): иллюстрация результата текущего изолированного демо.
// Пишется только после фактического approved; сбрасывается при новом запуске, rejected и human review.
// Реальное состояние задания и ledger не меняются. Карта показывает маркер «Completed in your demo · Simulated».
const DEMO_COMPLETION_KEY = 'streetcred.demoCompleted';
function setDemoCompletion(v) {
  try {
    if (v) sessionStorage.setItem(DEMO_COMPLETION_KEY, JSON.stringify(v));
    else sessionStorage.removeItem(DEMO_COMPLETION_KEY);
  } catch { /* хранилище недоступно — маркер просто не появится */ }
}

// ---------- шаги ----------
const outage = new URLSearchParams(location.search).get('model') === 'off';
async function start() {
  step('spot'); cheat = false; obs = null; verdict = null; setDemoCompletion(null);
  stage('<p class="muted loading">Starting an isolated demo…</p>');
  S = await api('/api/demo/start', { noModel: outage });
  aiState(S.ai);
  const t = S.task;
  $('#aboutcam').textContent = `Camera in this demo: ${t.cameraId} · ${t.address} (fictional street names).`;
  stage(card({
    media: frame(frameUrl('before')), cap: `Camera ${h(t.cameraId)} · ${h(t.address)}`,
    eyebrow: 'A spot that needs care', title: h(t.title),
    body: `<p class="short">The outlined area is what the camera checks.</p>
<div class="reward"><span class="bigmoney">${money(t.reward)}</span><span class="small muted">reward · simulated</span></div>`,
    actions: '<button class="btn lg accent" data-next>Claim this spot</button>',
    after: `<p class="small muted who">Demo resident: ${h(S.resident.name)} (fixture account, no sign-in needed)${outage ? ' · simulated model outage' : ''}</p>`,
  }));
  $('[data-next]').onclick = act(claim, 'claiming');
}

async function claim() {
  step('claim');
  const r = await api('/api/demo/claim', { id: S.id });
  stage(card({
    media: frame(frameUrl('before')), cap: 'The spot is reserved for 48 hours.',
    eyebrow: 'Claimed', title: 'A one-time QR code was issued',
    body: `<p class="short">It ends in <code>${h(r.tokenTail)}</code>. Show it to camera ${h(S.task.cameraId)} on arrival — the code, not the face, links the deed to you. It works once.</p>`,
    actions: '<button class="btn lg accent" data-next>Show the QR code to the camera</button>',
  }));
  $('[data-next]').onclick = act(qr, 'checking in');
}

async function qr() {
  step('qr');
  stage(card({
    media: frame(frameUrl('qr'), { roi: false, alt: 'Demo camera frame with the one-time QR code held up' }), cap: 'The camera reads the code in this frame.',
    eyebrow: 'Checked in', title: 'Checked in at the camera',
    body: '<p class="short">Now the work. The second option shows what the check does when nothing was cleaned.</p>',
    actions: '<button class="btn lg accent" data-clean>Clean the spot</button><button class="btn lg" data-cheat>Try to cheat: skip the work</button>',
  }));
  $('[data-clean]').onclick = act(() => work(false), 'recording the work');
  $('[data-cheat]').onclick = act(() => work(true), 'recording the work');
}

async function work(skip) {
  cheat = skip;
  step('work');
  stage(card({
    media: frame(frameUrl('after'), { alt: skip ? 'After frame: nothing was cleaned' : 'After frame: the bags are gone' }),
    cap: skip ? 'Nothing was cleaned — the after frame looks like the before frame.' : 'The after frame: the bags are gone (demo frame edited for the demo).',
    eyebrow: 'The work', title: skip ? 'The resident walked away' : 'Done — ask for the check',
    body: '<p class="short">The camera compares before and after, then a vision model looks at the outlined area.</p>',
    actions: '<button class="btn lg accent" data-next>I’m done — check it</button>',
  }));
  $('[data-next]').onclick = act(check, 'checking');
}

async function check() {
  step('check');
  const items = [['qr', 'Camera reads the one-time QR code'], ['scene', 'Before and after come from the same view'], ['change', 'The outlined area changed, the rest did not'], ['ai', S.ai.available ? 'Vision model: is the area clean?' : 'Vision model unavailable → human review']];
  stage(card({
    media: frame(frameUrl('after'), { extra: '<div class="scan" aria-hidden="true"></div>' }),
    eyebrow: 'Checking', title: 'Camera and AI check',
    body: `<ul class="checks" id="checks">${items.map(([id, l]) => `<li data-c="${id}"><i aria-hidden="true"></i><span>${h(l)}</span><b></b></li>`).join('')}</ul>
<p class="muted small" id="checkmsg" role="status">Edge camera: reading frames…</p>`,
  }));
  const mark = (id, state, val = '') => { const li = $(`#checks [data-c="${id}"]`); li.className = state; li.querySelector('b').textContent = val; };
  try {
    const { observe } = await import('./edge-camera.js');
    const frames = { before: await capture('before'), qr: await capture('qr'), after: await capture('after') };
    obs = observe({ frames, roi: S.task.roi, crops: true });
    obs.full = { before: blobUrl(frames.before), after: blobUrl(frames.after) };
    ['qr', 'scene', 'change'].forEach((id) => mark(id, 'busy'));
    $('#checkmsg').textContent = S.ai.available ? 'Server: QR code, thresholds and the AI question… (local model, a few seconds)' : 'Server: QR code and thresholds…';
    mark('ai', S.ai.available ? 'busy' : 'skip');
    const r = await api('/api/demo/verify', { id: S.id, edge: { qr: obs.qr, sim: obs.sim, inside: obs.inside, outside: obs.outside, heat: obs.heat, crops: { before: b64(obs.crops.before), after: b64(obs.crops.after) } } });
    verdict = r.verification;
    for (const c of verdict.checks) mark(c.id, c.ok ? 'ok' : 'bad', c.id === 'scene' ? `similarity ${c.value}` : c.id === 'change' ? `${c.value} vs ${c.background}` : c.ok ? 'matched' : '');
    const ai = verdict.ai || {};
    if (ai.before && ai.after) mark('ai', !ai.before.answer && ai.after.answer ? 'ok' : 'bad', `before ${ai.before.answer ? 'clean' : 'not clean'} · after ${ai.after.answer ? 'clean' : 'not clean'}`);
    else mark('ai', 'skip', ai.error && /not asked/.test(ai.error) ? 'not asked: pixel checks failed' : 'unavailable');
    $('#checkmsg').textContent = '';
    setTimeout(() => result().catch((err) => fail(err, 'showing the proof')), 900);
  } catch (err) {
    fail(err, 'checking');
  }
}

// ---------- доказательство ----------
// Сравнение «до/после» зоны задания: ползунок (клавиатура: стрелки), короткий проход при появлении — только без reduced motion.
function compare(beforeUrl, afterUrl) {
  return `<div class="compare" id="compare" style="--pos:50%">
<img class="cb" src="${beforeUrl}" alt="Before: cropped work zone"><img class="ca" src="${afterUrl}" alt="After: cropped work zone">
<span class="lbl lb">Before</span><span class="lbl la">After</span><span class="handle" aria-hidden="true"></span>
<input type="range" min="0" max="100" value="50" aria-label="Compare before and after: move left to see more of the after frame" id="cmprange"></div>`;
}
function wireCompare() {
  const box = $('#compare'); const range = $('#cmprange'); if (!box || !range) return;
  const set = (v) => { box.style.setProperty('--pos', `${v}%`); range.value = v; };
  // Вступительный проход отменяется при первом касании, клике или клавише — дальше управляет пользователь.
  let raf = 0;
  const stop = () => { if (raf) { cancelAnimationFrame(raf); raf = 0; } };
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => range.addEventListener(ev, stop, { passive: true }));
  range.oninput = () => { stop(); set(range.value); };
  if (reduceMotion()) return;
  const t0 = performance.now(); const from = 92; const to = 50; const dur = 900;
  const tick = (t) => { const k = Math.min(1, (t - t0) / dur); const e = 1 - (1 - k) ** 3; set(Math.round(from + (to - from) * e)); raf = k < 1 ? requestAnimationFrame(tick) : 0; };
  set(from); raf = requestAnimationFrame(tick);
}

async function result() {
  step('result');
  const v = verdict; const ai = v.ai || {};
  const ok = v.status === 'approved';
  const rejected = v.status === 'rejected';
  setDemoCompletion(ok ? { v: 1, taskId: S.task.id, demoId: S.id, status: 'approved', simulated: true, reward: S.task.reward, at: Date.now(),
    label: 'Completed in your demo · Simulated' } : null);
  const heat = v.heat ? `<div class="heat" style="grid-template-columns:repeat(${v.heat.cols},1fr);left:${(S.task.roi.x / W) * 100}%;top:${(S.task.roi.y / H) * 100}%;width:${(S.task.roi.w / W) * 100}%;height:${(S.task.roi.h / H) * 100}%">${v.heat.cells.map((x) => `<i style="background:${x > 0.08 ? `rgba(57,217,138,${Math.min(0.55, x)})` : 'transparent'}"></i>`).join('')}</div>` : '';
  const evid = S.ai.available ? '' : await recordedModel();
  // Заголовок и награда — только по фактическому статусу проверки.
  const head = ok ? { stamp: 'Approved', title: 'Proof confirmed', line: 'The camera checks and the vision model agree: the area is clean.' }
    : rejected ? { stamp: 'Rejected', title: 'Not verified', line: 'The checks did not confirm the work. No reward.' }
      : { stamp: 'Human review', title: 'Sent to a human reviewer', line: 'The automatic check could not decide. No reward until a person reviews it.' };
  const reward = ok
    ? `<div class="rewardline"><div><div class="eyebrow">Reward approved</div><div class="bigmoney">${money(S.task.reward)}</div></div>
<div class="paystate"><span class="pill sim">Payout pending</span><span class="small muted">Simulated in this demo · not sent</span></div></div>`
    : `<div class="rewardline none"><div><div class="eyebrow">Reward</div><div class="noreward">${rejected ? 'No reward' : 'No reward yet'}</div></div>
<div class="paystate"><span class="small muted">${rejected ? 'A rejected deed is never paid.' : 'Waiting for a human decision.'}</span></div></div>`;
  stage(`<div class="proof ${v.status}">
<div class="proofhead"><div class="stamp">${head.stamp}</div><div class="eyebrow">Proof</div><h2>${head.title}</h2><p class="reason">${h(head.line)}${v.reason ? ` <span class="muted">${h(v.reason)}</span>` : ''}</p></div>
${compare(blobUrl(obs.crops.before), blobUrl(obs.crops.after))}
<p class="cap">Work zone only, cropped from the same camera. Drag the slider or use the arrow keys.</p>
${reward}
<div class="actbar"><button class="btn lg accent" data-next>See the payout status</button><button class="btn lg" data-again>Run again</button></div>
<section class="howchecked" aria-labelledby="hc"><h3 id="hc">How it was checked</h3>
<div class="dstep tight"><div class="media">${frame(obs.full.after, { extra: heat, alt: 'Full after frame with the checked area outlined' })}<p class="cap">Full after frame: the outline is the checked area, green cells changed most.</p></div>
<div><table class="t facts"><tbody>${v.checks.map((c) => `<tr><td>${c.ok ? '✓' : '✗'}</td><td><b>${h({ qr: 'One-time QR code', scene: 'Same camera view', change: 'Change in the work zone' }[c.id] || c.id)}</b><div class="muted small">${h(c.detail)}${c.value !== undefined ? ` · value ${c.value}${c.background !== undefined ? `, background ${c.background}` : ''}` : ''}</div></td></tr>`).join('')}
<tr><td>${ai.before && ai.after ? (!ai.before.answer && ai.after.answer ? '✓' : '✗') : '–'}</td><td><b>Vision model</b><div class="muted small">${ai.before && ai.after
    ? `${h(ai.model || S.ai.provider)} · before: ${ai.before.answer ? 'clean' : 'not clean'} (${Math.round(ai.before.confidence * 100)}%), after: ${ai.after.answer ? 'clean' : 'not clean'} (${Math.round(ai.after.confidence * 100)}%)`
    : h(ai.error || 'not asked')}</div></td></tr></tbody></table>
<p class="muted small">Thresholds: same view ≥ 0.85; the zone must change ≥ 6 and at least 2.5× more than the rest of the frame; the model must say “not clean” before and “clean” after with ≥ 60% confidence.</p></div></div>
${evid}</section></div>`);
  wireCompare();
  toStageTop();
  $('[data-next]').onclick = act(payout, 'loading the payout status');
  $('[data-again]').onclick = act(start, 'starting');
}

let EVID = null;
async function evidence() { EVID = EVID || await api(`/api/demo/evidence?id=${S.id}`); return EVID; }
async function recordedModel() {
  const e = (await evidence()).recordedModel;
  const rows = e.runs.filter((r) => r.spot === 'sidewalk');
  return `<details class="recorded" open><summary>Recorded model evidence (not live) — ${h(e.model)}, ${h(e.provider)}, ${new Date(e.recordedAt).toLocaleString('en-US')}</summary>
<p class="small">No vision model was available for this run, so it went to a human reviewer. Here is what the model answered for this same spot when it was run on this machine: ${e.correct}/${e.total} correct across the project’s 8 frames (4 curated before/after pairs — not field accuracy).</p>
<div class="tablewrap"><table class="t"><thead><tr><th>Frame</th><th>Expected</th><th>Model answer</th><th>Time</th></tr></thead><tbody>${rows.map((r) => `<tr><td>${h(r.frame)}</td><td>${r.expectedClean ? 'clean' : 'not clean'}</td><td><code>${h(r.raw)}</code></td><td>${(r.ms / 1000).toFixed(1)} s</td></tr>`).join('')}</tbody></table></div></details>`;
}

// ---------- выплата: честный статус ----------
async function payout() {
  step('payout');
  const sb = (await evidence()).recordedSandboxPayout.payoutBatch;
  let html; let paid = false;
  try {
    const r = await api('/api/demo/payout', { id: S.id });
    const rc = r.receipt; paid = true;
    html = `<div class="receipt-card"><div class="simbadge">Simulated — no money moved</div><div class="eyebrow">Payout status</div>
<h2>${money(rc.amount)} would go to ${h(S.resident.name)}</h2>
<dl><dt>Receipt</dt><dd><code>${h(rc.id)}</code></dd><dt>Status</dt><dd><b>${h(rc.status)}</b></dd><dt>Route</dt><dd>${h(rc.via)}</dd><dt>When</dt><dd>${new Date(rc.at).toLocaleString('en-US')}</dd></dl>
<p class="small">In the city program, approved deeds join the next daily PayPal Payouts batch (5 pm PT) and the status comes from PayPal. This public demo never calls PayPal.</p></div>`;
  } catch (err) {
    html = `<div class="receipt-card none"><div class="eyebrow">Payout status</div><h2>No payout</h2><p>${h(err.message)}.</p>
<p class="small">Money moves only for approved deeds; a rejected or unreviewed deed is never paid.</p></div>`;
  }
  // Связь с картой: только просмотр этой точки на карте программы; демо её не меняет.
  stage(`${html}
<div class="sandbox"><div class="eyebrow">Recorded PayPal sandbox evidence (not from this run)</div>
<p>${h(sb.environment)} Payouts batch <code>${h(sb.payoutBatchId)}</code>: ${sb.items} payouts, ${money(sb.total)} ${h(sb.currency)}, status ${h(sb.status)}, ${h(sb.date)}.</p>
<p class="muted small">Source: ${h(sb.source)} Not re-queried from PayPal.</p></div>
<div class="actbar"><button class="btn lg accent" data-again>Run the demo again</button>${paid ? `<a class="btn lg" href="/?task=${encodeURIComponent(S.task.id)}">See this spot on the map</a>` : ''}<a class="btn lg" href="/pilot.html">Run a pilot</a></div>
${paid ? '<p class="small muted maplink">The map shows the city program as it is: this demo run did not change the spot, the program or its ledger.</p>' : ''}`);
  $('[data-again]').onclick = act(start, 'starting');
  toStageTop();
}

start().catch((err) => fail(err, 'starting'));
