#!/usr/bin/env node
// Сквозная проверка в собственном Chromium (для CI):
//   node e2e/flows.mjs [http://localhost:8790] [--skip-ai]
// В рабочей среде проекта сценарии запускаются в существующем Chrome через e2e/run-flow.js.
import { chromium } from 'playwright';
import { runFlows } from './flows-core.mjs';

const base = process.argv.find((a) => a.startsWith('http')) || 'http://localhost:8790';
const browser = await chromium.launch();
const results = await runFlows({
  base, skipAi: process.argv.includes('--skip-ai'),
  newPage: async ({ width, height }) => (await browser.newContext({ viewport: { width, height } })).newPage(),
  closePage: (p) => p.context().close(),
});
await browser.close();
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length} ok, ${bad.length} problems`);
for (const r of bad) console.log(`✗ [${r.flow}] ${r.msg}`);
process.exit(bad.length ? 1 : 0);
