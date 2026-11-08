# Third-party notices

The project license (`LICENSE`, MIT, approved by the owner on 2026-10-13) covers only original code and text
written for this project. It does **not** relicense anything listed below. Each item keeps its own
license, and no ownership of third-party data, photos, models or libraries is claimed.

## Map data — OpenStreetMap

- Files: `data/basemap.json`, `data/city.json` (street, building, park, water and path geometry),
  `public/data/basemap.*.json` (a content-hashed copy of `data/basemap.json`).
- Source: © OpenStreetMap contributors, https://www.openstreetmap.org/copyright
- License: Open Database License (ODbL) 1.0, https://opendatacommons.org/licenses/odbl/1-0/
- These files are a Derived Database built from OSM geometry. They are offered under ODbL 1.0, not
  under the project license. Real place names were used only to group street segments while building
  the city. Every name shown in the app (city, districts, streets, residents) is fictional.
- The app shows the attribution "© OpenStreetMap (ODbL)" on the map and in the page footer.

## Photographs — Wikimedia Commons

| Item | Used in the current build | Source | License | Author |
|---|---|---|---|---|
| `assets/lot/before.jpg` (and the derived `after.jpg`) | yes | [Fly-tipping - 15 May 2026.jpg](https://commons.wikimedia.org/wiki/File:Fly-tipping_-_15_May_2026.jpg) | CC0 1.0 | Aethonatic |
| listed in `assets/credits.json` as `sidewalk` | no (replaced by a generated frame) | [Garbage bags broken by crows in Tokyo.jpg](https://commons.wikimedia.org/wiki/File:Garbage_bags_broken_by_crows_in_Tokyo.jpg) | CC0 1.0 | Syced |
| listed in `assets/credits.json` as `corner` / `pole` | no | [Basura en Mazatlán, 9 de junio de 2026](https://commons.wikimedia.org/wiki/File:Basura_en_Mazatl%C3%A1n,_9_de_junio_de_2026.jpg) (and photo 03) | CC0 1.0 | Roedor Pacheco |

CC0 does not require attribution. The credits above are given as a courtesy.

## AI-generated images

- 40 task camera frames `public/img/tasks/*.jpg` (the open tasks; marked `"version": "gemini"` in
  `data/batch-prompts.json`) were generated with Google Gemini image generation (gemini.google.com) from
  the text prompts recorded there, then cropped/resized to 1024×576. Google does not claim ownership of
  generated content; the images carry Google's invisible SynthID watermark.
- The 40 resident portraits `public/avatar/*.jpg` were generated with ChatGPT image generation
  (chatgpt.com, OpenAI) as five grid images, then sliced and resized to 256×256. The grid prompts and
  the grid/cell of every portrait are in `data/avatar-prompts.json`. OpenAI's Terms of Use
  (https://openai.com/policies/row-terms-of-use/, effective January 1, 2026, "Ownership of content")
  say that, as between the user and OpenAI and to the extent permitted by law, "you (a) retain your
  ownership rights in Input and (b) own the Output".
- The other 16 task frames (1024×576) were generated locally with **Ming-Image-0.1-Design** (inclusionAI;
  code and weights licensed MIT, https://huggingface.co/inclusionAI/Ming-Image-0.1-Design) through mflux,
  using a community quantized derivative (`joeynyc/Ming-Image-0.1-Design-mflux-q8-te4`, MIT per its model
  card, base model inclusionAI/Ming-Image-0.1-Design: https://huggingface.co/joeynyc/Ming-Image-0.1-Design-mflux-q8-te4). The exact prompt
  and seed of every frame are in `data/batch-prompts.json`.
- The 39 street camera views `public/img/views/*.jpg` (23 from Google Gemini, 16 from ChatGPT) and the
  before/after demo pair `public/img/demo/lot-*.jpg` on the How page (ChatGPT; "after" is a ChatGPT edit
  of "before", blended back only around the removed debris) are AI-generated. The tool and prompt of each
  are in `data/view-prompts.json`. Gemini images carry Google's invisible SynthID watermark. Google's Terms
  of Service (effective July 30, 2026, "Your content": https://policies.google.com/terms) state:
  "Google won't claim ownership over that content." The `views`
  section of `data/batch-prompts.json` holds earlier FLUX prompts for views that were replaced; it is
  kept as history and does not describe the shipped view images.
- `assets/{sidewalk,alley,tires}/before.jpg` and `assets/avatars/*.jpg` were
  generated locally with the FLUX.1-schnell model (Black Forest Labs; model weights licensed Apache-2.0,
  https://huggingface.co/black-forest-labs/FLUX.1-schnell) through mflux. Prompts are in
  `scripts/make-prompts.mjs` and `scripts/avatar-prompts.tsv`.
- The places and people shown are fictional; the frames are synthetic, not real camera footage.
  Copyright in AI-generated images may not exist or may differ by jurisdiction. They are provided
  as-is, and no third-party rights are claimed for them.

## Inpainted "after" frames

- Files: `assets/*/after.jpg`. Each is the matching "before" frame with the problem area removed by
  the LaMa inpainting model (https://github.com/advimman/lama, Apache-2.0) through IOPaint
  (https://github.com/Sanster/IOPaint, Apache-2.0). An "after" frame derived from a CC0
  photo keeps the CC0 status of its source.

## Fonts (loaded from Google Fonts at runtime, not included in this repository)

- Geist — SIL Open Font License 1.1
- Fraunces — SIL Open Font License 1.1

## JavaScript libraries

Vendored into `public/vendor/` (shipped to the browser):

| Library | Version | License | Notice |
|---|---|---|---|
| Leaflet | 1.9.4 | BSD-2-Clause | © 2010-2023 Vladimir Agafonkin, © 2010-2011 CloudMade |
| Leaflet.markercluster | 1.5.3 | MIT | © 2012 David Leaver |
| AG Grid Community | 36.2.0 | MIT | © 2015-2026 AG GRID LTD (`public/vendor/ag-grid-community-36.2.0/licenses/LICENSE.txt`) |

npm runtime dependencies (bundled into the Worker or edge script; not committed, installed by `npm ci`):

| Package | Version | License |
|---|---|---|
| @paypal/agent-toolkit | 1.11.0 | ISC |
| ai (Vercel AI SDK) | 4.3.19 | Apache-2.0 |
| axios | 1.20.0 | MIT |
| fast-png | 6.4.0 | MIT |
| jsqr | 1.4.0 | Apache-2.0 |
| ollama-ai-provider | 1.2.0 | Apache-2.0 |
| qrcode-generator | 1.4.4 | MIT |
| workers-ai-provider | 0.7.5 | MIT |
| zod | 3.25.76 | MIT |

Development only: esbuild (MIT), playwright (Apache-2.0), @resvg/resvg-js (MPL-2.0).

## Models used at runtime (not included)

- qwen2.5vl:3b and qwen3:4b-instruct-2507 via Ollama (local), or Cloudflare Workers AI models
  (`@cf/meta/llama-4-scout-17b-16e-instruct`, `@cf/zai-org/glm-4.7-flash`) when deployed. Each is
  governed by its own license and terms of use.

## Trademarks

PayPal, Venmo, Cloudflare and other product names belong to their owners. This is an independent
hackathon project, not affiliated with or endorsed by them. Port Calloway is a fictional city.

## License texts of bundled libraries

`public/vendor/` ships Leaflet 1.9.4 (BSD-2-Clause) and Leaflet.markercluster (MIT). Their license
texts are included as `public/vendor/LEAFLET-LICENSE.txt` and
`public/vendor/LEAFLET-MARKERCLUSTER-LICENSE.txt`.

## Demo video (not in this repository)

- Narration: Kokoro-82M text-to-speech (https://huggingface.co/hexgrad/Kokoro-82M, Apache-2.0, revision
  f3ff3571791e), stock voice `af_heart`.
- Music: an original instrumental bed synthesized in code for the video (numpy/scipy; no samples,
  recordings or AI music models).
- Map shots show data © OpenStreetMap contributors (ODbL 1.0); the credit is in the video description.
- Overlay graphics in the video are original: the only image overlay used by the final cut is the
  pointer (`gfx/cursor.png`), drawn in code with Pillow for this project (reproduced byte-identically
  from its generator on 2026-10-16). Highlights, ink lines, rays and press effects are drawn by the
  project's own renderer.
