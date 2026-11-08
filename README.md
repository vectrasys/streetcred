# StreetCred

**Good deeds. Real credit.**

*Demo city: Port Calloway (fictional).*

A neighbor clears the dumped bags on their street. The camera that already watches that corner checks
the spot is really clean, and the program pays the reward through **PayPal Payouts**. StreetCred
turns small civic fixes into verified work with a paper trail. Built for the PayPal AI Hackathon.

> **Demo status, plainly:** Port Calloway is a fictional demo city. All data is sample data, not actual income. All PayPal calls go to the **PayPal
> sandbox** (the API host is hard-coded). Camera frames are a CC0 photo and AI-generated images, and
> 40 residents are fictional. There are no real cities, sponsors, paying customers or real-money
> payouts. Program history (e.g. totals and payout counts on dashboards) is **seeded sample data**, not
> executed PayPal payments. The one recorded sandbox batch is in `data/recorded-sandbox-evidence.json`.
> See [docs/DEMO_HONESTY.md](docs/DEMO_HONESTY.md).

**Cameras verify the deed, not the face.** No face recognition, and no faces are stored. The
volunteer checks in by showing a one-time QR code to the camera.

## How a deed is verified

1. **Pixels, at the camera (edge).** The QR from the frame must be valid and unused. "Before" and
   "after" must come from the same camera (correlation outside the task zone). Lighting of "after"
   is matched to "before". The task zone must change while the background stays the same.
2. **A vision model** sees a crop of the task zone and gets one question: *"Is this place clean?"*.
   "Before" must be *no*, "after" must be *yes*. Money moves only when pixels and model agree;
   otherwise the claim is rejected or sent to a human reviewer.
3. **Approved deeds are paid in one PayPal Payouts batch** per business day with an idempotent
   `sender_batch_id`, so a retry can never pay anyone twice.

Why that question? Measured on the project's frames (`scripts/bench-photo-vision.mjs`, qwen2.5vl 3B):

| # | Prompt | Correct |
|---|---|
| 1 | Side-by-side "before \| after", "was it done?" | ~50% (almost always "yes", would approve cheating) |
| 2 | Whole frame, "is there a problem?" | 6 / 8 |
| 3 | Whole frame, "is this place clean?" | 7 / 8 |
| 4 | **Task-zone crop, "is this place clean?"** | **8 / 8** |

That is **4 curated before/after photo pairs (8 frames)**, recorded in `data/recorded-model-evidence.json`. It shows the prompt design works on these images. It is **not** a measure of accuracy in the field.

## PayPal integration

- **Payouts** (`src/paypal.js`): batch per business day (cut-off 5:00 pm PT). Item statuses SUCCESS /
  UNCLAIMED / RETURNED / ONHOLD / PENDING. Money moves through double-entry accounts
  `program_budget → payable → in_transit → paid_out | returned`.
- **Checkout** (Orders v2, JS SDK): "Boost this reward" lets anyone add money to a task.
- **Treasury Copilot** (`src/agent.js`, admin → Copilot): an AI agent built on the **PayPal Agent
  Toolkit**. It reads sandbox orders, transactions, disputes and invoices plus program data. It
  reconciles boosts against PayPal orders with a deterministic tool, and *proposes* refunds and
  sponsor invoices. Nothing executes until a human presses **Approve**. The sandbox host is enforced,
  and requests to `api.paypal.com` / `api-m.paypal.com` are blocked.
- **Webhooks**: received events are recorded. Signatures are not verified in the demo, so webhook
  events never move money.

## Run locally (judges: start here)

Requirements: Node.js 22+. **No PayPal credentials and no AI model are needed for the guided demo.**

```bash
npm ci                       # includes the pinned Wrangler CLI (devDependency, wrangler 4.147.0)
npm run dev -- --port 8790   # predev embeds assets, versions the basemap, builds the edge camera
```

Then open **http://localhost:8790/demo**.

- **This is the default path on a fresh checkout.** Without a model, `/demo` runs every camera check
  for real. The AI step is reported as unavailable, the deed goes to **human review**, and nothing is
  paid — the payout step answers "Waiting for a human reviewer — no payout yet". This is the intended,
  safe behaviour: StreetCred never pays on pixels alone. The page shows the model's **recorded**
  answers for the same spot (`data/recorded-model-evidence.json`), clearly marked as not live.
  `/demo?model=off` shows the same branch on purpose.
- Use `npm run dev`, not `npx wrangler dev` directly: on a fresh checkout the direct call skips the
  predev step.

**Optional — live AI inference** with [Ollama](https://ollama.com):

```bash
ollama pull qwen2.5vl:3b && ollama pull qwen3:4b-instruct-2507-q4_K_M
npm run dev -- --port 8790 \
  --var OLLAMA_URL:http://127.0.0.1:11434 \
  --var OLLAMA_VISION_MODEL:qwen2.5vl:3b \
  --var OLLAMA_AGENT_MODEL:qwen3:4b-instruct-2507-q4_K_M
```

With the vision model running, `/demo` can approve the cleaned spot when pixels and model agree, and
then shows a **simulated** receipt — it never calls PayPal. The model may still disagree and send the
deed to human review; the 8/8 result below is on curated frames, not a guarantee. The agent model
powers Treasury Copilot (read-only question on `/treasury.html`). Check the model is detected with
`curl -s localhost:8790/api/demo/evidence` (`"ai": {"available": true, ...}`).

The first answer after a cold start takes longer while Ollama loads the model into memory.

**Optional — PayPal sandbox credentials**, only for testing the program's own payments (admin Payouts
batches, "Boost this reward" Checkout, Copilot PayPal lookups). They are not needed to judge `/demo`.

```bash
cp .dev.vars.example .dev.vars   # fill in your own PayPal *sandbox* app credentials
```

Tests: `npm test` (99 unit tests, no network; `pretest` rebuilds the generated files). Browser
scenarios: `npm run e2e -- http://localhost:8790` (Playwright; add `--skip-ai` without models). They
never call PayPal unless you add sandbox credentials yourself.

Sign-in is a demo picker: any of the 40 fictional residents, or the program manager (Dana Whitfield),
who can open `/admin.html` and `/treasury.html`.

## Site map

| # | Page | What it shows |
|---|---|
| 1 | `/demo` | **Guided demo, start here.** One deed end to end in 7 steps: Dirty spot → Claim → QR check-in → The work → Camera + AI check → Proof → Payout status. Runs on an **isolated demo copy** of the program (it never touches the program state). The camera check runs in the browser like an edge camera. The one-time QR, the decision and the AI question run on the server through the same code path as the program. The payout step returns a **simulated receipt** (`SIM-…`, "not sent"): no PayPal API call. Visitors can also switch the model off to see the human-review path, labelled as a simulated outage. After an approved check it shows a before/after compare slider (keyboard-accessible), "Reward approved" and, separately, "Payout pending · simulated, not sent". The page also shows the recorded model evidence and the recorded PayPal sandbox batch. After an approved run, the map shows a separate marker **"Completed in your demo · Simulated"** (sessionStorage only; the real task and ledger are unchanged; cleared on a new run, rejection or human review). |
| 2 | `/pilot.html` | **Pilot template** for a campus, an HOA or a business park: six-week scope, an example budget that the organisation sets itself, conditions, timeline, disputes and what to measure. It states plainly that StreetCred has no pilot customers yet and that the figures are an example, not results. |
| 3 | `/treasury.html` | **Treasury dashboard** (program manager sign-in): payouts, tasks and ledger in a filterable grid, with source and provenance for every record. Seeded historical rows are labelled as fixtures, not executed payouts. The assistant question runs **read-only** (`readOnly: true`): it reads local program records only, makes no PayPal calls and creates no proposals. Money actions always need a person. |
| 4 | `/` | Map and list of tasks in the demo city (vector basemap from OSM geometry). Practical filters: **Nearby** (location only after you press it), **No special tools**, **Solo-friendly**; each task shows demo guidance on tools and team size |
| 5 | `/heroes.html` | **Community impact**: neighbors ordered by deeds confirmed in this program session, then name. Sample history and sample rewards are kept apart and labelled as demo data |
| 6 | `/about.html` | Fictional city history and districts |
| 7 | `/how.html` | Steps, how cameras check, payouts and PayPal statuses, taxes (W-9), privacy, FAQ |
| 8 | `/account.html` | **Resident profile**: current task, contribution history with the actual before/after evidence of deeds confirmed in this session (demo-camera frames, not real-world work), reward approval and payout status kept separate, payouts with their source |
| 9 | `/admin.html` | Program admin: budget, live verification, manual review, moderation, Payouts batches (PayPal sandbox), ledger, cameras, webhooks, audit log, Treasury Copilot (proposals need **Approve** by a person) |

## Architecture

- Cloudflare Worker (`src/worker.js`) serves static pages from `public/` and the `/api/*` routes.
  A Durable Object keeps one shared city state.
- Heavy pixel work runs at the "camera" (`src/edge-camera.js` → `public/js/edge-camera.js`). In the
  demo the browser plays the camera. The server checks the one-time QR, applies thresholds
  (`judge` in `src/verify.js`) and asks the model.
- Models: Ollama locally, or Cloudflare Workers AI when deployed.

## Limitations

- Camera frames are photos and generated images rasterized by the browser, not live streams.
- In the demo the "camera" is the resident's browser, so its observations could be forged. The model
  still looks at the before/after crops. A real deployment needs city-owned cameras that sign their
  observations.
- All sandbox payouts go to one test receiver.
- Full automatic verification covers the tasks that have a before/after frame pair. Other tasks go to
  a human reviewer.
- City state lives in memory and resets to demo data after idle.

## Licenses

Original code and documentation: [MIT License](LICENSE), Copyright (c) 2026 the owner named in
`LICENSE`. The MIT License does not cover third-party material: map data © OpenStreetMap
contributors (ODbL 1.0, files `data/basemap.json`, `data/city.json`, `public/data/basemap.*.json`);
photos, AI-generated images, fonts, models and libraries keep their own terms — see
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
