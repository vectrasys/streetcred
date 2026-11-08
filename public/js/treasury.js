import { $, h, money, dateTime, api, chrome } from './common.js';
const user = await chrome('admin');
if (!user || user.role !== 'admin') { location.replace('/signin.html?next=/treasury.html'); await new Promise(() => {}); }
const ENDPOINTS = ['overview', 'tasks', 'payouts', 'ledger'];
const STATUS = { SUCCESS: 'Delivered', PENDING: 'Pending', PROCESSING: 'Processing', UNCLAIMED: 'Unclaimed', ONHOLD: 'On hold', RETURNED: 'Returned', FAILED: 'Failed', DENIED: 'Denied', ready: 'Ready for batch', held: 'Held before sending', claimed: 'Claimed', in_review: 'In review', approved: 'Approved, not sent', paid: 'Sent to payout batch', rejected: 'Not approved', open: 'Open', completed: 'Completed' };
const REASONS = { SUCCESS: 'PayPal item status confirms delivery.', PENDING: 'Accepted by PayPal; delivery is not confirmed.', PROCESSING: 'PayPal is processing this item.', UNCLAIMED: 'Recipient has not claimed the payout; check the destination in the admin payout records.', ONHOLD: 'PayPal has placed this item on hold.', RETURNED: 'Returned to the program; this is not a delivered reward.', FAILED: 'Delivery failed; inspect the payout record before any reissue.', DENIED: 'PayPal denied this item; inspect the payout record.' };
const attention = new Set(['UNCLAIMED', 'ONHOLD', 'RETURNED', 'FAILED', 'DENIED', 'held']);
let data, grid, view = 'payouts', filtered = [], status = '', query = '', onlyAttention = false, page = 0, model;
const pageSize = 12;
let selectedId = null;
const safe = (value) => /^[=+\-@\t\r]/.test(String(value ?? '')) ? `'${value}` : value;
function pill(value) { return `<span class="tr-status ${['SUCCESS', 'approved'].includes(value) ? 'good' : attention.has(value) ? 'alert' : ''}">${h(STATUS[value] || value)}</span>`; }
function rowReason(row) { if (row.provenance === 'Seeded historical fixture') return `Seeded fixture status: ${STATUS[row.status] || row.status}. This example is not proof of an executed PayPal payout or recipient delivery.`; return row.reason || REASONS[row.status] || (row.status === 'ready' ? 'Approved and eligible for the next batch; not yet sent.' : row.status === 'in_review' ? 'Human review is still pending; no reward is approved yet.' : row.status === 'claimed' ? 'Work has been claimed; completion is not yet confirmed.' : row.status === 'approved' ? 'Approved work; see the payout queue for eligibility and any hold.' : row.status === 'paid' ? 'Task status means sent, not necessarily delivered. Match its payout item status.' : row.status === 'rejected' ? 'Work was not approved. No approved reward is inferred.' : 'Source record; no additional delivery conclusion.'); }
function rowsFor(kind) {
  if (kind === 'tasks') return data.tasks.map(t => ({ id: t.id, task: t.title, resident: t.claimedBy?.name || 'Unclaimed', status: t.status, amount: Number(t.reward), location: t.address, reason: t.verification?.reason, provenance: 'Sample program data; task provenance not supplied by API', source: '/api/admin/tasks' }));
  if (kind === 'ledger') return data.ledger.entries.map(e => ({ id: String(e.id), date: e.at, task: e.memo, status: 'ledger', amount: Number(e.amount), debit: e.debit, credit: e.credit, reference: e.ref, provenance: 'Sample program ledger; per-entry provenance not supplied by API', source: '/api/admin/ledger' }));
  const batches = data.payouts.batches.flatMap(b => b.items.map(i => ({ id: i.id, task: i.taskId || i.kind || 'Historical reward', resident: i.residentId, status: i.status, amount: Number(i.amount), date: b.createdAt, batch: b.id, reference: b.payoutBatchId, wallet: i.wallet, provenance: String(b.payoutBatchId).startsWith('HIST') ? 'Seeded historical fixture' : 'Recorded program batch; not independently verified here', source: '/api/admin/payouts' })));
  return [...data.payouts.prepared.held.map(i => ({ ...i, id: `held:${i.taskId}`, task: i.taskId, resident: i.name, status: 'held', amount: Number(i.amount), source: '/api/admin/payouts · prepared.held' })), ...data.payouts.prepared.ready.map(i => ({ id: `ready:${i.taskId}`, task: i.taskId, resident: i.name, status: 'ready', amount: Number(i.amount), wallet: i.wallet, source: '/api/admin/payouts · prepared.ready' })), ...batches];
}
function columns() {
  const text = (field, headerName, extra = {}) => ({ field, headerName, filter: 'agTextColumnFilter', ...extra });
  const cols = [text('id', 'Record', { minWidth: 165 }), text('task', view === 'ledger' ? 'Memo' : 'Work / task', { minWidth: 230, flex: 2 })];
  if (view !== 'ledger') cols.push(text('resident', 'Resident'), text('status', 'Status', { minWidth: 170, valueFormatter: p => STATUS[p.value] || p.value, cellRenderer: p => pill(p.value) }));
  else cols.push(text('debit', 'Debit'), text('credit', 'Credit'));
  cols.push({ field: 'amount', headerName: view === 'tasks' ? 'Reward offered' : 'Amount', filter: 'agNumberColumnFilter', type: 'numericColumn', minWidth: 120, valueFormatter: p => money(p.value) });
  cols.push(text('reference', 'Reference', { hide: view !== 'ledger' }), text('source', 'Source', { hide: true, minWidth: 200 }), text('provenance', 'Provenance', { hide: true, minWidth: 220 }));
  return cols;
}
async function load() {
  const result = await Promise.allSettled(ENDPOINTS.map(x => api(`/api/admin/${x}`)));
  const failures = result.flatMap((r, i) => r.status === 'rejected' ? [`${ENDPOINTS[i]}: ${r.reason.message}`] : []);
  if (failures.length) { $('#treasury').innerHTML = `<section class="tr-error" role="alert"><h1>Records could not be loaded</h1><p>${h(failures.join(' · '))}</p><button class="btn" id="retry">Try again</button><a href="/admin.html">Back to admin</a></section>`; $('#retry').onclick = load; return; }
  data = Object.fromEntries(result.map((r, i) => [ENDPOINTS[i], r.value]));
  try { model = await api('/api/admin/copilot'); } catch (e) { model = { model: null, error: e.message }; }
  render();
}
function render() {
  grid?.destroy();
  const ov = data.overview, b = ov.balances, spend = Number(ov.monthSpend), budget = Number(ov.budget), pct = budget > 0 ? spend / budget * 100 : 0;
  const confirmed = data.tasks.filter(t => ['approved', 'paid', 'completed'].includes(t.status)).length;
  const all = rowsFor('payouts'); const exceptions = all.filter(r => attention.has(r.status));
  const totalBalance = Object.values(data.ledger.balances).reduce((a, v) => a + Number(v), 0);
  $('#treasury').innerHTML = `<div class="tr-heading"><div><div class="eyebrow">Program operations / Treasury</div><h1>Good work.<br><em>Clear accounts.</em></h1><p class="muted">Track approval, delivery and the records behind every reward.</p></div><div class="tr-head-meta"><span class="tr-status">Seeded program example · no real payouts</span><p id="source-time" class="small muted">Loaded ${h(dateTime(Date.now()))} PT</p><button class="btn sm" id="reload">Reload records</button><a class="btn sm" href="/admin.html">Program admin ↗</a></div></div>
<div class="tr-provenance" role="note"><b>Sample program data, not proof of payment.</b> Historical payouts and opening ledger entries are seeded examples. This dashboard does not check delivery with PayPal. Recorded sandbox evidence is separate from these example totals.</div>
<section class="tr-widgets" aria-label="Program snapshot">
  <article class="tr-budget"><div class="eyebrow">This month · sample program spend</div><div class="tr-budget-number">${money(spend)} <span>of ${money(budget)}</span></div><div class="tr-track" role="progressbar" aria-label="Monthly budget used" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.min(100, Math.max(0, pct))}" aria-valuetext="${pct.toFixed(1)} percent of monthly budget"><i style="width:${Math.min(100, Math.max(0, pct))}%"></i></div><p>${budget > 0 ? `${pct.toFixed(1)}% used · ${money(Math.max(0, budget - spend))} remaining${spend > budget ? ` · ${money(spend - budget)} over budget` : ''}` : 'No positive monthly budget configured'}</p><span class="small muted">Approval commits budget; delivery is tracked separately.</span></article>
  <article class="tr-stat"><span>Delivered rewards (sample records)</span><strong class="tr-green">${money(b.paid_out)}</strong><small>Ledger · paid_out</small></article>
  <article class="tr-stat"><span>Approved, not sent (program records)</span><strong>${money(b.payable)}</strong><small>${data.payouts.prepared.ready.length} ready · ${data.payouts.prepared.held.length} held</small></article>
  <article class="tr-stat"><span>Confirmed work (sample program)</span><strong>${confirmed}</strong><small>Current tasks approved / sent / completed; not lifetime totals</small></article>
</section>
<div class="tr-workspace"><section class="tr-records" aria-labelledby="records-heading"><div class="tr-section-head"><div><div class="eyebrow">Follow the reward</div><h2 id="records-heading">Treasury records</h2></div><span class="tr-status ${Math.abs(totalBalance) < .005 ? 'good' : 'alert'}">${Math.abs(totalBalance) < .005 ? 'Ledger balanced' : `Ledger difference ${money(totalBalance)}`}</span></div>
<div class="tr-mini"><button id="attention" aria-pressed="false"><b>${exceptions.length}</b><span>Need attention</span></button><div><b>${money(b.in_transit)}</b><span>In transit · ledger</span></div><div><b>${ov.counts.review}</b><span>Work in review</span></div></div>
<div class="tr-view" role="group" aria-label="Record category">${[['payouts','Rewards & payouts'],['tasks','Work'],['ledger','Ledger']].map(([id,label]) => `<button data-view="${id}" aria-pressed="${view === id}">${label}</button>`).join('')}</div>
<div class="tr-controls"><label>Search records<input type="search" id="search" placeholder="Task, resident, payout ID…"></label><label>Status<select id="status"></select></label><button class="btn sm" id="clear">Clear filters</button><button class="btn sm" id="export">Export CSV</button><details class="tr-columns"><summary>Columns</summary><div id="column-list"></div></details></div>
<div class="tr-result"><span id="row-count" role="status"></span><span class="small muted" id="limit-note"></span></div>
<div id="treasury-grid" aria-label="Treasury records grid"></div><div id="treasury-cards" aria-label="Treasury record cards"></div><div class="tr-mobile-pages"><button class="btn sm" id="previous">Previous</button><span id="page-count"></span><button class="btn sm" id="next">Next</button></div>
<section id="record-detail" class="tr-detail" aria-label="Selected record"><p class="muted">Select a row or “View evidence” to inspect its source and status.</p></section>
<p class="tr-footnote">Local AG Grid Community 36.2.0 · MIT · CSV, sorting and column filters. No Enterprise, AG Studio or Agent Framework.</p></section>
<aside class="tr-aside"><section class="tr-analysis"><div class="eyebrow">Rule analysis · not an AI response</div><h2>Why haven’t rewards arrived?</h2><p class="small muted">Deterministic breakdown of sample program records, including seeded history. Not a live PayPal status check or delivery evidence.</p><div id="breakdown"></div></section>
<section class="tr-copilot"><div class="eyebrow">Treasury Copilot</div><h2>Ask about the evidence</h2><p class="small muted" id="model-status">${h(model.model || 'No model configured')}${model.error ? ` · ${h(model.error)}` : ''}</p><form id="copilot-form"><label class="tr-question">Your question<textarea id="question" maxlength="2000" rows="3">Why haven’t these rewards arrived?</textarea></label><button class="btn primary" id="ask" ${!model.model ? 'disabled' : ''}>Ask Copilot · read only</button></form><div id="answer" role="status"><p class="small muted">The model can read local program records only. No PayPal lookups, proposals or payment operations are available in this panel. Historical records may be seeded examples.</p></div><a class="tr-approval-link" href="/admin.html?tab=copilot">Open admin Copilot for approvals ↗</a></section></aside></div>`;
  $('#reload').onclick = load;
  const theme = agGrid.themeQuartz.withParams({ backgroundColor: '#fbf9f4', foregroundColor: '#191917', borderColor: '#e2ddd2', headerBackgroundColor: '#f0ece2', accentColor: '#e2492f', fontFamily: 'Geist, sans-serif', fontSize: 13, headerFontWeight: 600, rowBorder: true, wrapperBorderRadius: 12 });
  grid = agGrid.createGrid($('#treasury-grid'), { theme, columnDefs: columns(), rowData: [], defaultColDef: { sortable: true, resizable: true, minWidth: 135, flex: 1 }, pagination: true, paginationPageSize: 20, paginationPageSizeSelector: [20,50,100], rowHeight: 48, headerHeight: 42, getRowId: p => p.data.id, onRowClicked: e => detail(e.data), onCellKeyDown: e => { if (e.event.key === 'Enter') detail(e.data); }, onFilterChanged: syncCards, onSortChanged: syncCards, suppressCellFocus: false });
  document.querySelectorAll('[data-view]').forEach(button => button.onclick = () => { view = button.dataset.view; status = ''; query = ''; onlyAttention = false; selectedId = null; page = 0; render(); });
  $('#search').oninput = () => { query = $('#search').value; page = 0; apply(); };
  $('#status').onchange = () => { status = $('#status').value; page = 0; apply(); };
  $('#attention').onclick = () => { view = 'payouts'; onlyAttention = !onlyAttention; status = ''; query = ''; page = 0; grid.setGridOption('columnDefs', columns()); setupControls(); apply(); document.querySelectorAll('[data-view]').forEach(btn => btn.setAttribute('aria-pressed', String(btn.dataset.view === view))); };
  $('#clear').onclick = () => { status = ''; query = ''; onlyAttention = false; page = 0; $('#search').value = ''; $('#status').value = ''; grid.setFilterModel(null); apply(); };
  $('#export').onclick = () => grid.exportDataAsCsv({ fileName: `city-proof-${view}.csv`, allColumns: true, processCellCallback: p => safe(p.column.getColId() === 'amount' ? p.value : p.column.getColId() === 'status' ? STATUS[p.value] || p.value : p.value) });
  $('#previous').onclick = () => { page = Math.max(0,page-1); syncCards(); };
  $('#next').onclick = () => { page++; syncCards(); };
  $('#copilot-form').onsubmit = event => { event.preventDefault(); ask(); };
  setupControls(); breakdown(); apply();
}
function setupControls() {
  $('#search').value = query;
  $('#status').innerHTML = '<option value="">All statuses</option>' + [...new Set(rowsFor(view).map(r => r.status))].sort().map(s => `<option value="${h(s)}">${h(STATUS[s] || s)}</option>`).join('');
  $('#status').value = status; $('#status').disabled = view === 'ledger';
  $('#column-list').innerHTML = columns().map(c => `<label><input type="checkbox" data-column="${c.field}" ${c.hide ? '' : 'checked'}>${h(c.headerName)}</label>`).join('');
  document.querySelectorAll('[data-column]').forEach(input => input.onchange = () => { grid.setColumnsVisible([input.dataset.column], input.checked); });
  $('#limit-note').textContent = view === 'ledger' ? 'Latest 300 entries at most; balances cover the full ledger.' : 'Current loaded snapshot; no automatic polling.';
}
function apply() {
  filtered = rowsFor(view).filter(r => (!status || r.status === status) && (!onlyAttention || attention.has(r.status)) && (!query || Object.values(r).join(' ').toLowerCase().includes(query.toLowerCase())));
  $('#attention').setAttribute('aria-pressed',String(onlyAttention)); grid.setGridOption('rowData', filtered); syncCards();
  if (selectedId && !filtered.some(r => r.id === selectedId)) { selectedId = null; $('#record-detail').innerHTML = '<p class="muted">Selection cleared because this record is outside the filter.</p>'; }
}
function syncCards() {
  if (!grid) return;
  const rows = []; grid.forEachNodeAfterFilterAndSort(n => rows.push(n.data));
  $('#row-count').textContent = `${rows.length} of ${rowsFor(view).length} records · ${money(rows.reduce((a,r) => a+r.amount,0))}${view === 'tasks' ? ' offered rewards' : view === 'ledger' ? ' entry amounts (not net spend)' : ' recorded amounts'}`;
  const pages = Math.max(1, Math.ceil(rows.length/pageSize)); page = Math.min(page,pages-1);
  $('#treasury-cards').innerHTML = rows.slice(page*pageSize,(page+1)*pageSize).map(r => `<article class="tr-mobile-card"><div class="tr-card-head"><b>${h(r.id)}</b>${view === 'ledger' ? '' : pill(r.status)}</div><h3>${h(r.task)}</h3><dl>${view === 'ledger' ? `<dt>Debit</dt><dd>${h(r.debit)}</dd><dt>Credit</dt><dd>${h(r.credit)}</dd>` : `<dt>Resident</dt><dd>${h(r.resident)}</dd>`}<dt>${view === 'tasks' ? 'Offered reward' : 'Amount'}</dt><dd>${money(r.amount)}</dd>${r.reference ? `<dt>Reference</dt><dd>${h(r.reference)}</dd>` : ''}</dl><button class="btn sm" data-record="${h(r.id)}">View evidence</button></article>`).join('') || '<p class="tr-empty">No records match these filters. Clear filters to see the full snapshot.</p>';
  document.querySelectorAll('[data-record]').forEach(btn => btn.onclick = () => detail(rows.find(r=>r.id===btn.dataset.record)));
  $('#page-count').textContent = `${page+1} / ${pages}`; $('#previous').disabled = page === 0; $('#next').disabled = page+1 >= pages;
}
function detail(row) {
  selectedId = row.id;
  $('#record-detail').innerHTML = `<div class="eyebrow">Source evidence</div><h3>${h(row.id)}</h3>${view === 'ledger' ? `<p>${h(row.task)} · ${h(row.debit)} → ${h(row.credit)}</p>` : `${pill(row.status)}<p>${h(rowReason(row))}</p>`}<dl><dt>Source</dt><dd><code>${h(row.source)}</code></dd><dt>Provenance</dt><dd>${h(row.provenance || 'Sample program data; source endpoint does not provide per-record provenance')}</dd><dt>Amount</dt><dd>${money(row.amount)}${view === 'tasks' ? ' offered; not confirmed delivery' : ''}</dd>${row.batch ? `<dt>City batch</dt><dd>${h(row.batch)}</dd>` : ''}${row.reference ? `<dt>Reference</dt><dd>${h(row.reference)}</dd>` : ''}${row.date ? `<dt>Recorded</dt><dd>${h(dateTime(row.date))} PT</dd>` : ''}</dl>`;
  if (matchMedia('(max-width: 700px)').matches) $('#record-detail').scrollIntoView({behavior:'smooth',block:'start'});
}
function breakdown() {
  const rows = rowsFor('payouts');
  const groups = [['held','Held before sending'],['ready','Approved, waiting for batch'],['PENDING','PayPal pending'],['PROCESSING','PayPal processing'],['UNCLAIMED','Unclaimed by recipient'],['ONHOLD','PayPal on hold'],['RETURNED','Returned'],['FAILED','Failed'],['DENIED','Denied']];
  $('#breakdown').innerHTML = groups.map(([s,label]) => { const list = rows.filter(r=>r.status===s); return list.length ? `<button class="tr-reason" data-reason="${s}"><span>${h(label)}</span><b>${list.length} · ${money(list.reduce((a,r)=>a+r.amount,0))}</b><small>${h(list.every(r=>r.provenance === 'Seeded historical fixture') ? 'Seeded example statuses; not verified PayPal delivery.' : list[0].reason || REASONS[s] || 'Approved; not yet sent to PayPal.')}</small></button>` : ''; }).join('') || '<p>No pending or exception payouts in the loaded snapshot.</p>';
  document.querySelectorAll('[data-reason]').forEach(btn=>btn.onclick=()=>{ view='payouts'; status=btn.dataset.reason; query=''; onlyAttention=false; page=0; grid.setGridOption('columnDefs',columns()); setupControls(); apply(); document.querySelectorAll('[data-view]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.view===view))); });
}
// Escapes source text before adding a small allowlist of presentation tags.
// Raw HTML, links, images and embedded content are never interpreted.
function basicMarkdown(text) {
  const inline = value => h(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const blocks = []; let paragraph = []; let list = []; let listType = '';
  const flushParagraph = () => { if (paragraph.length) blocks.push(`<p>${inline(paragraph.join(' '))}</p>`); paragraph = []; };
  const flushList = () => { if (list.length) blocks.push(`<${listType}>${list.map(line => `<li>${inline(line)}</li>`).join('')}</${listType}>`); list = []; listType = ''; };
  for (const line of text.split(/\r?\n/)) {
    const item = line.match(/^\s*(?:([-*]) |(\d+)\. )(.*)$/);
    if (item) { flushParagraph(); const type = item[2] ? 'ol' : 'ul'; if (listType && listType !== type) flushList(); listType = type; list.push(item[3]); }
    else { flushList(); if (!line.trim()) flushParagraph(); else paragraph.push(line.trim()); }
  }
  flushList(); flushParagraph(); return blocks.join('');
}
export function renderCopilotAnswer(r) {
  const text = r.text || 'The model returned no answer.';
  const plain = text.replace(/\*\*|`/g, '').replace(/^\s*[-*]\s+/gm, '').replace(/\s+/g, ' ').trim();
  const preview = plain.length > 190 ? `${plain.slice(0, 190).replace(/\s+\S*$/, '')}…` : plain;
  $('#answer').innerHTML = `<div class="eyebrow">Model interpretation · read-only local records</div><p class="small muted">${h(r.model)} · not independently verified PayPal delivery</p>${!r.steps?.length ? '<p class="tr-unverified">No source lookups reported. This is an unverified model interpretation.</p>' : ''}<p class="tr-answer-preview">${h(preview)}</p><details class="tr-full-explanation"><summary>Read full explanation</summary><div class="tr-answer-text" tabindex="0" role="region" aria-label="Full model explanation">${basicMarkdown(text)}</div></details><div class="tr-snapshot-check"><b>Local snapshot check · not model output</b><p>HIST-prefixed items are seeded fixtures, not executed sandbox payouts.</p>${['RETURNED','UNCLAIMED','ONHOLD','FAILED','DENIED','PENDING','PROCESSING'].map(status => { const rows = rowsFor('payouts').filter(row => row.status === status); return rows.length ? `<p>${h(STATUS[status])}: ${rows.length} items · ${money(rows.reduce((sum,row)=>sum+row.amount,0))}</p>` : ''; }).join('')}<p>Check any model totals or delivery claims against these source records.</p></div><details class="tr-model-sources"><summary>Source lookups (${r.steps?.length || 0})</summary>${(r.steps || []).map(step => `<div><b>${h(step.tool)}</b><code>${h(JSON.stringify(step.args || {}))}</code></div>`).join('') || '<p>No source tools were reported by the model.</p>'}</details>`;
}
async function ask() {
  const question = $('#question').value.trim();
  const snapshotGroups = Object.entries(rowsFor('payouts').reduce((groups, row) => { const group = groups[row.status] ||= { count: 0, amount: 0 }; group.count++; group.amount += row.amount; return groups; }, {}));
  const summary = snapshotGroups.map(([status, group]) => `${status}: ${group.count} items, ${money(group.amount)}`).join('; ');
  if (!question || !model.model) return;
  $('#ask').disabled = true; $('#answer').innerHTML = '<p>Reading local records with the configured model…</p>';
  try {
    const r = await api('/api/admin/copilot', { readOnly: true, messages: [{ role: 'user', content: question + `\nSource cross-check from loaded /api/admin/payouts: ${summary}. Keep distinct status counts separate. Verify against your tools. All HIST-prefixed records are seeded fixtures; explicitly say this in the answer.` + '\nThis is a SEEDED PROGRAM EXAMPLE, not executed PayPal payouts. HIST batch references mean seeded fixtures. Group payout exceptions strictly by each item.status; the exceptions total combines different statuses and must not be called the Returned total. Do not recommend initiating payment operations.' + '\nBefore answering, call program_overview, next_payout_batch and payout_exceptions. Use the returned exact item IDs, amounts, statuses and hold reasons. Explain each distinct blocker separately. Do not answer using context alone.' + `\nDashboard snapshot: ${rowsFor('payouts').filter(row => row.provenance === 'Seeded historical fixture').length} historical payout items have HIST-prefixed batch references and are seeded examples, not executed PayPal payments.` + '\nDistinguish seeded historical fixtures from executed sandbox evidence. Do not describe seeded SUCCESS records as verified PayPal deliveries. Use exact record IDs and amounts.' }] });
    if (r.readOnly !== true || r.proposals?.length) throw new Error('The server did not confirm the read-only contract. No result is displayed.');
    renderCopilotAnswer(r);
  } catch (e) { $('#answer').innerHTML = `<p role="alert">Model request failed: ${h(e.message)}</p><p class="small muted">Rule analysis remains separate and is not a model answer.</p>`; }
  finally { $('#ask').disabled = !model.model; }
}
load().catch(e=>{$('#treasury').innerHTML=`<p role="alert">Treasury could not initialize: ${h(e.message)}</p>`;});
