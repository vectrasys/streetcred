// Клиентские скрипты страниц должны хотя бы компилироваться: синтаксическая
// ошибка в модуле молча ломает страницу целиком.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pub = new URL('../public/', import.meta.url);
const dir = mkdtempSync(join(tmpdir(), 'cp-pages-'));
const check = (name, src) => {
  const f = join(dir, `${name.replace(/\W/g, '_')}.mjs`);
  writeFileSync(f, src);
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { assert.fail(`${name}: ${e.stderr}`); }
};

for (const f of readdirSync(new URL('js/', pub))) {
  test(`js/${f} компилируется`, () => check(f, readFileSync(new URL(`js/${f}`, pub), 'utf8')));
}
for (const f of readdirSync(pub).filter((x) => x.endsWith('.html'))) {
  test(`${f}: встроенные модули компилируются, есть title`, () => {
    const html = readFileSync(new URL(f, pub), 'utf8');
    assert.match(html, /<title>[^<]+<\/title>/);
    [...html.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].forEach((m, i) => check(`${f}-${i}`, m[1]));
  });
}
