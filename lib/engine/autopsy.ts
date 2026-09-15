import type { DecisionRecord, RunState } from "./types";
import { companyMetrics } from "./company-brief";

export interface AutopsyReport {
  companyName: string;
  yearsSurvived: number;
  finalValuation: number;
  /** The three decisions that killed the company, quoting the run log. */
  fatalDecisions: {
    year: number;
    eventTitle: string;
    choiceLabel: string;
    impact: number;
  }[];
  hiddenTruths: string[]; // hidden-stat reveals the living never saw
}

/**
 * Realized damage in dollars. A company dies of cash, so cash out is the
 * headline term; a permanent burn increase is a slow killer, counted over the
 * year it would have cost; lost valuation is real but discounted, because it
 * is an opinion until someone buys.
 */
function damageOf(d: DecisionRecord): number {
  const cash = d.cashCost ?? 0;
  const burn = (d.burnAdded ?? 0) * 12;
  const valuation = -(d.valuationImpact ?? 0) * 0.1;
  return cash + burn + valuation;
}

/**
 * Chapter 7 autopsy (GDD §9): rank decisions by realized damage; autopsy
 * magnets — the choices the writing flags as fatal — always outrank the rest.
 */
export function buildAutopsy(state: RunState): AutopsyReport {
  const magnets = new Set(state.autopsyMagnets.map((m) => m.sourceId));

  const scored = state.decisions
    .map((d) => ({ d, damage: damageOf(d), magnet: magnets.has(d.eventId) }))
    // Only decisions that actually cost something can be a cause of death.
    .filter((x) => x.magnet || x.damage > 0)
    .sort((a, b) => {
      if (a.magnet !== b.magnet) return a.magnet ? -1 : 1;
      return b.damage - a.damage;
    });

  const fatal = scored.slice(0, 3).map(({ d, damage }) => ({
    year: d.year,
    eventTitle: d.eventTitle,
    choiceLabel: d.choiceLabel,
    impact: -Math.round(damage), // negative = what it cost you
  }));

  const hiddenTruths: string[] = [];
  if (state.stats.risk >= 3)
    hiddenTruths.push(
      `Your hidden legal risk had been red for ${Math.max(1, Math.floor(state.stats.risk / 2))} year${state.stats.risk >= 4 ? "s" : ""}. Nobody looked.`,
    );
  if (state.stats.tdebt >= 3)
    hiddenTruths.push("The duct tape was holding up more than anyone admitted.");
  if (state.stats.teamloy <= -2)
    hiddenTruths.push("Your team had stopped believing before the bank did.");
  if (state.stats.invsent <= -2)
    hiddenTruths.push("Investors had quietly marked you down months ago.");
  if (state.stats.suploy <= -2)
    hiddenTruths.push("Your suppliers served you last. Every time.");
  if (state.karma <= -2)
    hiddenTruths.push("You made a habit of the cheap option. Habits compound.");

  /*
   * The unit-economics figures CompanyScreen shows year-round now (LTV, CAC,
   * Rule of 40, burn multiple — see lib/engine/company-brief.ts) were never
   * secret the way risk/tdebt/teamloy are, so these aren't reveals — they're
   * a reminder of a number that was sitting on the player's own screen the
   * whole time. Same array, honest framing: "hidden" here means "the founder
   * didn't add it up," not "the game withheld it."
   */
  const metrics = companyMetrics(state);
  if (metrics.raw.ltvCacRatio > 0 && metrics.raw.ltvCacRatio < 1)
    hiddenTruths.push(
      `Every customer cost more than they ever paid back — LTV:CAC never cleared ${metrics.raw.ltvCacRatio}×. It was on your own numbers screen the whole time.`,
    );
  if (metrics.raw.burnMultiple !== null && metrics.raw.burnMultiple > 3)
    hiddenTruths.push(
      `Near the end you were burning ${metrics.raw.burnMultiple}× for every new dollar of revenue. That is not a pace anyone recovers from.`,
    );
  if (metrics.raw.ruleOf40Pct < 0)
    hiddenTruths.push(
      "Growth and profit were both working against you at once — shrinking and losing money in the same year.",
    );

  return {
    companyName: state.companyName,
    yearsSurvived: state.year,
    finalValuation: state.stats.valuation,
    fatalDecisions: fatal,
    hiddenTruths,
  };
}

export function decisionQuote(d: DecisionRecord): string {
  return `Year ${d.year}: "${d.choiceLabel}" — ${d.eventTitle}`;
}
