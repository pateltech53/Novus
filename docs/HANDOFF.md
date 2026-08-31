# HANDOFF — project history, current state, and open work

Written 2026-08-31 so that a session on a fresh account can continue this
project with zero ramp-up. Companion to the root **CLAUDE.md** (the rules and
the map); this file is the memory. History below is compiled from all 230
commits and 108 PRs on `pateltech53/Novus`.

The whole project was built 2026-07-28 → 2026-08-30, almost entirely by
Claude Code sessions working PR-by-PR (branches `claude/<topic>-<suffix>`),
with the owner (GitHub `zzzachariah`) reviewing, merging, and field-testing on
real phones. Bug reports sometimes arrive in Chinese; the fix commits quote
them verbatim.

---

## 1. Timeline — what was built, in order

### Era 1 · Foundation (Jul 28 – Aug 1, PRs #1–#13)

- **PR #1** imported the entire already-built web game in one commit (~40k
  lines): engine, 255 authored events, all core screens, and the governing
  docs (design.md, DO-NOT-TOUCH.md, LEADERBOARD.md, BUILD-PROMPT.md). Almost
  everything since is infrastructure around a finished game.
- **PR #2** Supabase: migrations 0001 (core) + 0002 (leaderboard), the RLS
  test-suite pattern, `/api/sync`, debounced cloud mirror. Invariants set
  here: `lib/engine/save.ts` stays synchronous; saves are local-wins;
  `playerAge`/`founderName` never leave the device; no IPs/device-ids in the
  schema, "not to be added later".
- **PR #3 (+#9, #10)** Stripe end-to-end: hosted checkout only (no stripe.js,
  no publishable key), webhook as the sole entitlement granter,
  price-vs-code cross-check, `/api/billing/status` diagnostics.
- **PRs #4–#6** the Capacitor shell: iOS UIKit Liquid Glass chrome (measured
  heights → CSS vars), native decision sheet, Android release workflow,
  `scripts/audit-phone.mjs`.
- **PR #7 (+#8)** email/password accounts + the first big adversarial pass
  (the e66b464 body is effectively the auth threat model). **Reversal:**
  anonymous-identity-per-visitor was ripped out — no account = nothing sent,
  ever; the helper functions were deleted "so this cannot quietly come back".
  Postgres rate limiting (HMAC'd IPs), Turnstile on sign-up (fail-closed).
- **PRs #11–#12** two whole-app native outages root-caused to duplicated
  origin config → single allowlist `lib/native/origins.ts` + build-time
  origin verification in `build-native.mjs`.
- **PR #13** landing-page WebGL loops made scroll-driven/demand-rendered.

### Era 2 · The shell wars and the AI tier (Aug 1 – Aug 3, PRs #14–#46)

- **The Capacitor routing saga (#15→#35):** the defining defect arc. True
  root cause: the iOS shell resolves extensionless paths to the ROOT
  index.html — so `/play/` served the marketing page. Everything now names
  `index.html` explicitly via `lib/native/href.ts`; `build-native.mjs` fails
  on stale bundles. Prior code comments asserting the trailing-slash rule
  were exactly wrong.
- **Liquid Glass built out, then gated:** glass spread across the app
  (#14–#39), then **#40 reversed the ambition** — glass is iOS-only; **#52
  retired CSS glass entirely** on every platform (owner's call, recorded in
  design.md §0; the material sits one unwritten `[data-css-glass]` attribute
  away).
- **AI tier stood up (#23, #25–#27):** the keys had been read by NO file —
  everything silently ran local fallbacks. Now: `/api/tts` (ElevenLabs),
  `/api/stt` (Deepgram), `/api/pitch` (OpenRouter), 501-latching clients,
  `GET /api/ai` diagnostics, `scripts/ai-test.mjs` contract suite.
- **The Tank went live (#30, #41):** replaced canned fixture scripts with a
  model-driven room grounded in `lib/engine/company-brief.ts` (the deck
  cannot contradict the books); offline twin `panel-local.ts`; the model
  never writes game numbers.
- **Leaderboard (#29):** clients submit input tapes; the server replays them
  against the real engine. The shared orchestration in
  `lib/leaderboard/replay.ts` is the same code GameProvider plays with.
- **Store compliance (#19, #20, #24, #36, #44):** `lib/commerce.ts` (store
  builds sell nothing), upgrade funnel, privacy manifest.
- **Chapters/B2B (#46):** classroom seat licences (DB-enforced caps),
  `/chapter` console, Resend invites, `APPLY-ALL.sql`.

### Era 3 · Operations and teachability (Aug 3 – Aug 4, PRs #47–#58)

- **Admin console (#47, #49, #50):** `profiles.role` flipped only in the
  Supabase dashboard (guard trigger blocks self-promotion); gifting lives in
  `comp_*` columns beside webhook-owned `pro`; every action audited;
  hand-rolled SVG analytics; checkout skip-or-real fork for operators.
- **Pre-investor security pass (#55):** TTS relay closed, AI payload caps,
  invite-link expiry, webhook re-reads subscriptions from Stripe, deletion
  winds down owned chapter licences, security headers (CSP deliberately
  deferred at this point).
- **Live-ops (#56):** heartbeat propagates deletions/revokes to open devices;
  table-by-table purge; STT went audio-only (~1MB, preserving "video never
  leaves the device"); gibberish scores zero; Tank skippable from year 4
  (verifier enforces years 1–3); free tier paced.
- **Teachability (#55–#58):** stable mobile tutorial, StageGuide,
  KeyTermsSheet from one shared GLOSSARY, '?' explainers on decisions.
  **Settled by revert:** /play keeps its scroll (a no-scroll column clipped
  The Books); the desktop keeps its compact rail.
- **The ledger (direct to main, 3f53c5e):** `lib/engine/ledger.ts` — the one
  sanctioned engine-adjacent addition (observation only, sampled pre-tick,
  sim byte-identical) and the template for how to route around protected
  files. Radius budget settled (22/14/10/6). Phone masthead became a 76px
  identity row.

### Era 4 · Performance, desktop, islands, widgets (Aug 4 – Aug 7, PRs #59–#89)

- **Performance overhaul (#62, #64):** bundle budgets now fail builds
  (`scripts/bundle-report.mjs` in `npm run build`); /play code-split; mic
  level left React entirely; save writes coalesced 120ms with deliberate
  drop-not-flush on wipe.
- **Motion system (#63):** ~30 ad-hoc transitions → named tokens in
  `components/ui/Motion.tsx`, enforced by `validate-motion.mjs`; the
  real-browser probe-script habit starts here (`exit-audit.mjs`).
- **Desktop three-column workspace (#65, #66):** activity screens dock as
  panels above 64rem.
- **Auth flows (#60, #61, #70, #71, #78):** invite completion on
  `/join/setup`; OAuth (Google/Apple) off-by-default behind
  `NEXT_PUBLIC_OAUTH_PROVIDERS`; `lib/plan.ts` as the single source of plan
  wording; under-13 age gate (#83).
- **Islands (#72, #79, #80):** up to 50 concurrent companies per device
  (2 free / 10 Pro / +bought), migration 0013 renamed
  `extra_run_slots → extra_islands`; four latent single-company bugs fixed;
  `islands-test.mjs` guards the 120ms write-buffer ordering.
- **Widgets (#81–#86):** the NovusWidgets extension target (iOS 17 floor):
  nine surfaces + two Live Activities + Dynamic Island, reading an App Group
  snapshot; Swift ports of market/format math kept honest by a generated
  fixture (`npm run market:fixture`, CI-checked). Widgets show
  Brand/Quality/Morale — the weakest stat on tiny slots (threshold 45
  deliberately copied, not imported, from protected `events.ts`).
- **Native hardening (#73–#75, #89):** the "UIKit fails silently" arc —
  sheetPresented watchdog with DOM fallback, measured panel heights,
  additive safe-area vars, `data-notch` first-paint floor.

### Era 5 · The conversation, content depth, rewards (Aug 7 – Aug 30, PRs #90–#108)

- **The Tank became a real conversation (#92):** `panel-dynamics.ts` encodes
  every shark relationship as data shared by live and offline rooms; joint
  offers; echo/tic guards; message-thread UI; 400-session fuzz.
- **CSRF + CSP shipped (#93):** `crossSite()` on twelve previously unguarded
  routes (PUT /api/sync the critical one); CSP with reasoned
  `'unsafe-inline'` (nonces force every page Dynamic; `connect-src 'self'`
  is the real defence); HSTS/COOP/CORP.
- **Chrome fixes + the 300ms kill (#90, #94–#96):** the /play nudge became a
  native glass panel after in-flow placement proved mathematically
  impossible; `lib/warm.tsx` replaced `dynamic()` for tap-opened overlays
  (~315ms → 14–20ms, `test:tap` guards it).
- **Pricing rework (#97):** typed price with 100×-anchor ceiling made safe by
  monotonic revenue decay past 1.6× (sub-1.6× curve byte-identical;
  `test:pricing`).
- **/product story + chapter repricing (#99–#102):** $799/35 and $1,599/100
  seats (`chapter_100` → Stripe product `prod_V4J52t9fUOcrVm`); the
  scroll-scrubbed story engine was replaced by timed-play slides after user
  feedback ("得一点一点滑").
- **Admin truth + auto-submission (#103):** paid status = union of
  entitlements and billing_customers with a Stripe RECONCILE endpoint;
  leaderboard submission became automatic (year close / company end / board
  open).
- **The big mobile wave (#104):** shark GLB decimated 457k→65k triangles
  (-v2 filenames); free tier = 1 year-close/day enforced in the engine on
  both paths; The Room rebuilt as Index → copy a 555-01xx number → dialler
  (FOOD/ECOM/FITNESS deliberately have no phone); year-2 repetition fixed.
- **The Playbook (#105, #106):** 17 → 48 shared activities, 9 with
  second-question branches; tape gains an additive `option` field; wardrobe
  re-costed to fiscal-year achievements with a sticky ledger; 4 progression
  rules recorded in docs/PROGRESSION.md.
- **Briefcases (#107, #108):** gacha-style reward loop **behind a per-account
  beta flag** (`entitlements.rewards_beta`; all /api/rewards/* 404 without
  it). Server-authoritative rolls (client never rolls; migrations 0017/0018),
  token shop never touches money, no reward grants permanent Pro. Art
  pipeline: 212 of 244 Gemini-generated assets shipped, 32 still missing.

---

## 2. Current state (at `main` = 337c7fb, 2026-08-30)

A playable, monetized company life-sim on web + iOS + Android. Everything in
the Era 5 summary is live on main. CI is green. The balance harness at HEAD
measures (seed 1, frozen clock): `sim 30 8` → 40% survival, median death
year 4; `sim 50 10 1` → 44%, $81.8M median valuation, 197/289 events seen,
0 runtime errors. (These supersede every table in BASELINE.md — the event
pool grew to 289 after its last re-baseline. Re-baseline on the untouched
tree before judging any shift.)

### In-flight work (open PRs — both based on early-August main, expect conflicts)

- **[#98 Paying in a browser now ends in the app](https://github.com/pateltech53/Novus/pull/98)**
  (branch `claude/price-adjustment-improvements-1zdr30`, +1156/−41): the
  web-checkout → app return hop (`novus://purchase` + foreground re-read), an
  Android `novus` intent-filter, and a signed account-hint (`?h=`) so
  checkout refuses a signed-into-a-different-account mismatch. Adds
  `test:handoff` (15 assertions). Worth landing: it closes a real "paid and
  nothing happened" hole.
- **[#91 Onboarding was a one-way corridor](https://github.com/pateltech53/Novus/pull/91)**
  (branch `claude/dynamic-island-widgets-4et73x`, +365/−4): BACK + HOME
  (native Liquid Glass on iOS) in onboarding; `--nv-overlay-top` third
  padding term; registers `test:safearea` in package.json (the script exists
  but the manifest entry was lost). Answers a direct owner request (the
  Chinese quote in the PR body).

The other ~33 unmerged `claude/*` branches on origin have **no open PR** —
they are squash-merge residue or superseded experiments. Treat them as
history, not as work to finish.

### Known open items (inherited TODO list, roughly prioritized)

1. Regenerate `supabase/APPLY-ALL.sql` for migrations 0017/0018 and add
   0014/0015/0017/0018 rows to `CHECK-SCHEMA.sql` — a fresh deployment from
   APPLY-ALL alone currently lacks the whole rewards schema.
2. Write an RLS test suite for the rewards tables (0017) and add it to
   SUITES in `scripts/db-test.mjs` — "the client never rolls" is currently
   asserted only by the migration's policy shape.
3. Regenerate the 32 missing briefcase renders once Gemini credits/billing
   allow (`npm run art:briefcase -- status`; 10 of the 32 are safety-filter
   refusals on formalwear that need reworded prompts). docs/BRIEFCASE-ART.md
   has the exact procedure.
4. Rewards beta: decide when to lift `rewards_beta` to everyone; BRIEFCASES.md
   lists the finish work (4 delivery templates dark, weekly challenge unread,
   bespoke SFX absent).
5. Split the activity registry off GameProvider — /islands pays ~9 kB of
   /play's Playbook prose for no reason (recorded in the #105 commit).
6. The §12.3 balance question: the design band wants 30–45% survival; the
   measured curve sits ~44–50%. An open design decision, not a bug — do not
   resolve it by accident.
7. Not built yet (per README): tutorial spotlight coaching overlay, the
   Closet economy / Practice Gym / Marco's rival sim; the event queue is
   React state so a mid-card reload drops that card (the run survives).
8. `public/intro.mp4` and `public/onboarding.mp4` do not exist — 
   INTRO-VIDEO-PROMPT.md / ONBOARDING-VIDEO-PROMPT.md are generation briefs.
9. www-vs-apex: `lib/seo.ts` uses the apex while the native API origin must
   be `https://www.novuspitch.com` (no-redirect rule) — flagged in lib/seo.ts
   as unresolved.
10. `.env.example` lines ~69/77–78 are stale (old chapter prices/ids, old
    `STRIPE_PRICE_EXTRA_RUN_SLOT` name — the legacy name still works).

### Dead ends — settled decisions, do not redo

CSS/backdrop-filter Liquid Glass anywhere in the DOM (retired, #52) · cross-
platform glass (#40) · the native theme picker (#42) · anonymous-session-per-
visitor (#7) · in-app Stripe checkout and SIMULATE PRO (#20) · the landing-
page boot redirect (#32) · desktop unified with the phone layout (dbd41a7) ·
no-scroll /play (49b598b) · Instrument Serif display voice (4f4c8eb) · the
scroll-scrubbed /product engine (38268d8) · CSP nonces (forces every page
Dynamic) · `dynamic().preload()` (doesn't exist on App Router) · third-party
fetches from SharkCanvas (#22) · enterprise self-serve checkout (#104) ·
in-flow placement of the /play nudge (#95).

---

## 3. What a new account needs (access inventory)

Secrets are never in the repo. The new owner/account needs access to, or
replacements for:

| Service | Used for | Where configured |
|---|---|---|
| GitHub `pateltech53/Novus` | source, CI, Android releases | Actions secrets: `ANDROID_KEYSTORE_BASE64/PASSWORD`, `ANDROID_KEY_ALIAS/PASSWORD` |
| Vercel (or equivalent) | web deploy of novuspitch.com; runs `npm run build` | all `.env` vars below |
| Supabase project | Postgres + auth; migrations 0001–0018 applied manually | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`; dashboard: Email ON / Confirm email OFF, redirect URLs for `/reset` + `/join/setup`, the `novus-expire-tapes` pg_cron job, first admin via `profiles.role` |
| Stripe (live) | Pro subs, packs, chapter licences | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, price/product ids; live products incl. `prod_V0RQl8TDKC3JKu` (chapter_35 $799) and `prod_V4J52t9fUOcrVm` (chapter_100 $1,599); webhook endpoint on the deploy |
| ElevenLabs / Deepgram / OpenRouter | TTS / STT / LLM (all optional, graceful fallback) | `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY` (turn OFF Deepgram data retention — child voices), `OPENROUTER_API_KEY` |
| Resend | chapter invite email (optional) | `RESEND_API_KEY` + `RESEND_FROM`, domain verified |
| Cloudflare Turnstile | sign-up human check (optional) | `NEXT_PUBLIC_TURNSTILE_SITE_KEY` + `TURNSTILE_SECRET_KEY` |
| Google Gemini (billed) | briefcase art generation (dev-time only) | `GEMINI_API_KEY` for `scripts/generate-briefcase-art.mjs` |
| Apple Developer | iOS signing, App Group `group.com.novuspitch.app`, widget bundle id, Sign in with Apple | manual, per docs/WIDGETS.md §the-four-steps + docs/APP-STORE.md §6 |
| Google Play | Android releases | keystore secrets above |
| Domain novuspitch.com (+ app.novuspitch.com) | web origin + native asset origin; `NEXT_PUBLIC_API_ORIGIN` must stay the www host (no redirect in front) | DNS/hosting |

`GET /api/billing/status` and `GET /api/ai` are the built-in diagnostics for
"which of these are actually configured on this deploy".

### First hour on a fresh clone

```bash
npm install
npm run check                      # should pass clean
npm run build                      # budgets should pass
DATABASE_URL=postgres://... npm run test:db   # optional, needs a Postgres 16
```

Then read CLAUDE.md's doc index and open the doc for whatever subsystem the
task touches. Work on a `claude/<topic>-<suffix>` branch, PR to main, in the
house commit voice, and run the adversarial pass before calling it done.
