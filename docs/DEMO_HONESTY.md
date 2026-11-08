# What is real and what is simulated

The demo has to be judged on what it actually does, so this page separates the two.

| # | Part | Status in this demo |
|---|---|
| 1 | City, districts, streets, residents, program manager | **Fictional.** Street geometry comes from OpenStreetMap. Every name is invented, and portraits are AI-generated people who do not exist. |
| 2 | Camera frames | **Not live cameras.** One CC0 photo (Wikimedia Commons) and AI-generated frames. "After" frames are the same images with the problem removed by an inpainting model. The browser rasterizes them as a camera would. |
| 3 | One-time QR check-in | **Real code path.** The QR is generated, read from the frame and marked as used. |
| 4 | Pixel checks (same camera, lighting, zone change) | **Real code path**, running in the browser as the "edge camera". |
| 5 | Vision model "is this place clean?" | **Real model call**: qwen2.5vl 3B through Ollama locally, Workers AI when deployed. 8 / 8 on **4 curated before/after photo pairs** (`data/recorded-model-evidence.json`). That is a design check on these images, not field accuracy. |
| 6 | PayPal Payouts | **Real PayPal sandbox API calls.** No real money. All items go to one sandbox test receiver. |
| 7 | PayPal Checkout "Boost this reward" | **Real PayPal sandbox order** (Orders v2 / JS SDK). No real money. |
| 8 | Treasury Copilot | **Real agent** on PayPal Agent Toolkit against sandbox data. On the admin page it only *proposes* refunds and invoices, and a human approves each one. On `/treasury` it runs **read-only** (`readOnly: true`): it reads local program records only, makes no PayPal calls and creates no proposals. |
| 9 | `/demo` guided flow | Runs on an **isolated demo copy** of the program. QR, verification and the AI question use the real code path. The payout step shows a **simulated receipt** (`SIM-…`, "not sent"): no PayPal call and no money. The "model off" option is a labelled **simulated outage**. |
| 10 | `/pilot.html` | A **proposed template** with an example budget. No pilot customers, no results. |
| 11 | Budget, ledger, heroes, program history (e.g. "$2,870 · 119 payouts") | **Seeded sample program data**, not executed PayPal payments. Actions you take during a session are added on top, and state resets after idle. |
| 12 | Recorded sandbox evidence | `data/recorded-sandbox-evidence.json`: one earlier PayPal **sandbox** Payouts batch (3 items, $75.00, SUCCESS, 2026-10-02) with its source. It is recorded, not re-queried. |
| 13 | Webhooks | Recorded only. Signatures are not verified, so they never move money. |
| 14 | Sponsors, partner cities, pilots, paying customers | **None.** Any sponsor, pilot or partner shown in the UI is a labelled example, not a real organisation or agreement. |

## Demo video

The 89.5-second demo video follows the same rules, with these specifics:

- About 37 of the 89.5 seconds (~42 %) are real app UI recorded from the running app; the rest are
  edited scenes built from app captures and generated frames (story beats, approval stamp, receipt).
- **The main task (T-2001) is $25.00 in the app and in the video.** The video was cut while the app
  still had $15.00, so three frames (map pin, task card, receipt amount) show $25 painted on; the app
  data now matches (since 2026-10-13). No payout was sent for T-2001, and no historical transfer of
  $25 is claimed.
- "Her reward arrives in PayPal, with a receipt in her name" describes how the program would pay an
  approved deed. In the app, `/demo` only shows a simulated receipt; the one real sandbox batch is the
  recorded one above.
- The narration is a synthetic voice (Kokoro TTS); see the video credits for voice and music.

Captions and on-screen labels say when a screen shows a fixture, a sandbox call or a local model.
