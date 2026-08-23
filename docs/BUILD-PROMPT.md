# NOVUS — BUILD PROMPT · PHASES 1–7

**One document, all remaining phases.** Phase 0 is complete and committed.

> ## ⛔ THE ONE RULE THAT OVERRIDES EVERYTHING
>
> **Execute ONE phase, then stop and wait.** Do not begin Phase N+1 until Phase N is committed,
> `npm run check` passes, and its gate is met.
>
> Announce which phase you are entering and which files you expect to create / modify / delete.
> **Deletions require explicit confirmation before you make them.**
>
> This document being complete is not permission to run it end to end. Attempting all seven in one
> pass produces a plausible-looking rewrite that fails every gate. This is 4–6 sessions of work.

---

## 0 · ORIENTATION

### 0.1 What Novus is

A BitLife-style life sim for a **company**. You found it, name it, pick an industry, and advance it
year by fiscal year toward an IPO — or Chapter 7. The twist: **the sim never plays itself.** Every
fiscal year closes only when you pitch on camera to a panel of five AI shark investors and survive
their questions.

```
Found → Today's Market → Perform (camera) → Consequences → Year End → Legacy
  │                                                                      │
  └──────────────────── new run, respect persists ───────────────────────┘
```

**Vocabulary — use these exact words in code and UI.** The Founder Run · Today's Market · The Books
· Year End · Chapter 7 · Still Standing · The Closet · The Panel (Marcus Cole *The Ledger*, Serena
Voss *Blue Sky*, Dev Okafor *The Wrench*, Lily Zhang *The Loyalist*, Viktor Reyes *The Autopsy*).

### 0.2 Read before touching anything

| File | What it is |
|---|---|
| **`design.md`** | The **locked** design system. Overrides improvisation. Need a value that isn't there? Add it as a named token first, then reference it. |
| **`docs/DO-NOT-TOUCH.md`** | Protected engine files + the Brand Laws. Naming a file in a task does not grant permission. |
| **`docs/BASELINE.md`** | Every number, measured rather than asserted. The pre-Phase-1 state. |
| **`docs/baseline-shots/report.md`** | The gate table across 7 widths. Your *before*. |

### 0.3 Operating rules — every phase, no exceptions

1. **Read a file in full before editing it.** Before adding a component, check whether one already
   exists that does 80% of the job.
2. **Never bulldoze `lib/engine/`.** See `docs/DO-NOT-TOUCH.md`.
3. **Every change survives `npm run check`** — `events` + `tsc --noEmit` + `sim 30 8`.
4. **A balance shift is a real regression, not a rounding error.** Report it. Never retune constants
   to hide it.
5. **No new dependency without justification.** State what it costs (bundle KB, iOS Safari support)
   and what it replaces. Default answer is no. Specifically: no UI component library, no CSS-in-JS
   runtime, no second state manager.
6. **Do not invent content.** Every event, choice, number, and shark line either exists in `data/`
   and `lib/ai/fixtures/`, or is authored per `design/EVENT_SCHEMA.md`. No fabricated metrics,
   testimonials, user counts, or "10× faster" copy anywhere.
7. **Do not narrate the implementation in the UI.** No "✨ Powered by AI" badges, no loading copy
   describing your own work.
8. **Ask when the spec is genuinely ambiguous.** One short question beats a wrong 400-line
   component. Do not ask what this document already answers.

### 0.4 The Brand Laws — enforced in code, not in a style guide

| # | Law | What it means for you |
|---|---|---|
| 1 | **Talk to progress** | Year N → N+1 is unreachable without a scored camera performance. No skip button, no simulate-year button, no debug bypass in production. Enforced by `advanceMonth()` / `closeYear()` in `lib/engine/run.ts`. |
| 2 | **Every year is earned** | Outcomes derive from player scores. Luck is a ±15% band that **never flips the sign**. Already in `effects.ts` — preserve it. |
| 3 | **Death is content** | Chapter 7 is a lesson. The autopsy names the three decisions that actually killed you, ranked by realized cash damage. Runs never end from not opening the app. |
| 4 | **We sell drip, not wins** | Cosmetics, run slots, scenario packs are purchasable. Score, survival, revives, leaderboard position **never** are. No ad-for-reward, no pay-to-continue, no loot box. **This is a product for minors — a legal constraint, not a taste one.** |
| 5 | **Grade the logic, not the kid** | High-energy and calm-clinical delivery both score 10/10. The rubric may penalise filler words, hedging, unsupported numbers. It may **never** penalise accent, pitch, energy, or speech rhythm. Write the prohibition into the prompts. |
| 6 | **Real words only** | *burn rate, runway, dilution, gross margin, Chapter 7.* Never coins, energy, gems, XP. Rookie Mode **adds** a plain-English gloss; it never replaces the real term. |

### 0.5 What Phase 0 already built — use it, don't rebuild it

**`npm run check` — deterministic.** `scripts/simulate.mjs` takes `[runs] [years] [seed]`, seed
defaults to **1**, and **freezes the clock** to `2026-01-15` before importing the engine. Pass
`random` to sample variance; `NOVUS_SIM_DATE=YYYY-MM-DD` replays a specific day's market.

The clock freeze is load-bearing: Today's Market is seeded by the real UTC date, so before it an
untouched tree returned 53% one day and 50% the next. Verified byte-identical across
`TZ=Pacific/Kiritimati` (UTC+14) and `TZ=Pacific/Midway` (UTC−11).

**The numbers no phase may move — seed 1, clock 2026-01-15:**

| Config | Survival | Median death yr | Median valuation | Distinct events |
|---|---|---|---|---|
| `npm run sim 30 8` (the `check` gate) | 15/30 · **50%** | 5 | $28.3M | 157 / 255 |
| `npm run sim 50 10 1` (regression baseline) | 24/50 · **48%** | 5 | $117.8M | 187 / 255 |
| `npm run sim 300 10 1` (absolute curve) | 149/300 · **50%** | 5 | $119.7M | 201 / 255 |

**`npm run capture` — the visual gate harness.**

```bash
npm run dev                              # port 3100, per .claude/launch.json
npm run capture                          # → docs/baseline-shots/
npm run capture -- docs/shots-phase1     # → anywhere, to diff
```

Screenshots `/welcome`, `/found`, `/play` (tutorial + steady) at 375 and 1280; audits the gates at
**320 / 375 / 390 / 414 / 768 / 1280 / 1920**; writes `report.json` + `report.md`; **exits non-zero**
on horizontal scroll at 320 or any text below 12px. `docs/gate-audit.js` holds the gates as
measurements.

**Skill stack** — seven vendored in `.claude/skills/`, pinned in `skills-lock.json` (gitignored
bodies). Restore on a fresh clone: `npx skills experimental_install`.
`animate` + `theme-factory` (Phase 1) · `conversation-patterns` + `mixed-initiative-flow` (Phase 3)
· `persona-architecture` + `constraint-specification` (Phase 7) · `canvas-design` (§C.1).
Plus `hallmark` and `frontend-design`, already present. **Do not install a third base taste layer**
— if `hallmark` and `frontend-design` disagree, resolve by deleting one, never by adding a third.
**`theme-factory` is constrained-use:** implement and extend the locked ramp; if it proposes
different brand hues, reject them.

**Three traps already paid for. Do not re-discover them.**

- Framer entrance animations never complete when `document.visibilityState === "hidden"`. Only an
  `!important` stylesheet beats Framer's inline styles. Real Playwright headless is fine.
- The tutorial's `advance` step has **no button** — the click must land inside the spotlight hole.
  A "click every GOT IT" loop stalls silently.
- **Tutorial completion is not persisted** — reloading `/play` restarts the coachmarks.

---

## PHASE 1 · THE VISUAL SYSTEM

**Fixes:** P5 (23 MB shark) · P6 (visual layer contradicts the brand, reads as generic)
**Blocks:** Phases 3, 4, 5 · **Size:** Large · **Scope:** presentation only, no feature logic

### The measured before

| Route | text < 12px | accent uses | wrapping labels |
|---|---|---|---|
| `/welcome` | **0** ✅ | **1** ✅ | **0** ✅ |
| `/found` | 2 (min 11px) | 3 | 0–5 (worst at 320) |
| `/play` (tutorial) | 19 (min 8px) | 5 | 0 |
| `/play` (steady) | **23–26** (min **8px**) | **6–7** | 0–1 |

> **`/welcome` already passes every gate at every width and is the only route already on dark navy.
> It is the reference. When a Phase 1 decision is ambiguous, make the other routes behave like it.**

Other facts: `--color-action` used **70×/26 files** · **171 arbitrary `text-[…rem]`** bypass the
scale, **117 below 12px across 20 files** · neutral system is **8 ad-hoc alphas** of one navy
(`globals.css:46–53`), with `rgb(11 30 54 / 0.42)` doing double duty as `--faint` and `--scrim` ·
**no dark theme exists at all** · **0 glass surfaces** · **1 canvas on every route** because
`useGLTF.preload()` sits at module scope (`SharkStage.tsx:238`) · `/play` First Load JS **532 kB**.

### The work

**1.1 Token rebuild — `app/globals.css`.** Replace `:root` with `design.md` §1. Every
`rgb(11 30 54 / 0.xx)` → an `--n-*` reference. Add the semantic aliases so components never touch
the ramp. Delete `--stage: linear-gradient(...)`; the mascot stage becomes solid `--n-0` + one
radial vignette.

**The mandated comparison (`design.md` §1.2):** the OKLCH ramp is deliberately desaturated and
warm-shifted vs flat `#0B1E36`. Build it, capture both, compare, keep the better one, **and say
which you kept and why.** The comparison is required; the outcome is not pre-decided.

**Sweep to zero inline colour:**

| Value | Where | Action |
|---|---|---|
| `#ff7d1f` | 6 files, every primary button `hover:` | tokenise as an action hover step |
| `#0d8f5e` | 8 files | a *second* solvency green — reconcile with `--color-solvency` |
| `#d92020` | 9 files | a *second* alert red — reconcile with `--color-alert` |
| `#241a05` | 3 files | ink on prestige gold — name it |
| `#FF6B00` | `SharkStage:64`, `HomeStage:41` | brand orange re-typed inside JS |
| `#0d8f5e`,`#a9761a`,`#1b5fa8` | `phone/Phone.tsx:27,50,75` | in-fiction tints — **keep outside the palette**, but name them |
| 21 hexes | `lib/engine/avatar.ts:26–52` | cosmetic swatch **data** — **leave alone** |

**1.2 Elevation.** `design.md` §2 — five steps, each two shadows, monotonic with z-order, pressed
drops one step. **Never animate `box-shadow`** — animate a pseudo-element's opacity.
`AdvanceButton.tsx:33` ships an animated `box-shadow` keyframe (`nvPulse`); it goes.

**1.3 Glass — `components/ui/Glass.tsx` (new).** Four layers per `design.md` §3. **Nobody
hand-rolls `backdrop-filter` anywhere else.** Allowed: tab bar, sheet grabber + scrolled sheet
header, toasts, year-gate banner, phone status bar + dock, modal scrims. **Forbidden:** decision
sheets, The Books, cards, list rows, closet grids, anything over the canvas, anything containing a
financial figure. Ship the `@supports` fallback and a `solid` prop.

**1.4 Typography.** Add **IBM Plex Mono** via `next/font/google` (rationale locked in `design.md`
§4.1 — do not re-litigate). `--font-ledger` + `font-feature-settings: "tnum" 1, "ss01" 1`. Make
`.tnum` **universal on every figure**. Then the **sub-12px sweep** — 117 declarations across 20
files: `ActivityBar`, `ActivitySheet`, `AdvanceButton`, `Coachmarks`, `DecisionSheet`, `HomeStage`,
`LifeLog`, `LoopExplainer`, `ProSheet`, `StatRings`, `TheBooks`, `TermCoach`, `phone/BeeMail`,
`phone/LinkedOut`, `phone/Phone`, `phone/RobinGhood`, `screens/AssetsScreen`,
`screens/ClosetScreen`, `screens/CompanyScreen`, `screens/TeamScreen`. Raise `--text-2xs` to 12px
or retire it.

> Raising 8px labels to 12px **will** change layout — The Books strip is the tightest case. The
> answer is fewer words or a different composition, **not** 10px text.

**1.5 The accent cull.** 70 → **one element per screen**. Known offenders: the two full-width rules
bracketing The Books (accent as **border**), the BRAND stat ring (accent as **chart colour**), the
selected industry chip on `/found` (border + fill + label = 3 on one control), the HomeStage radial.

**1.6 Dark default, light as a real parallel set.** Not `filter: invert()`. `/play` currently
collides light and dark inside one screen — navy stage above a light Books strip.

**1.7 The 23 MB shark.** `gltf-transform optimize` with Draco + KTX2/Basis, **target < 3 MB**;
original to `assets-src/` outside `public/`. `next/dynamic` with `ssr: false`. Move
`useGLTF.preload()` off module scope. Replace `StagePoster`'s fin glyph with a real still frame.
Keep `dpr={[1,2]}`; add `frameloop="demand"` for idle. Cap 30fps when backgrounded or reduced-motion.
**Delete the four unreferenced mp4s** in `public/shark/` — 6.7 MB, confirmed dead. **Announce first.**

**1.8 Desktop is not a stretched phone.** At ≥1024px: centre at max-width, mascot promoted to a
persistent left column, Books docked to a right rail. Current failure is the *opposite* of the
usual — `/play` goes **full-bleed**, Books becomes a 1280px band with 8px labels, ADVANCE MONTH an
~800px slab. Containers are inconsistent: stage and copy cap, Books row and CTA do not.

**1.9 iOS behaviours.** `design.md` §6, all required. Motion contract: enter ~280ms / exit ~180ms,
only `transform` and `opacity`. `globals.css:64` transitions `background-color` and `color` —
remove. **`prefers-reduced-motion` must reach Framer**, not just CSS.

### Gate

- [ ] text < 12px: **0** everywhere · accent: **1** everywhere · wrapping labels: **0** everywhere
- [ ] horizontal scroll still passes · gradients ≤ 3 and you can name all three
- [ ] glass only on sanctioned chrome, **0 overlapping the canvas**, ≤ 2 visible at once
- [ ] `npm run capture` **exits 0**
- [ ] `grep -rn "#[0-9a-fA-F]\{6\}" app/ components/` → token block only
- [ ] `shark-v2.glb` **< 1 MB and < 80k triangles** (bytes alone were the wrong target — see docs/BASELINE.md §5), mp4s deleted, `public/` under ~4 MB
- [ ] canvas count **0** on `/welcome` and `/found` until needed
- [ ] Lighthouse mobile performance **≥ 90** on `/play`
- [ ] `npm run check` passes, balance **unchanged at seed 1**
- [ ] Screenshots diffed and **improved**, not merely different
- [ ] The OKLCH-vs-`#0B1E36` comparison was run and you say which won
- [ ] At 1280 the play surface is **composed**, not stretched
- [ ] Chanel test per screen: find the one element removable with no loss. Remove it.

---

## PHASE 2 · DECISION INTEGRITY

**Fixes:** P1 · **Blocks:** Phase 6 · **Size:** Large

### The problem, precisely

`data/events.json` carries **506 `known` chips** rendered beside choice labels — e.g.
`Cash −2S · CSAT +6`. The optimal play is: read chips, ignore prose, pick the biggest number. The
player never engages with *why* generous refunds cost cash and buy loyalty. They engage with `−2`
versus `−1`.

**Photographed in `docs/baseline-shots/play@375.png`** — event *The Logo Night*: "The safe one ·
`Brand +1`" beside "Pay a student designer · `Cash −0.1S · Brand +2`", and "The weird one" carrying
**no chip at all**, which makes the one interesting option read as the null one.

### ⚠️ The trap

**Deleting the chips is wrong on its own.** A choice with no information is a coin flip, and a coin
flip teaches nothing and feels *worse* — it converts "optimising against an answer key" into
"guessing", which is the same complaint arriving from the opposite direction.

**The principle:** a real founder doesn't know refunds cost exactly $2,000 and add exactly 6 CSAT.
But they aren't clueless — they know refunds cost cash now and buy goodwill slowly, that goodwill is
hard to price, and that their lawyer said store-credit-only is risky. **Knowing the *shape* of a
tradeoff but not its *magnitude* is the actual skill.** Model that.

### Part A — replace `known` with `signal`

**Do not delete `known` from the data** — it's a useful authoring record and the autopsy uses
realized values. Stop *rendering* it.

**It is rendered in four components, not one:**

```
components/DecisionSheet.tsx:105,107
components/ActivitySheet.tsx:111
components/YearEndStatement.tsx:127        ← undocumented in the original brief
components/screens/CompanyScreen.tsx:285   ← undocumented in the original brief
```

Add to the schema (`design/EVENT_SCHEMA.md`, `lib/engine/types.ts`):

```ts
interface Choice {
  label: string;
  known?: string;   // AUTHORING RECORD ONLY — never rendered in-game
  signal?: string;  // ≤7 words. Qualitative, directional, NO DIGITS.
  cost?: "none" | "cash" | "time" | "people" | "reputation" | "legal";
  outcome: Outcome;
}
```

**Authoring rules for a signal:** no digits, ever — not "about 2 grand", not "a couple points". Name
the *currency* of the cost and the *nature* of the upside, never amounts. It must be true — it may
omit a hidden consequence (that's the point) but must not deny it. Voice v2: second person, present
tense, no corporate softener.

Worked example, `E-CUS-004 · Refund Storm`:

| Choice | Old `known` (delete from UI) | New `signal` | `cost` |
|---|---|---|---|
| No-questions refunds | `Cash −2S · CSAT +6` | Expensive now. They'll remember. | `cash` |
| Case-by-case | `Cash −1S · CSAT −2 · Mor −3` | Cheaper. Your support team eats it. | `people` |
| Store credit only | `Cash −0.2S · CSAT −5` | Barely costs you. Your lawyer would wince. | `legal` |

The player can still reason — *"3 months runway and my CSAT is already low; I can't afford the cash
but I can't afford the churn either."* That's a business decision. What died is arithmetic.

Render `signal` as **plain secondary text under the label** in `--text-secondary`. Not a chip, not a
badge, not coloured — chips read as data, sentences read as judgment. `cost` drives one small
monochrome glyph, not a colour.

> **⚠️ SCOPE DECISION — resolve before authoring.** `known` covers **506 of 694** choices (73%). The
> original brief says "author a signal for every one of the 506." That leaves **188 choices with
> neither a number nor a signal** — the coin-flip trap through the back door.
> **Recommendation: author all 694.**

### Part B — the forecast (this is the teaching mechanic)

After the player commits but **before** the outcome resolves:

```
        You chose: Case-by-case
        ─────────────────────────────
        What happens to your cash this quarter?
        [ It goes up ]  [ Roughly flat ]  [ It goes down ]
                                             ↑ how sure?  ○ ○ ● ○ ○
```

Then resolve, then show the delta *against their prediction*:

```
        Cash fell $1,180.        You said: down. ✓
        Confidence: high. Correct.        Calibration +2
```

Why it belongs here: it forces an **explicit mental model** before the reveal — you cannot passively
absorb an outcome you already bet on. It makes hidden magnitude a *feature*: you're graded on
direction and honest uncertainty, not on knowing the number. And **calibration** is the single most
transferable skill in finance and almost never taught — being right 70% of the time when you say
"70% sure" is measurable, improvable, real.

Implementation: direction options adapt to `cost` (a `people`-cost choice asks about morale, not
cash). Store `{ eventId, choiceIndex, predictedDirection, confidence, actualDirection }` on the run.
Show on **~60%** of decisions with a cooldown so it stays a moment, not a tax — always for Today's
Market and the first three decisions of a guided run. Skippable with one tap on the outcome;
skipping forfeits calibration credit but does not change the game outcome.

### Part C — the aftermath shows everything

Hiding numbers pre-choice only teaches if the post-choice reveal is complete. `ImpactLayer.tsx`
shows: every stat that moved with exact delta and new value · which movements are **delayed** and
land in a future quarter (`effects.ts` already supports this — surface it: *"Two quarters from now,
this bites."*) · **the luck band's contribution, explicitly** — *"Market luck: −8%. It didn't change
the direction."* (teaches that variance exists and isn't an excuse) · and one causal sentence, not a
stat dump: *"Refunds cost you cash you didn't have; the churn you avoided won't show up for two
quarters."*

### Also fix

**`ActivityBar` / `ActivitySheet`** — remove any preview of what an activity does before it's taken.
Same rule: qualitative before, quantitative after.

**Save-scumming.** The event queue is React state, so a reload drops the drawn card. That's a bug
*and* an exploit vector. When the queue moves into the persisted run (Phase 7), the drawn event
persists with it. **The card you drew is the card you answer.**

### Gate

- [ ] Zero `known` rendered anywhere. `grep -rn "\.known" components/` → nothing outside the autopsy
- [ ] Signals authored and validated — **add a build rule: a signal containing a digit fails**
- [ ] Forecast flow implemented, storing calibration data
- [ ] `ImpactLayer` shows deltas, delayed effects, and the luck contribution
- [ ] **Balance unchanged** — this phase changes *information*, not *outcomes*
- [ ] Playtest: watch someone new make five decisions. If they read only labels and never signals,
      the signals are too long. Cut them.

---

## PHASE 3 · THE PANEL

**Fixes:** P2, P3 · **Blocks:** Phases 6, 7 · **Size:** Largest
**Skills:** `conversation-patterns`, `mixed-initiative-flow`

### What's wrong

`SharkPanel.tsx` renders **one 80×80 `<SharkStage>`** in the header and five *names in a list*. No
faces, no room. Cross-talk, bidding, going out are all text lines in a scrolling `<ol>` revealed on
`setTimeout`.

Worse: `lib/ai/fixtures/panel-scripts.json` has **6 beats with `"speaker": "founder"`** (lines
108, 264, 460, 567, 742, 815) — **the app writes the player's dialogue.** They watch a conversation
they're supposedly having. This is the most damaging thing in the app, because it hollows out the
one feature no competitor has: you, on camera, defending your company out loud.

The type permits it in **two** places: `lib/ai/types.ts:106` **and** `:198`. Change both to
`speaker: SharkId | "chair"` and let the compiler enforce it.

### The room

Five faces, always on screen, state legible at a glance without reading text:

| State | Visual |
|---|---|
| `idle` | full colour, slight ambient breathing |
| `speaking` | scales ~8%, forward in z, gains an elevation step, subtle rim light |
| `listening` | turns toward the player, leans in proportional to live mic level |
| `interested` | warm rim light, a small tell |
| `skeptical` | turns away a few degrees, cooler light |
| `out` | desaturates to ~20%, drops an elevation step — **stays visible**, a shark who folded is part of the story |
| `bidding` | prestige-gold ring, offer figure beneath in the ledger face |

**Performance:** five simultaneous WebGL canvases will not survive an iPhone. Use **one `<Canvas>`
with five instances** of the mesh in a shallow arc, per-instance material variation for identity. If
still heavy after Phase 1's compression, fall back to **five 2D vector avatars** with 3D reserved
for the speaking shark. **Decide on a measured frame rate on a real iPhone, not a guess.** (Phase 4
may build those avatars anyway — see §8.1.)

### Turn-taking

```
PITCH → CHAIR OPENS → ┌─→ SHARK SPEAKS → PLAYER ANSWERS → SHARK REACTS → NEXT SHARK? ─┐
                      └───────────────────────────────────────────────────────────────┘
                              ↓ (2–4 questions, never all five — it's a game, not an ordeal)
                      CROSS-TALK → OFFERS → NEGOTIATION → SIGN / WALK
```

**Hard requirements.** Sharks speak **one at a time**. The player answers **in their own voice** —
real recording via `lib/media/recorder.ts`, same machinery as the main pitch. **Never generate the
player's dialogue — not one line, not as a placeholder, not "temporarily."** A player may decline to
answer; that's a legitimate move with a consequence, and the shark reacts to the silence. Only one
shark's audio at a time; barge-in stops TTS immediately. Retain every answer's transcript for the
debrief. Cross-talk is the only passive beat and it's the most fun one.

### Reactions must depend on what was said

Until live AI (Phase 7), fixtures must still be **conditioned on the answer** or the illusion
collapses on the second playthrough.

Each authored question carries `expects: { mustMention: string[], creditFor: string[], redFlags:
string[] }`. Score the transcript on: did it name a number, did it name a mechanism, did it hedge,
did it dodge, length, filler density. Select the reaction from a bank of **≥6 lines per shark per
outcome band** (nailed it / partial / dodged / contradicted the brief) — under six and players see
repeats in one session. Surface the existing `private_notes` in the debrief as "what they were
actually thinking." When live AI lands, this rubric becomes the prompt's grading contract, not
something you throw away.

### Negotiation — make the deal math real

Highest-leverage place in the app to teach finance, and nearly free to build.

Show for every offer the **implied post-money valuation** and **resulting ownership**, live, in the
ledger face: `$400K for 18% → post-money $2.22M → you keep 61.4%`. A slider lets the player push on
**amount** or **equity** and the third number updates — watching your own ownership fall as you take
more money is the entire lesson of dilution, delivered without a word of instruction.

A counter-offer is a **spoken** move, not a slider drag. You say why you're worth more. The shark
accepts, splits the difference, or walks. Pushing a shark who already said they're at their limit
should sometimes lose the deal — and per Brand Law 2 that's driven by argument quality, not a dice
roll. **"Take no deal" stays prominent and stays respected: walking away is a real answer.**

### Gate

- [ ] `grep -rn '"founder"' lib/ai/fixtures/` → **nothing**; both type sites changed
- [ ] Five avatars visible throughout, all seven states legible at 375px
- [ ] A full round playable with real recorded answers between every shark line
- [ ] Two playthroughs with different answers → visibly different reactions
- [ ] **≥50fps measured on a real iPhone.** If not, drop to 2D avatars and re-measure
- [ ] Ownership math verified by hand against three worked examples

---

## PHASE 4 · THE CLOSET & THE AVATAR

**Fixes:** P4 · **Size:** Medium · **Blocks:** nothing

### The measured diagnosis — worse than the original brief says

Inventory (`lib/engine/avatar.ts`): SKINS 8 · SUITS 8 · SHIRTS 5 · ACCESSORIES 8 = **29**.
The brief says ~13 are non-functional. **Measurement says effectively 0 of 29 render correctly:**

1. **`SharkStage` accepts no `shirt` or `accessory` prop at all** → 13 unreachable.
2. **`tint ?? suitTint` (`SharkStage.tsx:124`)** — and `DEFAULT_AVATAR.skin = "slate"`
   (`avatar.ts:83`) is *always* set, so `tint` is always truthy and **`suitTint` is dead code 100%
   of the time.** All 8 suits do nothing, always — even in the Closet.
3. **Only 1 of 9 `<SharkStage>` call sites passes any avatar prop** — `ClosetScreen.tsx:109`.
   `HomeStage:69`, `PerformScreen:199,262,327`, `SharkPanel:109`, `PitchScore:61`,
   `welcome:116,257,338` pass none. **The avatar is invisible everywhere except the shop that
   sells it.**

The 8 skins that "work" repaint **every material in the model** one flat colour, destroying the
baked pinstripe.

Root cause: `public/shark/shark.glb` is a **single baked material, no named submeshes, no rig.** You
cannot address "the suit" separately because the mesh has no such part.

### The decision — make it before you build

**Option A — re-author the GLB** with named materials (`skin`, `suit`, `shirt`) plus toggleable
accessory meshes. Keeps the 3D mascot. But it's hours of Blender/Meshy asset work, every future
cosmetic is an asset task, and it still carries WebGL cost everywhere the avatar appears.

**Option B — layered 2D vector avatar (recommended).** An ordered SVG stack
(`body → suit → shirt → collar → accessory → expression`), each independently tintable, same
`AvatarConfig` interface. Keep the 3D GLB for the **mascot stage and the panel only**.

**Recommendation: B.** The Closet is a monetisation surface, and one that can only ship new items at
the speed of 3D asset production is one that dies. It also solves Phase 3's performance problem for
free and makes shareable Still Standing cards trivial. **The measured evidence strengthens this:**
the 3D path needs a re-authored mesh *and* 8 rewired call sites regardless, so Option A is strictly
more work than the original estimate assumed.

**If you disagree, argue it before you build it. Do not silently pick the other one.**
(If you pick A, install `blender-motion` per §A.3 — it makes A meaningfully cheaper.)

### Either way, fix these

`skin`, `suit`, `shirt`, `accessory` **independent and simultaneous**; changing one never alters
another. Unknown ids fall back gracefully (`swatchOf` already does — keep it). Closet preview
updates on tap with no round trip. **Locked (Pro) items render at full fidelity, not greyed out** —
the player should see exactly what Pro is: more choices, never a better company (Brand Law 4).
**Wire all 9 call sites.**

### Then extend the Closet

1. **Expression / demeanour** — what makes an avatar feel like *you*. Not a stat.
2. **The office** — background layer: garage → co-working → real office → corner office. Unlocks by
   **stage reached, not purchase.** A legacy trophy that happens to be cosmetic.
3. **Company logo builder** — glyph + colour from a curated set, shown on the Books header, year-end
   statement, and Still Standing. High perceived value, near-zero build cost.
4. **Suit condition** — purely cosmetic; visibly nicer as valuation climbs.

### Gate

- [ ] All 29 items visibly change the avatar
- [ ] Skin, suit, shirt, accessory **simultaneously and independently** settable — verify all four at once
- [ ] Renders correctly at 32px (list row), 96px (grid), 320px (preview)
- [ ] **Zero effect on any stat, score, or outcome** — verify by simulation: run `sim 30 8 1` with a
      max-cosmetic avatar and a default one; tables must be **identical** (they will be, at a fixed seed)

---

## PHASE 5 · THE PHONE AND ITS APPS

**Fixes:** P7 · **Size:** Medium · **Skills:** `animate`

`components/phone/Phone.tsx` is a rounded rect with a clock and three tiles. The three in-fiction
apps have real content — RobinGhood is 32 KB of trading UI — sitting inside a shell that undercuts
them.

### The shell

Real **status bar** (live time, in-fiction signal/wifi/battery — the battery is a good place for a
joke that never becomes a mechanic). **Home indicator** + working swipe-up-to-close with
rubber-banding. **App-open transition**: the icon scales and morphs into the app frame from its grid
position — a shared-element transition, not a fade. Framer's `layoutId` does 90% of it, and it's the
single most iOS-feeling thing you can build. **Springs, not durations**, on every phone transition. A
**dock** with the most-used app (sanctioned glass). **Notification badges** reflecting real state.
**Depth**: the phone sits at `--e4`; the game world behind gets a real blur + scale-down, like iOS's
app-switcher recession.

### The apps — deep enough to be worth opening

**RobinGhood.** A real chart with a real time axis in SVG (no chart library — one polyline and an
area fill). Positions with cost basis, unrealised P&L, portfolio total in the ledger face. **The
teaching moment:** show the opportunity cost — if you'd left that money in the company, here's what
your runway would look like. Founders who day-trade their seed round is a lesson worth delivering
with a straight face. The market moves on the **same date-seeded RNG** as Today's Market, so every
player sees the same market and it becomes discussable.

**BeeMail.** Threads, not messages — a supplier crisis is a chain you can scroll back through. Some
events **arrive here first**: you read the email, then the decision sheet opens. That gives the phone
a real job. Readable attachments — a term sheet, a P&L, an invoice — which is how you put a real
financial document in front of a teenager without it feeling like homework. Unsubscribed spam that
is genuinely funny; texture matters.

**LinkedOut.** **Marco** (the persistent rival, GDD §14) posts here — how you learn he raised, hired
your candidate, or died. **A rival you read about is more alive than a rival in a leaderboard row.**
Candidate profiles with information asymmetry intact: you see the résumé, not the truth — a natural
home for a second calibration moment. Your own profile updates as you grow: vanity, correctly
modelled.

**Consider a fourth: The Ledger** — read-only history of The Books across all years with year-end
statements archived. The player's own financial history currently isn't browsable, which is a strange
gap in a finance game.

### Gate

- [ ] Open/close spring-driven and drag-dismissible
- [ ] App-open uses a shared-element transition
- [ ] All three apps have live state that changes across years
- [ ] ≥1 event per year delivered via BeeMail before its decision sheet
- [ ] **60fps on phone transitions on a real iPhone**

---

## PHASE 6 · THE TEACHING LAYER

**Fixes:** P8 · **Size:** Large · **Depends on:** Phases 2, 3
**This is the phase that determines whether Novus is defensible.**

### The honest diagnosis

The app teaches **vocabulary** — Rookie Mode glosses, The Books always on screen. That's genuinely
good ambient literacy; preserve it. But nothing ever checks whether the player can **use** a concept,
and nothing tells them what they got better at. Ten runs in, they have no evidence of learning. For a
product whose parent-facing pitch is *"daily DECA/FBLA role-play practice with receipts"* — **there
are currently no receipts.**

### Fluency — three competencies, evidenced from play

Not XP. Not levels. Three named competencies a DECA judge would recognise, each scored from things
the player **actually did**.

| Competency | Raises it | Lowers it |
|---|---|---|
| **Unit Economics** | Naming a margin, CAC, or payback figure unprompted in a pitch. Choosing an option whose signal implies a margin tradeoff and defending it. Correctly forecasting a cash direction. | Quoting revenue with no cost attached. Being caught on a number that contradicts your own Books. |
| **Capital & Dilution** | Correctly stating post-money or ownership when asked. Turning down a bad deal for a stated reason. Negotiating on the axis that actually matters. | Accepting an offer below your last round without acknowledging it. Not knowing your own cap table. |
| **Operating Judgment** | Decisions that survive their own delayed effects. Acting on runway before it's a crisis. Calibration accuracy across forecasts. | Repeatedly choosing the option that defers cost. Being killed by a consequence you'd been warned about. |

**Every change must cite its evidence.** Not `Unit Economics +3` but:

> **Unit Economics · Year 4**
> You told Marcus your gross margin before he asked, and it matched your Books.
> *"Somebody walked in here knowing their own P&L."*

That citation is the receipt — what a student screenshots for a college app, what a parent sees when
they ask what this thing is for.

### The calibration record

From Phase 2's forecasts: prediction count, accuracy by confidence level, a calibration curve. Say
the plain-English version out loud:

> When you say you're **sure**, you're right **62%** of the time.
> When you say you're **guessing**, you're right **58%** of the time.
> **Your confidence isn't telling you much yet.**

Uncomfortable, useful, and almost no product tells a teenager this. It is also the most defensible
"we teach business skills" claim in the app, because it is **measured rather than asserted.**

### The autopsy, upgraded

`lib/engine/autopsy.ts` already ranks fatal decisions by realized damage. Make it teach: for each of
the three, show what the **alternative** would have done, run counterfactually through the engine
(`effects.ts` is pure, so this is genuinely computable — **only claim it because you can actually run
it**). Name the **warning that was already on screen**: *"Your runway went under 6 months in Year 3.
You had four decisions after that and none of them were about cash."* End on the one transferable
sentence — not "you ran out of money" but *"You optimised for growth in a quarter when you needed to
optimise for survival. That's the trade every founder gets wrong once."*

### Rookie Mode, extended

Keep current behaviour (glosses **add**, never replace). Add **term-on-first-use in context**, once
per term per run, as an inline tap-target — not a modal, not a blocking tooltip. And a real glossary
screen, because sometimes people just want to look something up.

### What NOT to build

**No quizzes. No lesson screens. No "Did you know?" cards. No badge for reading something.** Nothing
that pauses the game to teach — every teaching moment above is *inside* a decision, *inside* a
conversation, or *after* a death. **No claim the app cannot evidence.**

### Gate

- [ ] Three competencies, each with cited evidence for every change
- [ ] Calibration record with an honest plain-English readout
- [ ] Autopsy runs **real** counterfactuals through the engine
- [ ] Playtest, asked of someone who finished one run: *"What are you better at than you were an
      hour ago?"* **If they can't answer, this phase is not done.**

---

## PHASE 7 · PERSISTENCE, LIVE AI, VOICE

**Size:** Large · **Do not start before Phases 1–6 are gated.**
**Skills:** `persona-architecture`, `constraint-specification` (+ `guardrail-design` if warranted)

### Supabase

`lib/engine/save.ts` is already shaped for this. Free tier. Account: `pateltech53@gmail.com`.

Tables: `profiles` · `runs` · `run_events` (append-only decision log — this is what makes Fluency
evidence auditable) · `legacy` · `calibration` · `daily_market`.

**Non-negotiable: Row Level Security on every table from day one.** A player reads and writes only
their own rows. Still Standing reads through a view exposing **only** display name, avatar config,
and best year — never financials, never email.

**Server-authoritative:** the daily market seed and leaderboard writes. Everything else is
optimistic-local with sync, because a dropped write should never cost a player a run.

### Live AI

`lib/ai/stub.ts` implements `AiAdapter` and the fixture shapes are copied verbatim from the prompt
pack — the swap is one line. Preserve that.

**All AI calls move behind Next.js route handlers. No key ever reaches the client.** Not negotiable,
and the single most common way student projects leak a key. Rate limit per user, hard cap per day,
and **graceful degradation to fixtures** when capped — Brand Law 3 says runs never end from something
that isn't the player's decision.

**Cache aggressively.** Today's Market is the same for everyone, so its brief and panel framing are
generated **once per day, server-side**, not once per player. That's the difference between a $25 API
budget lasting a month and lasting a day.

The five shark prompts in `lib/ai/prompts/` are already written and good. **Add the Brand Law 5
prohibition explicitly to each:** *grade the logic, never the voice — accent, energy, pace, and speech
rhythm are never scored.* Use `constraint-specification` to make that an **eval you can run**, not a
sentence you hope the model read.

**Panel reactions must be conditioned on the actual transcript. If a live response ever ignores what
the player said, that is a P0 bug.**

### ElevenLabs

Starter tier. Five distinct shark voices + one Chair.

**Pre-generate everything that repeats** — stock lines, Chair framing, going-out lines, Chapter 7
narration are fixed strings and should be cached audio served from storage, not synthesised per play.
Only genuinely dynamic reactions hit the API live.

**Always ship text alongside audio.** Audio is an enhancement; the game is fully playable and legible
with sound off. **Test the whole panel muted.** Barge-in cuts the shark immediately. Fall back to
`speechSynthesis` (`lib/ai/speech.ts`) when quota is out — never a silent failure.

### Gate

- [ ] RLS verified by attempting a cross-user read and confirming it **fails**
- [ ] No API key in any client bundle — `grep` the built output
- [ ] A full run playable with AI disabled, sound off, and offline-after-load
- [ ] Daily API cost measured against a projected 100-DAU load and reported

---

## C · CROSS-CUTTING REQUIREMENTS

### C.1 It must be a real game

Ship these or the "doesn't feel like a full game" complaint stands:

- **A guided first run that cannot be lost** (GDD §4) — fully scripted, teaches by playing, ends with
  the player having closed a fiscal year on camera.
- **Save and resume mid-year, mid-card, mid-panel.** Currently a reload drops the drawn card *and*
  restarts the tutorial. Unacceptable in a game about consequences.
- **Real sound design** — not music, *interface sound*. The year closing, the deal signing, the
  Chapter 7 filing. **Three sounds well chosen is a game; twenty is a toy.** Everything works muted.
- **A run summary card worth sharing** — company name, industry, years survived, cause of death,
  avatar. This is your entire organic growth loop and it is one component. (Skill: `canvas-design`.)
- **Marco.** The persistent rival (GDD §14, event library Section G) belongs in LinkedOut. A rival
  who is only a leaderboard row is not a rival.
- **Legacy that visibly persists** — shark respect, best year, badges, visible at the start of the
  *next* run, so death has continuity.

### C.2 Accessibility — not optional, cheap if done as you go

Full keyboard nav with visible `:focus-visible` · semantic landmarks · every icon-only control
labelled · live regions on The Books when figures change · AA minimum, **AAA on financial figures** ·
`prefers-reduced-motion` honoured throughout · **and every camera/mic moment has a text-input
fallback** — a player who cannot speak, or is on a bus, must still be able to play. It's scored on
content only and stated plainly, never hidden.

### C.3 Testing

`npm run check` in CI on every commit. Engine unit tests for: `advanceMonth` gating, `closeYear`
requiring a `PerformResult`, luck never flipping a sign, autopsy ranking, dilution math. The balance
harness runs on every PR and reports the curve. **Real-device testing on an actual iPhone at the end
of each phase** — a simulator will not surface `backdrop-filter` jank, memory pressure, or safe-area
errors.

Add the two cheap CI assertions: **no horizontal scroll at 320px** and **no text below 12px**
(`npm run capture` already exits non-zero on both).

### C.4 Privacy — this is a product used by minors

Camera and mic recordings are **processed and discarded**. If ever stored: opt-in, clearly stated,
deletable. **Default is never stored.** Ask permission **at the moment of use**, with an explanation,
never on load. No fingerprinting analytics, no ad SDK, no social login that pulls a friend graph.
Display names are user-chosen and moderated; real names never required. A visible, plain-English
one-screen explanation of what is recorded, sent, and kept — **written for a 15-year-old, not a
lawyer.**

---

## D · WHAT NOT TO DO

The failure modes most likely to occur while executing this document.

1. **Do not rewrite `lib/engine/`.** It is the best code in the repo.
2. **Do not delete the `known` field from the data.** Stop *rendering* it — the autopsy and the
   authoring pipeline use it.
3. **Do not replace the decision chips with nothing.** Phase 2's trap section exists because that is
   the obvious and wrong fix.
4. **Do not make the game harder to compensate for removing the answer key.** Information changed;
   difficulty did not. Verify with the harness at a fixed seed.
5. **Do not add glass to content surfaces.** Money is read on solid ground.
6. **Do not put `backdrop-filter` over the WebGL canvas.** It janks on iOS and you won't see it on a
   desktop browser.
7. **Do not generate the player's dialogue.** Not one line, not as a placeholder, not "temporarily."
8. **Do not add a skip button, a simulate-year button, or a debug bypass that ships.**
9. **Do not let anything purchasable touch score, survival, or leaderboard.** Legal exposure with
   minors, not a design preference.
10. **Do not score accent, energy, pace, or speech rhythm.** Put the prohibition in the prompt text,
    not just in your intentions.
11. **Do not invent metrics or testimonials** anywhere in the app or marketing surface.
12. **Do not add a component library, a CSS-in-JS runtime, or a second state manager.**
13. **Do not italicise a heading.** Ever.
14. **Do not ship a 375px column on a 1280px screen** — and do not ship the current full-bleed
    stretch either.
15. **Do not do all seven phases in one pass.**

---

## E · OPEN QUESTIONS — do not let these resolve by accident

1. **The balance band.** True survival is **~50%** (300×10, seed 1, clock 2026-01-15). The brief's
   §12.3 gate band is **30–45%** and its stated target was ~38%. Either the band was written against
   a build that no longer exists, or the game is genuinely too forgiving. **A balance-design call,
   still open.** Wiring that CI gate as written fails on day one against an untouched codebase.
2. **Phase 2 signal scope.** 506 of 694 choices carry `known`. **Recommendation: author all 694.**
3. **Phase 4 avatar path.** Measurement strengthens Option B. Argue before building if you disagree.
4. **Tutorial completion is not persisted** — reloading `/play` restarts the coachmarks. Related to
   C.1's resume requirement. Cheap; worth scheduling.
5. **npm audit** reports 3 high-severity findings — all pre-existing `next` transitive deps
   (postcss, sharp). The offered fix downgrades `next` to 9.3.3. **Left alone deliberately.**

---

## F · PHASE SUMMARY

| Phase | Fixes | Size | Blocking |
|---|---|---|---|
| ~~0 · Pre-flight~~ | — | ✅ **done** | — |
| **1 · Visual system** | P5, P6 | Large | 3, 4, 5 |
| **2 · Decision integrity** | P1 | Large | 6 |
| **3 · The Panel** | P2, P3 | Largest | 6, 7 |
| **4 · Closet & avatar** | P4 | Medium | — |
| **5 · Phone & apps** | P7 | Medium | — |
| **6 · Teaching layer** | P8 | Large | — |
| **7 · Persistence & live AI** | gaps | Large | launch |

**If you can only do three: Phase 2, Phase 3, Phase 1 — in that order.** Phase 2 is what makes it a
business game instead of a number game. Phase 3 is what makes it Novus instead of a tycoon clone.
Phase 1 is what makes people take it seriously in the first thirty seconds.

---

## G · DEFINITION OF DONE — the whole project

A stranger can:

- open `novuspitch.com` on an iPhone in Safari, add it to the home screen, and have it open
  fullscreen with no browser chrome and no layout shift;
- play through a guided first fiscal year without reading any instructions;
- **not be able to tell, before choosing, which option is numerically optimal** — and still feel
  their choice was informed rather than random;
- speak into the camera, be asked a follow-up by a named shark that references what they actually
  said, answer in their own voice, and get a different outcome than if they'd said something else;
- lose the company, read the autopsy, and correctly name the decision that killed them;
- explain what *runway*, *dilution*, and *gross margin* mean afterwards — **without having been shown
  a glossary screen.**

**If any of those six fail, the phase that owns it is not done.**

---

## H · THE ONE-PARAGRAPH VERSION

Novus is a life sim for a company where the only way time moves is by defending that company out loud
on camera. The engine underneath already works and is well built — protect it. Three things are
hollowing it out: the decisions print their own answer key, so nobody has to think; the app writes the
player's dialogue, so nobody has to speak; and nothing ever measures whether the player got better, so
nobody can prove they learned. Fix those three, put the whole thing on a real design system with a
disciplined dark palette, glass on the controls and nowhere near the money, and an iPhone-native feel
that also stands up on a desktop — and Novus stops being a good prototype and starts being a product
that a DECA judge, a parent, and a fifteen-year-old would each recognise as worth their time, for three
completely different reasons.
