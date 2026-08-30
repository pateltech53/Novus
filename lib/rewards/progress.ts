import type { DailySlot } from "./daily";

/**
 * Turning play into progress.
 *
 * ── There is no engine event bus ────────────────────────────────────────────
 *
 * The build prompt assumed one ("subscribe an achievements.ts reducer to the
 * existing event bus"). There isn't: the sim is pure TypeScript running in the
 * browser, and what reaches the server is the SAVE — `{run, legacy, prefs}`
 * through /api/sync. So progress is reported as moments, and this module is
 * what decides whether a reported moment satisfies a template.
 *
 * ── Which half of a moment is trusted ───────────────────────────────────────
 *
 * Not the client's word for anything it could simply assert. Each fact below
 * is marked `fromSave` or `fromEvent`:
 *
 *   · `fromSave` facts — the fiscal year reached, valuation, cash, net worth,
 *     industries played — are re-read from the player's synced save on the
 *     server and the posted number is ignored. Lying requires writing the lie
 *     into the save, which /api/sync already owns.
 *   · `fromEvent` facts — a pitch score, a deal's equity — have no server-side
 *     record to check against yet, so they are taken on trust but RATE-CAPPED
 *     (a pitch takes a minute; twenty in a minute is not a pitch).
 *
 * That split is written down here rather than assumed, because the difference
 * between the two is the difference between a leaderboard and a suggestion.
 */

export interface PlayEvent {
  /** Matches `Template.event` — "pitch.scored", "year.ended", … */
  type: string;
  /** The numbers the moment carries. */
  payload: Record<string, number | string | boolean>;
  /** Client clock, for ordering only; never trusted for rate limits. */
  at?: string;
}

/** Facts the server re-derives from the synced save rather than believing. */
export interface SaveFacts {
  year: number;
  valuation: number;
  cash: number;
  netWorth: number;
  industriesPlayed: string[];
  runsStarted: number;
  pitchesDelivered: number;
}

/** How many times one event type may advance progress in a single day. */
const DAILY_EVENT_CAP: Record<string, number> = {
  "pitch.scored": 40,
  "pitch.completed": 40,
  "deal.closed": 30,
  "year.ended": 60,
  "quarter.ended": 200,
  "run.started": 20,
  "session.heartbeat": 240, // 30 s ticks — 2 h of foreground, the 2× cap
  "panel.offers": 40,
  "panel.qna": 60,
};

export const capFor = (type: string) => DAILY_EVENT_CAP[type] ?? 60;

/**
 * Does this event advance this slot, and by how much?
 *
 * Returns 0 when the event is for a different template or does not clear the
 * template's bar. A template whose goal is cumulative ("play 20 minutes",
 * "close 2 deals") returns 1 per qualifying event; a template whose goal is a
 * threshold ("score ≥ 75") returns the whole target, because clearing it once
 * is the whole job.
 */
export function advanceBy(
  slot: DailySlot,
  event: PlayEvent,
  facts: SaveFacts | null,
): number {
  if (event.type !== slot.event) return 0;

  const p = event.payload;
  const n = Number(slot.param.n ?? 0);
  const num = (key: string) => Number(p[key] ?? 0);
  const whole = slot.target;

  switch (slot.id) {
    // ── cumulative: one tick per qualifying moment ────────────────────────
    case "S1": return 0.5;                                   // 30 s heartbeat → half a minute
    case "S2": return 1;
    case "S5": return 1;
    case "O1": return Math.max(1, num("count"));
    case "O2": case "O4": return 1;
    case "C1": case "C2": return 1;
    case "F2": return 1;

    // ── save-derived thresholds: the posted number is ignored ─────────────
    case "S3": return facts && facts.year >= n ? whole : 0;
    case "S6": return facts && facts.year >= n ? whole : 0;
    case "F1": return facts && facts.cash >= n ? whole : 0;
    case "F4": return facts && facts.valuation >= n ? whole : 0;
    case "B2": return facts && facts.netWorth > 0 ? whole : 0;
    case "B3": return facts ? whole : 0;
    case "S4": return facts && String(p.industry ?? "") === String(slot.param.industry ?? "") ? whole : 0;

    // ── event thresholds: trusted, but rate-capped by the caller ──────────
    case "P1": return num("score") >= n ? whole : 0;
    case "P2": return num("fillerWords") <= n ? whole : 0;
    case "P3": return num("eyeContactPct") >= n ? whole : 0;
    case "P4": return num("pacingGreenPct") >= n ? whole : 0;
    case "P5": return Math.max(1, num("answered"));
    case "P6": return num("improvedBy") >= n ? whole : 0;
    case "P7": return num("clarity") >= n ? whole : 0;
    case "B1": return num("personalBest") ? whole : 0;

    case "D1": return num("offers") >= n ? whole : 0;
    case "D2": return num("equityPct") > 0 && num("equityPct") <= n ? whole : 0;
    case "D3": return num("amount") >= n ? whole : 0;
    case "D4": return String(p.shark ?? "") === String(slot.param.shark ?? "") ? whole : 0;
    case "D5": return num("sharks") >= Math.max(2, n) ? whole : 0;
    case "D6": case "D7": case "D8": return whole;

    case "F3": return num("runwayMonths") >= n ? whole : 0;
    case "F5": return num("grossMarginPct") >= n ? whole : 0;
    case "F6": case "F8": return whole;
    case "F7": return num("profitPct") >= n ? whole : 0;

    case "O3": return num("ctr") >= n ? whole : 0;
    case "O5": case "O6": case "O7": return whole;
    case "O8": return num("wtpPct") >= n ? whole : 0;
    case "O9": return num("customers") >= n ? whole : 0;
    case "O10": return num("revenueGrowthPct") >= n ? whole : 0;

    case "R1": case "R2": case "R4": return whole;
    case "R3": return 1;
    case "B4": return whole;

    case "C3": case "C4": return whole;

    default: return 0;
  }
}

/** Whether a template's goal is counted up or cleared in one go. */
export const isCumulative = (id: string) =>
  ["S1", "S2", "S5", "O1", "O2", "O4", "C1", "C2", "F2", "P5", "R3"].includes(id);
