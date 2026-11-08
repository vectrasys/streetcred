#!/usr/bin/env node
// Промпты FLUX для кадров камер: задание в стиле архитектуры своего района.
import { writeFileSync } from 'node:fs';
import { makeRng } from './rng.mjs';
import { DISTRICTS } from './districts.mjs';

const rng = makeRng(7);
const pick = (a) => a[Math.floor(rng() * a.length)];
const PROBLEMS = {
  bags: ['several black plastic garbage bags dumped on the sidewalk next to a utility pole', ['heights', 'seaview', 'grove', 'wharf']],
  graffiti: ['a large spray-painted graffiti tag on a wall', ['cooperage', 'plaza', 'wharf', 'millworks']],
  couch: ['an old abandoned couch dumped on the curb', ['heights', 'seaview', 'grove']],
  mattress: ['an old stained mattress leaning against a fence on the sidewalk', ['seaview', 'heights', 'millworks']],
  tires: ['several old car tires dumped on the sidewalk strip', ['millworks', 'seaview', 'heights']],
  cart: ['an abandoned shopping cart left on the sidewalk', ['plaza', 'wharf', 'seaview']],
  branches: ['fallen tree branches and leaves blocking part of the sidewalk after a storm', ['heights', 'grove', 'seaview']],
  boxes: ['a pile of flattened cardboard boxes and packaging dumped by a dumpster', ['plaza', 'cooperage', 'wharf']],
  litter: ['scattered litter, cups and food wrappers on the grass of a small pocket park', ['grove', 'plaza', 'heights']],
  drain: ['a storm drain at the curb clogged with leaves and trash', ['wharf', 'cooperage', 'plaza']],
  weeds: ['tall overgrown weeds growing through cracks along a sidewalk', ['seaview', 'grove', 'heights']],
  bin: ['an overflowing public trash can with trash spilling onto the ground', ['plaza', 'wharf', 'cooperage']],
  flyers: ['a wooden utility pole covered with layers of torn paper flyers and posters', ['plaza', 'grove', 'cooperage']],
  debris: ['a pile of construction debris, boards and drywall dumped on a vacant lot', ['millworks', 'cooperage']],
};
const TIMES = ['overcast daylight', 'bright morning sun', 'late afternoon light', 'soft coastal fog', 'early evening dusk with street lights on'];
const kinds = Object.keys(PROBLEMS);
const tasks = [];
for (let i = 0; i < 50; i += 1) {
  const kind = kinds[i % kinds.length];
  const [desc, where] = PROBLEMS[kind];
  const target = pick(where);
  const d = DISTRICTS.find((x) => x.id === target);
  tasks.push({ id: `t${String(i + 1).padStart(2, '0')}`, kind, district: d.id, seed: 1000 + i,
    prompt: `Security camera footage, elevated wide-angle view of an empty street in a small Californian coastal town, ${d.style}, ${desc}, ${pick(TIMES)}, CCTV image, slightly grainy, photorealistic, no people, no text, no watermark` });
}
const views = DISTRICTS.flatMap((d, di) => Array.from({ length: d.id === 'grove' || d.id === 'cooperage' ? 7 : 5 }, (_, j) => ({
  id: `v${d.id}${j + 1}`, district: d.id, seed: 2000 + di * 10 + j,
  prompt: `Security camera footage, elevated wide-angle view of an empty clean street in a small Californian coastal town, ${d.style}, parked cars, trees, ${pick(TIMES)}, CCTV image, slightly grainy, photorealistic, no people, no text, no watermark`,
})));
writeFileSync(new URL('../data/batch-prompts.json', import.meta.url), `${JSON.stringify({ tasks, views }, null, 1)}\n`);
console.log(tasks.length, 'tasks,', views.length, 'views');
