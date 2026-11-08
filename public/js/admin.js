// Админка Public Works: обзор, живая проверка, проверка вручную, заявки жителей,
// выплаты PayPal, книга, камеры, жители, webhooks, журнал, настройки.
import { $, $$, h, money, date, dateTime, ago, api, chrome, toast, modal, camView } from './common.js';
import { camTile, runDeed, sleep } from './camflow.js';

const user = await chrome('admin');
// Без входа администратора — на страницу входа; дальше код не выполняется.
if (!user || user.role !== 'admin') { location.replace('/signin.html?next=/admin.html'); await new Promise(() => {}); }
const city = await api('/api/public/city');
const D = Object.fromEntries(city.districts.map((d) => [d.id, d]));
const camById = new Map(city.cameras.map((c) => [c.id, c]));
const TABS = [['overview', 'Overview'], ['copilot', '✦ Copilot'], ['live', 'Live verification'], ['review', 'Review queue'], ['reports', 'Resident reports'], ['payouts', 'Payouts'],
  ['ledger', 'Ledger'], ['cameras', 'Cameras'], ['residents', 'Residents'], ['webhooks', 'Webhooks'], ['audit', 'Audit log'], ['settings', 'Settings']];
let tab = new URLSearchParams(location.search).get('tab') || 'overview';
let ov;

$('#app').innerHTML = `<div class="pagehead"><div><h1 style="margin:0">StreetCred — Program Admin</h1>
<div class="muted">${h(user.name)} · ${h(user.title)}</div></div>
<div style="margin-left:auto;display:flex;gap:8px;flex-wrap:wrap"><span class="pill pending" style="align-self:center">PayPal: Sandbox</span><a class="btn sm" href="/treasury.html">Treasury dashboard →</a><button class="btn sm danger" id="reset">Reset demo data</button></div></div>
<div class="tabs" id="tabs"></div><div id="tab"></div>`;
$('#reset').onclick = async () => { if (confirm('Reset all demo data to the seeded state?')) { await api('/api/admin/reset', {}); toast('Demo data reset'); show(tab); } };

async function tabsBar() {
  ov = await api('/api/admin/overview');
  const badge = { review: ov.counts.review, reports: ov.counts.proposals, payouts: ov.counts.approved };
  $('#tabs').innerHTML = TABS.map(([id, label]) => `<button data-tab="${id}" class="${tab === id ? 'on' : ''}">${label}${badge[id] ? ` <span class="count">${badge[id]}</span>` : ''}</button>`).join('');
  $$('#tabs [data-tab]').forEach((b) => (b.onclick = () => show(b.dataset.tab)));
}
async function show(id) {
  tab = id; history.replaceState(null, '', `?tab=${id}`);
  await tabsBar();
  $('#tab').innerHTML = '<p class="muted">Loading…</p>';
  await VIEWS[id]();
}
const table = (head, rows, empty = 'Nothing here.') => `<div class="card" style="padding:0;overflow:auto">${rows.length
  ? `<table class="t"><thead><tr>${head.map((x) => `<th class="${x.startsWith('#') ? 'num' : ''}">${x.replace(/^#/, '')}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`
  : `<div class="empty">${empty}</div>`}</div>`;
// Минимальная разметка ответов агента: таблицы, **жирный**, списки, переносы. Сначала экранирование.
function md(text) {
  const lines = h(text).split('\n'); const out = []; let tbl = [];
  const flush = () => {
    if (!tbl.length) return;
    const rows = tbl.filter((l) => !/^\|\s*:?-{2,}/.test(l)).map((l) => l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim()));
    out.push(`<table class="t mini"><thead><tr>${rows[0].map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${rows.slice(1).map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
    tbl = [];
  };
  for (const l of lines) {
    if (/^\s*\|/.test(l)) { tbl.push(l.trim()); continue; }
    flush();
    if (/^\s*-{3,}\s*$/.test(l)) { out.push('<hr>'); continue; }
    if (/^\s*#{1,4} /.test(l)) { out.push(`<div class="hd">${l.replace(/^\s*#{1,4} /, '')}</div>`); continue; }
    out.push(/^\s*[-*] /.test(l) ? `<div class="li">${l.replace(/^\s*[-*] /, '')}</div>` : l ? `<div>${l}</div>` : '<div class="gap"></div>');
  }
  flush();
  return out.join('').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
}
const ACC = { sponsor_funds: 'Boosts received (PayPal Checkout)', program_budget: 'Program budget (funding)', payable: 'Rewards payable', in_transit: 'In transit at PayPal', paid_out: 'Paid out', returned: 'Returned by PayPal' };

const VIEWS = {
  // ---------- обзор ----------
  async overview() {
    const b = ov.balances; const spend = Number(ov.monthSpend); const pct = Math.min(100, (spend / ov.budget) * 100);
    const ex = await api('/api/admin/payout-exceptions');
    const why = `<div class="card whycard"><div class="eyebrow">Treasury · read-only</div><h2>Why didn’t some payouts arrive?</h2>
<p class="small muted">${h(ex.provenance)}</p>
<div class="whyrow">${Object.entries(ex.byStatus).map(([k, x]) => `<div><span class="pill ${k}">${k}</span><b>${x.count}</b><span class="money">${money(x.total)}</span></div>`).join('') || '<p>All recorded payouts settled.</p>'}</div>
<details><summary>${ex.count} items · ${money(ex.total)} — see each item</summary>${table(['Item', 'Resident', 'Status', 'Meaning', 'Next step', '#Amount'], ex.rows.map((r) => `<tr><td><code>${h(r.itemId)}</code><div class="muted small">${h(r.source)}</div></td><td>${h(r.resident)}</td><td><span class="pill ${r.status}">${r.status}</span></td><td class="small">${h(r.meaning)}</td><td class="small">${h(r.nextStep)}</td><td class="num money">${money(r.amount)}</td></tr>`))}</details>
<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:12px"><button class="btn primary" id="why-ask">Ask Treasury Copilot (read-only)</button><a class="btn" href="/treasury.html">Open the treasury dashboard</a></div>
<div id="why-out" class="small" role="status"></div></div>`;
    $('#tab').innerHTML = `${why}<div class="kpis">
  <div class="kpi"><b>${ov.counts.online}/${ov.counts.cameras}</b><span>Cameras online</span></div>
  <div class="kpi"><b>${ov.counts.open}</b><span>Open tasks</span></div>
  <div class="kpi"><b>${ov.counts.claimed}</b><span>Claimed, in progress</span></div>
  <div class="kpi"><b>${ov.counts.review}</b><span>Waiting for human review</span></div>
  <div class="kpi"><b>${ov.counts.proposals}</b><span>Resident reports to moderate</span></div>
  <div class="kpi"><b class="money">${money(b.payable)}</b><span>Approved, not yet sent</span></div>
</div>
<div class="row2" style="margin-top:16px">
  <div class="card"><h2>Budget — this month</h2><div style="display:flex;justify-content:space-between"><b class="money">${money(spend)}</b><span class="muted">of ${money(ov.budget)}</span></div>
  <div style="height:6px;background:var(--line);border-radius:99px;margin:10px 0 14px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${pct > 85 ? 'var(--bad)' : 'var(--ink)'}"></div></div>
  <table class="t">${Object.entries(ACC).map(([k, v]) => `<tr><td>${v}</td><td class="num money">${money(b[k])}</td></tr>`).join('')}</table>
  <p class="muted small">Double-entry ledger. Program budget is debited when a deed is approved; money leaves the program only when PayPal confirms the payout.</p></div>
  <div class="card"><h2>Recent activity</h2>${ov.audit.map((a) => `<div style="padding:6px 0;border-bottom:1px solid #eef2f6"><b>${h(a.actor)}</b> ${h(a.action)}<div class="muted small">${h(a.detail || '')} · ${ago(a.at)}</div></div>`).join('') || '<p class="muted">No activity yet today.</p>'}</div>
</div>`;
    $('#why-ask').onclick = async (e) => {
      e.target.disabled = true;
      const out = $('#why-out');
      const info = await api('/api/admin/copilot');
      if (!info.model) { out.innerHTML = '<p class="bad">The Copilot model is unavailable on this server; the read-only figures above come straight from the program records.</p>'; e.target.disabled = false; return; }
      out.innerHTML = `<p class="muted">${h(info.model)} is reading the program records…</p>`;
      try {
        const r = await api('/api/admin/copilot', { readOnly: true, messages: [{ role: 'user', content: 'Why did some payouts not arrive? Give counts and amounts per status.' }] });
        out.innerHTML = `<div class="msg bot">${md(r.text)}<div class="tools">${r.steps.map((x) => `<span>${h(x.tool)}</span>`).join('')}<span>read-only · ${h(r.model)}</span></div></div>`;
      } catch (err) { out.innerHTML = `<p class="bad">Copilot failed: ${h(err.message)}. The figures above are still accurate.</p>`; }
      e.target.disabled = false;
    };
  },

  // ---------- Treasury Copilot ----------
  async copilot() {
    const info = await api('/api/admin/copilot');
    $('#tab').innerHTML = `<div class="copilot">
<div class="chat card"><div class="chead"><div><div class="eyebrow">AI agent · <span class="pp-word">Pay<i>Pal</i></span> Agent Toolkit · sandbox</div>
<h2 style="margin:4px 0 0">Treasury <em>Copilot</em></h2></div><span class="pill ${info.model ? 'approved' : 'rejected'}">${h(info.model || 'no model configured')}</span></div>
<div class="msgs" id="msgs"><div class="msg bot">Hi Dana. I can check boosts against PayPal orders, look at transactions and disputes, review payouts, and draft refunds or sponsor invoices for you to approve. I never move money on my own.</div></div>
<div class="sugg" id="sugg">${['Reconcile the reward boosts with PayPal', 'Which payouts were unclaimed or returned? What should we do?', 'Any open PayPal disputes?',
  'Draft an invoice to Harbor Street Bakery (billing@harborstreetbakery.example) for $250 to sponsor Old Wharf cleanups in November']
  .map((q) => `<button>${h(q)}</button>`).join('')}</div>
<form class="ask" id="ask"><input class="f" id="q" placeholder="Ask about boosts, payouts, refunds, invoices…" autocomplete="off"><button class="btn primary">Ask</button></form></div>
<aside class="card"><h3>Waiting for your approval</h3><p class="muted small">Refunds and invoices proposed by the copilot. Approving runs the PayPal Agent Toolkit action in the sandbox.</p><div id="acts"></div></aside></div>`;
    const history = [];
    const drawActs = (list) => {
      $('#acts').innerHTML = list.map((a) => `<div class="act ${a.status}"><div class="row"><b>${h(a.label)}</b><span class="pill ${a.status === 'done' ? 'approved' : a.status === 'pending' ? 'pending' : 'rejected'}">${a.status}</span></div>
<div class="muted small">${h(a.id)} · <code>${h(a.name)}</code> · ${ago(a.at)}</div><pre class="json small">${h(JSON.stringify(a.args, null, 1))}</pre>
${a.result ? `<div class="small">${h(JSON.stringify(a.result).slice(0, 260))}</div>` : ''}
${a.status === 'pending' ? `<div class="row" style="justify-content:flex-start;gap:6px"><button class="btn sm primary" data-ok="${a.id}">Approve</button><button class="btn sm danger" data-no="${a.id}">Reject</button></div>` : ''}</div>`).join('') || '<p class="muted small">Nothing yet.</p>';
      $$('[data-ok],[data-no]', $('#acts')).forEach((b) => (b.onclick = async () => {
        b.disabled = true;
        try { await api('/api/admin/copilot/decide', { id: b.dataset.ok || b.dataset.no, approve: Boolean(b.dataset.ok) }); toast(b.dataset.ok ? 'Done in the PayPal sandbox' : 'Rejected'); }
        catch (err) { toast(err.message); }
        drawActs((await api('/api/admin/copilot')).actions);
      }));
    };
    drawActs(info.actions);
    const add = (cls, html) => { $('#msgs').insertAdjacentHTML('beforeend', `<div class="msg ${cls}">${html}</div>`); $('#msgs').scrollTop = 1e9; };
    const ask = async (q) => {
      if (!q.trim()) return;
      add('me', h(q)); history.push({ role: 'user', content: q }); $('#q').value = '';
      add('bot thinking', '<span class="dots"><i></i><i></i><i></i></span> Checking PayPal…');
      try {
        const r = await api('/api/admin/copilot', { messages: history });
        $('#msgs .thinking').remove();
        history.push({ role: 'assistant', content: r.text });
        add('bot', `${md(r.text)}${r.steps.length ? `<div class="tools">${r.steps.map((x) => `<span>${h(x.tool)}</span>`).join('')}</div>` : ''}`);
        if (r.proposals.length) drawActs((await api('/api/admin/copilot')).actions);
      } catch (err) { $('#msgs .thinking').remove(); add('bot err', h(err.message)); }
    };
    $('#ask').onsubmit = (e) => { e.preventDefault(); ask($('#q').value); };
    $$('#sugg button').forEach((b) => (b.onclick = () => ask(b.textContent)));
  },

  // ---------- живая проверка ----------
  async live() {
    const tasks = (await api('/api/admin/tasks')).filter((t) => t.verifiable).sort((a, b) => a.id.localeCompare(b.id));
    const res = await api('/api/admin/residents');
    $('#tab').innerHTML = `<div class="demo-note">Live wall for the four spots with full automatic verification. Frames come from the street camera; the server checks the one-time QR, that the view is the same camera, what changed inside the task area, and asks a vision model whether the area is clean before and after.
Demo controls simulate what happens on site.</div>
<div style="display:flex;gap:8px;margin:12px 0;flex-wrap:wrap"><button class="btn primary" id="story">▶ Run demo: 4 deeds, one fraud attempt, payout</button><span class="muted small" style="align-self:center" id="story-st"></span></div>
<div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(460px,1fr))" id="wall"></div>
<div class="card" style="margin-top:16px"><h2>Verification feed</h2><div id="feed" class="small"></div></div>`;
    const tiles = {};
    for (const t of tasks) {
      const el = camTile(t); tiles[t.id] = el; $('#wall').appendChild(el);
      const meta = document.createElement('div'); meta.className = 'cap'; meta.style.paddingTop = '0';
      meta.dataset.meta = t.id;
      meta.innerHTML = `<span class="small" style="color:#9fb0c2">${h(t.id)} · <span class="pill ${t.status}">${t.status}</span>${t.claimedBy ? ` · ${h(t.claimedBy.name)}` : ''}</span>`;
      el.appendChild(meta);
    }
    const feed = (s, cls = '') => { $('#feed').insertAdjacentHTML('afterbegin', `<div style="padding:4px 0;border-bottom:1px solid #eef2f6" class="${cls}"><span class="muted">${new Date().toLocaleTimeString('en-US', { timeZone: 'America/Los_Angeles' })}</span> ${s}</div>`); };
    const name = (id) => res.find((r) => r.id === id).fullName;
    $('#story').onclick = async (e) => {
      e.target.disabled = true;
      const plan = [['T-2001', 'maya', {}], ['T-2002', 'jordan', { work: false }], ['T-2003', 'luis', { light: 0.7 }], ['T-2004', 'priya', {}]];
      for (const [id, who, opt] of plan) {
        const t = tasks.find((x) => x.id === id);
        if (t.status !== 'open') { feed(`${h(id)} is not open — reset demo data to run the story again.`); continue; }
        try {
          await api('/api/admin/claim', { taskId: id, residentId: who });
          feed(`<b>${h(name(who))}</b> claimed <b>${h(t.title)}</b> at ${h(t.address)} · ${money(t.reward)}`);
          if (opt.work === false) feed('↳ simulating a fraud attempt: QR shown, but nothing was cleaned');
          if (opt.light) feed('↳ evening light: the AFTER frame is darker');
          const r = await runDeed(tiles[id], t, { ...opt, onStep: (s) => feed(`<span class="muted">${h(t.cameraId)}:</span> ${h(s)}`) });
          const v = r.verification;
          const failed = (v.checks || []).filter((c) => !c.ok).map((c) => c.detail).join('; ');
          feed(`<b style="color:var(${v.status === 'approved' ? '--ok' : v.status === 'rejected' ? '--bad' : '--warn'})">${v.status.toUpperCase()}</b> ${h(t.id)} — ${h(failed || v.reason)}`);
          $(`[data-meta="${id}"]`).innerHTML = `<span class="small" style="color:#9fb0c2">${h(id)} · <span class="pill ${r.task.status}">${r.task.status}</span> · ${h(name(who))}</span>`;
        } catch (err) { feed(`<span style="color:var(--bad)">${h(err.message)}</span>`); }
        await sleep(600);
      }
      $('#story-st').innerHTML = 'Approved deeds are now in <a href="?tab=payouts">Payouts</a>.';
      await tabsBar(); e.target.disabled = false;
    };
  },

  // ---------- ручная проверка ----------
  async review() {
    const tasks = (await api('/api/admin/tasks')).filter((t) => t.status === 'in_review');
    $('#tab').innerHTML = tasks.length ? '<div class="grid" id="q"></div>' : '<div class="card empty">The review queue is empty.</div>';
    for (const t of tasks) {
      const c = camById.get(t.cameraId); const v = t.verification || {};
      const el = document.createElement('div'); el.className = 'card';
      el.innerHTML = `<div class="row2"><div>${camView(c, { frame: t.frame, district: D[t.district].name })}</div>
<div><div style="display:flex;justify-content:space-between"><h2 style="font-size:18px">${h(t.title)}</h2><span class="money" style="font-size:20px">${money(t.reward)}</span></div>
<div class="muted">${h(t.id)} · ${h(t.address)} · ${h(D[t.district].name)}</div>
<p><b>${h(t.claimedBy ? t.claimedBy.name : '—')}</b> · ${v.at ? `submitted ${ago(v.at)}` : ''}</p>
<p class="small"><b>Why it is here:</b> ${h(v.reason || 'Submitted for human review')}</p>
${(v.checks || []).map((x) => `<div class="small">${x.ok ? '✓' : '✗'} ${h(x.id)} — <span class="muted">${h(x.detail || '')}</span></div>`).join('')}
${v.ai && v.ai.before ? `<div class="small">AI before: ${v.ai.before.answer ? 'clean' : 'problem'} (${Math.round(v.ai.before.confidence * 100)}%) · after: ${v.ai.after.answer ? 'clean' : 'problem'} (${Math.round(v.ai.after.confidence * 100)}%)</div>` : ''}
<label class="f">Note (optional, visible to the resident)</label><input class="f" data-note placeholder="e.g. Confirmed on footage at 2:14 pm">
<div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" data-a="1">Approve ${money(t.reward)}</button><button class="btn danger" data-a="0">Reject</button></div></div></div>`;
      el.querySelectorAll('[data-a]').forEach((b) => (b.onclick = async () => {
        try { await api('/api/admin/review', { taskId: t.id, approve: b.dataset.a === '1', note: el.querySelector('[data-note]').value }); toast(b.dataset.a === '1' ? 'Approved — added to the next payout batch' : 'Rejected'); show('review'); } catch (err) { toast(err.message); }
      }));
      $('#q').appendChild(el);
    }
  },

  // ---------- заявки жителей ----------
  async reports() {
    const all = await api('/api/admin/proposals'); const s = await api('/api/admin/settings');
    const pending = all.filter((x) => x.status === 'pending');
    $('#tab').innerHTML = `${pending.length ? '<div class="grid" id="q"></div>' : '<div class="card empty">No reports waiting.</div>'}
<h2 style="font-size:18px;margin-top:20px">Decided</h2>${table(['Report', 'Resident', 'Camera', 'Text', 'Decision'], all.filter((x) => x.status !== 'pending').map((x) =>
  `<tr><td>${h(x.id)}<div class="muted small">${ago(x.createdAt)}</div></td><td>${h(x.resident)}</td><td>${h(x.cameraId)}</td><td class="small">${h(x.text)}</td><td><span class="pill ${x.status}">${x.status}</span> ${x.taskId ? h(x.taskId) : h(x.reason || '')}</td></tr>`), 'No decisions yet.')}`;
    const KINDS = { bags: 'Clear dumped garbage bags', graffiti: 'Paint over graffiti', couch: 'Haul away an abandoned couch', mattress: 'Remove a dumped mattress', tires: 'Remove dumped tires', cart: 'Return an abandoned shopping cart', branches: 'Clear fallen branches', boxes: 'Break down and recycle dumped boxes', litter: 'Pick up park litter', drain: 'Clear a clogged storm drain', weeds: 'Pull overgrown weeds', bin: 'Clean up around an overflowing bin', flyers: 'Remove old flyers', debris: 'Haul away construction debris', butts: 'Sweep up cigarette butts', leaves: 'Rake fallen leaves off the sidewalk', windblown: 'Collect wind-blown trash along a fence', beach: 'Pick up litter on the beach', stickers: 'Scrape off stickers', other: 'Resident-reported cleanup' };
    for (const x of pending) {
      const c = x.camera;
      const el = document.createElement('div'); el.className = 'card';
      el.innerHTML = `<div class="row2"><div>${camView(c, { district: D[c.district].name })}</div>
<div><h2 style="font-size:18px">${h(x.id)} · ${h(c.streets[0])} &amp; ${h(c.streets[1])}</h2>
<div class="muted">${h(x.resident)} · ${ago(x.createdAt)} · ${h(c.id)} · ${h(D[c.district].name)}</div>
<blockquote style="margin:10px 0;padding:8px 12px;border-left:3px solid var(--line);background:var(--bg)">${h(x.text)}</blockquote>
<label class="f">Task title</label><input class="f" data-title value="${h(KINDS[x.kind] || KINDS.other)}">
<label class="f">Reward (USD, $5–$${s.maxReward})</label><input class="f" data-reward type="number" min="5" max="${s.maxReward}" step="5" value="25">
<div style="display:flex;gap:8px;margin-top:10px"><button class="btn primary" data-ok>Publish task</button>
<select class="f" data-why style="width:auto"><option>Private property — not eligible</option><option>Needs a Public Works crew (hazardous)</option><option>Already scheduled for city cleanup</option><option>Not visible to any camera</option><option>Duplicate report</option></select><button class="btn danger" data-no>Decline</button></div></div></div>`;
      el.querySelector('[data-ok]').onclick = async () => {
        try { const r = await api('/api/admin/moderate', { proposalId: x.id, approve: true, reward: el.querySelector('[data-reward]').value, title: el.querySelector('[data-title]').value }); toast(`Published ${r.task.id} on the map`); show('reports'); } catch (err) { toast(err.message); }
      };
      el.querySelector('[data-no]').onclick = async () => { await api('/api/admin/moderate', { proposalId: x.id, approve: false, reason: el.querySelector('[data-why]').value }); toast('Declined; the resident is notified'); show('reports'); };
      $('#q').appendChild(el);
    }
  },

  // ---------- выплаты ----------
  async payouts() {
    const d = await api('/api/admin/payouts');
    const pr = d.prepared;
    $('#tab').innerHTML = `<div class="row2">
<div class="card"><h2>Next batch</h2>
  <p class="muted small">Daily cut-off 5:00 pm PT. Each batch is one PayPal Payouts request with an idempotent <code>sender_batch_id</code>, so a retry can never pay twice.</p>
  ${table(['Task', 'Resident', 'Wallet', '#Amount'], pr.ready.map((x) => `<tr><td>${h(x.taskId)}</td><td>${h(x.name)}</td><td class="small">${x.wallet === 'venmo' ? '<span class="venmo-word">venmo</span>' : '<span class="pp-word">Pay<i>Pal</i></span>'} ${h(x.receiver)}</td><td class="num money">${money(x.amount)}</td></tr>`), 'No approved deeds waiting.')}
  <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px"><b>Total ${money(pr.total)}</b>
  <button class="btn pp" id="send" ${pr.ready.length ? '' : 'disabled'}>Send ${pr.ready.length} payout${pr.ready.length === 1 ? '' : 's'} with PayPal</button></div>
  <p class="muted small">${d.receiverNote ? `Sandbox mode: every item is delivered to the sandbox test account <code>${h(d.receiverNote)}</code>; no real money moves.` : 'PayPal sandbox credentials are not configured.'}</p></div>
<div class="card"><h2>Held</h2><p class="muted small">Items are held, not dropped: they stay payable and go out in the first batch after the hold clears.</p>
  ${table(['Task', 'Resident', 'Reason', '#Amount'], pr.held.map((x) => `<tr><td>${h(x.taskId)}</td><td>${h(x.name)}</td><td class="small">${h(x.reason)}</td><td class="num money">${money(x.amount)}</td></tr>`), 'No holds.')}</div>
</div>
${pr.ready.length ? `<details class="card" style="margin-top:16px"><summary><b>Request to PayPal</b> <span class="muted small">POST /v1/payments/payouts — production form; in sandbox every item goes to the sandbox test account</span></summary>
<pre class="json">${h(JSON.stringify(d.preview, null, 2))}</pre></details>` : ''}
<h2 style="font-size:24px;margin-top:24px">Batches</h2><div id="batches"></div>`;
    $('#batches').innerHTML = d.batches.map((b) => {
      const total = b.items.reduce((s, i) => s + Number(i.amount), 0);
      const cnt = b.items.reduce((m, i) => ({ ...m, [i.status]: (m[i.status] || 0) + 1 }), {});
      const live = !String(b.payoutBatchId).startsWith('HIST');
      return `<details class="card" style="margin-bottom:10px"><summary style="display:flex;gap:12px;align-items:center;cursor:pointer;flex-wrap:wrap">
<b>${h(b.id)}</b><span class="muted small">PayPal ${h(b.payoutBatchId)}</span><span class="muted small">${dateTime(b.createdAt)} PT</span>
<span class="pill ${b.status}">${b.status}</span><span class="small">${Object.entries(cnt).map(([k, v]) => `${v} ${k}`).join(' · ')}</span>
<b class="money" style="margin-left:auto">${money(total)}</b>${live ? `<button class="btn sm" data-refresh="${h(b.id)}">Refresh status</button>` : ''}</summary>
${table(['Item', 'Resident', 'Task', 'Status', '#Amount'], b.items.map((i) => `<tr><td><code>${h(i.id)}</code></td><td>${h(i.residentId)}</td><td>${h(i.taskId || i.kind || '')}</td><td><span class="pill ${i.status}">${i.status}</span></td><td class="num money">${money(i.amount)}</td></tr>`))}</details>`;
    }).join('');
    $$('[data-refresh]').forEach((b) => (b.onclick = async (e) => {
      e.preventDefault();
      try { const r = await api(`/api/admin/payouts/${b.dataset.refresh}/refresh`, {}); toast(`PayPal says: ${r.batch.status}`); show('payouts'); } catch (err) { toast(err.message); }
    }));
    $('#send').onclick = async (e) => {
      e.target.disabled = true; e.target.textContent = 'Sending to PayPal…';
      try {
        const r = await api('/api/admin/payouts', {});
        toast(`PayPal accepted batch ${r.batch.payoutBatchId}`);
        await show('payouts');
        // Опрос статуса, пока PayPal не закончит обработку.
        for (let i = 0; i < 10; i += 1) {
          await sleep(4000);
          const s = await api(`/api/admin/payouts/${r.batch.id}/refresh`, {});
          if (!['PENDING', 'PROCESSING'].includes(s.batch.status)) { toast(`Batch ${s.batch.status}`); await show('payouts'); break; }
        }
      } catch (err) { toast(err.message); e.target.disabled = false; }
    };
  },

  // ---------- книга ----------
  async ledger() {
    const d = await api('/api/admin/ledger'); const b = d.balances;
    const sum = Object.values(b).reduce((s, v) => s + Number(v), 0);
    $('#tab').innerHTML = `<div class="kpis">${Object.entries(ACC).map(([k, v]) => `<div class="kpi"><b class="money">${money(b[k])}</b><span>${v}</span></div>`).join('')}</div>
<p class="small" style="margin:12px 0">${Math.abs(sum) < 0.005 ? '<span class="pill approved">Balanced</span> Debits equal credits across all accounts.' : `<span class="pill rejected">Out of balance by ${money(sum)}</span>`}
In transit must match PayPal items in PENDING / PROCESSING / UNCLAIMED / ONHOLD.</p>
${table(['#', 'When', 'Memo', 'Debit', 'Credit', 'Ref', '#Amount'], d.entries.map((e) => `<tr><td>${e.id}</td><td class="small">${dateTime(e.at)}</td><td>${h(e.memo)}</td><td class="small">${h(e.debit)}</td><td class="small">${h(e.credit)}</td><td class="small"><code>${h(e.ref)}</code></td><td class="num money">${money(e.amount)}</td></tr>`))}`;
  },

  // ---------- камеры ----------
  async cameras() {
    const cams = await api('/api/admin/cameras');
    $('#tab').innerHTML = `<div style="display:flex;gap:8px;margin-bottom:10px;flex-wrap:wrap"><input class="f" id="q" placeholder="Search camera ID or street" style="max-width:320px">
<select class="f" id="st" style="width:auto"><option value="">All statuses</option><option>online</option><option>maintenance</option><option>offline</option></select>
<select class="f" id="dd" style="width:auto"><option value="">All neighborhoods</option>${city.districts.map((x) => `<option value="${x.id}">${h(x.name)}</option>`).join('')}</select><span class="muted small" id="n" style="align-self:center"></span></div><div id="ct"></div>`;
    const draw = () => {
      const q = $('#q').value.toLowerCase(); const st = $('#st').value; const dd = $('#dd').value;
      const rows = cams.filter((c) => (!st || c.status === st) && (!dd || c.district === dd) && (!q || `${c.id} ${c.streets.join(' ')}`.toLowerCase().includes(q)));
      $('#n').textContent = `${rows.length} of ${cams.length} cameras`;
      $('#ct').innerHTML = table(['Camera', 'Location', 'Neighborhood', 'Status', 'Installed', 'Verification'], rows.slice(0, 150).map((c) => `<tr><td><b>${h(c.id)}</b></td><td>${h(c.streets[0])} &amp; ${h(c.streets[1])}</td><td>${h(D[c.district].name)}</td><td><span class="pill ${c.status}">${c.status}</span></td><td>${h(c.installed)}</td><td class="small">${c.spot ? 'Automatic (pixels + AI)' : 'Human review'}</td></tr>`))
        + (rows.length > 150 ? '<p class="muted small">Showing the first 150 — refine the search.</p>' : '');
    };
    ['#q', '#st', '#dd'].forEach((s) => ($(s).oninput = draw)); draw();
  },

  // ---------- жители ----------
  async residents() {
    const rs = await api('/api/admin/residents');
    $('#tab').innerHTML = table(['Resident', 'Neighborhood', 'PayPal', 'W-9', 'Joined', '#Deeds', '#Paid', '#Pending'], rs.sort((a, b) => Number(b.paid) - Number(a.paid)).map((r) => `<tr>
<td style="display:flex;gap:8px;align-items:center">${r.photo ? `<img src="${r.photo}" style="width:28px;height:28px;border-radius:50%;object-fit:cover">` : `<span class="ini" style="width:28px;height:28px;font-size:11px">${h(r.fullName.split(' ').map((x) => x[0]).join(''))}</span>`}<b>${h(r.fullName)}</b></td>
<td>${h(D[r.district].name)}</td><td class="small">${h(r.paypal)}</td><td><span class="pill ${r.w9 === 'on_file' ? 'approved' : 'pending'}">${r.w9.replace('_', ' ')}</span></td><td>${date(r.joined)}</td>
<td class="num">${r.deeds}</td><td class="num money">${money(r.paid)}</td><td class="num money">${money(Number(r.pending) + Number(r.inTransit))}</td></tr>`));
  },

  // ---------- webhooks ----------
  async webhooks() {
    const ws = await api('/api/admin/webhooks');
    $('#tab').innerHTML = `<div class="demo-note" style="margin-bottom:12px">Endpoint <code>POST /api/webhooks/paypal</code> receives <code>PAYMENT.PAYOUTS-ITEM.*</code> and <code>PAYMENT.PAYOUTSBATCH.*</code> events.
Events are logged but never change a payout status until the signature is verified with PayPal (<code>verify-webhook-signature</code>); statuses come from polling the Payouts API.</div>
${table(['Received', 'Event', 'Resource', 'Signature', 'Note'], ws.map((w) => `<tr><td class="small">${dateTime(w.at)}</td><td><code>${h(w.event)}</code></td><td class="small"><code>${h(w.resource || '')}</code></td><td><span class="pill ${w.verified ? 'approved' : 'pending'}">${w.verified ? 'verified' : 'not verified'}</span></td><td class="small">${h(w.note)}</td></tr>`), 'No webhook events received yet.')}`;
  },

  // ---------- журнал ----------
  async audit() {
    const a = await api('/api/admin/audit');
    $('#tab').innerHTML = table(['When', 'Who', 'Action', 'Details'], a.map((x) => `<tr><td class="small">${dateTime(x.at)}</td><td><b>${h(x.actor)}</b></td><td>${h(x.action)}</td><td class="small">${h(x.detail || '')}</td></tr>`), 'No actions recorded since the last reset.');
  },

  // ---------- настройки ----------
  async settings() {
    const s = await api('/api/admin/settings');
    const F = [['monthlyBudget', 'Monthly program budget (USD)', 'number'], ['maxReward', 'Maximum reward per task (USD)', 'number'], ['dailyCutoff', 'Daily payout cut-off', 'text'],
      ['claimHoldHours', 'How long a claim reserves a task (hours)', 'number'], ['w9ThresholdYear', 'Ask for Form W-9 above (USD per calendar year)', 'number'], ['unclaimedDays', 'Unclaimed payouts return after (days, set by PayPal)', 'number']];
    $('#tab').innerHTML = `<div class="card" style="max-width:640px">${F.map(([k, l, t]) => `<label class="f">${l}</label><input class="f" data-k="${k}" type="${t}" value="${h(s[k])}" ${k === 'unclaimedDays' ? 'disabled' : ''}>`).join('')}
<p class="muted small">The W-9 threshold is a program policy, not tax advice; the city’s finance office sets it. Currency: ${h(s.payoutCurrency)}.</p>
<button class="btn primary" id="save">Save settings</button></div>`;
    $('#save').onclick = async () => {
      const patch = {}; $$('[data-k]').forEach((i) => { if (!i.disabled) patch[i.dataset.k] = i.type === 'number' ? Number(i.value) : i.value; });
      await api('/api/admin/settings', patch); toast('Settings saved — recorded in the audit log');
    };
  },
};

show(tab);
