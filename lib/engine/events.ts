import type { GameEvent, RunState } from "./types";
import { condMet } from "./effects";
import { KNOBS } from "./constants";
import { mulberry32, pickWeighted, todaysMarketSeed, type Rng } from "./rng";

/**
 * Category pressure map: ≥1 draw biases toward the weakest visible stat's
 * category (GDD §9 "targeted pressure").
 */
function weakestCategory(state: RunState): string | null {
  const s = state.stats;
  const candidates: [string, number][] = [
    ["PPL", s.morale],
    ["PRD", s.qual],
    ["MKT", s.brand],
    ["CUS", s.csat],
    ["LIF", s.energy],
  ];
  candidates.sort((a, b) => a[1] - b[1]);
  return candidates[0][1] < 45 ? candidates[0][0] : null;
}

export function eventById(events: GameEvent[], id: string): GameEvent | undefined {
  return events.find((e) => e.id === id);
}

export function isEligible(state: RunState, ev: GameEvent): boolean {
  if (!ev.stages.includes(state.stage)) return false;
  if (ev.industries !== "all" && !ev.industries.includes(state.industry)) return false;
  if (ev.minYear && state.year < ev.minYear) return false;
  if (ev.once && state.firedOnce.includes(ev.id)) return false;
  const cooldownUntil = state.cooldowns[ev.id];
  if (cooldownUntil !== undefined && state.year < cooldownUntil) return false;
  // Chain steps beyond 1 only arrive via followups.
  if (ev.chain && ev.chain.step > 1) return false;

  const flagReqs = (ev.requiresFlags ?? []).map((f) => !!state.flags[f]);
  const condReqs = (ev.requiresCond ?? []).map((c) => condMet(state, c));
  const reqs = [...flagReqs, ...condReqs];
  if (reqs.length > 0) {
    const ok = ev.reqAnyOf ? reqs.some(Boolean) : reqs.every(Boolean);
    if (!ok) return false;
  }
  if ((ev.excludesFlags ?? []).some((f) => state.flags[f])) return false;
  return true;
}

export function effectiveWeight(state: RunState, ev: GameEvent): number {
  let w = ev.weight;
  for (const mod of ev.weightMods ?? []) {
    if (mod.flag && state.flags[mod.flag]) w *= mod.mult;
    if (mod.industries && mod.industries.includes(state.industry)) w *= mod.mult;
  }
  // Harsher stages: crisis-adjacent categories gain weight as valuation grows.
  if (state.stage >= 3 && ["LGL", "RIV", "K"].includes(ev.category)) w *= 1.3;
  return w;
}

/** Follow-ups due now (chains, delayed callbacks). Consumed by the caller. */
export function dueFollowups(state: RunState, events: GameEvent[]): GameEvent[] {
  const due = state.followups.filter(
    (f) =>
      f.dueYear < state.year ||
      (f.dueYear === state.year && f.dueMonth <= state.month),
  );
  state.followups = state.followups.filter((f) => !due.includes(f));
  return due
    .map((f) => eventById(events, f.eventId))
    .filter((e): e is GameEvent => !!e);
}

/**
 * Draw 0–2 events for this month (never two of one category back-to-back).
 * The advance button is the only caller — time moves nowhere else.
 */
export function drawMonthEvents(
  state: RunState,
  events: GameEvent[],
  rng: Rng,
): GameEvent[] {
  const drawn: GameEvent[] = [];
  const pool = events.filter(
    (e) => isEligible(state, e) && e.category !== "MILE" && !e.chain,
  );

  const drawOne = (excludeCategory: string | null): GameEvent | null => {
    let candidates = pool.filter(
      (e) => !drawn.includes(e) && e.category !== excludeCategory,
    );
    const pressure = weakestCategory(state);
    if (pressure && rng() < 0.35) {
      const pressured = candidates.filter((e) => e.category === pressure);
      if (pressured.length > 0) candidates = pressured;
    }
    return pickWeighted(candidates, (e) => effectiveWeight(state, e), rng);
  };

  if (rng() < KNOBS.pEvent) {
    const first = drawOne(state.lastCategory);
    if (first) {
      drawn.push(first);
      if (rng() < KNOBS.pSecondEvent) {
        const second = drawOne(first.category);
        if (second) drawn.push(second);
      }
    }
  }
  if (drawn.length > 0) state.lastCategory = drawn[drawn.length - 1].category;
  return drawn;
}

/** Milestone beats for the current stage/year, drawn deterministically. */
export function dueMilestones(state: RunState, events: GameEvent[], rng: Rng): GameEvent[] {
  const pool = events.filter(
    (e) => e.category === "MILE" && isEligible(state, e),
  );
  if (pool.length === 0) return [];
  // At most one milestone per year, in the first quarter.
  if (state.month > 3) return [];
  const pick = pickWeighted(pool, (e) => effectiveWeight(state, e), rng);
  return pick ? [pick] : [];
}

/**
 * Today's Market: one shared event per real day, identical for every player,
 * seeded by the UTC date alone (GDD Layer 2). Stage/industry gates are relaxed
 * on purpose — the same storm hits every boat; S units scale the damage.
 */
export function todaysMarket(
  state: RunState,
  events: GameEvent[],
  date = new Date(),
): GameEvent | null {
  const iso = date.toISOString().slice(0, 10);
  if (state.marketDayISO === iso) return null; // already surfaced today
  const rng = mulberry32(todaysMarketSeed(date));
  const pool = events.filter(
    (e) =>
      e.industries === "all" &&
      !e.once &&
      !e.chain &&
      (e.requiresFlags ?? []).length === 0 &&
      ["OPS", "FIN", "MKT", "RIV", "LGL"].includes(e.category),
  );
  const pick = pickWeighted(pool, (e) => e.weight, rng);
  if (pick) state.marketDayISO = iso;
  return pick;
}
