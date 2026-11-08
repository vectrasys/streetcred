# Architecture

StreetCred is one Cloudflare Worker that serves static pages and a JSON API. In the demo the
browser plays the street camera. The design holds money back until both the pixel checks and the AI
agree.

```
 Browser ("edge camera")                Cloudflare Worker (src/worker.js)              External
 ───────────────────────                ────────────────────────────────              ────────
 public/js/edge-camera.js   ── edge ──▶  /api/verify, /api/demo/verify
   QR decode (jsqr)          observations   one-time QR check (single use)
   same-view correlation     + zone crops   thresholds: judge()  (src/verify.js)
   lighting match                           vision question ───────────────────────▶ Ollama qwen2.5vl:3b
   task-zone change                         "Is this place clean?" before=no, after=yes  (local) or
                                                                                        Workers AI (deploy)
                                            decision: approve | reject | human review
                                                 │
                                                 ▼
                                            program state (src/program.js)
                                            double-entry ledger:
                                            program_budget → payable → in_transit → paid_out | returned
                                                 │
 /admin  Payouts batch  ─────────────────▶  src/paypal.js  ──────────────────────────────▶ PayPal sandbox
 /demo   simulated receipt (no API call)    Payouts (idempotent sender_batch_id)            Payouts API
 Boost   PayPal JS SDK  ─────────────────▶  Orders v2 create / capture ──────────────────▶ Orders v2
 /admin  Treasury Copilot ───────────────▶  src/agent.js: PayPal Agent Toolkit + AI SDK ──▶ sandbox orders,
 /treasury read-only question ───────────▶  readOnly: local program records only           transactions,
                                            (no PayPal tools, no proposals)                 disputes, invoices
 /treasury AG Grid Community ◀── /api/admin/{overview,tasks,payouts,ledger} (source + provenance per row)
```

## Key decisions

- **Two independent signals before money moves.** Pixel checks catch replays, a different camera
  and lighting tricks. The vision model sees only the cropped task zone and answers one narrow
  question. If they disagree, the deed goes to a human reviewer.
- **The narrow question.** On this project's frames, "is this place clean?" on the zone crop
  outperformed whole-frame or side-by-side prompts. The measured result is 8/8 on 4 curated
  before/after pairs (`data/recorded-model-evidence.json`) — a design check, not field accuracy.
- **Payouts are idempotent.** One batch per business day with a deterministic `sender_batch_id`,
  so a retry cannot pay twice. Item statuses come from PayPal, never from unverified webhooks.
- **The agent proposes, a person disposes.** The Copilot can read PayPal sandbox data and propose
  refunds or sponsor invoices. Exact PayPal parameters are assembled by code, and execution needs
  an explicit Approve. The PayPal host is pinned to sandbox, and live hosts are blocked in axios.
- **Read-only treasury questions.** `/treasury` calls the Copilot with `readOnly: true`. The server
  confirms the mode and returns no proposals. The page refuses to show an answer if that contract is
  not confirmed.
- **Edge/cloud split.** Heavy pixel work runs at the camera, so each server request fits the
  Workers free-tier CPU budget. On the real deployment that would be a city-owned camera that signs
  its observations.
- **Isolated demo.** `/demo` creates a throwaway program copy per visitor (TTL-limited). It uses the
  real verification path, but its payout step returns a simulated receipt.

## Files

| Path | Role |
|---|---|
| `src/worker.js` | routes, sessions, demo copies, PayPal and AI wiring |
| `src/program.js` | tasks, claims, one-time QR tokens, ledger, payouts preparation, audit log |
| `src/verify.js` | pixel checks, `judge()` thresholds, zone crops |
| `src/edge-camera.js` | browser-side camera checks (built to `public/js/edge-camera.js`) |
| `src/ai.js` | vision question, Ollama / Workers AI providers, answer parsing |
| `src/paypal.js` | sandbox-only Payouts and Orders clients |
| `src/agent.js` | Treasury Copilot on PayPal Agent Toolkit, read-only mode |
| `public/js/treasury.js` | AG Grid Community dashboard: views, filters, CSV, source evidence |
| `public/js/demo.js` | 7-step guided demo |
| `scripts/` | city and basemap builders from OSM, asset preparation, model benchmark |
| `test/` | unit tests (`npm test`) · `e2e/` browser scenarios (`npm run e2e`) |
