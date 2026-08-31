# CLAUDE.md — start here

Novus is a BitLife-style life sim for a **company**: time only moves when the
player taps ADVANCE MONTH, and a fiscal year closes only after a scored,
on-camera pitch to a panel of AI shark investors. One Next.js codebase ships
three ways: the web app (novuspitch.com), and a Capacitor static export inside
iOS and Android shells. The audience includes minors (13–18) sold to schools —
several "missing features" below are legal constraints, not gaps.

Stack: Next.js 15 App Router · React 19 · TypeScript strict · Tailwind v4 ·
React Three Fiber · Framer Motion 12 · Capacitor 8 · Supabase (Postgres + RLS)
· Stripe. Node 22 in CI.

This file is the map. The deep documentation lives in `docs/` and is genuinely
load-bearing — see the doc index at the bottom. **The full project history,
current state, in-flight work, and external-service inventory are in
[docs/HANDOFF.md](docs/HANDOFF.md).**

## The three rules that outrank everything

1. **`docs/DO-NOT-TOUCH.md` is non-negotiable.** The engine core
   (`lib/engine/run.ts`, `effects.ts`, `events.ts`, `sim.ts`, `autopsy.ts`),
   `scripts/simulate.mjs`, and all of `data/sections/*.json` require naming
   the file and the exact change, then explicit sign-off, before any edit.
   `rng.ts` and `types.ts` are read-only unless a task names them (`types.ts`
   additive only). `advanceMonth()` is the only function that moves time —
   never add a second path. Authored prose in `data/sections/` is verbatim —
   never rewrite a character.

2. **The Brand Laws** (full text in DO-NOT-TOUCH.md): no skip/simulate-year
   button; the ±15% luck band never flips a result's sign; nothing purchasable
   may touch score, survival, revives, or leaderboard position (legal — the
   product serves minors); never score accent, voice pitch, energy, or speech
   rhythm; never generate a single line of the player's dialogue; real
   financial vocabulary only (burn rate, runway, Chapter 7 — never coins,
   gems, XP; Rookie Mode adds a gloss, never replaces the term).

3. **A balance shift is a regression to report, never to retune away.** The
   sim harness is deterministic (seeded, clock frozen to 2026-01-15), so a
   changed number at a fixed seed is real. Measure against a fresh baseline on
   the untouched tree — the historical targets in DO-NOT-TOUCH §2.2 (38% /
   $279M) are recorded as non-reproducing, and `docs/BASELINE.md` §2's tables
   predate the current 289-event pool.

## Commands

```bash
npm install            # first thing on a fresh clone (sim needs `typescript`)
npm run dev            # dev server (`.claude/launch.json` uses port 3100)
npm run check          # local definition of done — must pass after EVERY change
npm run build          # events + next build + bundle budgets. NEVER bare `npx next build`
npm run sim 50 10 1    # balance regression baseline (30 8 is the check gate)
npm run test:db        # migrations + RLS suites; needs Postgres (DATABASE_URL)
npm run build:native   # static export for the iOS/Android shells, then cap sync
npm run test:outside   # Swift market fixture --check + pbxproj structural lint
npm run audit:phone    # Playwright phone audit at 320/375/393/430 (build:native:only first)
```

`npm run check` = events pipeline (parse + validate events/activities/tokens/
motion) + `tsc --noEmit` + `sim 30 8` + test:ai/board/islands/rules/pricing/
limits/variety/room/wardrobe/playbook.

**CI ≠ check.** CI (`.github/workflows/ci.yml`) skips test:islands/rules/
pricing but adds `test:outside`, the budgeted `npm run build`, `test:db`
against postgres:16, and an Android static-export/APK job. Run both `npm run
check` and `npm run build` before opening a PR. `test:rewards` is in neither —
run it by hand when touching rewards. `ios-build.yml` is the only thing that
compiles Swift, and only when a push to main or a PR touches `ios/**`,
`capacitor.config.ts`, or the workflow file itself (requires Xcode 26).
Android releases are tag-driven: push a `v*` tag and
`android-release.yml` publishes `novus.apk`/`novus.aab`. The Playwright
probes (`audit:phone`, `test:tap`, `test:exits`, `test:notes`,
`test:home:fold`, `test:islands:layout`, `capture`, `safe-area-probe`) are
manual-only — none run in CI, and a fresh machine needs
`npx playwright install chromium` before the first one works.

Per-route gzipped First-Load-JS budgets live in `scripts/bundle-report.mjs`
(BUDGETS table; e.g. /play 359 kB). Exceeding one fails the build; the
sanctioned fix is shrinking the route or raising the budget **in the same
commit** with the reason in the message.

## Architecture in one screen

```
data/sections/*.json (255 authored events, verbatim, PROTECTED; files A–N and P — no O)
  + data/industry/*.json (exclusives + reskins overlay — the UNPROTECTED route for new content)
    ──npm run events──▶ data/events.json (generated, 289 events) ──▶ lib/engine
```

New content goes through the overlay, not the protected sections: industry
exclusives and reskins live in `data/industry/` and are merged by
`scripts/parse-events.mjs` (its header essay is the instruction). The
authored library and conversion contract live in `design/`
(`NOVUS_EVENT_LIBRARY_B1.md`, `EVENT_SCHEMA.md`); a universal event in
`data/sections/` needs sign-off like any protected edit.

- **`lib/engine/`** — the whole game, pure TS, zero React, so
  `scripts/simulate.mjs` can play thousands of years headlessly. Protected
  core + additive satellites (ledger, activities, portfolio, positioning,
  wardrobe, market, save…). New RunState fields must be optional and tolerate
  absence (old saves must load).
- **`lib/state/GameProvider.tsx`** — the one client game context. All
  mutations go through the shared orchestration in `lib/leaderboard/replay.ts`
  (the leaderboard verifier replays input tapes against the same code), and
  taps are recorded to the tape before commit.
- **`app/`** — 19 pages, 63 API route handlers. Every route exports
  `runtime="nodejs"`, and all but the deliberately-static `/api/rewards/odds`
  also export `dynamic="force-dynamic"`; every state-changing handler
  opens with `if (crossSite(req))` (CSRF); every response on a path that read
  the session must return via `withSession()`/`attachSession()` (Supabase
  rotates the refresh token per read — dropping it silently signs the player
  out). Gates answer **404**, never 401/403.
- **`lib/supabase/route.ts`** — per-request anon-key client; **RLS is the
  access control**, route code carries no authorization logic of its own.
  `lib/supabase/admin.ts` (service role) bypasses RLS and must filter
  `profile_id` explicitly. The browser never talks to Supabase, Stripe, or any
  third-party origin directly — everything proxies through this app's own
  route handlers (child-safety rule; Turnstile is the single sanctioned
  third-party script).
- **`supabase/migrations/0001–0018`** — schema source of truth, applied in
  filename order (deployment is manual paste into the Supabase SQL editor;
  `APPLY-ALL.sql` currently covers only 0001→0016). 9 RLS test suites run per
  PR via `npm run test:db`.
- **Persistence** — localStorage is the synchronous cache the game reads;
  Supabase is the debounced mirror (`lib/cloud/sync.ts`). Saves: local/newer
  wins. Entitlements: server wins. No account = fully local play, nothing
  sent (a supported state — never "fix" a missing env var by throwing).
- **Money** — prices exist once, in cents, in `lib/monetization.ts`; the
  Stripe webhook is the **only** granter of paid entitlements; checkout
  refuses on any amount mismatch with live Stripe; store builds sell nothing
  (`lib/commerce.ts` — App Store 3.1.1). Comped Pro lives in `comp_pro`
  beside `pro` because the webhook overwrites `pro`.
- **AI** — three independent server-only keys (ElevenLabs TTS, Deepgram STT,
  OpenRouter LLM) read only in `lib/ai/server/providers.ts`; every feature has
  a complete local fallback and clients latch on 501. Prompts in
  `lib/ai/prompts/` are verbatim pack files — behavioural fixes go in
  HOUSE_RULES (`lib/ai/server/panel-prompts.ts`). Delivery is measured but
  structurally unreachable from scorers (Brand Law 5).
- **Native** — on iOS the tab bar, advance button, sheets and nudge are
  withdrawn from the DOM and redrawn by UIKit as real Liquid Glass; DOM
  elements under native chrome are **unrendered, not hidden**. CSS glass is
  retired on every platform (deliberate; gated behind `[data-css-glass]`,
  which nothing writes). All in-app document navigation must name
  `index.html` explicitly (`lib/native/href.ts`) — the shell resolves
  extensionless paths to the marketing page. The widget extension carries
  Swift ports of `lib/engine/market.ts`/`format.ts`; editing those requires
  `npm run market:fixture` or CI fails.

## Working conventions (match these exactly)

- **Branches**: `claude/<kebab-topic>-<6-char-suffix>` off `main`; everything
  lands via PR on `pateltech53/Novus`. Never push to main directly. Merge
  origin/main INTO a long-lived branch (narrative merge subject), don't rebase.
- **Commit voice**: declarative narrative subjects, no prefixes, no ticket
  ids — state the outcome or the defect ("The widgets show the scores, not
  the runway"). Bodies are multi-paragraph essays: the why, the mechanism,
  what was measured. Fix commits name the defect, not "fix bug".
- **Comment style**: dense and narrative, not sparse. Every nontrivial file
  opens with a header essay (what it was / what it is / why it's safe, with
  measured numbers); inline comments cite other files by path. Header comments
  are the project's real documentation — several "missing" features are
  documented there as deliberate. Read the header before changing a file.
- **Design tokens only**: never a raw color/duration/radius in a component.
  Tokens live in `app/globals.css` `@theme` (radius budget: sheet 22 › card
  14 › row 10 › chip 6, child ≥4px tighter); motion only from
  `components/ui/Motion.tsx` (`scripts/validate-motion.mjs` fails the build on
  inline transition literals); money always in `.tnum`/`--font-ledger`
  (Tailwind `font-mono` would silently break it). `#FF6B00` (`--color-action`)
  is the only color that asks for action — one accent element per screen.
  Light theme is the shipped default (design.md §1.4's "dark default" is
  superseded).
- **No ESLint, no Jest — deliberately.** Every invariant is a bespoke node
  script in `scripts/*.mjs` wired into `npm run events`/`check`/CI, parsing
  its registry out of the source-of-truth file so lists can't drift. New
  invariants get a validator script + package.json entry + a commented CI
  step, never a lint rule or test framework.
- **The adversarial pass**: after landing a substantial change, hunt defects
  in your own diff and land findings as a follow-up commit ("Seven defects an
  adversarial pass found in the last commit"). When triaging bug reports, say
  explicitly which were real and which were not.
- **Docs stay in sync**: a change to a documented subsystem updates its doc in
  the same PR — mark supersessions explicitly rather than silently rewriting.
- Derived artifacts are regenerated, never hand-edited: `data/events.json`
  (`npm run events`), the Swift market fixture (`npm run market:fixture`),
  `supabase/migrations/0018_rewards_seed.sql` (`npm run rewards:seed`), GLBs
  (`npm run models`), icons, briefcase art.

## Traps that have already bitten someone

- `npm run build` ≠ `npx next build` — the package script adds the bundle
  budget check that Vercel runs. CI was once green while the deploy was red.
- Engine/content changes that break replay determinism must bump
  `NOVUS_ENGINE_VERSION` + `NOVUS_LEADERBOARD_SEASON` together (env-overridable
  constants defaulting in `lib/leaderboard/season.ts`), or every submitted
  leaderboard tape is silently invalidated.
- `env(safe-area-inset-top)` is 0 on WKWebView's first load; UIKit refuses
  present-onto-presenting silently; Auto Layout picks height 0 without an
  equality — the native layer's rule is *confirm or measure, never assume*
  (watchdogs + DOM fallbacks exist; keep them).
- The sim freezes `Date` before importing the engine — new engine code reading
  the clock via other APIs reintroduces calendar drift.
- `crossSite()` deliberately does NOT guard: the Stripe webhook, the OAuth
  callbacks, the moderation route, and GETs. CSP keeps `'unsafe-inline'`
  deliberately (nonces force every page Dynamic) — the real defence is
  `connect-src 'self'`. Read the rationale in `next.config.ts` before "fixing".
- Rate limiting and AI spend caps **fail open** without
  `SUPABASE_SERVICE_ROLE_KEY` (documented, not a bug).
- `.env.example` is partly stale (chapter prices/ids) — `lib/monetization.ts`
  and `lib/stripe/catalogue.ts` are ground truth ($799/35 seats,
  $1,599/100 seats).
- A list of settled dead ends (do not resurrect: CSS glass, scroll-scrubbed
  /product engine, serif display voice, anonymous-session-per-visitor,
  in-app checkout, …) is in [docs/HANDOFF.md](docs/HANDOFF.md).

## Doc index (open the right one before working)

| Area | Doc |
|---|---|
| History, current state, open work, external services | **docs/HANDOFF.md** |
| Protected files + Brand Laws | docs/DO-NOT-TOUCH.md |
| Design system (locked) | design.md |
| Balance harness + measured baselines | docs/BASELINE.md |
| Year-loop design rules (read before touching activities) | docs/PROGRESSION.md |
| Auth / accounts | docs/ACCOUNTS-SETUP.md (+ docs/OAUTH-SETUP.md) |
| Billing / Stripe | docs/STRIPE-SETUP.md |
| Supabase provisioning (partly Chinese, partly stale) | docs/SUPABASE-SETUP.md |
| Operator console | docs/ADMIN.md |
| AI features & keys | docs/AI-SETUP.md |
| Leaderboard / anti-cheat / COPPA | docs/LEADERBOARD.md |
| Native shells / CORS / Liquid Glass | docs/APP.md |
| App Review compliance | docs/APP-STORE.md |
| iOS widgets / Live Activities | docs/WIDGETS.md |
| Chapters (classroom licences) | docs/CHAPTERS.md |
| Briefcase reward loop (beta) | docs/BRIEFCASES.md (+ docs/BRIEFCASE-ART.md) |
| SEO / www-vs-apex / structured data | docs/SEO.md |
| Authored event library + conversion contract | design/NOVUS_EVENT_LIBRARY_B1.md, design/EVENT_SCHEMA.md |
| Original 7-phase build brief (historical rationale) | docs/BUILD-PROMPT.md |

When a doc and the code disagree, the code plus the newest doc wins.
**README.md itself is partly historical** (it still says 237 events, quotes
the non-reproducing 38%/$279M curve, and predates most of the systems above)
— this file and docs/HANDOFF.md win; HANDOFF §4 lists the known-stale claims
so you don't re-propagate them.
