# Novus

A BitLife-style life sim for a *company*. Time only moves when you tap the
advance button — and a fiscal year only closes when you pitch on camera to a
panel of AI shark investors and survive their questions.

Next.js App Router · TypeScript · Tailwind v4 · React Three Fiber · Framer Motion.

**Look:** the visual design is taken from `Novus iOS App.html` (the iOS prototype
v2) — its light palette, mascot-led masthead, stat rings and card language. Two
deliberate departures: the mascot is the **live GLB** rather than a chroma-keyed
video, and the whole thing sits on a real engine. Light is the default theme;
the moon/sun control in the masthead switches to the prototype's dark palette.
Onboarding, the camera and the panel stay on brand navy, as they do in the
prototype.

```bash
npm install
npm run dev            # http://localhost:3000
npm run build:native   # the bundle the iOS and Android apps ship
npm run ios            # …and open Xcode
```

**The app:** the same code runs in a Capacitor shell on both stores. On iOS the
tab bar, the advance button and the masthead controls are withdrawn from the
DOM and re-drawn by UIKit, so they are the system's own Liquid Glass rather
than a CSS impression of it — and the height they take is measured after
layout and handed back as a CSS variable, so nothing is ever occluded by a
number somebody guessed. See **[docs/APP.md](docs/APP.md)**.

**Nothing is sold inside the app.** Pro is bought on the web and attaches to a
Novus account, so a store build carries no price, no checkout and no link to
one — App Store Guideline 3.1.1, and Google Play's Payments policy, say the
same thing. The rule is one file, `lib/commerce.ts`; what App Review looks for
and what is still a form to fill in are in
**[docs/APP-STORE.md](docs/APP-STORE.md)**.

> If `npm install` fails with `EACCES … .npm/_cacache`, the npm cache has
> root-owned files from an old npm bug. Either run
> `sudo chown -R $(id -u):$(id -g) ~/.npm`, or install with a local cache:
> `npm install --cache .npm-cache`.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm run build` | Regenerates `data/events.json`, validates it, builds |
| `npm run events` | Merge `data/sections/*.json` → `data/events.json`, then validate |
| `npm run sim [runs] [years]` | Headless balance harness against the real engine |
| `npm run check` | events + typecheck + a 30×8 simulation |
| `npm run test:db` | Applies every migration to a scratch database and runs the RLS suite |
| `npm run build:native` | Static export for the apps, then `cap sync` |
| `npm run audit:phone` | Type, tap targets and occlusion at 320–430px |
| `npm run ios` / `npm run android` | Build, sync, open the native project |

## How it fits together

```
design/NOVUS_EVENT_LIBRARY_B1.md   authored content (humans edit this)
        │  converted by hand/agent per design/EVENT_SCHEMA.md
        ▼
data/sections/A–N.json  ──merge──▶  data/events.json  ──▶  the engine
```

**`lib/engine/`** is the whole game, and it is pure TypeScript with no React in
it — which is why `scripts/simulate.mjs` can play thousands of years headlessly.

- `run.ts` — `advanceMonth()` is **the only function that moves time**. Month 12
  refuses to advance and reports the gate instead; `closeYear()` is reachable
  only with a `PerformResult` in hand.
- `sim.ts` — quarterly tick, burn, runway, valuation, stage promotion, Chapter 7.
- `effects.ts` — applies authored outcomes: S-unit money, durations, delayed
  effects, probabilistic and conditional branches, and the ±15% luck band that
  **never flips the sign** of a result.
- `events.ts` — weighted draw with cooldowns, flag gating, category anti-repeat,
  targeted pressure on your weakest stat, and date-seeded Today's Market.
- `autopsy.ts` — ranks the decisions that actually killed you by realized cash
  and burn damage, with authored autopsy magnets outranking everything.

## The content pipeline

All **237 authored events** are converted, not rewritten: `title`, `text`,
reskins and narration are verbatim from the library. `data/sections/*.json` is
the editable source of truth; `data/events.json` is generated.

`npm run events` fails the build on structural errors and reports two things it
deliberately tolerates:

- **flags gated on but never set** — a dead gate, always a content bug.
- **special tags the engine doesn't implement** (~139 of them). These are
  authored mechanics beyond the stat vocabulary. They degrade to a queryable
  flag and are listed every run, so nothing disappears silently. Implementing
  one means adding a case to `applySpecial()` in `effects.ts` and a name to
  `KNOWN_SPECIALS` in `scripts/validate-events.mjs`.

## What is real and what is stubbed

**Real:** the camera and microphone. `getUserMedia`, `MediaRecorder`, the
permission and denial flows, the Web Audio level meter, the recording clock.

**Stubbed:** only the intelligence. `lib/ai/stub.ts` implements the `AiAdapter`
interface with canned fixtures at 600–1200 ms of simulated latency. The output
shapes are copied **verbatim** from the prompt pack, so going live is a one-line
swap behind the same interface with no UI rework:

| Interface | Stub source |
|---|---|
| `transcribePitch` | `fixtures/transcripts.json` — verbatim style, disfluencies preserved |
| `scoreLanguage` | `fixtures/coach-reports.json` — Language Coach schema |
| `runPanel` | `fixtures/panel-scripts.json` — three score bands, offers rescaled to your books |
| `debrief` | `fixtures/debriefs.json` — Debrief Analyst schema |
| `sharkRespond` | `fixtures/shark-lines.json` |
| `generateBusinessBrief` | `fixtures/briefs.json` |
| `speak` | browser `speechSynthesis` |

The verbatim prompt texts live in `lib/ai/prompts/` for that swap. **Note:** the
Business Generator prompt is absent from the source pack (it is only referenced),
so `PublicBrief` in `lib/ai/types.ts` is inferred and marked as such.

Adapters are pure functions today; when they go live they must move behind route
handlers so no key ever reaches the client.

Three of them already have. Voices, transcription and cold-call verdicts run on
ElevenLabs, Deepgram and OpenRouter through `app/api/{tts,stt,pitch}/route.ts`,
where the keys stay — each is independent, and each falls back to a complete
local path when its key is unset, so an unconfigured deploy loses polish and
never function. `npm run test:ai` asserts the contracts without spending a
request; `npm run test:ai -- --live` says whether your own keys work, which is
the answer to "I set them and nothing happened."
[docs/AI-SETUP.md](docs/AI-SETUP.md) covers the rest — the caps, the casting,
and the one key that sends a child's voice to a third party.

## Persistence, accounts and money

`localStorage` is the cache the game reads; Supabase is the durable copy behind
it. `lib/engine/save.ts` stays synchronous because its callers read it during
render, so every local write also queues a debounced push through
`lib/cloud/sync.ts` to `/api/sync`. A player without an account sends nothing
at all — no identity is minted for a visitor, and the game runs on localStorage
alone, which is a supported way to run Novus.

Email-and-password accounts are in `app/api/auth/*`, Stripe is in
`app/api/billing/*`, and **the webhook is the only thing that grants a paid
entitlement** — a success URL proves only that somebody reached a URL. Setup
lives in [docs/ACCOUNTS-SETUP.md](docs/ACCOUNTS-SETUP.md),
[docs/SUPABASE-SETUP.md](docs/SUPABASE-SETUP.md) and
[docs/STRIPE-SETUP.md](docs/STRIPE-SETUP.md).

Access control is row-level security, not route code: everything on the player
path runs as the signed-in player with the anon key, so the database is what
refuses. `supabase/tests/` proves that, and **`npm run test:db` is what makes
it a proof** — it builds a scratch database per suite, applies all five
migrations, and asserts each claim (`test.throws('42501', …)` for the refusals).
CI runs it on every pull request. You need a Postgres to point it at:

```bash
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16
DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db
```

## The shark

Rendered live from `public/shark/shark.glb` with React Three Fiber on a
transparent canvas — **never chroma-keyed at runtime**. The supplied mesh has no
rig and no animation clips, so the four states (idle, listening, thinking,
celebrate) are procedural in `SharkStage.tsx`; the listening lean tracks your
actual mic level. Without WebGL it falls back to a still mark, never a keyed
video. The four source `.mp4`s are in `public/shark/` awaiting the offline
alpha-encode described in the build prompt (this machine has no ffmpeg).

## Balance

Tuned against `npm run sim`, not by guesswork. Current curve, 50 runs × 10 years:

```
survived to year 10:  38%          median death year:      5
median valuation:     $279M        median year revenue:    $132K
distinct events seen: 177 / 237    runtime errors:         0
```

Losing stings and most of the library is reachable. The knobs are in
`lib/engine/constants.ts`; every number the GDD did not specify is marked
`INFERRED`. Two that matter most: `organicGrowth` (stage-decayed — without the
decay the late game runs away to absurd valuations) and the year-end ask, which
is sized to buy a year of runway rather than a fraction of valuation.

## Brand laws enforced in code

- `#FF6B00` is the only colour that asks you to do something. Solvency green is
  financial upside only; prestige gold is the year gate, stage-ups and badges.
- Real words only — burn rate, runway, dilution, Chapter 7. No coins, no XP.
- Rookie Mode **adds** a plain-English line; the real term is always present.
- Nothing purchasable touches score, survival, revives, or the leaderboard.
- The year cannot close without a scored camera performance.

## Not built yet

- **Tutorial spotlight coaching.** Term-on-first-use, Rookie Mode and the
  unfailable first year all work; the dim-and-cut-a-hole overlay does not exist
  yet — the tutorial currently teaches through the shark's narration.
- **Still Standing, the Closet economy, Practice Gym, Marco's rival sim.**
- The event queue is React state, so a mid-card reload drops that card. The run
  itself survives.
