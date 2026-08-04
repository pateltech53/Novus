# Novus guide capture — manifest

Full company life of **"Marrow & Co"** (Food & Beverage, founder "Zach", guided year skipped), played
against the local AI stub at 1920×1080 in headless Chromium with a fake camera/mic
(`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`). Year 1 was played to the gate,
pitched on camera, defended in The Tank, a deal signed with Marcus Cole ($14K for 40%), and Year 2 opened.

General notes that apply to several files:

- The app's AI status toast ("Shark voices is using the local fallback" / "4 AI features are using local
  fallbacks") floats over the bottom of some frames — that is the offline stub announcing itself, not a bug.
- Headless SpeechRecognition hears nothing, so the pitch and all Tank answers went through the app's own
  typed-rescue / "Type it instead" paths. Typed input is scored identically by design.
- The founder's camera PiP shows Chromium's fake-device pattern (solid green with a spinning wedge) wherever
  the camera is live.
- The pitch/recording screen renders some labels in white on the light theme (mic-rescue label, "WHAT THEY
  HEARD") — low contrast in these shots is the app's light-theme styling, not a capture artifact.

## Screenshots

| File | Shows | Odd / notes |
|---|---|---|
| 01-landing.png | Marketing landing page at `/` — "Keep a company alive. Defend it out loud.", tuxedo shark, CREATE ACCOUNT | |
| 02-welcome.png | `/welcome` onboarding gate — tier-5 founder, "Run a company. Defend it out loud.", START | voice-fallback toast sits over the START button |
| 02-welcome-name.png | Onboarding — "What should the shark call you?" name step (bonus) | |
| 02-welcome-plans.png | Onboarding — "Free is the whole game. Pro is more rooms in it." plans step, CONTINUE FREE (bonus) | |
| 03-found-1.png | `/found` paperwork — HE/SHE founder pick, company-name field, industry grid with Pro locks | |
| 03-found-2.png | Founding — "Marrow & Co" typed, Food & Beverage selected | |
| 03-found-3.png | Founding — "WHAT THE COMPANY IS" brief expanded, offline writer's first draft filled in | |
| 04-play.png | The play screen — mascot stage, BRAND/QUALITY/MORALE rings, CASH/BURN/RUNWAY/VALUATION ledger, ADVANCE MONTH capsule + JAN → FEB badge, six-tab bar | desktop two-column composition |
| 05-tabs-company.png | COMPANY tab — dossier sheet | |
| 05-tabs-team.png | TEAM tab — roster/hiring screen | |
| 05-tabs-product.png | PRODUCT tab — quality and product actions | |
| 05-tabs-assets.png | ASSETS tab — holdings, buy/sell | |
| 05-tabs-market.png | MARKET tab — the in-game phone rises, on its lock screen ("SWIPE UP TO UNLOCK", shark wallpaper); RobinGhood lives behind the unlock | phone shows lock screen, not the trading app itself |
| 05-tabs-closet.png | CLOSET tab — earned wardrobe / cosmetics | |
| 06-advance.png | ADVANCE MONTH pressed — the month turns, the month's event arrives | event card mid-entry by design |
| 07-decision-1.png | A decision card — MILESTONE "Price Tag Panic": situation, COGS/CWP explainer, choices with known tradeoffs | |
| 07-decision-2.png | The choice being committed — first option held mid-press | press effect is subtle (slight scale) |
| 07-decision-3.png | Decision committed — ledger updated ($23K cash) and the next event (TODAY'S MARKET card) already on screen | months chain immediately; the outcome lands in the ledger/log behind the next card |
| 08-months-1.png | A later-month event — MARKETING "The Viral Accident", with the life-log behind it showing months 2–3 progressing and "The Books move" deltas (Revenue +3%, Energy −2) | |
| 08-months-badge.png | Mid-year play screen — month badge progressed to JUN → JUL | |
| 09-gate-button.png | Month 12 — the advance capsule turned gold: 🔒 CLOSE THE YEAR, DEC → GATE badge | |
| 09-gate.png | The year gate — "Pitch me", FISCAL YEAR 1 · THE GATE, four beats, company brief card, OPEN THE CAMERA + CHECK YOUR NUMBERS | |
| 10-pitch-1.png | Camera open — draggable self-view PiP (fake camera), shark stage, THE COMPANY/THE NUMBERS/THE ORDER notes, level meter, START TALKING | |
| 10-pitch-2.png | Recording live — REC timer on the PiP, KEEP GOING countdown, delivery-coach line, mic-rescue textarea filled with the typed pitch | typed-rescue path; white-on-light labels (see general notes) |
| 11-panel-1.png | The Tank — the five-shark set at full strength, Chair reads the ask into the record ($19.6K for 40% = $49.1K company), founder PiP bottom-right, LET THEM ASK | the Chair's opening line appears twice in the log — Next.js dev-mode double-effect, not present in a prod build |
| 11-panel-2.png | A shark's question (Marcus Cole, THE LEDGER) with the room waiting — ANSWER OUT LOUD / Type it instead / STUCK? · 2 LEFT / SAY NOTHING | |
| 11-panel-3.png | The verdict — 5 offers ON THE TABLE, each with its math (amount ÷ equity = implied valuation), TAKE NO DEAL underneath | |
| 11-panel-4.png | Offer selected (Marcus Cole, $14K for 40%) — SIGN IT | |
| 11-panel-5.png | The score card after the room — score /10, coverage bars, the seven beats, "what you actually said", READ THE FULL BREAKDOWN | |
| 12-verdict-1.png | The Tank debrief — "You sold 40% for $14K, valuing the company at $35K", PITCH 6/10 · THE DEAL 7/10 · OVERALL B, structure coverage 4/7, what was missing / wasn't clear | |
| 12-verdict-2.png | Year-end statement — Fiscal Year 1 "Closed out loud. Score 5.8/10", revenue/profit/cash/valuation, YEAR 1: SURVIVED badge, next year's allocation choices | |
| 12-verdict-3.png | Year 2 begins — FY 2 · Garage, JAN → FEB, valuation $39.5K with the deal on the books, Brand 50 after the Marketing allocation | AI-fallback toast over the tab bar |

## Clips (1920×1080 webm)

| File | Shows | Odd / notes |
|---|---|---|
| clip-advance.webm (7s) | The play screen settling, ADVANCE MONTH pressed, JAN → FEB turning to FEB → MAR and the month's event card sliding in | first ~2s is the page settling after load |
| clip-decision.webm (12s) | The month's decision card ("Price Tag Panic") read, each choice hovered in turn, first choice committed, the next event arriving on the books | |
| clip-pitch.webm (25s) | CLOSE THE YEAR pressed, the gate brief, OPEN THE CAMERA, live self-view PiP, START TALKING, ~8s of the REC timer running with the shark listening | fake-device camera pattern in the PiP |

## Not captured

- **Chapter 7 / company death** — the run survived Year 1 (that is the real outcome of this playthrough), so
  no Chapter Seven screen exists to capture.
- **RobinGhood app past the phone lock screen** — the MARKET tab shot stops at the phone's lock screen; the
  swipe-to-unlock gesture was not driven.
- **The stance/positioning sheet** — the E-POS-ASK card never surfaced as a capturable moment in the final
  run (events are drawn per-run); month events shown instead.
