# Baseline shots

Captured 2026-07-26 by `node scripts/capture.mjs` against `http://localhost:3100`,
Playwright chromium headless, `deviceScaleFactor: 2`, `colorScheme: dark`.

**Every later phase diffs against these.** Re-capture to a different directory and compare:

```bash
npm run capture -- docs/shots-phase1
```

## Files

| File | What |
|---|---|
| `welcome@375.png` · `welcome@1280.png` | onboarding — the only route that passes every gate |
| `found@375.png` · `found@1280.png` | company founding |
| `play-coachmarks@375.png` · `@1280.png` | `/play` with the 4-step first-run tutorial up |
| `play@375.png` · `play@1280.png` | `/play` steady state, month 2, DecisionSheet open |
| `report.json` | full gate audit, every route × width |
| `report.md` | the same as a table |

The `/play` shots land on an open DecisionSheet because clearing the tutorial requires genuinely
pressing ADVANCE MONTH (see below), which surfaces an event. That is a **useful** accident — it
captures the decision sheet, which is where the largest design problem in the app lives.

---

## P1, photographed

`play@375.png` shows event `The Logo Night` with its three choices:

| Choice | Chip rendered beside it |
|---|---|
| The safe one | **`Brand +1`** |
| The weird one | *(none)* |
| Pay a student designer | **`Cash −0.1S · Brand +2`** |

This is the answer key, on screen, before the player commits. `+2` beats `+1`; no reasoning about
brand, cash, or craft is required. Note the second-order damage too: "The weird one" carries **no
chip at all**, so the one choice that might be interesting reads as the null option.

Fixing this is Phase 2. The chips come from `choice.known` and are rendered in four components —
see `docs/BASELINE.md` §6.1.

---

## Gate results

Measured, not asserted. `pass` / `FAIL n` where n is the count of offending elements.

| route | h-scroll | <12px | accent | gradients | wrap labels | italic h |
|---|---|---|---|---|---|---|
| `/welcome` | pass | **pass** | **pass** | pass | pass | pass |
| `/found` | pass | FAIL 2 (min 11px) | FAIL 3 | pass | FAIL 2 @375, **FAIL 5 @320** | pass |
| `/play` (tutorial) | pass | FAIL 19 (min 8px) | FAIL 5 | pass | pass | pass |
| `/play` (steady) | pass | **FAIL 25** (min 8px) | **FAIL 6** | pass | FAIL 1 @320 | pass |

Identical at 320 / 375 / 414 / 768 / 1280 except where noted.

**Reading it:**

- **`/welcome` passes everything.** It is also the only route already on dark navy. It is the
  reference for what the rest should become.
- **Steady-state `/play` is worse than the tutorial state** — 25 sub-12px elements vs 19, and 6
  accent uses vs 5 — because the life log fills with content. The screen degrades as it is used,
  which a single first-load screenshot would never reveal.
- **No horizontal scroll at any width, including 320.** Already compliant; `overflow-x: clip` is
  correctly set on both `html` and `body`.
- **Gradients pass everywhere** — 2 painted, budget 3.
- **Glass: 0 surfaces** on every route. The §5.3 system is entirely unbuilt.
- **Canvas: 1 on every route**, including `/welcome` and `/found`. The 23 MB GLB is fetched on all
  three because `useGLTF.preload()` sits at module scope in `SharkStage.tsx:238`.

---

## Two things the harness had to get right

Both cost real debugging and are worth not re-discovering.

**1 · Framer Motion and `visibilityState`.** In the in-app browser pane,
`document.visibilityState === "hidden"`, so `requestAnimationFrame` is throttled to a crawl and
Framer entrance animations **never complete** — everything with `initial={{opacity:0}}` sits near 0
forever, and screenshots come back blank. A one-shot inline-style fix loses, because Framer
re-writes the inline style on its next tick; only an `!important` stylesheet outranks it.

**Under real Playwright headless `visibilityState` is `"visible"` and animations run normally.**
So this was a harness artifact, not an app bug, and it needs no app change. `capture.mjs` still
measures how many elements are stuck and only settles if more than two are — so if a future phase
introduces an animation that genuinely never finishes, the count rises and shows up in `report.md`.

**2 · The tutorial has two step modes, and one is not a button.** `FIRST_RUN_STEPS` in
`Coachmarks.tsx`:

- `mode: "ack"` (books, tabs, phone) → a real `GOT IT` button.
- `mode: "tap"` (advance) → **no button.** The overlay spans `inset-0` and its `onClick` tests
  whether the pointer landed inside the spotlight hole, then forwards the click to the real
  control. Clicking the button node directly does **not** advance the step.

So a "click every GOT IT" loop stalls silently at step 2. `capture.mjs` clicks the centre of the
spotlight ring for `tap` steps, and throws if the overlay survives — an earlier version swallowed
the failure and measured `/play` on the tutorial overlay instead.

In practice the tutorial completes after **2** steps, not 4: the `advance` tap ends it. Pressing it
also advances the fiscal month for real — cash $25K → $23K, runway 12 mo → 11 mo.

**Do not reload to get a clean screen.** Tutorial completion is **not persisted to the saved run**,
so navigating to `/play` again restarts the coachmarks at step 1 and undoes the dismissal. That is
itself a save-state gap worth fixing alongside §12.1's "resume mid-year, mid-card".

---

## CI

`capture.mjs` exits non-zero on the two §A.5 checks: **horizontal scroll at 320px**, and **any text
below 12px**. It currently exits 1 — 21 failures, all sub-12px, none horizontal-scroll. That is the
correct baseline behaviour: the gate is real and it is currently red.
