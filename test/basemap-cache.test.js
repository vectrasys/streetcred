// Кэш подложки карты: имя с хешем содержимого, immutable-заголовок, preload в index.html; API — no-store.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../src/worker.js';

const root = new URL('../', import.meta.url);
const read = (p) => readFileSync(new URL(p, root));

test('preload в index.html указывает на опубликованную подложку с хешем её содержимого', () => {
  const html = read('public/index.html').toString();
  const m = html.match(/<link rel="preload" id="basemap-src" href="\/data\/(basemap\.([a-f0-9]{12})\.json)" as="fetch"[^>]*crossorigin="anonymous">/);
  assert.ok(m, 'preload подложки есть');
  const published = read(`public/data/${m[1]}`);
  assert.equal(createHash('sha256').update(published).digest('hex').slice(0, 12), m[2], 'хеш в имени = содержимое');
  assert.deepEqual(published, read('data/basemap.json'), 'опубликована текущая версия');
  assert.deepEqual(readdirSync(new URL('public/data/', root)).filter((f) => f.startsWith('basemap')), [m[1]], 'старых версий нет');
});

test('_headers: immutable только для версионной подложки', () => {
  const h = read('public/_headers').toString();
  assert.match(h, /^\/data\/basemap\.\*\.json\n\s+Cache-Control: public, max-age=31536000, immutable/m);
});

test('ответы API не кэшируются браузером (настоящие маршруты, 200 JSON)', async () => {
  const resident = `cp_session=${encodeURIComponent(btoa(JSON.stringify({ role: 'resident', userId: 'maya' })))}`;
  // /api/session вызывает chrome() на каждой странице, /api/me — кабинет жителя.
  for (const [path, cookie] of [['/api/public/city'], ['/api/public/stats'], ['/api/session'], ['/api/me', resident]]) {
    const res = await worker.fetch(new Request(`https://x.dev${path}`, { headers: cookie ? { cookie } : {} }), {}, {});
    assert.equal(res.status, 200, `${path} отвечает 200`);
    assert.match(res.headers.get('content-type'), /^application\/json/, path);
    assert.equal(res.headers.get('cache-control'), 'no-store', path);
  }
  const me = await (await worker.fetch(new Request('https://x.dev/api/me', { headers: { cookie: resident } }), {}, {})).json();
  assert.equal(me.profile.id, 'maya', '/api/me вернул кабинет жителя');
});
