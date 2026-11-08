#!/usr/bin/env node
// Подложка карты публикуется под именем с хешем содержимого: public/data/basemap.<hash>.json.
// Её можно кэшировать навсегда (public/_headers: immutable), а новая версия — новый URL,
// так что старая подложка не подхватится. Ссылка обновляется в preload в public/index.html.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, unlinkSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const src = readFileSync(new URL('data/basemap.json', root));
const hash = createHash('sha256').update(src).digest('hex').slice(0, 12);
const name = `basemap.${hash}.json`;
const dir = new URL('public/data/', root);
mkdirSync(dir, { recursive: true });
for (const f of readdirSync(dir)) if (/^basemap\..*\.json$/.test(f) && f !== name) unlinkSync(new URL(f, dir));
writeFileSync(new URL(name, dir), src);
const idx = new URL('public/index.html', root);
const html = readFileSync(idx, 'utf8');
const next = html.replace(/href="\/data\/basemap[^"]*\.json"/, `href="/data/${name}"`);
if (!next.includes(`/data/${name}`)) throw new Error('preload link for the basemap not found in public/index.html');
if (next !== html) writeFileSync(idx, next);
console.log('basemap', name, src.length, 'bytes');
