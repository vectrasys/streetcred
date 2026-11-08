// Общее для всех страниц: шапка, подвал, сессия, запросы, форматирование.
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];
export const h = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const money = (v) => `${Number(v) < 0 ? '−' : ''}$${Math.abs(Number(v)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const PT = { timeZone: 'America/Los_Angeles' };
export const date = (t) => new Date(t).toLocaleDateString('en-US', { ...PT, month: 'short', day: 'numeric', year: 'numeric' });
export const dateTime = (t) => new Date(t).toLocaleString('en-US', { ...PT, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
export const ago = (t) => {
  const m = Math.round((Date.now() - t) / 60000);
  if (m < 60) return `${Math.max(1, m)} min ago`;
  const hr = Math.round(m / 60);
  return hr < 48 ? `${hr} h ago` : `${Math.round(hr / 24)} days ago`;
};

export async function api(path, body) {
  const res = await fetch(path, body === undefined ? { credentials: 'same-origin' }
    : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || `HTTP ${res.status}`), { status: res.status });
  return data;
}

export function toast(text) {
  const t = document.createElement('div'); t.className = 'toast'; t.textContent = text;
  document.body.appendChild(t); setTimeout(() => t.remove(), 3200);
}

export function modal(html, onMount) {
  const bg = document.createElement('div'); bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { bg.remove(); removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  bg.addEventListener('click', (e) => { if (e.target === bg) close(); });
  addEventListener('keydown', esc);
  document.body.appendChild(bg);
  bg.querySelector('button, a, input, select, textarea')?.focus();
  if (onMount) onMount(bg.firstElementChild, close);
  return close;
}

export async function chrome(active) {
  let user = null;
  try { user = (await api('/api/session')).user; } catch { /* гость */ }
  const nav = [['/', 'Map', 'map'], ['/demo.html', 'Demo', 'demo'], ['/how.html', 'How it works', 'how'], ['/pilot.html', 'Pilot', 'pilot'], ['/heroes.html', 'Heroes', 'heroes'], ['/about.html', 'Demo city', 'about']];
  if (user && user.role === 'resident') nav.push(['/account.html', 'My account', 'account']);
  if (user && user.role === 'admin') nav.push(['/admin.html', 'Admin', 'admin']);
  document.body.insertAdjacentHTML('afterbegin', `
<header class="site"><div class="wrap">
  <a class="brand" href="/" aria-label="StreetCred — Good deeds. Real credit. Port Calloway demo city"><img class="mark" src="/img/streetcred-mark.svg" alt="" width="28" height="28"><span class="t1">StreetCred</span><span class="t2">Good deeds. Real credit.</span></a>
  <button class="navtoggle" aria-expanded="false" aria-controls="mainnav" aria-label="Menu"><span></span><span></span></button>
  <nav class="main" id="mainnav">${nav.map(([href, label, id]) => `<a href="${href}" class="${id === active ? 'on' : ''}">${label}</a>`).join('')}</nav>
  <div class="who">${user ? `${user.photo ? `<img src="${user.photo}" alt="">` : ''}<span class="hide-sm">${h(user.name)}</span><button class="btn sm" id="signout">Sign out</button>`
    : '<a class="btn sm primary" href="/signin.html">Sign in</a>'}</div>
</div></header>`);
  const tg = document.querySelector('.navtoggle');
  tg.onclick = () => { const open = tg.getAttribute('aria-expanded') !== 'true'; tg.setAttribute('aria-expanded', String(open)); document.querySelector('header.site').classList.toggle('navopen', open); };
  if (active === 'map') return finish(user);
  document.body.insertAdjacentHTML('beforeend', `
<footer class="site"><div class="wrap">
  <div><div class="big">Good deeds.<br><em style="color:var(--accent)">Real credit.</em></div>
  StreetCred — civic rewards verified by city cameras. ${DEMO_BADGE} Shown in Port Calloway, a fictional demo city (300 Mission Plaza, CA&nbsp;93940 · (555) 014-2049).<br>
  Cameras verify the deed, not the face: no facial recognition, no faces stored.</div>
  <div><div class="pplock" style="display:flex;margin-bottom:12px">Payments powered by <span class="pp-word">Pay<i>Pal</i></span></div><b>Program</b><br><a href="/how.html">How it works</a><br><a href="/how.html#payments">Payments &amp; taxes</a><br><a href="/how.html#privacy">Camera privacy</a><br><a href="/heroes.html">Heroes</a></div>
  <div><b>City</b><br><a href="/about.html">History &amp; neighborhoods</a><br><a href="/how.html#faq">FAQ</a><br><a href="/how.html#terms">Program terms</a></div>
</div><div class="legal">Demo for the PayPal AI Hackathon. Port Calloway, its residents and this program are fictional; payouts run in the PayPal sandbox with no real money.
Map data © OpenStreetMap contributors (ODbL), geometry only — all names are fictional. Camera frames: CC0 photo and AI-generated images (FLUX.1-schnell); portraits are AI-generated.</div></footer>`);
  return finish(user);
}
function finish(user) {
  const so = document.getElementById('signout');
  if (so) so.onclick = async () => { await api('/api/logout', {}); location.href = '/'; };
  return user;
}

// Пометка демо-данных: засеянные суммы, счётчики и примеры — не реальные выплаты.
export const DEMO_BADGE = '<span class="demo-badge" title="Seeded sample data for the fictional demo city — not real payouts">Demo data</span>';

/**
 * Единые статусы для выплат и заданий. Payout completed — только запись sandbox с SUCCESS;
 * засеянная история (seeded_sample) — пример, а не выплата PayPal.
 */
export function payoutState(x = {}) {
  const s = String(x.status || '');
  if (x.source === 'seeded_sample') return { key: 'sample', label: s === 'SUCCESS' ? 'Sample payout (demo data)' : `Sample: ${s.toLowerCase()} (demo data)`, cls: 'st-sample' };
  // «Completed» — только при подтверждённом источнике (запись sandbox-пакета). Без источника — не утверждаем.
  if (s === 'SUCCESS') return x.source === 'sandbox_record' ? { key: 'payout_completed', label: 'Payout completed', cls: 'st-completed' }
    : { key: 'payout_recorded', label: 'Recorded SUCCESS · source unknown', cls: 'st-pending' };
  if (['PENDING', 'PROCESSING', 'UNCLAIMED', 'ONHOLD'].includes(s)) return { key: 'payout_pending', label: 'Payout pending', cls: 'st-pending' };
  if (['RETURNED', 'FAILED', 'DENIED', 'BLOCKED'].includes(s)) return { key: 'payout_problem', label: `Payout ${s.toLowerCase()}`, cls: 'st-problem' };
  if (s === 'approved') return { key: 'reward_approved', label: 'Reward approved', cls: 'st-approved' };
  if (s === 'paid') return { key: 'payout_pending', label: 'Payout pending', cls: 'st-pending' };
  if (s === 'in_review') return { key: 'proof_review', label: 'Proof in review', cls: 'st-review' };
  if (s === 'completed') return { key: 'sample', label: 'Sample: completed (demo data)', cls: 'st-sample' };
  if (s === 'claimed') return { key: 'claimed', label: 'Claimed', cls: 'st-claimed' };
  if (s === 'open') return { key: 'open', label: 'Open', cls: 'st-open' };
  return { key: s || 'unknown', label: s || 'Unknown', cls: 'st-claimed' };
}
/** Подтверждение доказательства (результат проверки камерой и моделью или проверяющим). */
export const proofState = (v) => (v && v.status === 'approved' ? { key: 'proof_confirmed', label: 'Proof confirmed', cls: 'st-proof' } : null);
export const stateBadge = (st) => `<span class="st ${st.cls}">${h(st.label)}</span>`;

// Кадры — статичные демо-снимки (фото CC0 и FLUX), не трансляция: так и подписано.
export const DEMO_TAG = '<div class="demotag">Demo camera frame</div>';

/** Кадр камеры с наложением OSD. Для мест с парой кадров — живой SVG-кадр. */
export function camView(cam, { frame, district } = {}) {
  const src = cam.spot ? `/api/frame?spot=${cam.spot}&t=${Date.now()}` : frame ? `/img/tasks/${frame}.jpg` : `/img/views/${cam.view}.jpg`;
  const off = cam.status !== 'online';
  return `<div class="camview ${cam.mirror && !cam.spot && !frame ? 'mirror' : ''}">
${off ? `<div class="off">${cam.status === 'maintenance' ? 'MAINTENANCE' : 'NO SIGNAL'}</div>` : `<img alt="Demo camera frame, ${h(cam.id)}" loading="lazy" src="${src}" onerror="this.style.opacity=.15">`}
<div class="grain"></div><div class="osd"><span>${h(cam.id)} · ${h(cam.streets[0]).toUpperCase()}</span><span>${h(district || '')}</span></div>${off ? '' : DEMO_TAG}</div>`;
}
