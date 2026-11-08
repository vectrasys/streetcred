#!/bin/bash
# Переносит сгенерированные FLUX-кадры на сайт в сжатом виде.
#   scripts/import-gen.sh <gen-dir>   (в нём tasks/, views/, avatars/ с PNG)
set -e
G=${1:?gen dir}; cd "$(dirname "$0")/.."
mkdir -p public/img/tasks public/img/views public/avatar
# Кадры камер: срезаем полосы сверху и снизу — FLUX иногда рисует там свою метку времени.
conv() { sips -s format jpeg -s formatOptions "$3" --resampleWidth "$2" "$1" --out "$4" >/dev/null; }
cam() { sips -c 620 1280 "$1" --out "${TMPDIR:-/tmp}/cp-crop.png" >/dev/null && conv "${TMPDIR:-/tmp}/cp-crop.png" "$2" "$3" "$4"; }
for f in "$G"/tasks/*.png; do [ -f "$f" ] && cam "$f" 960 70 "public/img/tasks/$(basename "${f%.png}").jpg"; done
# У отдельных кадров метка выше полосы — обрезаются сильнее.
deep() { sips -c 560 1280 --cropOffset 40 0 "$1" --out "${TMPDIR:-/tmp}/cp-crop.png" >/dev/null && conv "${TMPDIR:-/tmp}/cp-crop.png" 960 70 "$2"; }
for f in "$G"/views/*.png; do [ -f "$f" ] && cam "$f" 960 70 "public/img/views/$(basename "${f%.png}").jpg"; done
deep "$G/views/vplaza5.png" public/img/views/vplaza5.jpg; deep "$G/tasks/t44.png" public/img/tasks/t44.jpg
for f in "$G"/avatars/*.png; do [ -f "$f" ] && conv "$f" 256 80 "public/avatar/$(basename "${f%.png}").jpg"; done
node scripts/embed-assets.mjs
du -sh public/img public/avatar
