import type { LedgerSample, RunState } from "./types";
import { deriveRunwayMonths } from "./sim";

/**
 * The Books' own memory — a rolling twelve months, so the ledger can draw a
 * trend and name a change instead of only ever showing a value.
 *
 * ── Why this is its own file ──────────────────────────────────────────────
 *
 * `lib/engine/run.ts` and `lib/engine/sim.ts` are protected (docs/DO-NOT-TOUCH
 * §"Protected files"), and the rule there is additive-over-invasive. Sampling
 * is an observation, not a rule of the game: nothing here reads back into a
 * decision, an outcome or a draw, so the engine has no business carrying it.
 * This file only *reads* the engine.
 *
 * ── Why the call sites are in lib/leaderboard/replay.ts ───────────────────
 *
 * `advanceTurn()` and `closeYearWhole()` are "one tap, whole" and "the fiscal
 * year closing, whole" — the shared orchestration the provider AND the server
 * verifier both run, extracted precisely so the two cannot drift. Sampling
 * there means the history is identical on both sides by construction, and it
 * follows the precedent docs/LEADERBOARD.md sets for derived per-turn state.
 *
 * `scripts/simulate.mjs` and `scripts/audit-phone.mjs` call `advanceMonth`
 * directly and so produce no history at all. That is deliberate and it is why
 * every reader below must treat an empty history as normal: the balance
 * harness has no use for a sparkline, and a run restored from a save written
 * before this existed has none either.
 */

/** How many months the ledger remembers. One fiscal year, one sparkline. */
export const LEDGER_WINDOW = 12;

/** Below this many points a sparkline is a dot pretending to be a trend. */
export const SPARK_MIN_POINTS = 3;

/**
 * Read the Books as they stand right now. Pure — nothing is stored.
 *
 * Separate from `pushLedger` because the sample and the storing happen at
 * different moments: the caller takes this BEFORE time moves and stores it
 * AFTER, once it knows the tap actually was a month and not the year gate.
 */
export function sampleLedger(state: RunState): LedgerSample {
  const runway = deriveRunwayMonths(state);
  return {
    c: state.stats.cash,
    b: state.stats.burnMonthly,
    /*
     * `deriveRunwayMonths` returns Infinity for burn ≤ 0 — a real state (the
     * company is profitable) and an unserialisable number: JSON.stringify
     * turns Infinity into null, and a save that round-trips a runway into null
     * is a crash waiting for the first company that makes money. Clamped on
     * the way in, where there is still something true to clamp.
     */
    r: Number.isFinite(runway) ? Math.min(999, runway) : 999,
    v: state.stats.valuation,
  };
}

/**
 * Store a sample, oldest first, keeping at most a fiscal year of them.
 *
 * Deliberately NOT wired into `refreshBooks`: that runs after every applied
 * effect, and a series sampled per effect charts how many buttons were pressed
 * rather than how the company went.
 */
export function pushLedger(state: RunState, sample: LedgerSample) {
  if (!state.ledger) state.ledger = [];
  state.ledger.push(sample);
  if (state.ledger.length > LEDGER_WINDOW) {
    state.ledger.splice(0, state.ledger.length - LEDGER_WINDOW);
  }
}

/** The four series a ledger cell can draw. */
export type LedgerKey = keyof LedgerSample;

/**
 * What this figure was when the player last looked at it — the sample taken
 * just before the most recent tap moved time.
 *
 * The newest entry is the RIGHT baseline precisely because it is stored before
 * the tick rather than after: `current − newest` is what the tap did, plus
 * whatever the decisions it surfaced then did. Sampling after the tick instead
 * would make the newest entry equal to the live value and every delta would
 * read as zero — which is what the first version of this did.
 *
 * Null means "say nothing", never "no change": a delta of zero and an absence
 * of history are different facts and the ledger must not conflate them.
 */
export function previousValue(state: RunState, key: LedgerKey): number | null {
  const history = state.ledger;
  if (!history || history.length === 0) return null;
  const prev = history[history.length - 1][key];
  return Number.isFinite(prev) ? prev : null;
}

/**
 * The history of one figure as plain numbers, oldest first, with the live
 * value appended — so the line ends where the number on screen is rather than
 * one month behind it.
 *
 * Returns an empty array below `SPARK_MIN_POINTS`, so a caller can render the
 * whole sparkline or none of it without counting.
 */
export function series(state: RunState, key: LedgerKey, live: number): number[] {
  const history = state.ledger ?? [];
  const points = [...history.map((s) => s[key]), live].filter(Number.isFinite);
  return points.length >= SPARK_MIN_POINTS ? points : [];
}
