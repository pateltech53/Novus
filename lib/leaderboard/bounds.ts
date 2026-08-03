import { INDUSTRIES, industryByCode } from "@/lib/engine/constants";
import { MAX_CALLS_PER_DAY } from "@/lib/ai/callers";
import type { Industry } from "@/lib/engine/types";

import { MAX_TAPE_ENTRIES, type RunTape } from "./tape";

/**
 * Plausibility bounds — the cheap gate in front of the expensive one.
 *
 * Replay costs CPU, and CPU is what an attacker spends when they cannot spend
 * anything else. So the absurd is rejected before a single month is simulated
 * (docs/LEADERBOARD.md §7.4).
 *
 * Everything here is a REJECT-THE-IMPOSSIBLE test, never a reject-the-unlikely
 * one. A player who scripts an optimal run against the real engine is playing
 * the game well, and the tape they submit is genuine — deterministic replay
 * draws exactly the right line, and these bounds must not draw a different one
 * in front of it. Where a number is merely extraordinary, the verdict is
 * `flag`: a human looks, rather than a door closing in someone's face on their
 * best ever run.
 */

export type BoundsVerdict = "pass" | "flag" | "reject";

export interface BoundsResult {
  verdict: BoundsVerdict;
  /** Machine-readable. Logged on every rejection — see the note at the bottom. */
  reasons: string[];
}

export const MIN_YEARS = 1;
export const MAX_YEARS = 60;

/** Nothing in this app existed before this. A tape dated earlier is forged. */
export const EPOCH_ISO = "2026-01-01";

/** 11 taps reach the year gate; the 12th month is the gate itself. */
export const ADVANCES_PER_YEAR = 11;

/**
 * The median final valuation of a surviving run, by fiscal years survived.
 *
 * MEASURED, not guessed: `npm run sim 60 <years> 1` over 2/4/6/8/10/12 years
 * returns $130.0K / $575.3K / $2.8M / $12.8M / $81.8M / $675.0M. That is a
 * clean geometric curve at ~2.4× a year, which is the fit below.
 *
 * The harness plays FOOD, ECOM, TECH and CONTENT — industry multiples 2, 3, 8
 * and 5 — so the curve is normalised at 4.5 and scaled by the run's own
 * multiple. TECH at 8 is legitimately worth ~1.8× a FOOD run of the same
 * length, and a ceiling that did not know that would reject the best free
 * industry in the game for being good at the thing it is good at.
 */
const MEDIAN_MULTIPLE = 4.5;

export function medianValuationAt(years: number, industry: Industry): number {
  const base = 30_000 * Math.pow(2.4, Math.max(1, years));
  return base * (industryByCode(industry).multiple / MEDIAN_MULTIPLE);
}

/**
 * Above this, a human looks. Roughly the p99 of the measured distribution.
 *
 * 40× the median rather than a measured percentile because the harness reports
 * medians and not tails, and inventing a precision the data does not have would
 * be worse than being visibly approximate. It is the flag line, not the reject
 * line — being wrong here costs a review, not a run.
 */
export const FLAG_FACTOR = 40;

/**
 * Above this, the claim is nonsense and the replay is not worth paying for.
 *
 * ~100× the flag line, per §7.4, and clamped under the `valuation_claim` check
 * constraint in 0002 so this function and the database can never disagree about
 * which of them refused a row.
 */
export const REJECT_FACTOR = 1000;
export const ABSOLUTE_VALUATION_CEILING = 1e13 - 1;

export function valuationCeilings(years: number, industry: Industry) {
  const median = medianValuationAt(years, industry);
  return {
    median,
    flagAbove: median * FLAG_FACTOR,
    rejectAbove: Math.min(median * REJECT_FACTOR, ABSOLUTE_VALUATION_CEILING),
  };
}

const isDateISO = (v: unknown): v is string =>
  typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v));

export interface ClaimedNumbers {
  peakValuation: number;
  yearsSurvived: number;
}

/**
 * Checks a tape and the numbers its client claimed for it.
 *
 * `todayISO` is a parameter so this is a pure function: a bounds check whose
 * result depends on when it ran is one that cannot be tested.
 */
export function checkBounds(
  tape: RunTape,
  claimed: ClaimedNumbers,
  todayISO: string,
): BoundsResult {
  const reasons: string[] = [];
  const reject = (reason: string): BoundsResult => ({ verdict: "reject", reasons: [reason] });

  // ── Shape ────────────────────────────────────────────────────────────────
  if (!Number.isFinite(tape.seed) || tape.seed < 0 || tape.seed > 0xffffffff) {
    return reject("seed-out-of-range");
  }
  if (tape.founderName !== "") return reject("founder-name-present");
  /*
   * Checked here, before `medianValuationAt` reaches for the multiple.
   *
   * `industryByCode` ends in `.find(...)!` — a non-null assertion over a lookup
   * that can miss — so an unrecognised code THROWS rather than returning
   * undefined. Without this line that throw happens inside the cheap gate,
   * which turns a malformed submission into a 500 on a route whose entire job
   * is to refuse malformed submissions politely. The database has the same
   * constraint; this is the half that can explain itself.
   */
  if (!INDUSTRIES.some((i) => i.code === tape.industry)) return reject("unknown-industry");
  if (!Array.isArray(tape.entries)) return reject("no-entries");
  if (tape.entries.length === 0) return reject("empty-tape");
  if (tape.entries.length > MAX_TAPE_ENTRIES) return reject("tape-too-long");

  // ── The claim ────────────────────────────────────────────────────────────
  if (!Number.isInteger(claimed.yearsSurvived)) return reject("years-not-an-integer");
  if (claimed.yearsSurvived < MIN_YEARS || claimed.yearsSurvived > MAX_YEARS) {
    return reject("years-out-of-range");
  }
  if (!Number.isFinite(claimed.peakValuation) || claimed.peakValuation < 0) {
    return reject("valuation-not-a-number");
  }

  const ceilings = valuationCeilings(claimed.yearsSurvived, tape.industry);
  if (claimed.peakValuation > ceilings.rejectAbove) return reject("valuation-above-ceiling");
  if (claimed.peakValuation > ceilings.flagAbove) reasons.push("valuation-above-p99");

  // ── Does the tape carry the run it claims? ───────────────────────────────
  /*
   * A 40-year run needs at least 440 advances. Reject a 40-year claim carried
   * by 12 — not because the numbers would survive the replay (they would not),
   * but because finding that out costs a replay and this costs a subtraction.
   */
  const advances = tape.entries.filter((e) => e.t === "advance").length;
  const closes = tape.entries.filter((e) => e.t === "perform" && e.kind === "yearEnd").length;
  if (claimed.yearsSurvived > 1) {
    if (advances < (claimed.yearsSurvived - 1) * ADVANCES_PER_YEAR) {
      return reject("too-few-advances-for-the-claim");
    }
    if (closes < claimed.yearsSurvived - 1) return reject("too-few-year-closes-for-the-claim");
  }

  // ── The clock ────────────────────────────────────────────────────────────
  /*
   * Today's Market is seeded on the UTC date, so a run cannot go back in time:
   * doing so would let a player shop for the day whose shared event suited
   * them. Dates must be non-decreasing, none in the future, none before the app
   * existed.
   */
  let previous = EPOCH_ISO;
  const coldCallsByDay = new Map<string, number>();

  for (const entry of tape.entries) {
    const at =
      entry.t === "advance" ? entry.atISO : entry.t === "coldcall" ? entry.atISO : null;
    if (at === null) continue;
    if (!isDateISO(at)) return reject("malformed-date");
    if (at < EPOCH_ISO) return reject("date-before-launch");
    if (at > todayISO) return reject("date-in-the-future");
    if (at < previous) return reject("clock-went-backwards");
    previous = at;

    if (entry.t === "coldcall") {
      const used = (coldCallsByDay.get(at) ?? 0) + 1;
      coldCallsByDay.set(at, used);
      /*
       * `RunState` rations cold calls to three per REAL day
       * (`coldCallDayISO`, `coldCallsUsed`). More than three sharing a date is
       * a forged tape — the engine could not have produced it.
       */
      if (used > MAX_CALLS_PER_DAY) return reject("too-many-cold-calls-in-a-day");
    }
  }

  // ── Per-entry sanity ─────────────────────────────────────────────────────
  for (const entry of tape.entries) {
    switch (entry.t) {
      case "choice":
        if (!Number.isInteger(entry.choice) || entry.choice < 0 || entry.choice > 9) {
          return reject("choice-index-out-of-range");
        }
        break;
      case "hire":
      case "fire":
      case "sell-asset":
      case "retire":
        if (!Number.isInteger(entry.index) || entry.index < 0 || entry.index > 200) {
          return reject("index-out-of-range");
        }
        break;
      case "trade":
        if (!Number.isFinite(entry.qty) || entry.qty <= 0 || entry.qty > 1e9) {
          return reject("trade-quantity-out-of-range");
        }
        if (!Number.isInteger(entry.minute) || entry.minute <= 0) {
          return reject("trade-minute-out-of-range");
        }
        break;
      case "transfer":
        if (!Number.isFinite(entry.amountUsd) || entry.amountUsd < 0) {
          return reject("transfer-out-of-range");
        }
        break;
      case "product":
        if (!Number.isInteger(entry.priceCents) || entry.priceCents < 0) {
          return reject("price-out-of-range");
        }
        if (typeof entry.name !== "string" || entry.name.length > 60) {
          return reject("product-name-out-of-range");
        }
        break;
      case "perform":
        // The transcript is the input to the scorer and the only free text a
        // tape carries at length. Bounded so a tape cannot be a payload.
        if (typeof entry.transcript !== "string" || entry.transcript.length > 4000) {
          return reject("transcript-out-of-range");
        }
        break;
      case "coldcall":
        if (typeof entry.transcript !== "string" || entry.transcript.length > 4000) {
          return reject("transcript-out-of-range");
        }
        break;
    }
  }

  return { verdict: reasons.length > 0 ? "flag" : "pass", reasons };
}

/*
 * Log every rejection with its reason.
 *
 * A spike in one reason is either an exploit going around or a bug you shipped,
 * and you want to know which within the hour. That is why every refusal above
 * returns a distinct string rather than a boolean: `valuation-above-ceiling`
 * climbing on its own is somebody probing, and `too-few-advances-for-the-claim`
 * climbing on its own is a recorder that stopped recording.
 */
