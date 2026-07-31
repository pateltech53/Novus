# NOVUS · Phase 0 Baseline

Recorded before any Phase 1 work. Every later phase diffs against this file.

> **Phase 0 is closed.** Next step: **`docs/BUILD-PROMPT.md`** — all remaining phases (1–7) in one
> document, each with its own gate and stop rule, carrying the measured targets below.
>
> Reading order for a fresh session: `design.md` → `docs/DO-NOT-TOUCH.md` → this file →
> `docs/BUILD-PROMPT.md`.

- **Date:** 2026-07-26
- **Repo:** `/Users/dhruvpatel/Downloads/novusclaude/novus-web`
- **Node:** v24.4.1 · **npm:** 11.4.2
- **Next:** 15.3.x (App Router) · React 19 · Tailwind v4 · Framer Motion 12 · R3F 9 / three 0.177

---

## 1 · `npm run check` — baseline result

`check` = `events` + `tsc --noEmit` + `sim 30 8`.

| Stage | Result |
|---|---|
| `npm run events` | ✅ 255 events merged and valid, 0 errors |
| `tsc --noEmit` | ✅ clean, exit 0, zero type errors |
| `npm run sim 30 8` | ✅ runs, 0 runtime errors |

**Overall: `npm run check` passes.**

### 1.1 Event pipeline detail

```
A 16 · B 18 · C 16 · D 16 · E 14 · F 12 · G 10 · H 12
I 12 · J 12 · K 15 · L 26 · M 48 · N 10 · P 18   → 255 events

categories: IND 48 · MILE 26 · PERF 18 · PPL 18 · FIN 16 · MKT 16 · OPS 16
            K 15 · PRD 14 · CUS 12 · LGL 12 · LIF 12 · OPP 12 · RIV 10 · WILD 10
flags set: 116   flags gated on: 46   perform events: 66   chains: 6
```

**Unimplemented special tags: 139** (they degrade to narration + a queryable flag; nothing is
silently dropped). Largest clusters: `rubric`×6, `slower`×4, `narration_flex`×4,
`bonus_option`×3, `growth_cap`×3, `run_end`×3, `bonus_events_yr`×3. The remaining ~120 are ×1–×2.
Matches §2.4's known gap.

---

## 2 · Balance table — ⚠️ DOES NOT MATCH §2.2

This is the most important finding in Phase 0. **Reported, not silently retuned** (rule 0.1 #4).

> ### ✅ RESOLVED — the harness is now deterministic
>
> Approved and applied: `scripts/simulate.mjs` takes a third argument `[seed]`, **defaulting to
> `1`**, and threads it through `mulberry32` from `lib/engine/rng.ts`. Pass `random` to sample
> variance; the seed is always printed so any result can be replayed.
>
> Seeding the harness policy alone was **not enough**. `createRun()` derives the engine's run seed
> from `Date.now()` (`lib/engine/run.ts:54`), so event draws and luck bands still varied per
> invocation. The harness now overrides `run.seed` immediately after construction — a change
> contained in `simulate.mjs` rather than a new parameter on the protected `createRun()`.
>
> **Third source, caught the hard way: THE WALL CLOCK.** Seeding (1) and (2) was not enough.
> Today's Market is seeded by the real UTC date (`rng.ts todaysMarketSeed`) and `run.lastPlayedISO`
> uses today's date, so **the entire balance table shifted at midnight UTC**. An untouched tree
> returned 53% survival one day and 50% the next. This was first documented as an acceptable
> residual and it was not — a gate that drifts by calendar is worse than no gate, because it
> reports a regression nobody caused.
>
> `simulate.mjs` now **freezes the clock before the engine is imported**, defaulting to
> `2026-01-15`. Override with `NOVUS_SIM_DATE=YYYY-MM-DD` to replay a specific day's market. Only
> the no-argument forms are pinned — `new Date(x)` and date arithmetic are untouched.
>
> Verified:
> - repeat invocations → byte-identical
> - **`TZ=Pacific/Kiritimati` (UTC+14) and `TZ=Pacific/Midway` (UTC−11) → byte-identical**, a
>   25-hour span, which is the strongest available test for calendar drift
> - `NOVUS_SIM_DATE=2026-07-26` reproduces the pre-freeze 53% exactly, so the freeze is faithful
>   rather than merely constant
> - different seeds still diverge (43–77% at N=30) — reproducible, not frozen solid
>
> `lib/engine/log.ts:81` uses `Math.random()` for cosmetic line ids; it cannot affect a balance
> outcome and is left alone.
>
> ### The authoritative baseline — seed 1, clock 2026-01-15
>
> | Config | survived | median death yr | median valuation | distinct events | errors |
> |---|---|---|---|---|---|
> | `sim 30 8 1` — the `check` gate | 15/30 · **50%** | 5 | $28.3M | 157 / 255 | 0 |
> | `sim 50 10 1` — regression baseline | 24/50 · **48%** | 5 | $117.8M | 187 / 255 | 0 |
> | `sim 300 10 1` — low sampling error | 149/300 · **50%** | 5 | $119.7M | 201 / 255 | 0 |
>
> **Use `sim 50 10 1` as the regression baseline** — any Phase 1–7 change that moves 48% is a real
> signal now, not noise. **Use the 300-run figure for absolute claims:** true survival is ~50%, not
> the ~38% in §2.2, and median valuation is ~$120M, not ~$279M.
>
> ⚠️ **The §12.3 gate band still needs a decision.** Real survival is ~50%, which is outside the
> stated 30–45%. Either the band was written against a build that no longer exists, or the game is
> genuinely 6 points too forgiving. That is a balance-design call, not a Phase 0 call — it is
> carried forward as an open question, and `docs/DO-NOT-TOUCH.md` warns against "fixing" changes
> against the stale numbers in the meantime.
>
> ### Re-verification after the industry-content pass
>
> Adding 24 industry-exclusive events and 360 per-industry text rewrites (see
> `data/industry/`) changed the drawable pool from 255 events to 279, so the balance had to be
> re-measured. Same seed, same frozen clock.
>
> | Config | before | after | verdict |
> |---|---|---|---|
> | `sim 30 8 1` — the `check` gate | 15/30 · **50%** · $28.3M | 13/30 · **43%** · $9.9M | noise (see below) |
> | `sim 50 10 1` — regression baseline | 24/50 · **48%** · $117.8M | 25/50 · **50%** · $69.4M | unchanged |
> | `sim 300 10 1` — low sampling error | 149/300 · **50%** · $119.7M | 147/300 · **49%** · $129.8M | unchanged |
> | `sim 300 10 2` — second seed | not recorded | 150/300 · **50%** · $139.0M | unchanged |
>
> **The verdict is "unchanged", and the 30-run row is why this table has four rows.** At N=30 the
> gate dropped 7 points and median valuation fell by two thirds, which looks alarming and is
> sampling error — exactly the 43–77% spread at N=30 that this document already warns about two
> paragraphs above. At N=300 survival moves by 2 runs out of 300 on seed 1 and by 1 on seed 2, and
> median valuation goes *up*. Anyone who reads the `npm run check` output and concludes the industry
> pass made the game harder is reading noise.
>
> Only the 24 new events could have moved anything: the 360 rewrites replace `text` and touch no
> mechanics, and the three new activities (`ipo`, `real-estate`, `ad-campaign`) are unreachable by
> the harness, which never calls an activity.
>
> Event coverage falls from 201/255 (79%) to 209/279 (75%) at N=300 — more events seen in absolute
> terms, a smaller share of a larger library. Not a regression; the denominator grew by 24.
>
> Industry connection, measured as the share of drawable event weight that is either
> industry-exclusive or carries a rewrite for that industry:
>
> | | before | after |
> |---|---|---|
> | mean across the 12 industries | **2.6%** | **26.5%** |
> | worst industry | 2.1% (FASHION, PET) | 26.2% (FASHION, PET) |
> | best industry | 3.2% (CONTENT) | 27.1% (CONTENT) |
>
> Before this pass, 206 of 255 events were tagged `industries: "all"` and exactly **one** event in
> the entire library had a `reskins` entry — so the mechanism that `isEligible`, `effectiveWeight`
> and `DecisionSheet` were all built around was starved of content. Roughly 1 situation in 40 named
> the player's business; it is now about 1 in 4.
>
> Everything below documents the pre-fix state, for the record.

### 2.1 §2.2's stated target vs. measured reality

§2.2 states the target as *"50 runs × 10 years, from `npm run sim`"*:

| Metric | §2.2 target | Measured (50×10) | Verdict |
|---|---|---|---|
| survived to year 10 | **~38%** | **42–52%** (mean ≈ 47.5%) | ❌ above the 30–45% band |
| median death year | 5 | **5** | ✅ matches |
| median final valuation | ~$279M | **$111.6M – $183.2M** | ❌ ~40% low |
| distinct events seen | 177 / **237** | 184–194 / **255** | ⚠️ denominator changed |
| runtime errors | 0 | **0** | ✅ matches |

### 2.2 Two methodology problems with the stated target

**(a) `npm run sim` does not default to 50×10.** It defaults to **40 runs × 5 years**
(`simulate.mjs:26–27`). The §2.2 numbers cannot be reproduced by running `npm run sim`; they
require the explicit `node scripts/simulate.mjs 50 10`.

**(b) The harness is unseeded, so it cannot serve as a regression gate.**
`scripts/simulate.mjs` uses bare `Math.random()` in three places for its *player policy*:

- `:69` — which choice the sim player picks
- `:81` — the pitch score it awards itself (`4 + floor(random()*5)`)
- `:95` — the year-end allocation

Four consecutive identical invocations of `node scripts/simulate.mjs 50 10`:

| Run | survived y10 | median valuation | distinct events |
|---|---|---|---|
| 1 | 52% | $171.3M | 192 / 255 |
| 2 | 48% | $183.2M | 194 / 255 |
| 3 | 48% | $180.9M | 189 / 255 |
| 4 | 42% | $111.6M | 184 / 255 |

**Run-to-run spread is 10 points (42–52%). The §12.3 gate band is 15 points wide (30–45%).**
Noise is two-thirds of the band, so a CI gate on this harness will flake constantly and cannot
distinguish a real balance regression from a reseed.

The same instability hits the `check` gate itself. Two invocations of `npm run check` in this
session, zero code changes between them:

| `sim 30 8` invocation | survived to y8 | Chapter 7 | median valuation | performs/run |
|---|---|---|---|---|
| first | 18/30 · **60%** | 12/30 | $14.6M | 16 |
| second | 21/30 · **70%** | 9/30 | $18.9M | 18 |

A **10-point survival swing and a 29% valuation swing from nothing at all.** Any Phase 1–7 change
measured against this will produce a false verdict roughly as often as a true one.

The engine itself is *already fully seeded* — `lib/engine/rng.ts` ships `mulberry32`,
`hashString`, and `runRng(seed, year, month, salt)`. Only the harness's own player policy is
unseeded. See §7 for the proposed fix (requires sign-off: `simulate.mjs` is protected).

### 2.3 All three configurations, for reference

| Config | survived | median death yr | median valuation | median yr revenue | performs/run | distinct events | errors |
|---|---|---|---|---|---|---|---|
| `sim` (default 40×5) | 23/40 · **57%** to y5 | 4 | $1.5M | $45.2K | 10 | 104 / 255 | 0 |
| `sim 30 8` (the `check` gate) | 18/30 · **60%** to y8 | 5 | $14.6M | $106.9K | 16 | 152 / 255 | 0 |
| `sim 50 10` (§2.2 config) | **42–52%** to y10 | 5 | $111–183M | $165.0K | 21 | 184–194 / 255 | 0 |

Note the `check` gate uses 30×8 — a shorter, structurally easier run than the 50×10 the
30–45% band was written against. The two are not comparable.

---

## 3 · Colour audit

### 3.1 Every distinct colour value in the codebase

**Brand tokens** — declared once in `app/globals.css` `@theme`, correct per Brand Identity v2:

| Token | Value | Usages (`app/` + `components/`) |
|---|---|---|
| `--color-action` | `#ff6b00` | **70** |
| `--color-action-press` | `#d95a00` | (part of the 70) |
| `--color-prestige` | `#ffc24b` | **24** |
| `--color-alert` | `#ff3333` | **23** |
| `--color-solvency` | `#3ddc97` | **5** |
| `--color-navy` | `#0b1e36` | brand anchor |

**Off-token hex literals still inline in components** — these are the §5.1 sweep targets:

| Value | Where | Note |
|---|---|---|
| `#ff7d1f` | 6 files, every primary button `hover:` | undeclared hover tint of `--color-action` |
| `#0d8f5e` | `CompanyScreen`, `TeamScreen`, `AssetsScreen`, `RobinGhood`, `BeeMail`, `LifeLog`, `ImpactLayer`, `Phone` | a *second*, darker solvency green — not `--color-solvency` |
| `#d92020` | same 8 files + `LinkedOut` | a *second*, darker alert red — not `--color-alert` |
| `#241a05` | `AdvanceButton`, `HomeStage`, `LoopExplainer` | ink for text on prestige gold |
| `#fff` / `#ffffff` | `ImpactLayer`, `Phone` (SVG strokes), `SharkStage:124` | |
| `#FF6B00` | `SharkStage:64` (rim light), `HomeStage:41` (radial) | brand orange re-typed as a literal inside JS |
| `#0d8f5e`, `#a9761a`, `#1b5fa8` | `phone/Phone.tsx:27,50,75` | in-fiction app tints — deliberately outside the palette, keep but tokenise (§5.1) |
| 21 hexes | `lib/engine/avatar.ts:26–52` | cosmetic swatches; data, not UI colour — leave |

**The neutral "system" is 8 ad-hoc alpha values of one navy** (§2.3 P6 said six; it is eight),
all in `app/globals.css:46–53`:

```
rgb(11 30 54 / 0.60)  --sub
rgb(11 30 54 / 0.42)  --faint, --scrim   ← same value, two meanings
rgb(11 30 54 / 0.22)  --cardsh
rgb(11 30 54 / 0.18)  --tabsh
rgb(11 30 54 / 0.10)  --rowsh
rgb(11 30 54 / 0.08)  --line
rgb(11 30 54 / 0.06)  --chip
rgb(11 30 54 / 0.14)  (one more in a shadow)
```

There is **no dark theme at all.** `:root` declares `color-scheme: light` and a single light
surface set. No `@media (prefers-color-scheme: dark)`, no `[data-theme]`. Confirms P6.

### 3.2 Gradients — ✅ already within budget

Only **two** gradients exist in the entire codebase, and both paint at runtime:

| # | Where | Value |
|---|---|---|
| 1 | `app/globals.css:55` `--stage` | `linear-gradient(180deg, #143459, #0b1e36)` — the mascot stage |
| 2 | `components/HomeStage.tsx:41` | `radial-gradient(circle, #FF6B00 0%, transparent 70%)` |

The §3.1 budget is three. **This is already compliant** — §2.3 P6's "gradients doing the job
that shadow should do" overstates it. Phase 1 replaces #1 with a solid `--n-0` + vignette and
keeps a budget slot spare.

### 3.3 Accent discipline — ❌ the real P6 problem

`--color-action` is used **70 times across 26 files**. Measured live on `/play` at 375px, the
accent paints on **5 elements simultaneously**: the HomeStage radial glow, a progress-dot span,
the ADVANCE MONTH button fill, the `STEP n OF 4` label, and `↑ TAP IT TO CONTINUE`. On `/found`
it paints on 3 (selected-industry chip border, chip fill, chip label) **plus** the FOUND IT
button.

Target is **one element per screen**. Current worst case is 5. This — not the hue — is what
reads as generated.

Also, the accent is currently used as a **border** (the two full-width rules bracketing The
Books) and as a **chart colour** (the BRAND stat ring), both explicitly forbidden by §3.2.

### 3.4 Glass — none exists yet

Live measurement across `/play`: **0 elements** with `backdrop-filter`. The glass system of
§5.3 is entirely unbuilt, so there is no pre-existing iOS compositing-jank risk to unwind.

---

## 4 · Typography audit

Single face: **Urbanist** via `next/font` (`--font-urbanist`). No ledger/mono face. Confirms §3.3.

### 4.1 The `--text-*` scale is decorative, not enforced

`@theme` declares 8 steps (`--text-2xs` 11px → `--text-3xl` 36px), used **33 times**.
Components declare **171 arbitrary sizes** that bypass the scale entirely:

| Arbitrary class | Computed | Count |
|---|---|---|
| `text-[0.5625rem]` | **9px** | 56 |
| `text-[0.9375rem]` | 15px | 32 |
| `text-[0.6875rem]` | **11px** | 28 |
| `text-[0.5rem]` | **8px** | 22 |
| `text-[0.625rem]` | **10px** | 11 |
| `text-[1.75rem]` | 28px | 5 |
| `text-[1.0625rem]` | 17px | 5 |
| `text-[0.8125rem]` | 13px | 4 |
| others (2rem, 3rem, 1.5rem, 1.4375rem, 1.375rem, 1.25rem) | | 8 |

### 4.2 Sub-12px text — ❌ 117 declarations across 20 files

§3.4 requires **no text below 12px anywhere**. Measured on `/play`: **20 live elements** below
12px, the smallest at **8px**. Verified not a scaling artifact — root font-size is 16px, no
ancestor transform or zoom; the classes are literally `text-[0.5rem]`.

The 8px text includes **The Books' own labels** (`CASH`, `BURN`, `RUNWAY`, `VALUATION`) and
their Rookie-Mode glosses, plus the stat-ring labels (`BRAND`, `QUALITY`, `MORALE`) — i.e. the
financial figures §3.4 wants at AAA are labelled at 8px.

Affected files (20): `ActivityBar`, `ActivitySheet`, `AdvanceButton`, `Coachmarks`,
`DecisionSheet`, `HomeStage`, `LifeLog`, `LoopExplainer`, `ProSheet`, `StatRings`, `TermCoach`,
`TheBooks`, `phone/BeeMail`, `phone/LinkedOut`, `phone/Phone`, `phone/RobinGhood`,
`screens/AssetsScreen`, `screens/ClosetScreen`, `screens/CompanyScreen`, `screens/TeamScreen`.

`.tnum` exists in `globals.css:70` but is not universal on figures.

---

## 5 · Bundle and assets

### 5.1 `next build` route table

| Route | Route size | **First Load JS** |
|---|---|---|
| `/` | 123 B | 103 kB |
| `/_not-found` | 994 B | 104 kB |
| `/found` | 3.2 kB | 476 kB |
| **`/play`** | **58.5 kB** | **532 kB** |
| `/welcome` | 8.85 kB | 418 kB |
| shared by all | — | 103 kB |

`/play` at **532 kB First Load JS** — plus a 23 MB runtime asset fetch not counted here.

### 5.2 Largest five assets in `public/` (29 MB total)

| Asset | Size | Referenced? |
|---|---|---|
| `public/shark/shark.glb` | **23 MB** | ✅ `SharkStage` — uncompressed, no Draco, no KTX2 |
| `public/shark/celebrate.mp4` | 2.2 MB | ❌ **dead** |
| `public/shark/waving.mp4` | 1.9 MB | ❌ **dead** |
| `public/shark/sign.mp4` | 1.6 MB | ❌ **dead** |
| `public/shark/neutral_listening.mp4` | 956 KB | ❌ **dead** |

**All four mp4s are unreferenced — 6.7 MB of dead weight.** The only `<video>` element in the
codebase is `PerformScreen.tsx:246`, which is the live `getUserMedia` camera feed, not a file.
§5.5 only names the GLB; deleting the four videos is a free additional 6.7 MB.

`SharkStage` currently has `dpr={[1,2]}` (correct per §5.5 #4) but **no `frameloop="demand"`**,
and `useGLTF.preload("/shark/shark.glb")` at module scope (`:238`) forces the 23 MB fetch on
every route that imports the component — including `/found`, which shows only the poster.

---

## 6 · P1–P8 verification

Each claim in §2.3 re-measured. Three are **worse** than documented; one is **better**.

| # | §2.3 claim | Measured | Verdict |
|---|---|---|---|
| **P1** | 506 `known` chips across 255 events | **506** `known` on **694** total choices in **230** events with choices | ✅ exact — see note below |
| **P1** | rendered by `DecisionSheet.tsx` | rendered by **4** components | ⚠️ **worse** |
| **P2** | 6 `"speaker":"founder"` beats | **6**, at `panel-scripts.json:108,264,460,567,742,815` | ✅ exact |
| **P2** | type allows `"founder"` | declared in **2** places: `lib/ai/types.ts:106` **and** `:198` | ⚠️ **worse** |
| **P3** | one 80×80 shark, five names in a list | `SharkPanel.tsx:109` — one `<SharkStage className="h-20 w-20">` | ✅ confirmed |
| **P4** | ~13 of 29 cosmetics non-functional | **29 items total; effectively 0 correct** | ❌ **much worse** |
| **P5** | 23 MB shark on the play route | 23 MB + 6.7 MB dead video; preloaded at module scope | ⚠️ **worse** |
| **P6** | light default, 6 alpha neutrals, gradients | light default ✅, **8** alpha neutrals, but only **2** gradients | ⚠️ mixed |
| **P7** | phone is a rounded rect | confirmed (not re-measured this phase) | ✅ |
| **P8** | no measurement of learning | confirmed — no calibration/competency state anywhere | ✅ |

### 6.1 P1 — the `known` leak is in four components, not one

```
components/DecisionSheet.tsx:105,107      ← §2.3 names this one
components/ActivitySheet.tsx:111          ← §6.4 names this one
components/YearEndStatement.tsx:127       ← UNDOCUMENTED
components/screens/CompanyScreen.tsx:285  ← UNDOCUMENTED
```

**Spec clarification needed for Phase 2:** `known` is present on 506 of **694** choices (73%).
The other **188 choices have no `known`** and already render label-only. §6.3 says "author a
`signal` for every one of the 506 choices" — so 188 choices would ship with neither a number
nor a signal, i.e. genuinely no information. That is the §6.2 coin-flip trap arriving through
the back door. Recommend authoring signals for all **694**.

### 6.2 P4 — the Closet is more broken than "13 of 29"

Inventory (`lib/engine/avatar.ts`): SKINS 8 · SUITS 8 · SHIRTS 5 · ACCESSORIES 8 = **29**. ✅

Three compounding failures, not the two §2.3 describes:

1. **`SharkStage` accepts no `shirt` or `accessory` prop at all** → 13 items unreachable. (documented)
2. **`tint ?? suitTint` at `SharkStage.tsx:124`** — and `DEFAULT_AVATAR.skin = "slate"`
   (`avatar.ts:83`) is *always* set, so `tint` is always truthy and **`suitTint` is dead code
   100% of the time**. All 8 suits do nothing, always — even in the Closet. (§2.3 says the two
   are "mutually exclusive"; in practice suit never wins.)
3. **Only 1 of 9 `<SharkStage>` call sites passes any avatar prop.** `ClosetScreen.tsx:109` is
   the only one. `HomeStage:69`, `PerformScreen:199,262,327`, `SharkPanel:109`, `PitchScore:61`,
   `welcome:116,257,338` all pass none — so **the player's avatar is invisible everywhere
   except the shop that sells it.**

Net: of 29 cosmetic items, **0 render correctly**. The 8 skins that "work" repaint every
material in the model one flat colour, destroying the baked pinstripe texture.

This strengthens the §8.1 recommendation for **Option B (layered SVG avatar)** — the 3D path
must re-author the mesh *and* rewire 8 call sites regardless.

---

## 7 · Blockers — all four resolved

Recorded as found, then resolved with sign-off. Kept here because the diagnoses matter.

| # | Blocker | Status |
|---|---|---|
| B1 | not a git repository | ✅ `git init` + baseline commit |
| B2 | Framer animations never complete in the capture browser | ✅ harness artifact only — real Playwright headless reports `visible` and animates normally. **No app change needed.** |
| B3 | `playwright-mcp` not installable non-interactively | ✅ Playwright added as a devDependency instead — writes real PNGs *and* runs the §A.5 CI checks, which the MCP could not |
| B4 | balance gate not implementable | ✅ harness seeded, deterministic baseline established (see §2) |
| B5 | Appendix A skill stack | ✅ all 8 in place — 7 vendored via `npx skills add`, pinned in `skills-lock.json`; #08's capability met by the Playwright devDependency |

### B5 · The skill stack — initially under-delivered, now complete

Recorded honestly: this was first reported as "7 of 8 not installed" on the grounds that they
needed interactive commands. That was only true of **two** of them. `claude mcp add` (#08) and
`/plugin marketplace add` (#06's documented invocation) genuinely require an interactive session —
but the other six are plain `npx skills add` shell commands that run fine here, and #06's package
turned out to be reachable through the same CLI. They should have been attempted the first time.

All seven now live in `.claude/skills/`, pinned by content hash in `skills-lock.json` (committed;
the 5.8 MB of skill bodies are gitignored, same reasoning as `package-lock.json` vs
`node_modules`). Restore on a fresh clone:

```bash
npx skills experimental_install
```

Verified absent, per §A.1's prohibition on a third base taste layer: `impeccable`,
`design-taste-frontend`. The §A.3 conditionals are deliberately not installed.

### B1 · Not a git repository — no rollback exists
`git rev-parse` fails; there is no `.git` anywhere in `novus-web` or its parent. §0.1 #1 requires
each phase to be "committed" before the next begins, and §12.3 requires CI on every commit.
Neither is possible. A 328 MB `novus-web copy.zip` sits beside the repo as the only backup.
**Recommend `git init` + an initial commit as the true first act of Phase 1.**

### B2 · The visual-gate loop does not work in this environment
The browser pane runs with `document.visibilityState === "hidden"` and `document.hasFocus() ===
false`, so `requestAnimationFrame` is throttled to a near-halt. **Framer Motion entrance
animations never complete**: every element with `initial={{opacity:0}}` stays at or near opacity
0 indefinitely (observed drifting 0 → 0.199 → 0.225 over ~30 s). Raw screenshots of this app are
therefore blank or half-faded, and a one-shot inline-style override loses to Framer's ongoing
rAF writes.

Workaround used for this baseline — an injected `!important` stylesheet, which beats Framer's
inline styles:

```css
[style*="opacity"] { opacity: 1 !important }
[style*="transform"] { transform: none !important }
*, *::before, *::after { transition: none !important }
```

This is a measurement crutch, not a fix. Every §3.4 / §A.5 gate from Phase 1 onward depends on
reliable screenshots. **Recommend a first-class `?motion=off` / `NEXT_PUBLIC_STATIC_CAPTURE`
switch that sets Framer `initial={false}` via `MotionConfig` and R3F `frameloop="demand"`.**
That is an app change and needs sign-off.

### B3 · `playwright-mcp` cannot be installed from this session
§4.2 gates on `playwright-mcp` screenshotting `/play` at 390 px and 1920 px, and §A.5 makes it
the verification substrate for every later phase. MCP servers require an interactive
`claude mcp add`, which this non-interactive session cannot run. Baseline capture used the
in-app browser instead, which **cannot write PNG files** — so `docs/baseline-shots/` holds a
measured manifest rather than images. See `docs/baseline-shots/README.md`.

### B4 · The balance gate is not implementable as written
Per §2.2 the harness is protected, so this is a proposal, not a change. The minimal fix — a
`--seed` argument threaded into the three `Math.random()` call sites in `scripts/simulate.mjs`,
using the `mulberry32` already in `lib/engine/rng.ts` — makes the harness reproducible without
touching the engine or making it un-simulatable. Requires explicit approval.

---

## 8 · Anti-slop gate status at baseline (§3.4)

Measured live, not asserted. `/play` at 375×812 unless noted.

| Gate | Status | Evidence |
|---|---|---|
| `overflow-x: clip` on html **and** body | ✅ pass | both computed `clip` |
| No horizontal scroll | ✅ pass | `scrollWidth` 375 = `innerWidth` 375 at 375; also clean at 1280 |
| No two-line clickables | ✅ pass on `/play` (0) · ❌ fail on `/found` | "Fashion / Streetwear", "Toys & Collectibles" wrap |
| No text below 12px | ❌ **fail** | 20 live elements < 12px, min **8px**; 117 declarations in 20 files |
| Every colour from a token | ❌ fail | ~30 inline hex literals outside the token block |
| Three gradients max | ✅ pass | exactly 2 |
| Accent once per screen | ❌ **fail** | 5 on `/play`, 4 on `/found` |
| Glass on chrome only | n/a | 0 glass surfaces exist |
| Dark is the default world | ❌ fail | `color-scheme: light`, no dark set at all |
| Desktop ≥1024 is not a stretched phone | ❌ **fail** | see §8.1 |
| AA text / AAA figures | ❌ fail | disabled CTA is white on `#ff6b00` @ 35% over `#e7edf5` |
| Exits faster than entrances | ⚠️ unverified | motion cannot be observed here (B2) |
| Only transform/opacity animate | ❌ fail | `globals.css:64` transitions `background-color` + `color`; `AdvanceButton:33` ships an animated `box-shadow` keyframe (`nvPulse`) |
| `prefers-reduced-motion` honoured | ⚠️ partial | `globals.css:137` shortens **CSS** animations only; Framer JS motion is unaffected |

### 8.1 Desktop at 1280×800 — stretched, not composed

Not the "375 px column in a grey void" §3.4 warns about — the **opposite**. The layout goes
full-bleed: The Books becomes a 1280 px white band bracketed by two full-width orange rules,
each card ~390 px wide carrying an 8 px label; ADVANCE MONTH becomes an ~800 px orange slab; the
tab bar spreads 5 items across 1280 px; the mascot stage is a 1280 px navy band around a small
shark. Containers are inconsistent — the stage and copy block cap, the Books row and CTA do not.

§5.4's required ≥1024 px composition (centred max-width, mascot promoted to a persistent left
column, Books docked to a right rail) does not exist in any form.

---

## 9 · Reproducing this baseline

```bash
cd novus-web
npm install
npm run check                        # events + tsc + sim 30 8
node scripts/simulate.mjs 50 10      # §2.2 config — run 4× and average, it is unseeded
npm run build                        # route/bundle table
grep -rn "#[0-9a-fA-F]\{6\}" app/ components/   # inline colour sweep
grep -rno "text-\[[0-9.]*rem\]" app/ components/ | sed 's/.*text-/text-/' | sort | uniq -c | sort -rn
```

Dev server for visual checks runs on **port 3100** (`.claude/launch.json`, `autoPort: true`) —
port 3000 was held by an unrelated stale `next-server` serving Internal Server Error.
