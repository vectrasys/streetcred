// Кабинет жителя: баланс, задания с QR и проверкой камерой, выплаты, заявки, профиль.
import { $, $$, h, money, date, dateTime, ago, api, chrome, toast, modal, camView } from './common.js';
import * as shared from './common.js';
import { camTile, runDeed } from './camflow.js';

const user = await chrome('account');
// Без входа — на страницу входа; дальше код не выполняется.
if (!user || user.role !== 'resident') { location.replace('/signin.html?next=/account.html'); await new Promise(() => {}); }
const city = await api('/api/public/city');
const D = Object.fromEntries(city.districts.map((d) => [d.id, d]));
const camById = new Map(city.cameras.map((c) => [c.id, c]));
const STATUS_TEXT = { claimed: 'Claimed', in_review: 'In review', approved: 'Approved — next payout', paid: 'Sent to payout batch', rejected: 'Not approved', completed: 'Sample completed task' };
const ITEM_TEXT = { SUCCESS: 'Recorded SUCCESS', PENDING: 'Pending', PROCESSING: 'Processing', UNCLAIMED: 'Unclaimed', ONHOLD: 'On hold', RETURNED: 'Returned', FAILED: 'Failed', DENIED: 'Denied' };
const ITEM_HELP = {
  SUCCESS: 'Recorded payout status: SUCCESS. Read the source marker to distinguish sandbox records from seeded sample history.',
  PENDING: 'PayPal has accepted the payout and is processing it.',
  PROCESSING: 'PayPal is processing the payout.',
  UNCLAIMED: 'Recorded status: UNCLAIMED. Recipient claim is not recorded. The exact cause and return date are not supplied by this item.',
  ONHOLD: 'Recorded status: ONHOLD. The exact reason is not supplied; this does not establish a review or tax hold.',
  RETURNED: 'Recorded status: RETURNED. The exact cause is not supplied in this record. Review the item and recipient details before any reissue.',
  FAILED: 'Recorded status: FAILED. Provider reason and any reissue decision are not supplied in this record.',
  DENIED: 'PayPal declined this payout.',
};
const KIND = { bags: 'Garbage bags', graffiti: 'Graffiti', couch: 'Abandoned couch', mattress: 'Mattress', tires: 'Dumped tires', cart: 'Shopping cart', branches: 'Fallen branches', boxes: 'Dumped boxes', litter: 'Park litter', drain: 'Storm drain', weeds: 'Weeds', bin: 'Overflowing bin', flyers: 'Old flyers', debris: 'Debris', butts: 'Cigarette butts', leaves: 'Fallen leaves', windblown: 'Wind-blown trash', beach: 'Beach litter', stickers: 'Stickers', other: 'Good deed' };
const wordmark = (t) => (t === 'venmo' ? '<span class="venmo-word" style="font-size:17px">venmo</span>' : '<span class="pp-word" style="font-size:16px">Pay<i>Pal</i></span>');
let tab = new URLSearchParams(location.search).get('tab') || 'tasks';
if (!['tasks', 'payouts', 'reports', 'profile'].includes(tab)) tab = 'tasks';
const currentTasks = () => me.tasks.filter((t) => ['claimed', 'in_review', 'approved'].includes(t.status));
const NEXT_STEP = { claimed: 'Visit the spot, show your QR code, then do the work.', in_review: 'Your work is with Public Works for review. No further action is needed yet.', approved: 'Your reward is approved and waiting for the next payout batch.' };
function progress(t) {
  const states = ['claimed', 'in_review', 'approved', 'paid'];
  const at = states.indexOf(t.status);
  return `<ol class="account-progress" aria-label="Task progress">${states.map((status, i) => `<li class="${i < at ? 'done' : i === at ? 'current' : ''}" ${i === at ? 'aria-current="step"' : ''}><span>${i < at ? '✓' : i + 1}</span>${['Claimed', 'In review', 'Approved', 'Sent to batch'][i]}</li>`).join('')}</ol>`;
}
function focusTask() {
  const t = currentTasks()[0];
  return t ? `<section class="account-focus" aria-labelledby="current-heading"><div class="eyebrow">Your current task${currentTasks().length > 1 ? ` · ${currentTasks().length} in progress` : ''}</div><div class="account-focus-title"><h2 id="current-heading">${h(t.title)}</h2><span class="pill ${t.status}">${STATUS_TEXT[t.status]}</span></div><p class="muted">${h(t.address)} · ${h(D[t.district].name)}</p>${progress(t)}<div class="account-next"><p>${NEXT_STEP[t.status]}</p><button class="btn primary" data-current>${t.status === 'claimed' ? 'Continue task' : 'View task details'}</button></div></section>`
    : `<section class="account-focus account-discover"><div><div class="eyebrow">A little care goes a long way</div><h2>Ready for your next good deed?</h2><p class="muted">Find a nearby spot to care for. Check the work and reward before you claim it.</p></div><a class="btn primary" href="/">Find a task on the map <span aria-hidden="true">↗</span></a></section>`;
}
let me;
const samplePayout = x => x.source === 'seeded_sample' || (!x.source && String(x.payoutBatchId).startsWith('HIST'));
const payoutOrigin = x => samplePayout(x) ? 'Seeded sample history · demo data' : x.source === 'sandbox_record' ? 'Recorded PayPal sandbox batch · no real money' : 'Program record · origin not supplied';
function payoutBadge(x) {
  const normalized = samplePayout(x) ? { ...x, source: 'seeded_sample' } : x;
  const state = (['seeded_sample','sandbox_record'].includes(normalized.source) ? shared.payoutState?.(normalized) : { label: `Recorded ${x.status || 'unknown'} · source not supplied`, cls: 'st-claimed' }) || (samplePayout(x) ? { label: 'Sample payout (demo data)', cls: 'st-sample' } : x.source === 'sandbox_record' && x.status === 'SUCCESS' ? { label: 'Payout completed (sandbox)', cls: 'st-completed' } : ['PENDING','PROCESSING','UNCLAIMED','ONHOLD'].includes(x.status) ? { label: 'Payout pending', cls: 'st-pending' } : { label: ITEM_TEXT[x.status] || x.status, cls: 'st-problem' });
  return `<span class="st ${h(state.cls)}">${h(state.label)}</span>`;
}
const confirmedTasks = () => me.tasks.filter(t => (me.earnings.confirmedTaskIds || []).includes(t.id));
function evidenceMarkup(task) {
  const evidence = task.evidence;
  const localImage = value => typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') && !value.includes('..');
  if (!localImage(evidence?.beforeUrl) || !localImage(evidence?.afterUrl) || !evidence.provenance) return '<p class="community-no-evidence">No before/after evidence is attached to this record. A task photo or current camera frame is not proof of completed work.</p>';
  return `<div class="community-evidence"><figure><img src="${h(evidence.beforeUrl)}" alt="Before frame attached to ${h(task.id)}"><figcaption>Before · ${h(evidence.provenance)}</figcaption></figure><figure><img src="${h(evidence.afterUrl)}" alt="After frame attached to ${h(task.id)}"><figcaption>After · ${h(evidence.provenance)}</figcaption></figure></div>${evidence.caption ? `<p class="muted">${h(evidence.caption)}</p>` : ''}`;
}
function contributionCard(task, sample = false) {
  const items = me.payouts.filter(x => x.taskId === task.id);
  return `<article class="community-deed"><span class="community-source">${sample ? 'Sample completed task · no verification evidence' : 'Confirmed by verification in this demo session'}</span><h3>${h(task.title)}</h3><p class="muted">${h(task.id)} · ${h(task.address)}</p>${sample ? '<p class="community-no-evidence">Seeded demo example. No verification or before/after evidence is available.</p>' : evidenceMarkup(task)}<dl class="community-reward-status"><div><dt>Reward approval</dt><dd>${sample ? 'Sample task record; approval not evidenced' : `${money(task.reward)} approved`}</dd></div><div><dt>Payout status</dt><dd>${items.length ? items.map(payoutBadge).join(' ') : sample ? 'No linked payout record' : 'No payout item recorded yet'}</dd></div></dl>${!sample && task.verification ? `<p class="muted">${h(task.verification.reason || task.verification.reviewNote || 'Verification recorded; no reason supplied')}</p>` : ''}</article>`;
}
function contributions() {
  const tasks = confirmedTasks(); const examples = me.tasks.filter(t => t.status === 'completed' && !t.verification);
  return `<section class="community-confirmed" aria-labelledby="contribution-heading"><div class="community-confirmed-head"><h2 id="contribution-heading">Your contribution history</h2><span class="community-confirmed-count">${me.earnings.confirmedDeeds ?? tasks.length} confirmed in this demo session</span></div>${tasks.length ? `<div class="community-deed-grid">${tasks.map(t=>contributionCard(t)).join('')}</div>` : '<div class="community-no-evidence">No confirmed deeds recorded in this session yet. Seeded payout history does not count as verified work.</div>'}${examples.length ? `<details><summary>${examples.length} sample completed task${examples.length === 1 ? '' : 's'} · demo data</summary><div class="community-deed-grid">${examples.map(t=>contributionCard(t,true)).join('')}</div></details>` : ''}<p class="community-record-note">${me.earnings.sampleHistoryItems ?? me.payouts.filter(samplePayout).length} seeded payout history items are money examples only, not confirmed deeds. Source: /api/me.</p></section>`;
}


async function load() { me = await api('/api/me'); render(); }

function render() {
  const p = me.profile; const e = me.earnings;
  const active = currentTasks();
  $('#app').innerHTML = `
<div class="pagehead account-identity">${p.photo ? `<img class="av" src="${p.photo}" alt="">` : `<span class="ini account-initials">${h(p.name.split(' ').map((x) => x[0]).join(''))}</span>`}
  <div><div class="eyebrow">My account</div><h1>${h(p.name)}</h1><div class="muted small">${h(D[p.district].name)} · Member since ${date(p.joined)}</div></div>
</div>
<div class="community-demo-note"><b>Demo account · fictional activity</b><span>Session-confirmed work, sample task history and payout records are separate. Sandbox uses no real money; seeded history is not proof of work or payment.</span></div>
${focusTask()}
${contributions()}
<section class="account-summary" aria-label="Payment summary">
  <div class="account-summary-heading"><h2>Rewards at a glance</h2><a href="?tab=payouts">View payouts →</a></div>
  <dl class="account-balances">
    ${[[e.paidSandbox ?? 0, 'Completed payouts (sandbox)', 'paid'], [me.payouts.filter(x=>!samplePayout(x) && ['PENDING','PROCESSING','UNCLAIMED','ONHOLD'].includes(x.status)).reduce((sum,x)=>sum+Number(x.amount),0), 'Pending payouts (sandbox)', 'transit'], [e.pending, 'Approved rewards, not sent', 'pending']].map(([value, label, kind]) => `<div class="${Number(value) === 0 ? 'zero' : kind}"><dt>${label}</dt><dd>${money(value)}</dd></div>`).join('')}
    <div class="${Number(e.confirmedDeeds ?? 0) === 0 ? 'zero' : ''}"><dt>Confirmed in this session</dt><dd>${e.confirmedDeeds ?? 0}</dd></div>
  </dl>
  <p class="community-summary-source">Sample rewards recorded: ${money(e.paidSample ?? me.payouts.filter(x=>samplePayout(x) && x.status === 'SUCCESS').reduce((sum,x)=>sum+Number(x.amount),0))} · seeded history, not completed sandbox payouts.</p>
  <div class="account-wallet"><span>${wordmark(p.wallet.type)} · ${h(p.wallet.masked)}</span><a href="?tab=profile">Payout settings</a></div>
</section>
<div class="tabs">${[['tasks', `My tasks${active.length ? ` <span class="count">${active.length}</span>` : ''}`], ['payouts', 'Payouts'], ['reports', 'My reports'], ['profile', 'Payout settings']]
    .map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}</button>`).join('')}</div>
<div id="tab"></div>`;
  $$('[data-tab]').forEach((b) => (b.onclick = () => { tab = b.dataset.tab; history.replaceState(null, '', `?tab=${tab}`); render(); }));
  $('[data-current]') && ($('[data-current]').onclick = () => { tab = 'tasks'; history.replaceState(null, '', '?tab=tasks'); render(); document.getElementById('active').scrollIntoView({ behavior: 'smooth', block: 'start' }); });
  ({ tasks: renderTasks, payouts: renderPayouts, reports: renderReports, profile: renderProfile })[tab]();
}

// ---------- задания ----------
function renderTasks() {
  const active = currentTasks();
  const past = me.tasks.filter((t) => !['claimed', 'in_review', 'approved'].includes(t.status));
  $('#tab').innerHTML = `
${active.length ? '<h2 class="account-section-title">Current tasks</h2>' : ''}
<div class="grid" id="active"></div>
<h2 style="margin-top:22px;font-size:19px">History</h2>
<div class="card" style="padding:0">${past.length ? `<table class="t account-history"><thead><tr><th>Task</th><th>Where</th><th>Verification</th><th>Status</th><th class="num">Reward</th></tr></thead><tbody>
${past.map((t) => `<tr><td data-label="Task"><b>${h(t.title)}</b><div class="muted small">${h(t.id)}</div></td><td data-label="Where">${h(t.address)}<div class="muted small">${h(D[t.district].name)} · ${h(t.cameraId)}</div></td>
<td data-label="Verification" class="small">${t.verification ? h(t.verification.reason || (t.verification.by === 'human' ? 'Human review' : '')) : '<span class="muted">—</span>'}</td>
<td data-label="Status"><span class="pill ${t.status}">${STATUS_TEXT[t.status] || t.status}</span></td><td data-label="Reward" class="num money">${money(t.reward)}</td></tr>`).join('')}</tbody></table>` : '<div class="empty">No finished tasks yet.</div>'}</div>`;
  for (const t of active) {
    if (t.status === 'claimed') $('#active').appendChild(activeCard(t));
    else {
      const el = document.createElement('article'); el.className = 'card account-awaiting';
      el.innerHTML = `<span class="pill ${t.status}">${STATUS_TEXT[t.status]}</span><h3>${h(t.title)}</h3><p class="muted small">${h(t.address)} · ${h(t.id)}</p><p>${NEXT_STEP[t.status]}</p>${t.verification?.reason ? `<p class="small">${h(t.verification.reason)}</p>` : ''}<div class="account-next"><span class="money">Reward ${money(t.reward)}</span><a class="btn sm" href="/?task=${t.id}">Show on map</a></div>`;
      $('#active').appendChild(el);
    }
  }
}

function activeCard(t) {
  const c = camById.get(t.cameraId);
  const el = document.createElement('div'); el.className = 'card account-task';
  el.innerHTML = `<div class="row2">
  <div><div id="cam-${t.id}"></div><p class="muted small" style="margin:8px 0 0">Camera ${h(c.id)} watches this spot. It checks the area, not people: no faces are recognized or stored.</p></div>
  <div><div style="display:flex;justify-content:space-between;gap:10px"><h2 style="font-size:19px">${h(t.title)}</h2><span class="money" style="font-size:22px">${money(t.reward)}</span></div>
  <div class="muted">${h(t.address)} · ${h(D[t.district].name)} · ${h(t.id)}</div>
  <ol class="steps" style="margin-top:14px">
    <li class="done"><b>Claimed</b> <span class="muted small">— the spot is reserved for you for 48 hours.</span></li>
    <li><b>Show your QR code to the camera</b> when you arrive, so it knows the work is yours.
      <div style="display:flex;gap:12px;align-items:center;margin-top:8px"><img src="/api/me/qr?task=${t.id}" alt="One-time QR code" style="width:120px;height:120px;border:1px solid var(--line);border-radius:8px">
      <span class="muted small">One-time code. Valid for this task only; it stops working after the camera reads it.</span></div></li>
    <li><b>Do the work.</b> Bag it, sweep it, leave the spot clean. Heavy items go to the curb, not into the street.</li>
    <li><b>${t.verifiable ? 'Ask the camera to check' : 'Tell us you are done'}</b> <span class="muted small">— ${t.verifiable ? 'the camera compares before and after; most checks finish in under a minute.' : 'a Public Works reviewer checks the camera footage, usually within one business day.'}</span></li>
  </ol>
  <div style="display:flex;gap:8px;flex-wrap:wrap">${t.verifiable ? '<button class="btn primary" data-verify>I’m done — verify with the camera</button>' : '<button class="btn primary" data-submit>I’m done — send for review</button>'}
  <a class="btn" href="/?task=${t.id}">Show on map</a></div>
  <div data-log class="muted small" style="margin-top:10px"></div></div></div>`;
  if (t.verifiable) {
    const tile = camTile(t); tile.querySelector('.cap').remove();
    el.querySelector(`#cam-${t.id}`).appendChild(tile);
    el.querySelector('[data-verify]').onclick = (ev) => verify(ev.target, el, tile, t);
  } else {
    el.querySelector(`#cam-${t.id}`).innerHTML = camView(c, { frame: t.frame, district: D[t.district].name });
    el.querySelector('[data-submit]').onclick = async () => {
      try { await api('/api/me/submit', { taskId: t.id }); toast('Sent for review. We’ll email you when it’s approved.'); load(); } catch (err) { toast(err.message); }
    };
  }
  return el;
}

async function verify(btn, card, tile, t) {
  // Демо: «реальность» на месте — житель действительно убрал мусор. В рабочей
  // системе этот шаг делает сам житель, а кадры приходят с камеры напрямую.
  const log = card.querySelector('[data-log]');
  btn.disabled = true; log.innerHTML = '';
  const step = (s) => { log.innerHTML += `<div>✓ ${h(s)}</div>`; };
  try {
    const r = await runDeed(tile, t, { onStep: step });
    const v = r.verification;
    log.innerHTML += `<div style="margin-top:6px;color:var(${v.status === 'approved' ? '--ok' : v.status === 'rejected' ? '--bad' : '--warn'});font-weight:700">${
      v.status === 'approved' ? `Reward approved: ${money(t.reward)}. Payout has not been completed; it is tracked separately in Payouts.`
        : v.status === 'rejected' ? `Not approved: ${h(v.reason)}` : `Sent to a human reviewer: ${h(v.reason)}`}</div>`;
    setTimeout(load, 4500);
  } catch (err) { toast(err.message); btn.disabled = false; }
}

// ---------- выплаты ----------
function renderPayouts() {
  $('#tab').innerHTML = `<div class="demo-note" style="margin-bottom:12px">Approval is separate from payout completion. Seeded history below is sample data. Only a recorded sandbox item with SUCCESS is marked completed; pending or problem statuses do not confirm delivery.</div>
<div class="card" style="padding:0">${me.payouts.length ? `<table class="t account-history"><thead><tr><th>Date</th><th>Payout</th><th>For</th><th>Status</th><th class="num">Amount</th><th></th></tr></thead><tbody>
${me.payouts.map((x, i) => `<tr><td data-label="Date">${date(x.date)}</td><td data-label="Payout"><code>${h(x.id)}</code><div class="muted small">Batch ${h(x.batchId)}</div></td><td data-label="For">${h(x.taskId || KIND[x.kind] || 'Good deed')}</td>
<td data-label="Status">${payoutBadge(x)}<div class="muted small">Recorded: ${h(x.status)}</div><span class="community-source">${h(payoutOrigin(x))}</span></td><td data-label="Amount" class="num money">${money(x.amount)}</td><td data-label="Receipt"><button class="btn sm" data-r="${i}">Receipt</button></td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">No payouts yet. Sent payout batches will appear here with their delivery status.</div>'}</div>
<p class="muted small">Questions about a payout? Call the StreetCred helpline (555) 014-2049 and give the payout ID. <a href="/how.html#payments">How payments work</a></p>`;
  $$('[data-r]').forEach((b) => (b.onclick = () => receipt(me.payouts[b.dataset.r])));
}

function receipt(x) {
  modal(`<div class="receipt"><div style="display:flex;justify-content:space-between;align-items:center"><h3 style="margin:0">Payout receipt</h3><span class="pp-word" style="font-size:18px">Pay<i>Pal</i></span></div>
<dl><dt>Payer</dt><dd>City of Port Calloway — StreetCred</dd><dt>Recipient</dt><dd>${h(me.profile.name)}</dd><dt>Destination on record</dt><dd>${x.wallet === 'venmo' ? 'Venmo' : 'PayPal'} · ${h(me.profile.wallet.masked)}</dd><dt>Sent with</dt><dd>PayPal Payouts API${x.wallet === 'venmo' ? ' · <code>recipient_wallet: Venmo</code>' : ''}</dd>
<dt>Amount</dt><dd class="money">${money(x.amount)} USD</dd><dt>Status</dt><dd>${payoutBadge(x)} · recorded ${h(x.status)}</dd><dt>Source</dt><dd>${h(payoutOrigin(x))}</dd><dt>Evidence</dt><dd>${h(x.evidence || 'No payout evidence supplied')}</dd>
<dt>Payout item</dt><dd><code>${h(x.id)}</code></dd><dt>City batch</dt><dd><code>${h(x.batchId)}</code></dd><dt>PayPal batch</dt><dd><code>${h(x.payoutBatchId)}</code></dd>
<dt>Sent</dt><dd>${dateTime(x.date)} PT</dd><dt>Note</dt><dd>StreetCred: Port Calloway thanks you for your good deed</dd></dl>
<p class="community-receipt-note">${h(samplePayout(x) ? 'Seeded fictional history. This is a sample receipt, not proof of a PayPal transaction or recipient delivery.' : ITEM_HELP[x.status] || 'Recorded program status; no further cause supplied.')}</p>
<p class="muted small">StreetCred rewards are reported as program income. If you receive $${me.settings.w9ThresholdYear} or more in a calendar year, the city asks for a Form W-9 before further payouts.</p>
<div style="text-align:right"><button class="btn" data-x>Close</button></div></div>`, (m, close) => { m.querySelector('[data-x]').onclick = close; });
}

// ---------- заявки ----------
function renderReports() {
  $('#tab').innerHTML = `<p class="muted">Saw something that needs care? Open the <a href="/">map</a>, click the nearest camera and choose <b>Report a problem here</b>. Public Works reviews reports within one business day and sets the reward.</p>
<div class="card" style="padding:0">${me.proposals.length ? `<table class="t account-history"><thead><tr><th>Report</th><th>Camera</th><th>What you wrote</th><th>Status</th></tr></thead><tbody>
${me.proposals.map((x) => `<tr><td data-label="Report"><b>${h(x.id)}</b><div class="muted small">${ago(x.createdAt)}</div></td><td data-label="Camera">${h(x.cameraId)}<div class="muted small">${h(D[x.district].name)}</div></td><td data-label="What you wrote">${h(x.text)}</td>
<td data-label="Status"><span class="pill ${x.status}">${x.status}</span>${x.taskId ? `<div class="small">→ task ${h(x.taskId)}</div>` : ''}${x.reason ? `<div class="muted small">${h(x.reason)}</div>` : ''}</td></tr>`).join('')}</tbody></table>`
    : '<div class="empty">You have not reported anything yet.</div>'}</div>`;
}

// ---------- профиль ----------
function renderProfile() {
  const p = me.profile;
  $('#tab').innerHTML = `<div class="row2">
<div class="card"><div class="eyebrow">Payouts by <span class="pp-word">Pay<i>Pal</i></span></div><h2>Where should we send your rewards?</h2>
  <div class="wallets">
    <label class="wallet ${p.wallet.type === 'paypal' ? 'on' : ''}"><input type="radio" name="w" value="paypal" ${p.wallet.type === 'paypal' ? 'checked' : ''}>
      <span class="pp-word" style="font-size:22px">Pay<i>Pal</i></span><small>By email. Works worldwide.</small></label>
    <label class="wallet ${p.wallet.type === 'venmo' ? 'on' : ''}"><input type="radio" name="w" value="venmo" ${p.wallet.type === 'venmo' ? 'checked' : ''}>
      <span class="venmo-word" style="font-size:24px">venmo</span><small>By US mobile number.</small></label>
  </div>
  <div id="wf"></div>
  <p class="muted small">No account yet? PayPal or Venmo sends you a link to claim the money; unclaimed payouts return to the city after ${me.settings.unclaimedDays} days. In production the account is confirmed with <b>Log in with PayPal</b>.</p>
  <button class="btn primary" id="save">Save payout method</button></div>
<div class="card"><h2>Tax information</h2>
  <p class="muted small">StreetCred rewards are taxable income. The city asks for a Form W-9 once your rewards reach $${me.settings.w9ThresholdYear} in a calendar year; payouts above that are held until the form is on file. We do not give tax advice.</p>
  <p>Status: ${p.w9 === 'on_file' ? '<span class="pill approved">W-9 on file</span>' : '<span class="pill pending">Not on file</span>'}</p>
  ${p.w9 === 'on_file' ? '' : '<button class="btn" id="w9">Submit Form W-9 (demo)</button><p class="muted small">Demo: marks the form as received. No personal data is collected.</p>'}</div>
</div>`;
  const field = () => {
    const w = $('input[name=w]:checked').value;
    $$('.wallet').forEach((l) => l.classList.toggle('on', l.querySelector('input').checked));
    $('#wf').innerHTML = w === 'paypal' ? `<label class="f">PayPal email</label><input class="f" id="pp" value="${h(p.paypal)}" type="email">`
      : `<label class="f">US mobile number linked to Venmo</label><input class="f" id="ph" placeholder="${p.wallet.type === 'venmo' ? h(p.wallet.masked) : '(555) 014-2049'}" inputmode="tel">`;
  };
  $$('input[name=w]').forEach((i) => (i.onchange = field)); field();
  $('#save').onclick = async () => {
    const w = $('input[name=w]:checked').value;
    try {
      const r = await api('/api/me/profile', w === 'paypal' ? { paypal: $('#pp').value, wallet: 'paypal' } : { wallet: 'venmo', phone: $('#ph').value });
      me.profile.paypalMasked = r.paypalMasked; me.profile.wallet = r.wallet; if (w === 'paypal') me.profile.paypal = $('#pp').value;
      toast(`Rewards will go to your ${w === 'venmo' ? 'Venmo' : 'PayPal'}`); render();
    } catch (err) { toast(err.message); }
  };
  if ($('#w9')) $('#w9').onclick = async () => { await api('/api/me/profile', { w9: 'on_file' }); toast('W-9 received'); load(); };
}

load();
