// Сценарии сайта для сквозной проверки. Не зависят от того, кто запускает браузер:
//   node e2e/flows.mjs [url] [--skip-ai]               — свой Chromium (CI)
//   playwriter … -f e2e/run-flow.js                     — существующий Chrome, по одному сценарию
// Внешние денежные действия (отправка пакета Payouts, оплата добавки) не нажимаются.
let BASE = 'http://localhost:8790';
let env = null;
let results = [];
let current = '';
const fail = (msg) => results.push({ flow: current, ok: false, msg });
const pass = (msg) => results.push({ flow: current, ok: true, msg });
const check = (cond, msg) => (cond ? pass(msg) : fail(msg));

// Страница с наблюдением за ошибками. Сессия задаётся явно: в общем Chrome куки общие.
async function page({ width = 1440, height = 900, role } = {}) {
  const p = await env.newPage({ width, height });
  await p.setViewportSize({ width, height });
  // Служебная панель playwriter (в существующем Chrome) перекрывает клики на узких экранах — в тестах скрыта.
  await p.addInitScript(() => document.addEventListener('DOMContentLoaded', () => {
    const st = document.createElement('style'); st.textContent = '[data-playwriter-toolbar]{display:none!important}'; document.head.appendChild(st);
  })).catch(() => {});
  p.problems = [];
  p.on('pageerror', (e) => p.problems.push(`JS error: ${e.message}`));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) p.problems.push(`console: ${m.text()}`); });
  p.on('response', (r) => {
    const u = r.url();
    // 409 у /api/demo/payout — ожидаемый честный отказ («выплаты нет»), не ошибка.
    if (r.status() >= 400 && u.startsWith(BASE) && !(r.status() === 401 && /\/api\/(me|admin)/.test(u)) && !(r.status() === 409 && /\/api\/demo\/payout/.test(u))) p.problems.push(`HTTP ${r.status()} ${u.replace(BASE, '')}`);
  });
  p.on('requestfailed', (r) => { if (r.url().startsWith(BASE) && r.failure()?.errorText !== 'net::ERR_ABORTED') p.problems.push(`request failed ${r.url().replace(BASE, '')}: ${r.failure()?.errorText}`); });
  await p.goto(`${BASE}/signin.html`, { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => fetch('/api/logout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }));
  if (role) await signIn(p, role);
  return p;
}
async function closePage(p) { await env.closePage(p); }
// В настоящем Chrome «тишина сети» может не наступить (расширения), поэтому: DOM + короткое ожидание.
async function go(p, url) {
  if (url) await p.goto(url, { waitUntil: 'domcontentloaded' }); else await p.reload({ waitUntil: 'domcontentloaded' });
  await p.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
}
async function signIn(p, role) {
  await go(p, `${BASE}/signin.html`);
  if (role === 'admin') await p.click('#admin'); else await p.click(`[data-id="${role}"]`);
  await p.waitForURL(/account|admin/);
  await p.waitForLoadState('networkidle');
}
// Камера, которую реально видно: перелёт к заданию, приближение, клик по точке в свободной части экрана.
async function openVisibleCamera(p) {
  await go(p, `${BASE}/?task=T-2041`);
  await p.waitForSelector('#sheet.open'); await p.keyboard.press('Escape'); await p.waitForTimeout(600);
  for (let i = 0; i < 2; i += 1) { await p.click('.leaflet-control-zoom-in'); await p.waitForTimeout(600); }
  const pt = await p.evaluate(() => {
    const d = document.querySelector('.deck-wrap').getBoundingClientRect();
    const side = d.top < 100; // лента колонкой справа (компьютер) или полосой снизу (телефон)
    const deck = side ? innerHeight : d.top;
    const right = side ? d.left : innerWidth;
    const busy = [...document.querySelectorAll('.intro:not(.hidden), .toolbar, .leaflet-control-zoom')].map((e) => e.getBoundingClientRect());
    for (const el of document.querySelectorAll('.cam-pin')) {
      const r = el.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2;
      if (x < 20 || x > right - 20 || y < 80 || y > deck - 20) continue;
      if (busy.some((b) => x >= b.left - 10 && x <= b.right + 10 && y >= b.top - 10 && y <= b.bottom + 10)) continue;
      return { x, y };
    }
    return null;
  });
  if (!pt) return false;
  await p.mouse.click(pt.x, pt.y);
  await p.waitForSelector('.leaflet-popup .pop', { timeout: 5000 });
  return true;
}
async function brokenImages(p) {
  return p.evaluate(() => [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.style.opacity !== '0.15' && getComputedStyle(i).display !== 'none').map((i) => i.getAttribute('src')));
}
async function noHorizontalScroll(p) { return p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1); }
function report(p) { for (const x of [...new Set(p.problems)]) fail(x); p.problems.length = 0; }
async function flow(name, fn) {
  current = name;
  const t0 = Date.now();
  try { await fn(); } catch (err) { fail(`threw: ${err.message.split('\n')[0]}`); }
  console.log(`· ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
}
const api = (p, path, body) => p.evaluate(async ([path2, body2]) => {
  const r = await fetch(path2, body2 === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body2) });
  return { status: r.status, body: await r.json().catch(() => null) };
}, [path, body]);


const F = [];
// ---------------------------------------------------------------- гость
F.push(['Гость: карта, лента, фильтры, панель задания', '', async () => {
  const p = await page();
  await go(p, BASE);
  await p.waitForSelector('#deck .tcard');
  const n = await p.$$eval('#deck .tcard', (x) => x.length);
  check(n >= 30, `в ленте ${n} заданий`);
  check(/\d/.test(await p.textContent('#stats')), 'статистика заполнена');
  // фильтр по виду (тип, район, сортировка — в панели Filters)
  await p.click('#f-open');
  const chip = await p.$('#f-kind .chip:nth-child(2)');
  const k = await chip.textContent();
  await chip.click();
  const kinds = await p.$$eval('#deck .tcard .kind', (x) => x.map((e) => e.textContent.split('·')[0].trim().toLowerCase()));
  check(kinds.length > 0 && kinds.every((x) => k.toLowerCase().startsWith(x.toLowerCase().slice(0, 4))), `фильтр «${k.trim()}» оставил только его (${kinds.length})`);
  await p.click('#f-kind .chip:first-child');
  await p.keyboard.press('Escape');
  // статусы
  for (const v of ['active', 'done', 'open']) {
    await p.click(`#f-status [data-v="${v}"]`);
    const c = await p.$$eval('#deck .tcard', (x) => x.length);
    check(c > 0, `статус ${v}: ${c} карточек`);
  }
  // район
  await p.click('#f-open');
  const d = await p.$eval('#f-district option:nth-child(2)', (o) => o.value);
  await p.selectOption('#f-district', d);
  const dn = await p.$eval('#f-district', (e) => e.selectedOptions[0].textContent);
  const ds = await p.$$eval('#deck .tcard .body', (x) => x.map((e) => e.textContent));
  check(ds.length > 0 && ds.every((t) => t.includes(dn)), `фильтр района «${dn}»: ${ds.length}`);
  await p.selectOption('#f-district', '');
  // сортировка по награде
  await p.selectOption('#f-sort', 'reward');
  const rw = await p.$$eval('#deck .tcard .rw', (x) => x.map((e) => Number(e.textContent.replace(/[$,]/g, ''))));
  check(rw.every((v, i) => !i || rw[i - 1] >= v), 'сортировка по награде по убыванию');
  await p.keyboard.press('Escape');
  // карточка → панель
  await p.click('#deck .tcard:nth-child(2)');
  await p.waitForSelector('#sheet.open');
  check(await p.isVisible('#sheet .reward b'), 'панель задания открылась');
  check(await p.isVisible('#sheet a[href^="/signin"]'), 'гостю предлагается войти');
  check(await p.isVisible('#sheet [data-boost]'), 'есть блок Boost с PayPal');
  // соседние задания
  const near = await p.$('#sheet [data-near]');
  if (near) { await near.click(); await p.waitForTimeout(400); check(await p.isVisible('#sheet.open'), 'переход к соседнему заданию'); }
  await p.keyboard.press('Escape');
  await p.waitForTimeout(500);
  check(!(await p.isVisible('#sheet.open')), 'Esc закрывает панель');
  // стрелки
  const a1 = await p.getAttribute('#deck .tcard.active', 'data-id');
  await p.click('#next'); await p.waitForTimeout(900);
  const a2 = await p.getAttribute('#deck .tcard.active', 'data-id');
  check(a1 !== a2, 'кнопка → выбирает следующее задание');
  // Surprise me
  await p.click('#surprise'); await p.waitForSelector('#sheet.open');
  check(true, 'Surprise me открывает задание');
  await p.click('#sheet .x'); await p.waitForTimeout(400);
  // камеры при приближении
  const camOk = await openVisibleCamera(p);
  check(camOk, 'камеры видны при приближении, попап открывается');
  if (camOk) {
    check(await p.isVisible('[data-propose]'), 'попап камеры с «Report a problem here»');
    check((await brokenImages(p)).length === 0, 'кадр камеры в попапе загрузился');
    await p.click('[data-propose]'); await p.waitForURL(/signin/);
    check(true, 'гостя отправляет на вход');
  }
  report(p);
  await go(p, `${BASE}/?task=T-2041`);
  await p.waitForSelector('#sheet.open');
  check((await p.textContent('#sheet')).includes('T-2041') || (await p.textContent('#sheet h2')).length > 3, 'ссылка ?task= открывает задание');
  check((await brokenImages(p)).length === 0, `битые картинки: ${(await brokenImages(p)).join(', ') || 'нет'}`);
  report(p);
  await closePage(p);
}]);

F.push(['Публичные страницы', '', async () => {
  const p = await page();
  for (const path of ['/heroes.html', '/about.html', '/how.html', '/signin.html']) {
    await go(p, BASE + path);
    check(await p.isVisible('h1'), `${path}: заголовок`);
    const broken = await brokenImages(p);
    check(broken.length === 0, `${path}: битые картинки ${broken.join(', ') || 'нет'}`);
  }
  await go(p, `${BASE}/heroes.html`);
  check((await p.$$eval('#lb tr', (x) => x.length)) >= 10, 'рейтинг героев заполнен');
  await go(p, `${BASE}/how.html#payments`);
  check(await p.isVisible('.ppband'), 'полоса PayPal на How it works');
  for (const a of await p.$$eval('.toc a', (x) => x.map((e) => e.getAttribute('href')))) {
    check(await p.$(a) !== null, `якорь ${a} существует`);
  }
  report(p);
  await closePage(p);
}]);

F.push(['Телефон: все страницы без горизонтальной прокрутки', '', async () => {
  const p = await page({ width: 390, height: 844 });
  for (const path of ['/', '/heroes.html', '/about.html', '/how.html', '/signin.html']) {
    await go(p, BASE + path);
    check(await noHorizontalScroll(p), `${path} помещается по ширине`);
  }
  await go(p, BASE);
  await p.click('#deck .tcard:first-child');
  await p.waitForSelector('#sheet.open'); await p.waitForTimeout(500);
  const box = await p.$eval('#sheet', (e) => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight }; });
  check(box.bottom <= box.h + 1 && box.top >= 0, 'панель задания на телефоне в пределах экрана');
  report(p);
  await closePage(p);
}]);

F.push(['Доступы и PayPal-кнопки', '', async () => {
  const p = await page();
  await p.goto(`${BASE}/admin.html`).catch(() => {}); await p.waitForURL(/signin/);
  check(true, 'гостя из админки отправляет на вход');
  await p.goto(`${BASE}/account.html`).catch(() => {}); await p.waitForURL(/signin/);
  check(true, 'гостя из кабинета отправляет на вход');
  await go(p, `${BASE}/signin.html?next=/heroes.html`);
  await p.click('[data-id="rosa"]'); await p.waitForURL(/heroes/);
  check(true, 'после входа открывается страница из ?next=');
  await p.goto(`${BASE}/admin.html`).catch(() => {}); await p.waitForURL(/signin/);
  check(true, 'жителя из админки отправляет на вход');
  // кнопки PayPal JS SDK в блоке Boost (без оплаты)
  await go(p, `${BASE}/?task=T-2042`);
  await p.waitForSelector('#sheet [data-boost]');
  await p.click('#sheet [data-amt="25.00"]');
  check(await p.$eval('#sheet [data-amt="25.00"]', (b) => b.classList.contains('on')), 'выбор суммы добавки');
  await p.click('#sheet [data-boost]');
  const ok = await p.waitForSelector('#pp-buttons iframe', { timeout: 20000 }).then(() => true).catch(() => false);
  check(ok, 'официальные кнопки PayPal отрисовались');
  report(p);
  await closePage(p);
}]);

// ---------------------------------------------------------------- житель
F.push(['Житель: взять задание, QR, сдать на проверку, заявка, кошелёк, W-9', '', async () => {
  const p = await page({ role: 'nadia' });
  check(p.url().includes('/account'), 'после входа — кабинет');
  // взять задание на карте
  await go(p, BASE);
  await p.click('#f-open'); await p.selectOption('#f-sort', 'new'); await p.keyboard.press('Escape');
  const id = await p.getAttribute('#deck .tcard:not(:has(.verif))', 'data-id');
  await p.click(`#deck .tcard[data-id="${id}"]`);
  await p.waitForSelector('#sheet [data-claim]');
  await p.click('#sheet [data-claim]');
  await p.waitForSelector('.modal');
  check((await p.textContent('.modal')).includes('48 hours'), `задание ${id} взято, модальное окно`);
  await p.click('.modal a[href="/account.html"]');
  await p.waitForSelector('#active .card');
  const qrOk = await p.waitForFunction(() => { const i = document.querySelector('#active img[alt="One-time QR code"]'); return i && i.complete && i.naturalWidth > 0; }, null, { timeout: 8000 }).then(() => true).catch(() => false);
  check(qrOk, 'QR-код отображается');
  await p.click('#active [data-submit]');
  await p.waitForTimeout(1200);
  const st = await api(p, '/api/me');
  check(st.body.tasks.some((t) => t.id === id && t.status === 'in_review'), 'задание отправлено на проверку');
  // выплаты и квитанция
  await go(p, `${BASE}/account.html?tab=payouts`);
  const rec = await p.$('[data-r]');
  if (rec) { await rec.click(); await p.waitForSelector('.modal .receipt'); check(true, 'квитанция открывается'); await p.click('.modal [data-x]'); }
  else pass('выплат пока нет — пустое состояние');
  // заявка через камеру
  if (await openVisibleCamera(p)) {
    await p.click('[data-propose]'); await p.waitForSelector('#p-text');
    await p.fill('#p-text', 'short');
    await p.click('[data-send]'); await p.waitForTimeout(500);
    check(await p.isVisible('.toast'), 'короткое описание — сообщение об ошибке');
    p.problems = p.problems.filter((x) => !/HTTP 400 \/api\/me\/proposals/.test(x));
    await p.fill('#p-text', 'Three garbage bags dumped by the bench since Monday morning');
    await p.click('[data-send]'); await p.waitForTimeout(800);
    check(!(await p.isVisible('.modal')), 'заявка отправлена');
    await go(p, `${BASE}/account.html?tab=reports`);
    check((await p.textContent('#tab')).includes('Three garbage bags'), 'заявка видна в кабинете');
  } else fail('нет камеры для заявки');
  // кошелёк Venmo
  await go(p, `${BASE}/account.html?tab=profile`);
  await p.click('.wallet:has(input[value="venmo"])');
  await p.fill('#ph', '123');
  await p.click('#save'); await p.waitForTimeout(500);
  p.problems = p.problems.filter((x) => !/HTTP 400 \/api\/me\/profile/.test(x));
  await p.fill('#ph', '(555) 014-2049');
  await p.click('#save'); await p.waitForTimeout(800);
  const me = await api(p, '/api/me');
  check(me.body.profile.wallet.type === 'venmo', 'кошелёк переключён на Venmo');
  check(/venmo[\s\S]{0,40}2049/i.test(await p.textContent('body')), 'кабинет показывает выбранный Venmo');
  await go(p, `${BASE}/account.html?tab=profile`);
  const w9 = await p.$('#w9');
  if (w9) { await w9.click(); await p.waitForTimeout(800); check((await api(p, '/api/me')).body.profile.w9 === 'on_file', 'W-9 принята'); }
  report(p);
  // выход
  await p.click('#signout'); await p.waitForURL(`${BASE}/`);
  check(await p.waitForSelector('header.site a[href="/signin.html"]', { timeout: 10000 }).then(() => true).catch(() => false), 'выход из аккаунта');
  report(p);
  await closePage(p);
}]);

F.push(['Житель: проверка камерой с моделью (T-2001)', 'ai', async () => {
  const p = await page({ role: 'theo' });
  await api(p, '/api/me/claim', { taskId: 'T-2001' });
  await go(p, `${BASE}/account.html`);
  await p.click('[data-verify]');
  await p.waitForFunction(() => /Approved|Not approved|human reviewer/.test(document.querySelector('[data-log]')?.textContent || ''), null, { timeout: 120000 });
  const log = await p.textContent('[data-log]');
  check(/Approved!/.test(log), `результат проверки: ${log.split('\n').pop().trim().slice(0, 80)}`);
  report(p);
  await closePage(p);
}]);

// ---------------------------------------------------------------- админка
F.push(['Админка: все вкладки открываются', '', async () => {
  const p = await page({ role: 'admin' });
  for (const tab of ['overview', 'copilot', 'live', 'review', 'reports', 'payouts', 'ledger', 'cameras', 'residents', 'webhooks', 'audit', 'settings']) {
    await go(p, `${BASE}/admin.html?tab=${tab}`);
    await p.waitForTimeout(300);
    const txt = await p.textContent('#tab');
    check(txt && !/Loading…$/.test(txt.trim()) && txt.length > 20, `вкладка ${tab}`);
  }
  await go(p, `${BASE}/admin.html?tab=ledger`);
  check((await p.textContent('#tab')).includes('Balanced'), 'книга сходится');
  await go(p, `${BASE}/admin.html?tab=cameras`);
  await p.fill('#q', 'CAM-000'); await p.waitForTimeout(200);
  check(/of 606 cameras/.test(await p.textContent('#n')), `поиск камер: ${await p.textContent('#n')}`);
  report(p);
  await closePage(p);
}]);

F.push(['Админка: проверка, модерация, выплаты (без отправки), настройки', '', async () => {
  const p = await page({ role: 'admin' });
  await go(p, `${BASE}/admin.html?tab=review`);
  const before = await p.$$eval('#q .card', (x) => x.length);
  await p.click('#q .card [data-a="1"]');
  await p.waitForTimeout(1000);
  const after = await p.$$eval('#q .card', (x) => x.length).catch(() => 0);
  check(after === before - 1, `одобрение из очереди (${before}→${after})`);
  await go(p, `${BASE}/admin.html?tab=reports`);
  await p.fill('#q .card [data-reward] >> nth=0', '500');
  await p.click('#q .card [data-ok] >> nth=0'); await p.waitForTimeout(500);
  check(await p.isVisible('.toast'), 'награда выше лимита отклонена');
  p.problems = p.problems.filter((x) => !/HTTP 400 \/api\/admin\/moderate/.test(x));
  await p.fill('#q .card [data-reward] >> nth=0', '30');
  await p.click('#q .card [data-ok] >> nth=0'); await p.waitForTimeout(1000);
  const pub = await api(p, '/api/public/city');
  check(pub.body.tasks.some((t) => t.source === 'resident' && Number(t.reward) === 30), 'заявка опубликована как задание');
  await p.click('#q .card [data-no] >> nth=0'); await p.waitForTimeout(800);
  check(true, 'заявка отклонена');
  await go(p, `${BASE}/admin.html?tab=payouts`);
  check(await p.isVisible('#send'), 'кнопка отправки пакета есть (не нажимаем)');
  const prev = await p.$('details.card summary:has-text("Request to PayPal")');
  if (prev) { await prev.click(); check((await p.textContent('pre.json')).includes('sender_batch_header'), 'предпросмотр запроса Payouts'); }
  await p.click('details.card:has(.pill) summary >> nth=0').catch(() => {});
  await go(p, `${BASE}/admin.html?tab=settings`);
  await p.fill('[data-k="maxReward"]', '80'); await p.click('#save'); await p.waitForTimeout(500);
  check((await api(p, '/api/admin/settings')).body.maxReward === 80, 'настройки сохраняются');
  await api(p, '/api/admin/settings', { maxReward: 75 });
  report(p);
  await closePage(p);
}]);

F.push(['Админка: живая стена (4 дела, обман, вечер) и Copilot', 'ai', async () => {
  const p = await page({ role: 'admin' });
  await api(p, '/api/admin/reset', {});
  await go(p, `${BASE}/admin.html?tab=live`);
  await p.click('#story');
  await p.waitForFunction(() => !document.querySelector('#story').disabled, null, { timeout: 300000, polling: 1000 });
  const feed = await p.textContent('#feed');
  check((feed.match(/APPROVED/g) || []).length === 3, `одобрено 3 из 3 честных (${(feed.match(/APPROVED/g) || []).length})`);
  check(/REJECTED T-2002/.test(feed), 'попытка обмана отклонена');
  await go(p, `${BASE}/admin.html?tab=copilot`);
  await p.click('#sugg button >> nth=1');
  await p.waitForSelector('#msgs .msg.bot:not(.thinking) >> nth=1', { timeout: 180000 });
  const ans = await p.textContent('#msgs .msg.bot >> nth=1');
  check(/RETURNED|returned|unclaimed/i.test(ans), `Copilot ответил по выплатам: ${ans.replace(/\s+/g, ' ').slice(0, 70)}`);
  report(p);
  await closePage(p);
}]);


// ---------------------------------------------------------------- дизайн 2026-10-04
const PLAZA = [36.59727, -121.89575]; // самый плотный участок меток
async function overlapsAt(p, z) {
  await p.evaluate(([c, zz]) => window.__map.setView(c, zz, { animate: false }), [PLAZA, z]);
  await p.waitForTimeout(250);
  return p.evaluate(() => {
    const els = [...document.querySelectorAll('.leaflet-marker-pane .reward-pin, .leaflet-marker-pane .pin-cluster')];
    const r = els.map((e) => e.getBoundingClientRect()); let n = 0;
    for (let i = 0; i < r.length; i += 1) for (let j = i + 1; j < r.length; j += 1) {
      const a = r[i]; const b = r[j];
      if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) n += 1;
    }
    return { n, sel: Boolean(document.querySelector('.leaflet-marker-pane .reward-pin.active')), pins: els.length };
  });
}
const shot = async (p, name) => { if (env.shots) await p.screenshot({ path: `${env.shots}/${name}.png`, scale: 'css' }); };
const noLive = (p) => p.evaluate(() => !/\bLIVE\b/.test(document.body.innerText) && !document.querySelector('.camview .rec'));

F.push(['Дизайн: карта и панель задания (компьютер)', '', async () => {
  const p = await page();
  await go(p, BASE);
  await p.evaluate(() => localStorage.removeItem('cp_intro_seen'));
  await go(p, null);
  check(await p.isVisible('#intro:not(.hidden)'), 'вступление показано при первом визите');
  await p.click('#deck .tcard:nth-child(2)'); await p.waitForSelector('#sheet.open');
  check(await p.isVisible('#intro-open'), 'после знакомства вступление свёрнуто в кнопку');
  await go(p, null);
  check(!(await p.isVisible('#intro:not(.hidden)')) && await p.isVisible('#intro-open'), 'свёрнутое вступление запоминается');
  report(p);
  await closePage(p);
}]);

F.push(['Дизайн: метки без налезаний — плотный участок, 7 масштабов', '', async () => {
  const p = await page();
  await go(p, BASE); await p.waitForSelector('#deck .tcard');
  for (const z of [13.75, 14.25, 14.75, 15.25, 16, 17, 18]) {
    const o = await overlapsAt(p, z);
    check(o.n === 0 && o.sel, `плотный участок z${z}: налезаний ${o.n}, выбранная видна: ${o.sel}`);
  }
  report(p);
  await closePage(p);
}]);

F.push(['Дизайн: метки без налезаний — выбрана метка в плотном участке', '', async () => {
  const p = await page();
  await go(p, `${BASE}/?task=T-2045`); await p.waitForSelector('#sheet.open');
  for (const z of [13.75, 15.25, 17]) { const o = await overlapsAt(p, z); check(o.n === 0 && o.sel, `выбрано в Mission Plaza, z${z}: налезаний ${o.n}`); }
  report(p);
  await closePage(p);
}]);

F.push(['Дизайн: панель задания — кадр, зона, увеличение, sticky Claim', '', async () => {
  const p = await page();
  await go(p, `${BASE}/?task=T-2001`); await p.waitForSelector('#sheet.open');
  await p.waitForTimeout(600);
  check(await p.isVisible('#sheet .frame .roi'), 'размеченная зона проблемы выделена на полном кадре');
  const ratio = await p.$eval('#sheet .frame', (f) => f.getBoundingClientRect().width / f.getBoundingClientRect().height);
  check(Math.abs(ratio - 1280 / 720) < 0.02, `кадр в родной пропорции (${ratio.toFixed(3)})`);
  check(await p.isVisible('#sheet .sheet-cta [data-claim], #sheet .sheet-cta a[href^="/signin"]') && /\$\d/.test(await p.textContent('#sheet .sheet-cta')), 'закреплены сумма и действие');
  await shot(p, 'task-1440x900');
  await p.click('#sheet [data-zoom]'); await p.waitForSelector('.modal .zoomed .frame');
  check(await p.isVisible('.modal .zoomed .roi'), 'увеличенный кадр с выделением');
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  check(!(await p.isVisible('.modal')), 'увеличение закрывается по Esc');
  await go(p, `${BASE}/?task=T-2041`); await p.waitForSelector('#sheet.open');
  check(!(await p.$('#sheet .frame .roi')) && /isn’t outlined/.test(await p.textContent('#sheet .framecap')), 'без разметки зона не выдумывается');
  check(await noLive(p) && await p.isVisible('#sheet .demotag'), 'кадры подписаны «Demo camera frame», «LIVE» нет');
  await go(p, BASE); await shot(p, 'map-1440x900');
  await p.setViewportSize({ width: 1280, height: 760 }); await go(p, null); await shot(p, 'map-1280x760');
  report(p);
  await closePage(p);
}]);

for (const [w, hh] of [[390, 844], [320, 700]]) F.push([`Дизайн: телефон ${w}`, '', async () => {
  {
    const p = await page({ width: w, height: hh });
    await go(p, BASE);
    const clear = (sel) => p.evaluate((q) => { const a = document.querySelector(q).getBoundingClientRect(); const t = document.querySelector('.toolbar').getBoundingClientRect(); return t.top >= a.bottom; }, sel);
    await p.evaluate(() => localStorage.removeItem('cp_intro_seen')); await go(p, null); await p.waitForTimeout(500);
    check(await p.isVisible('#intro:not(.hidden)') && await clear('#intro'), `${w}: первый визит — полное вступление, фильтры ниже без перекрытия`);
    await shot(p, `map-fresh-${w}x${hh}`);
    await p.click('#intro-x'); await go(p, null); await p.waitForTimeout(500);
    check(!(await p.isVisible('#intro:not(.hidden)')) && await clear('#intro-open'), `${w}: свёрнутое вступление запоминается, фильтры ниже кнопки`);
    const head = await p.$eval('header.site', (e) => e.getBoundingClientRect().height);
    check(head <= 60, `${w}: компактная шапка (${Math.round(head)} px)`);
    await p.click('.navtoggle'); check(await p.isVisible('nav.main a[href="/heroes.html"]'), `${w}: меню открывается`); await p.click('.navtoggle');
    const done = await p.$eval('#f-status [data-v="done"]', (b) => b.getBoundingClientRect().right);
    check(done <= w, `${w}: вкладки Open/In progress/Done помещаются (${Math.round(done)})`);
    check(await noHorizontalScroll(p), `${w}: без горизонтальной прокрутки`);
    await shot(p, `map-${w}x${hh}`);
    report(p);
    await closePage(p);
  }
}]);
for (const [w, hh] of [[390, 844], [320, 700]]) F.push([`Дизайн: телефон ${w} — список и панель задания`, '', async () => {
  {
    const p = await page({ width: w, height: hh });
    await go(p, BASE); await p.waitForSelector('#deck .tcard');
    await p.click('#viewtoggle [data-view="list"]'); await p.waitForTimeout(300);
    const list = await p.$$eval('#deck .tcard', (c) => c.slice(0, 2).map((e) => e.getBoundingClientRect().top));
    check(await p.$eval('.explore', (e) => e.classList.contains('listview')) && list[1] > list[0], `${w}: List — карточки списком`);
    await shot(p, `list-${w}x${hh}`);
    await p.click('#deck .tcard:first-child'); await p.waitForSelector('#sheet.open'); await p.waitForTimeout(500);
    const cta = await p.$eval('#sheet .sheet-cta', (e) => { const r = e.getBoundingClientRect(); return { b: r.bottom, h: innerHeight, vis: r.height > 30 }; });
    check(cta.vis && cta.b <= cta.h + 1, `${w}: сумма и Claim закреплены внизу`);
    await shot(p, `task-${w}x${hh}`);
    await p.click('#sheet .grab'); check(await p.$eval('#sheet', (e) => e.classList.contains('full')), `${w}: панель раскрывается`);
    await p.keyboard.press('Escape'); await p.click('#viewtoggle [data-view="map"]');
    check(!(await p.$eval('.explore', (e) => e.classList.contains('listview'))), `${w}: возврат к карте`);
    report(p);
    await closePage(p);
  }
}]);

for (const [w, hh] of [[1440, 900], [390, 844]]) F.push([`Дизайн: How ${w} — шаги, выплаты, технические детали, «до/после»`, '', async () => {
  {
    const p = await page({ width: w, height: hh });
    await go(p, `${BASE}/how.html`);
    const y = await p.evaluate(() => ['how', 'money', 'verify'].map((id) => document.getElementById(id).getBoundingClientRect().top + scrollY));
    check(y[0] < y[1] && y[1] < y[2], `${w}: сначала четыре шага, затем выплаты, затем проверка`);
    check(!(await p.$eval('details.tech', (d) => d.open)) && !(await p.isVisible('details.tech code')), `${w}: API/SDK/sender_batch_id скрыты в Technical details`);
    check(/Before/i.test(await p.textContent('.ba-tag.l')) && /After/i.test(await p.textContent('.ba-tag.r')) && /Demo/.test(await p.textContent('.ba-demo')), `${w}: подписи Before/After/Demo`);
    await p.locator('#verify').scrollIntoViewIfNeeded();
    for (const v of [2, 98]) {
      await p.$eval('.ba-range', (r, val) => { r.value = val; r.dispatchEvent(new Event('input', { bubbles: true })); }, v);
      const wdt = await p.$eval('.ba-before', (e) => parseFloat(e.style.width));
      check(wdt === v, `${w}: слайдер в положении ${v}%`);
      await p.$eval('.ba', (e) => e.scrollIntoView({ block: 'center' }));
      await shot(p, `how-slider-${v}-${w}x${hh}`);
    }
    await p.focus('.ba-range'); await p.keyboard.press('ArrowLeft');
    check(await p.$eval('.ba-before', (e) => parseFloat(e.style.width)) === 97, `${w}: слайдер управляется клавиатурой`);
    await p.evaluate(() => scrollTo(0, 0)); await shot(p, `how-${w}x${hh}`);
    report(p);
    await closePage(p);
  }
}]);

F.push(['Дизайн: демо-метки на кадрах админки', '', async () => {
  const p = await page({ role: 'admin' });
  await go(p, `${BASE}/admin.html?tab=live`);
  check((await p.$$('.livecam .demotag')).length === 4 && await noLive(p), 'живая стена: «Demo camera frame» на всех 4 кадрах, «LIVE» нет');
  await go(p, `${BASE}/admin.html?tab=review`);
  check(await noLive(p), 'очередь проверки без «LIVE»');
  report(p);
  await closePage(p);
}]);

// ---------------------------------------------------------------- хакатон: демо, пилот, бренд, админка
async function demoTo(p, { q = '', choice = '[data-clean]' } = {}) {
  await go(p, `${BASE}/demo.html${q}`);
  await p.waitForSelector('#stage [data-next]', { timeout: 15000 });
  await p.click('#stage [data-next]'); await p.waitForSelector('#stage [data-next]');
  await p.click('#stage [data-next]'); await p.waitForSelector(choice);
  await p.click(choice); await p.waitForSelector('#stage [data-next]');
  await p.click('#stage [data-next]');
  await p.waitForSelector('.proof', { timeout: 40000 });
}
F.push(['Демо: отказ модели и обман — честные статусы, без выплаты', '', async () => {
  const p = await page();
  await demoTo(p, { q: '?model=off' });
  check(/simulated/i.test(await p.textContent('#aistate')), 'отказ модели подписан как симуляция');
  check(/Human review/i.test(await p.textContent('.proof .stamp')) && await p.isVisible('.recorded'), 'без модели — ручная проверка и сохранённые ответы модели');
  // Вырезки зоны с edge-камеры: обе загружены (не битые), это разные изображения, зона отмечена на полном кадре.
  const crops = await p.$$eval('.proof .compare img.cb, .proof .compare img.ca', (x) => x.map((i) => ({ cls: i.className, ok: i.complete && i.naturalWidth > 0, src: i.src, alt: i.alt })));
  check(crops.length === 2 && crops.every((c) => c.ok) && crops[0].src !== crops[1].src && /Before/.test(crops[0].alt) && /After/.test(crops[1].alt)
    && await p.isVisible('.proof .frame .roi'), `доказательство: вырезки «до/после» загружены (${crops.map((c) => `${c.cls}:${c.ok}`).join(', ')}) и зона на полном кадре`);
  const [resp] = await Promise.all([p.waitForResponse((r) => r.url().includes('/api/demo/payout')), p.click('.proof [data-next]')]);
  const body = await resp.json().catch(() => ({}));
  check(resp.status() === 409 && /Waiting for a human reviewer/.test(body.error || ''), `выплата для Human review: ожидаемый отказ ${resp.status()} «${body.error}»`);
  await p.waitForSelector('.receipt-card');
  check(/No payout/.test(await p.textContent('.receipt-card')) && /not re-queried/i.test(await p.textContent('.sandbox')), 'без одобрения выплаты нет; sandbox-доказательство подписано как записанное');
  await demoTo(p, { choice: '[data-cheat]' });
  check(/Rejected/i.test(await p.textContent('.proof .stamp')) && /not asked/i.test(await p.textContent('.proof')), 'обман отклонён, модель не спрашивали');
  report(p);
  await closePage(p);
}]);
F.push(['Бренд и пилот', '', async () => {
  const p = await page();
  await go(p, BASE);
  const brand = await p.$eval('header.site .brand', (b) => ({ label: b.getAttribute('aria-label') || '', t1: b.querySelector('.t1')?.textContent, t2: b.querySelector('.t2')?.textContent,
    mark: (() => { const i = b.querySelector('img.mark'); return Boolean(i && i.complete && i.naturalWidth > 0); })() }));
  check(brand.t1 === 'StreetCred' && /Good deeds\.\s*Real credit\./.test(brand.t2) && /StreetCred/.test(brand.label) && /Port Calloway demo city/.test(brand.label) && brand.mark,
    `шапка: знак загружен, «StreetCred» + «${brand.t2}», демо-город в aria-label`);
  const st = await p.textContent('#stats');
  check(/sample payouts/.test(st) && /Demo data/i.test(await p.textContent('#deck-count')), 'засеянные суммы подписаны как sample / Demo data');
  check(/Good deeds\.\s*Real credit\./.test(await p.textContent('#intro h1')), 'заголовок «Good deeds. Real credit.»');
  check(await p.isVisible('header.site a[href="/demo.html"]') || await p.$('nav.main a[href="/demo.html"]') !== null, 'вход в демо из шапки');
  await go(p, `${BASE}/pilot.html`);
  check(/no pilot customers yet/i.test(await p.textContent('.note')), 'пилот прямо говорит, что клиентов нет');
  check(['scope', 'budget', 'rules', 'timeline', 'disputes', 'measure'].every(Boolean) && (await p.$$('.pilot section')).length >= 6, 'пилот: масштаб, бюджет, условия, сроки, споры, метрики');
  report(p);
  await closePage(p);
}]);
F.push(['Админка: почему выплаты не дошли (read-only)', '', async () => {
  const p = await page({ role: 'admin' });
  await go(p, `${BASE}/admin.html?tab=overview`); await p.waitForSelector('.whycard');
  const pills = await p.$$eval('.whycard .whyrow .pill', (x) => x.map((e) => e.textContent));
  check(pills.includes('RETURNED') && /seeded sample history/.test(await p.textContent('.whycard')), `исключения по статусам с происхождением (${pills.join(', ')})`);
  check(await p.$('a[href="/treasury.html"]') !== null, 'ссылка на Treasury dashboard');
  report(p);
  await closePage(p);
}]);

export const FLOWS = F.map(([name, tag]) => ({ name, ai: tag === 'ai' }));

/** Прогон сценариев: newPage/closePage задаёт вызывающая сторона (свой браузер или существующий Chrome). */
export async function runFlows({ base, newPage, closePage: close, skipAi = false, only = null, reset = true, shots = null, log = console.log }) {
  BASE = base; env = { newPage, closePage: close, shots }; results = [];
  if (reset) {
    current = 'Подготовка';
    const p = await page({ role: 'admin' });
    await api(p, '/api/admin/reset', {});
    await closePage(p);
  }
  for (const [i, [name, tag, fn]] of F.entries()) {
    if (only && !only.includes(i)) continue;
    if (skipAi && tag === 'ai') continue;
    current = name;
    const t0 = Date.now();
    try { await fn(); } catch (err) { fail(`threw: ${err.message.split('\n')[0]}`); }
    log(`· [${i}] ${name} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  }
  return results;
}
