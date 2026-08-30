import type { Band } from "./tables";

/**
 * The 51 achievement templates (build prompt §2.4), verbatim.
 *
 * ── Why templates rather than a list of challenges ──────────────────────────
 *
 * A fixed list of daily challenges is memorised in a fortnight and then it is
 * a chore. A template carries parameter sets per difficulty, so the generator
 * has two dials — WHICH templates appear and WHAT numbers they carry — and 51
 * templates with 2–4 param sets each, minus a two-day anti-repeat window, make
 * a repeated day effectively impossible.
 *
 * ── The bands are data, not a guess ─────────────────────────────────────────
 *
 * A template is available at a band only if `params` has that band. "Reject
 * every offer, then end the quarter cash-positive" has no Easy set because
 * there is no easy version of it — it is a Medium/Hard shape. The generator
 * reads that off the object rather than being told separately, so a template
 * cannot claim a band it has no parameters for.
 *
 * ── `flags` and graceful degradation ────────────────────────────────────────
 *
 * Cold calling has not shipped. Its four templates carry `requires:coldcall`
 * and simply vanish from the pool until the flag flips — no code change, no
 * dead challenge nobody can complete. Same for the energy stat.
 */

export interface Template {
  id: string;
  category: string;
  text: string;
  /** A band the template omits is a band it cannot appear at. */
  params: Partial<Record<Band, Record<string, string | number>[]>>;
  event: string;
  flags: string[];
  cooldownDays?: number;
}

/** Shorthand: the common `{n}`-per-band shape. */
const n = (easy?: number, medium?: number, hard?: number) => ({
  ...(easy !== undefined ? { easy: [{ n: easy }] } : {}),
  ...(medium !== undefined ? { medium: [{ n: medium }] } : {}),
  ...(hard !== undefined ? { hard: [{ n: hard }] } : {}),
});

/** Shorthand for templates whose difficulty is the goal itself, not a number. */
const flag = (bands: Band[]) =>
  Object.fromEntries(bands.map((b) => [b, [{}]])) as Template["params"];

export const TEMPLATES: Template[] = [
  // ── Session & progression ────────────────────────────────────────────────
  { id: "S1", category: "session", text: "Play for {n} minutes today", params: n(10, 20, 35), event: "session.heartbeat", flags: [] },
  { id: "S2", category: "session", text: "Complete {n} on-camera pitch performances", params: n(1, 2, 3), event: "pitch.completed", flags: [] },
  { id: "S3", category: "session", text: "Advance {n} fiscal years in one run", params: n(1, 3, 5), event: "year.ended", flags: [] },
  { id: "S4", category: "session", text: "Start a run in the {industry} industry", params: flag(["easy", "medium", "hard"]), event: "run.started", flags: [] },
  { id: "S5", category: "session", text: "Finish a session without skipping any event card", params: n(1, 2, 3), event: "event.resolved", flags: [] },
  { id: "S6", category: "session", text: "Reach year {n} in a single run today", params: n(3, 6, 10), event: "year.ended", flags: [] },

  // ── Pitch & delivery ─────────────────────────────────────────────────────
  { id: "P1", category: "pitch", text: "Score ≥ {n} overall on a pitch", params: n(60, 75, 88), event: "pitch.scored", flags: [] },
  { id: "P2", category: "pitch", text: "Deliver a pitch with ≤ {n} filler words", params: n(6, 3, 1), event: "pitch.scored", flags: [] },
  { id: "P3", category: "pitch", text: "Hold eye contact ≥ {n}% of your pitch", params: n(50, 70, 85), event: "pitch.scored", flags: [] },
  { id: "P4", category: "pitch", text: "Keep pacing in the green for {n}% of a pitch", params: n(60, 75, 90), event: "pitch.scored", flags: [] },
  { id: "P5", category: "pitch", text: "Answer {n} shark curveball questions in one panel", params: n(1, 2, 3), event: "panel.qna", flags: ["requires:sharks"] },
  { id: "P6", category: "pitch", text: "Beat your previous pitch score by {n} points", params: n(3, 6, 10), event: "pitch.scored", flags: [] },
  { id: "P7", category: "pitch", text: "Score ≥ {n} on clarity from the Language Coach", params: n(65, 80, 90), event: "pitch.scored", flags: [] },

  // ── Deals & sharks ───────────────────────────────────────────────────────
  { id: "D1", category: "deals", text: "Receive offers from ≥ {n} sharks in one panel", params: n(1, 2, 3), event: "panel.offers", flags: ["requires:sharks"] },
  {
    id: "D2", category: "deals", text: "Close a deal giving away ≤ {n}% equity",
    params: { easy: [{ n: 35 }], medium: [{ n: 30 }, { n: 25 }], hard: [{ n: 20 }, { n: 15 }] },
    event: "deal.closed", flags: ["requires:sharks"],
  },
  {
    id: "D3", category: "deals", text: "Close a deal worth ≥ ${n}",
    params: { easy: [{ n: 25_000 }], medium: [{ n: 50_000 }], hard: [{ n: 100_000 }] },
    event: "deal.closed", flags: ["requires:sharks"],
  },
  { id: "D4", category: "deals", text: "Close a deal with {shark}", params: flag(["easy", "medium", "hard"]), event: "deal.closed", flags: ["requires:sharks"] },
  { id: "D5", category: "deals", text: "Trigger a bidding war (2+ sharks competing)", params: { medium: [{}], hard: [{ n: 3 }] }, event: "panel.bidwar", flags: ["requires:sharks"] },
  { id: "D6", category: "deals", text: "Counter-offer and get it accepted", params: { medium: [{}], hard: [{}] }, event: "deal.countered", flags: ["requires:sharks"] },
  { id: "D7", category: "deals", text: "Reject every offer, then end the next quarter cash-positive", params: { medium: [{}], hard: [{}] }, event: "quarter.ended", flags: ["requires:sharks"] },
  /*
   * Whole-panel, not per-shark. `RunState.stats.respect` is a single number
   * carried across runs — there is no per-shark respect model to raise — so a
   * mission naming one shark would be graded against every shark's opinion at
   * once and would complete for the wrong reason. The version that is true to
   * the engine is the one that ships.
   */
  { id: "D8", category: "deals", text: "Leave a panel with more respect than you walked in with", params: { easy: [{}], medium: [{}], hard: [{}] }, event: "shark.respect", flags: ["requires:sharks"] },

  // ── Cold calling (dark until the mode ships) ─────────────────────────────
  { id: "C1", category: "coldcall", text: "Make {n} cold calls", params: n(2, 3, 5), event: "call.completed", flags: ["requires:coldcall"] },
  { id: "C2", category: "coldcall", text: "Get {n} cold-call prospects to say yes", params: n(1, 2, 3), event: "call.won", flags: ["requires:coldcall"] },
  { id: "C3", category: "coldcall", text: 'Convert a "skeptic" persona on a call', params: { medium: [{}], hard: [{}] }, event: "call.won", flags: ["requires:coldcall"] },
  { id: "C4", category: "coldcall", text: "Complete a call with 0 filler-word flags", params: { medium: [{ n: 1 }], hard: [{ n: 2 }] }, event: "call.scored", flags: ["requires:coldcall"] },

  // ── Finance & books ──────────────────────────────────────────────────────
  {
    id: "F1", category: "finance", text: "End a fiscal year with cash ≥ ${n}",
    params: { easy: [{ n: 20_000 }], medium: [{ n: 100_000 }], hard: [{ n: 500_000 }] },
    event: "year.ended", flags: [],
  },
  { id: "F2", category: "finance", text: "Keep burn below revenue for {n} consecutive quarters", params: n(2, 4, 6), event: "quarter.ended", flags: [] },
  { id: "F3", category: "finance", text: "End a year with ≥ {n} months of runway", params: n(6, 12, 18), event: "year.ended", flags: [] },
  {
    id: "F4", category: "finance", text: "Reach a valuation of ≥ ${n}",
    params: { easy: [{ n: 500_000 }], medium: [{ n: 2_000_000 }], hard: [{ n: 10_000_000 }] },
    event: "valuation.updated", flags: [],
  },
  { id: "F5", category: "finance", text: "Hold gross margin ≥ {n}% for a full year", params: n(30, 45, 60), event: "year.ended", flags: [] },
  // Dark: the engine has no debt instrument, so there is no loan to pay off.
  // Behind a flag rather than deleted, because the mission is a good one and
  // the day it ships this is a one-word change.
  { id: "F6", category: "finance", text: "Pay off a loan in full", params: flag(["easy", "medium", "hard"]), event: "loan.closed", flags: ["requires:debt"] },
  { id: "F7", category: "finance", text: "Sell an investment at ≥ {n}% profit", params: n(10, 25, 50), event: "asset.sold", flags: [] },
  { id: "F8", category: "finance", text: "Survive a down-market event without negative cash flow", params: { easy: [{}], medium: [{}], hard: [{ n: 2 }] }, event: "event.market", flags: [] },

  // ── Operations & strategy ────────────────────────────────────────────────
  { id: "O1", category: "ops", text: "Hire {n} employees or executives", params: n(1, 2, 3), event: "staff.hired", flags: [] },
  { id: "O2", category: "ops", text: "Launch {n} new products, menu items or drops", params: n(1, 2, 3), event: "product.launched", flags: [] },
  {
    id: "O3", category: "ops", text: "Run a marketing campaign hitting CTR ≥ {n}%",
    params: { easy: [{ n: 1.5 }], medium: [{ n: 3 }], hard: [{ n: 5 }] },
    event: "campaign.ended", flags: [],
  },
  { id: "O4", category: "ops", text: "Complete {n} R&D upgrades", params: n(1, 2, 3), event: "rnd.completed", flags: [] },
  { id: "O5", category: "ops", text: "Open a second location or sign a franchisee", params: { medium: [{}], hard: [{}] }, event: "expansion.opened", flags: [] },
  { id: "O6", category: "ops", text: "Kill your worst seller and end the quarter up", params: { medium: [{}], hard: [{}] }, event: "product.retired", flags: [] },
  { id: "O7", category: "ops", text: "Execute a strategic move (rebrand, logo or price reposition)", params: flag(["easy", "medium", "hard"]), event: "strategy.executed", flags: [] },
  { id: "O8", category: "ops", text: "Raise average WTP by {n}% in one year", params: n(5, 10, 20), event: "year.ended", flags: [] },
  {
    // Dark: the sim models market share, brand and churn, but never a
    // customer COUNT — there is no number to reach. Flagged rather than
    // deleted; the day the engine grows one, this is a one-word change.
    id: "O9", category: "ops", text: "Reach {n} customers in a run",
    params: { easy: [{ n: 100 }], medium: [{ n: 1_000 }], hard: [{ n: 10_000 }] },
    event: "customers.updated", flags: ["requires:customers"],
  },
  { id: "O10", category: "ops", text: "Grow revenue {n}% year-over-year", params: n(10, 25, 50), event: "year.ended", flags: [] },

  // ── Resilience & founder life ────────────────────────────────────────────
  { id: "R1", category: "resilience", text: "Turn a losing year into a profitable next year", params: { medium: [{}], hard: [{}] }, event: "year.ended", flags: [] },
  { id: "R2", category: "resilience", text: "Start a new company after a bankruptcy", params: flag(["easy", "medium", "hard"]), event: "run.started", flags: [] },
  { id: "R3", category: "resilience", text: "Take {n} founder self-care actions", params: n(1, 2, 3), event: "founder.care", flags: ["requires:energy"] },
  { id: "R4", category: "resilience", text: "Attend a networking or mentor event and act on it", params: flag(["easy", "medium", "hard"]), event: "event.network", flags: [] },

  // ── Personal bests & variety ─────────────────────────────────────────────
  { id: "B1", category: "bests", text: "Beat your personal-best pitch score", params: { easy: [{}], medium: [{ n: 5 }], hard: [{ n: 10 }] }, event: "pitch.scored", flags: [] },
  { id: "B2", category: "bests", text: "Beat your personal-best net worth", params: { easy: [{}], medium: [{ n: 10 }], hard: [{ n: 25 }] }, event: "networth.updated", flags: [] },
  { id: "B3", category: "bests", text: "Play your least-played industry", params: flag(["easy", "medium", "hard"]), event: "run.started", flags: [] },
  { id: "B4", category: "bests", text: "Resolve today's market event within the game day", params: flag(["easy", "medium", "hard"]), event: "event.market", flags: [] },
];

/** The weekly challenge pool — one per week, always pays T4 (plan §4.5). */
export const WEEKLY: { id: string; text: string; flags: string[] }[] = [
  { id: "W1", text: "Close 3 deals this week at ≤ 25% equity each", flags: ["requires:sharks"] },
  { id: "W2", text: "Take one company from founding to a $2M valuation", flags: [] },
  { id: "W3", text: "Score ≥ 80 on five different pitches", flags: [] },
  { id: "W4", text: "Post positive cash flow in 8 consecutive quarters", flags: [] },
  { id: "W5", text: "Close a deal with 3 different sharks this week", flags: ["requires:sharks"] },
  { id: "W6", text: "Reach year 10 in a single run", flags: [] },
  { id: "W7", text: "Earn $5M cumulative revenue across all runs this week", flags: [] },
  { id: "W8", text: "Win 5 cold-call conversions this week", flags: ["requires:coldcall"] },
];

/**
 * Lifetime milestones (plan §4.6) — fixed, one-time, never rotating.
 *
 * These are the "I have been playing a while" markers, and they are the reason
 * a returning player who missed a week still has something to open.
 */
export const MILESTONES: { id: string; text: string; tier: 1 | 2 | 3 | 4 | 5; title?: string; skin?: string }[] = [
  { id: "M_FIRST_PITCH", text: "Deliver your first pitch", tier: 1 },
  { id: "M_FIRST_DEAL", text: "Close your first deal", tier: 2 },
  { id: "M_YEARS_5", text: "Survive 5 years in one run", tier: 3 },
  { id: "M_YEARS_10", text: "Survive 10 years in one run", tier: 4 },
  { id: "M_YEARS_25", text: "Survive 25 years in one run", tier: 4, title: "Dynasty" },
  { id: "M_BANKRUPT", text: "Survive a bankruptcy and start again", tier: 2 },
  { id: "M_VAL_1M", text: "Reach a $1M valuation", tier: 2 },
  { id: "M_VAL_10M", text: "Reach a $10M valuation", tier: 3 },
  { id: "M_VAL_100M", text: "Reach a $100M valuation", tier: 4 },
  { id: "M_IPO", text: "Complete an IPO", tier: 4, title: "Rang the Bell" },
  { id: "M_SELL", text: "Sell a company", tier: 3 },
  { id: "M_PITCHES_50", text: "Deliver 50 pitches", tier: 3 },
  { id: "M_PITCHES_200", text: "Deliver 200 pitches", tier: 4 },
  { id: "M_ALL_SHARKS", text: "Close a deal with all 5 sharks", tier: 3, title: "Shark Whisperer" },
  { id: "M_RESPECT_ONE", text: "Max respect with any shark", tier: 3 },
  { id: "M_RESPECT_ALL", text: "Max respect with every shark", tier: 4 },
  { id: "M_INDUSTRIES", text: "Play all 12 industries", tier: 4 },
  { id: "M_DAILIES_25", text: "Complete 25 daily challenges", tier: 2 },
  { id: "M_DAILIES_100", text: "Complete 100 daily challenges", tier: 3 },
  { id: "M_DAILIES_365", text: "Complete 365 daily challenges", tier: 4, skin: "101" },
];
