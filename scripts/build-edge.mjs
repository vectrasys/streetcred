#!/usr/bin/env node
// Собирает код камеры (src/edge-camera.js: проверка пикселей, QR) для браузера.
import { build } from 'esbuild';

await build({
  entryPoints: [new URL('../src/edge-camera.js', import.meta.url).pathname],
  outfile: new URL('../public/js/edge-camera.js', import.meta.url).pathname,
  bundle: true, format: 'esm', minify: true, platform: 'browser', target: 'es2022',
  banner: { js: '// Сгенерировано scripts/build-edge.mjs из src/edge-camera.js — не редактировать.' },
});
console.log('built public/js/edge-camera.js');
