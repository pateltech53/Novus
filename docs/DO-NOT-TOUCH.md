# DO NOT TOUCH

Transcribed from Master Build Prompt v3 §2.2 so that future sessions inherit the constraint
without needing the original document in context.

**The engine layer is the good part of this codebase. It is not a rewrite candidate.**
A previous reviewer called this app "vibe coded." That is half true, and the half that is false
is this directory.

---

## 🔒 Protected files

| File | Why it is protected |
|---|---|
| `lib/engine/run.ts` | `advanceMonth()` is the **only** function that moves time. Month 12 refuses to advance and reports the gate. `closeYear()` is unreachable without a `PerformResult`. This single design decision is what enforces **Brand Law 1** (talk to progress). **Never add a second time-advancing path.** |
| `lib/engine/effects.ts` | Applies authored outcomes: S-unit money, durations, delayed effects, probabilistic and conditional branches, and the ±15% luck band that never flips a sign. |
| `lib/engine/events.ts` | Weighted draw with cooldowns, flag gating, category anti-repeat, targeted pressure on the player's weakest stat, and date-seeded Today's Market. The date-seeding is what makes the shared daily event work. |
| `lib/engine/sim.ts` | Quarterly tick, burn, runway, valuation, stage promotion, Chapter 7 trigger. |
| `lib/engine/autopsy.ts` | Ranks the decisions that actually killed you by realized cash and burn damage. |
| `scripts/simulate.mjs` | The headless balance harness. This is why the engine has no React in it. **The most valuable file in the repo.** Any refactor that makes the engine un-simulatable is rejected. |
| `data/sections/*.json` | 255 authored events. `title`, `text`, reskins and narration are **verbatim** from the authored library. **Do not rewrite prose.** |

Also treat as read-only unless a task names the file and the change: `lib/engine/rng.ts`
(seeded RNG + the luck band), `lib/engine/types.ts` (the shared contract — additive changes only).

---

## Rules of engagement

1. **Read the whole file before editing it.** Every time.
2. **Additive over invasive.** If a protected file needs a change, prefer a new exported function
   over altering an existing signature.
3. **Name the file and the change, then wait.** Any edit to the table above requires explicit
   sign-off first. State what you will change and why before touching it.
4. **`npm run check` must pass after every change** — `events` + `tsc --noEmit` + `sim 30 8`.
5. **A balance shift is a real regression, not a rounding error.** Report it. Never retune
   constants to hide it.

---

## The balance target

§2.2 records the target as (50 runs × 10 years):

```
survived to year 10: ~38% · median death year: 5 · median valuation ~$279M
distinct events seen 177/237 · runtime errors 0
```

⚠️ **This target does not currently reproduce.** See `docs/BASELINE.md` §2 — measured survival is
**~50%** (300 runs × 10 years, seed 1, clock 2026-01-15) and valuation **~$120M**.

The harness is now deterministic — seeded *and* clock-frozen, so repeat runs are byte-identical
and a shift at a fixed seed is a real regression. Do not "fix" a change against the §2.2 numbers
until the discrepancy above is resolved; measure against `docs/BASELINE.md` §2 instead.

---

## Off-limits by Brand Law, not by file

These are product constraints that no amount of refactoring may erode:

- **No skip button, no simulate-year button, no debug time-advance bypass in production.** (Law 1)
- **Luck never flips the sign of a result.** The ±15% band is a band, not a coin. (Law 2)
- **Nothing purchasable may touch score, survival, revives, or leaderboard position.** This is a
  product for minors — a legal constraint, not a taste one. (Law 4)
- **Never score accent, pitch of voice, energy level, or speech rhythm.** The prohibition goes in
  the prompt text, not just in your intentions. (Law 5)
- **Never generate the player's dialogue.** Not one line, not as a placeholder, not "temporarily."
- **Real words only** — burn rate, runway, dilution, gross margin, Chapter 7. Never coins, energy,
  gems, or XP. Rookie Mode *adds* a gloss; it never replaces the real term. (Law 6)
