import type { Allocation } from "@/lib/engine/run";
import type { Industry, PerformType } from "@/lib/engine/types";

/**
 * The tape — what a player submits to the leaderboard.
 *
 * ── The one idea this file exists to enforce ────────────────────────────────
 *
 * A tape carries INPUTS, never OUTCOMES. Not one number a client computed ever
 * reaches a board query. `lib/engine/save.ts` writes the whole `RunState` to
 * localStorage as plain JSON: a player opens devtools, sets `stats.valuation`
 * to 1e12, reloads, and the app believes them — correctly, because that is what
 * a local save is for. So the server does not read that number. It replays the
 * inputs against `lib/engine` and computes its own (docs/LEADERBOARD.md §7).
 *
 * The engine makes that possible. `runRng(seed, year, month, salt)` is
 * POSITION-seeded, not sequential, so every draw, branch and luck band is a
 * pure function of where the run is standing rather than of how many random
 * numbers have been drawn so far. Given the seed and the taps, the run is
 * reproducible exactly — the same property `scripts/simulate.mjs` relies on.
 *
 * ── Why each entry carries what it carries ─────────────────────────────────
 *
 * Every entry below is the SMALLEST thing that identifies the player's intent
 * while leaving the consequence to the server. The pattern is worth naming,
 * because it is what stops each of these being a cheat:
 *
 *   · `hire` carries an INDEX, not a candidate. `candidatePool()` is seeded on
 *     `${state.id}:hire:${year}:${month}`, so the server regenerates the same
 *     six people and takes the same one. A client cannot invent a candidate
 *     with `performance: 100`.
 *   · `trade` carries a MINUTE, not a price. `priceAt(ticker, minute)` is a
 *     pure function of ticker and minute-since-epoch, so the server recomputes
 *     the fill. A client cannot claim it bought FINN at $0.01.
 *   · `perform` and `coldcall` carry a TRANSCRIPT, not a score. The words are
 *     the input; `scorePitchContent()` is the scorer and it runs server-side
 *     (§7.3). A client cannot award itself a 10.
 *   · `sell-asset`, `fire`, `retire` and `refresh` carry an INDEX into the
 *     run's own arrays, so they name a thing the replay already holds rather
 *     than describing one it has to trust.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 *
 * `founderName` is `""` and is typed that way so it cannot be filled in by
 * accident. For a nine-year-old the founder name is their first name, often
 * their full one, and publishing it beside a company name that might identify
 * a school is the exact pattern COPPA exists to prevent (§9.2). The board shows
 * a curated handle from `lib/leaderboard/handles.ts` instead. `playerAge` is
 * absent for the same family of reasons (§9.4): it is local age-gating, and
 * sending it would convert a device preference into stored data about a child.
 */

/** A YYYY-MM-DD date. Never a timestamp — a time of day is coarse location. */
export type DateISO = string;

export type TapeEntry =
  /**
   * A month passed. The date is here because `advanceMonth()` reads the wall
   * clock twice — Today's Market is seeded by the UTC date, and the coasting
   * rule compares against `lastPlayedISO` — so a replay that does not pin the
   * clock draws different events than the player saw.
   */
  | { t: "advance"; atISO: DateISO }
  /** A decision card answered. The index is into `visibleChoices()`. */
  | { t: "choice"; eventId: string; choice: number }
  /** A card the player closed without answering. */
  | { t: "dismiss"; eventId: string }
  /**
   * A camera moment. `kind` says which of the three the engine is being asked
   * for; the transcript is the input to the scorer, and the score is not here
   * on purpose.
   */
  | {
      t: "perform";
      kind: "choice" | "eventOnly" | "yearEnd";
      performType: PerformType;
      eventId?: string;
      choiceIndex?: number;
      transcript: string;
      /** Year closed quietly — no pitch (valid only after PITCH_REQUIRED_YEARS). */
      skipped?: true;
    }
  /** The year-end investment choice. */
  | { t: "allocation"; pick: Allocation }
  /** Index into `candidatePool(state, 6)` for the current fiscal month. */
  | { t: "hire"; index: number }
  /** Index into `state.roster`. */
  | { t: "fire"; index: number }
  | { t: "buy-asset"; defId: string }
  /** Index into `state.holdings`. */
  | { t: "sell-asset"; index: number }
  /** A product launch. Price in cents so a float never rounds differently. */
  | {
      t: "product";
      name: string;
      priceCents: number;
      investTier: 0 | 1 | 2;
      tags: string[];
    }
  /** Index into the portfolio's live items. */
  | { t: "retire"; index: number }
  | { t: "refresh"; index: number; costS: number }
  /**
   * RobinGhood. The minute is the fill; the server recomputes the price from
   * it. `qty` is shares, `side` is which way.
   */
  | { t: "trade"; side: "buy" | "sell"; symbol: string; qty: number; minute: number }
  /** Money moved from the company into the brokerage. */
  | { t: "transfer"; amountUsd: number }
  /**
   * A cold call. Rationed to three per REAL day, which is why the date is
   * here: more than three sharing one date is a forged tape (§7.4).
   */
  | { t: "coldcall"; investorId: string; transcript: string; atISO: DateISO }
  /** An activity from the activity bar. Spends resources, never time. */
  | { t: "activity"; id: string }
  /**
   * Pro was toggled. Audit only — Pro gates which candidates and industries a
   * player can SEE, and is enforced never to change what any of them are worth
   * (Brand Law 4). Recorded so the replay applies the same content gates the
   * player played under, and so §8.3's standing audit has something to read.
   */
  | { t: "pro"; on: boolean };

export type TapeEntryKind = TapeEntry["t"];

export interface RunTape {
  /** The whole basis of replay. `RunState.id` is derived from it. */
  seed: number;
  /**
   * Typed as the empty string, not as `string`. §9.2 — this is the field that
   * must never carry a child's name, and a type is a cheaper guard than a
   * code review.
   */
  founderName: "";
  companyName: string;
  industry: Industry;
  /**
   * Whether this company was founded as a guided first play.
   *
   * Part of the run's identity rather than of its taps, because it changes one
   * rule: the tutorial year cannot be failed, so year 1's camera score has a
   * floor of `KNOBS.tutorialScoreFloor`. A replay that did not know would score
   * every new player's first year below what they were shown.
   *
   * It is a client claim, and a bounded one. Forging it buys the floor on
   * exactly one year's pitch — the same floor the guided first play hands every
   * new player for free — and it cannot manufacture a decade of survival. That
   * is the same ceiling §7.3 accepts for a typed pitch, for the same reason:
   * closing it would cost more than the exploit is worth.
   */
  tutorial: boolean;
  entries: TapeEntry[];
}

/** Nothing above this many entries is a run; it is a script or a bug. */
export const MAX_TAPE_ENTRIES = 4000;

/** Mirrors the `tape_size` check constraint in 0002, minus a safety margin. */
export const MAX_TAPE_BYTES = 240 * 1024;

/**
 * Canonical JSON — the bytes that get hashed.
 *
 * Object key order is insertion order in JavaScript, so two structurally
 * identical tapes built by different code paths serialise differently and hash
 * differently. `unique (profile_id, tape_hash)` is what stops a tape being
 * submitted twice, and a duplicate-detection scheme that a key reordering
 * defeats is not one. Keys are sorted; arrays keep their order, because in a
 * tape the order IS the data.
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

/**
 * How many fiscal years a tape claims to cover.
 *
 * Counted from the tape rather than taken from the client, because it is one
 * of the two numbers a board orders by. Eleven advances reach the year gate and
 * a `yearEnd` perform closes the year, so the closes are what count — a run
 * that advanced 480 times but never closed a year survived one year, loudly.
 */
export function yearsClaimedBy(tape: RunTape): number {
  const closes = tape.entries.filter(
    (e) => e.t === "perform" && e.kind === "yearEnd",
  ).length;
  return Math.max(1, closes);
}

export function countKind(tape: RunTape, kind: TapeEntryKind): number {
  return tape.entries.filter((e) => e.t === kind).length;
}
