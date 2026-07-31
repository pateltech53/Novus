import type { RunState, StageNum } from "./types";
import { industryByCode, KNOBS, S_UNIT, STAGE_REVENUE_FLOOR } from "./constants";

import { marketModifier } from "./effects";
import type { Rng } from "./rng";

/** Monthly burn in dollars (GDD §6: FixedCosts + Payroll − GrossProfit/3). */
export function deriveBurn(state: RunState): number {
  const S = S_UNIT[state.stage];
  const scale = state.burnScale ?? 1;
  const fixed = (KNOBS.fixedCostS + state.burnDeltaS) * S * scale;
  const payroll = state.stats.employees * KNOBS.salaryPerEmployeeS * S * scale;
  const grossProfitMonthly =
    (state.stats.revenueAnnual / 12) * (state.stats.grossMarginPt / 100);
  return fixed + payroll - grossProfitMonthly;
}

export function deriveRunwayMonths(state: RunState): number {
  const burn = state.stats.burnMonthly;
  if (burn <= 0) return Infinity;
  return Math.max(0, state.stats.cash / burn);
}

/** GDD §6: Revenue × multiple × (0.6 + Qual/200 + Brand/200) + hype. */
export function deriveValuation(state: RunState): number {
  const ind = industryByCode(state.industry);
  const quality = 0.6 + state.stats.qual / 200 + state.stats.brand / 200;
  const core = state.stats.revenueAnnual * ind.multiple * quality;
  const hyped = core * (1 + state.hypePct / 100);
  const floor = Math.max(
    state.stats.cash,
    state.stats.revenueAnnual > 0 ? 0 : KNOBS.preRevValuationFloorS * S_UNIT[state.stage],
  );
  return Math.max(hyped, floor);
}

/**
 * Quarterly tick (GDD §6): demand → revenue → costs → Books.
 * Runs on months 3, 6, 9, 12 (before events surface).
 */
export function quarterTick(state: RunState, rng: Rng) {
  const ind = industryByCode(state.industry);
  const qIndex = Math.floor((state.month - 1) / 3); // 0..3
  const season = ind.season[qIndex];
  const churnDrag = 1 - state.stats.churnPt / 100 / 4;
  const organic =
    1 +
    KNOBS.organicGrowth(
      state.stats.qual,
      state.stats.brand,
      state.stats.marketSharePt,
      state.stage,
    );
  const market = marketModifier(state);
  // Small seeded wobble so quarters aren't metronomic (inside the luck band).
  const wobble = 0.97 + rng() * 0.06;

  const prevQ = state.quarters[state.quarters.length - 1] ?? 0;

  // The growth model is multiplicative, so a zero base can never leave zero.
  // The first quarter with any product to sell seeds a floor instead — this is
  // the "first sale" beat the tutorial narrates.
  const base =
    prevQ > 0
      ? prevQ
      : (KNOBS.seedRevenueS / 4) *
        S_UNIT[state.stage] *
        (0.5 + state.stats.qual / 100);

  const revQ = Math.max(0, base * season * churnDrag * organic * market * wobble);

  state.quarters = [...state.quarters.slice(-3), revQ];
  state.stats.revenueAnnual = state.quarters.reduce((a, b) => a + b, 0);
}

/** Recompute derived Books after any mutation. */
export function refreshBooks(state: RunState) {
  state.stats.burnMonthly = deriveBurn(state);
  state.stats.valuation = deriveValuation(state);

  // Engine-maintained gate flags. Authored events arm off these (K-CASH-1
  // fires when runway is short; K-TEC-1 doubles when the duct tape is thick),
  // so they must track the live Books rather than any single choice.
  if (deriveRunwayMonths(state) < 5) state.flags["runway_low"] = true;
  else delete state.flags["runway_low"];

  if (state.stats.tdebt >= 3) state.flags["tdebt_high"] = true;
  else delete state.flags["tdebt_high"];

  const gross = state.stats.revenueAnnual * (state.stats.grossMarginPt / 100);
  const totalCosts =
    (KNOBS.fixedCostS + state.burnDeltaS) * S_UNIT[state.stage] * 12 +
    state.stats.employees * KNOBS.salaryPerEmployeeS * S_UNIT[state.stage] * 12;
  state.stats.netMarginPt =
    state.stats.revenueAnnual > 0
      ? Math.round(((gross - totalCosts) / state.stats.revenueAnnual) * 100)
      : 0;
}

/** Monthly cash movement. Returns true if the month ended in the red. */
export function cashTick(state: RunState): boolean {
  state.stats.burnMonthly = deriveBurn(state);
  state.stats.cash -= state.stats.burnMonthly;
  const inRed = state.stats.cash < 0;
  state.redMonths = inRed ? state.redMonths + 1 : 0;
  return inRed;
}

/** Stage promotion check — announced at Year End (GDD §6). */
export function stageCheck(state: RunState): StageNum | null {
  let next = state.stage;
  for (const st of [5, 4, 3, 2] as StageNum[]) {
    if (state.stats.revenueAnnual >= STAGE_REVENUE_FLOOR[st]) {
      next = st;
      break;
    }
  }
  if (next > state.stage) {
    state.stage = next;
    return next;
  }
  return null;
}

/** Chapter 7 trigger: sustained red months (tutorial year is immune). */
export function deathCheck(state: RunState): boolean {
  if (state.tutorial && state.year === 1) return false;
  return state.redMonths >= KNOBS.redMonthsBeforeDeath;
}
