import type {
  Choice,
  GameEvent,
  Industry,
  LogLine,
  PerformResult,
  RunState,
} from "./types";
import { KNOBS, STARTING_STATS, YEAR_END_MONTH } from "./constants";
import { applyOutcome, resolveBranches, tickModifiersQuarter, tickPendingMonth } from "./effects";
import {
  cashTick,
  deathCheck,
  deriveValuation,
  quarterTick,
  refreshBooks,
  stageCheck,
} from "./sim";
import {
  drawMonthEvents,
  dueFollowups,
  dueMilestones,
  todaysMarket,
} from "./events";
import {
  coastLine,
  financeLine,
  makeLine,
  monthRule,
  quietLine,
  runwayWarning,
  stageUpLine,
  yearOpenLine,
} from "./log";
import { hashString, runRng } from "./rng";
import { DEFAULT_AVATAR, type AvatarConfig } from "./avatar";
import { tickRoster } from "./people";
import { tickHoldings } from "./holdings";
import { fmtMoney } from "./format";

export interface CreateRunOpts {
  founderName: string;
  playerAge: number | null;
  companyName: string;
  industry: Industry;
  rookieMode: boolean;
  tutorial: boolean;
  carriedRespect?: number;
  pro?: boolean;
  avatar?: AvatarConfig;
}

export function createRun(opts: CreateRunOpts): RunState {
  const seed = hashString(`${opts.companyName}:${opts.founderName}:${Date.now()}`);
  const state: RunState = {
    id: `run-${seed.toString(36)}`,
    seed,
    pro: opts.pro ?? false,
    founderName: opts.founderName,
    playerAge: opts.playerAge,
    companyName: opts.companyName,
    industry: opts.industry,
    year: 1,
    month: 1,
    stage: 1,
    stats: { ...STARTING_STATS, respect: opts.carriedRespect ?? STARTING_STATS.respect },
    quarters: [0, 0, 0, 0],
    burnDeltaS: 0,
    burnScale: 1,
    karma: 0,
    hypePct: 0,
    founderEquityPct: 100,
    flags: {},
    modifiers: [],
    pending: [],
    recurring: [],
    followups: [],
    firedOnce: [],
    cooldowns: {},
    lastCategory: null,
    impairedChoices: 0,
    autopsyMagnets: [],
    unknownSpecials: [],
    redMonths: 0,
    marketDayISO: null,
    lastPlayedISO: new Date().toISOString().slice(0, 10),
    roster: [],
    holdings: [],
    positions: [],
    brokerageCash: 0,
    avatar: opts.avatar ?? { ...DEFAULT_AVATAR, name: opts.founderName },
    readMail: [],
    log: [],
    decisions: [],
    performs: [],
    rookieMode: opts.rookieMode,
    tutorial: opts.tutorial,
    tutorialStep: opts.tutorial ? 1 : 0,
    seenTerms: [],
    alive: true,
  };
  refreshBooks(state);
  const rng = runRng(seed, 1, 0);
  state.log.push(
    makeLine(
      state,
      "narration",
      `${state.companyName} exists. On paper. The paper is the easy part.`,
    ),
    makeLine(
      state,
      "narration",
      "Congratulations. You now own a company worth nothing. Fix that.",
    ),
  );
  state.log.push(yearOpenLine(state, rng));
  return state;
}

export interface AdvanceResult {
  /** Events the UI must surface as decision cards, in order. */
  surfaced: GameEvent[];
  /** True when the tap hit the year gate instead of moving time. */
  gate: boolean;
  died: boolean;
  /** Set when one of the surfaced events is today's shared market case. */
  marketEventId?: string;
}

/**
 * THE advance button. The only function in the app that moves time.
 * Month 12 does not advance — it reports the gate; the year closes only
 * through a scored camera performance (Brand Law 1).
 */
export function advanceMonth(state: RunState, events: GameEvent[]): AdvanceResult {
  if (!state.alive) return { surfaced: [], gate: false, died: true };
  if (state.month >= YEAR_END_MONTH) return { surfaced: [], gate: true, died: false };

  state.month += 1;
  const rng = runRng(state.seed, state.year, state.month);
  state.log.push(monthRule(state));

  // Coasting: real days away idle the company (absence never kills — Brand Law 3).
  const todayISO = new Date().toISOString().slice(0, 10);
  if (state.lastPlayedISO && state.lastPlayedISO < todayISO) {
    const away =
      (Date.parse(todayISO) - Date.parse(state.lastPlayedISO)) / 86_400_000;
    if (away >= 2) {
      state.stats.energy = Math.min(100, state.stats.energy + 5);
      state.stats.brand = Math.max(0, state.stats.brand - Math.min(3, Math.floor(away / 7)));
      state.log.push(coastLine(state, rng));
    }
  }
  state.lastPlayedISO = todayISO;

  // Delayed effects maturing this month.
  for (const matured of tickPendingMonth(state, rng)) {
    if (matured.deltas.length > 0) {
      state.log.push(
        makeLine(state, "consequence", "An old decision comes due.", matured.deltas),
      );
    }
  }

  // Quarterly sim tick (months 3/6/9/12) before events surface.
  if (state.month % 3 === 0) {
    quarterTick(state, rng);
    tickModifiersQuarter(state, rng);
  }

  const inRed = cashTick(state);
  refreshBooks(state);
  state.log.push(financeLine(state, rng));
  const warning = runwayWarning(state, rng);
  if (warning) state.log.push(warning);

  if (inRed && deathCheck(state)) {
    state.alive = false;
    state.endedBy = "chapter7";
    state.log.push(
      makeLine(
        state,
        "milestone",
        "The bank calls. Then the lawyers. Chapter 7 has a paperwork sound to it.",
      ),
    );
    return { surfaced: [], gate: false, died: true };
  }

  // Surface events: followups (chains) → milestones → Today's Market → draws.
  const surfaced: GameEvent[] = [];
  surfaced.push(...dueFollowups(state, events));
  surfaced.push(...dueMilestones(state, events, rng));
  const market = todaysMarket(state, events);
  if (market) surfaced.push(market);
  surfaced.push(...drawMonthEvents(state, events, rng));

  const capped = surfaced.slice(0, 2); // 0–2 cards per tap, chains first
  if (capped.length === 0) {
    state.stats.energy = Math.min(100, state.stats.energy + KNOBS.quietMonthEnergy);
    state.log.push(quietLine(state, rng));
  }
  return {
    surfaced: capped,
    gate: false,
    died: false,
    marketEventId: market && capped.includes(market) ? market.id : undefined,
  };
}

/** Visible choices after gating + low-energy impairment. */
export function visibleChoices(state: RunState, ev: GameEvent): Choice[] {
  let list = (ev.choices ?? []).filter((c) => {
    if (c.requiresFlag && !state.flags[c.requiresFlag]) return false;
    if (c.requiresAnyFlags && !c.requiresAnyFlags.some((f) => state.flags[f])) return false;
    if (c.excludesFlag && state.flags[c.excludesFlag]) return false;
    return true;
  });
  if (state.impairedChoices > 0 && list.length > 2) {
    list = list.slice(0, list.length - 1); // impaired judgment: one option gone
  }
  return list;
}

export interface ChoiceResult {
  lines: LogLine[];
  /** Set when the choice demands a camera performance before resolving. */
  perform?: { type: string; event: GameEvent; choiceIndex: number };
}

/**
 * Resolve a tapped choice. PERFORM choices return a redirect instead of
 * resolving — the camera is not optional (Brand Law 1).
 */
export function resolveChoice(
  state: RunState,
  ev: GameEvent,
  choiceIndex: number,
  performScore?: number,
): ChoiceResult {
  const choice = visibleChoices(state, ev)[choiceIndex];
  if (!choice) return { lines: [] };

  if (choice.perform && performScore === undefined) {
    return {
      lines: [],
      perform: { type: choice.perform.type, event: ev, choiceIndex },
    };
  }

  const rng = runRng(state.seed, state.year, state.month, hashString(ev.id));
  const valuationBefore = deriveValuation(state);
  const cashBefore = state.stats.cash;
  const burnBefore = state.stats.burnMonthly;

  let outcome;
  let multiplier = 1;
  if (choice.perform && performScore !== undefined) {
    const passScore = choice.perform.passScore ?? 6;
    outcome = performScore >= passScore ? choice.perform.pass : choice.perform.fail;
    multiplier = KNOBS.performMultiplier(performScore);
  } else if (choice.branches) {
    outcome = resolveBranches(state, choice.branches, rng);
  } else {
    outcome = choice.outcome ?? {};
  }

  const res = applyOutcome(state, outcome, ev.id, rng, multiplier);
  refreshBooks(state);

  if (state.impairedChoices > 0) state.impairedChoices -= 1;
  if (ev.once) state.firedOnce.push(ev.id);
  state.cooldowns[ev.id] = state.year + (ev.cooldownYears ?? 3);

  const valuationAfter = deriveValuation(state);
  state.decisions.push({
    eventId: ev.id,
    eventTitle: ev.title,
    choiceLabel: choice.label,
    year: state.year,
    month: state.month,
    valuationImpact: valuationAfter - valuationBefore,
    cashCost: cashBefore - state.stats.cash,
    burnAdded: state.stats.burnMonthly - burnBefore,
    booksBefore: { cash: cashBefore, valuation: valuationBefore },
  });

  // Quote the choice rather than inflecting it: authored labels are a mix of
  // imperatives ("Absorb it") and noun phrases ("Simple one-pager compromise"),
  // so "you <label>" reads wrong half the time. This also matches the autopsy.
  const lines: LogLine[] = [
    makeLine(state, "decision", `${ev.title} — “${choice.label}”`),
  ];
  if (res.narration) lines.push(makeLine(state, "consequence", res.narration, res.deltas));
  else if (res.deltas.length > 0)
    lines.push(makeLine(state, "consequence", "The Books move.", res.deltas));
  state.log.push(...lines);
  return { lines };
}

/** Auto events (narration-only beats) and event-level performOnly resolution. */
export function resolveAuto(state: RunState, ev: GameEvent): void {
  if (!ev.auto) return;
  const rng = runRng(state.seed, state.year, state.month, hashString(ev.id));
  const res = applyOutcome(state, ev.auto, ev.id, rng);
  refreshBooks(state);
  if (ev.once) state.firedOnce.push(ev.id);
  state.cooldowns[ev.id] = state.year + (ev.cooldownYears ?? 3);
  state.log.push(
    makeLine(state, "consequence", ev.auto.narration ?? ev.title, res.deltas),
  );
}

export function resolvePerformOnly(
  state: RunState,
  ev: GameEvent,
  score: number,
): void {
  if (!ev.performOnly) return;
  const rng = runRng(state.seed, state.year, state.month, hashString(ev.id));
  const spec = ev.performOnly;
  const passScore = spec.passScore ?? 6;
  const outcome = score >= passScore ? spec.pass : spec.fail;
  const res = applyOutcome(state, outcome, ev.id, rng, KNOBS.performMultiplier(score));
  refreshBooks(state);
  if (ev.once) state.firedOnce.push(ev.id);
  state.cooldowns[ev.id] = state.year + (ev.cooldownYears ?? 3);
  state.log.push(
    makeLine(
      state,
      "perform",
      res.narration ?? `${ev.title}: scored ${score}/10.`,
      res.deltas,
    ),
  );
}

export interface YearEndSummary {
  year: number;
  revenue: number;
  profit: number;
  valuation: number;
  valuationDelta: number;
  cash: number;
  score: number;
  stageUp: number | null;
  badge: string;
}

/**
 * Close the fiscal year — ONLY reachable after a scored camera performance.
 * Applies the deal/consequence multiplier, ages the company up, returns the
 * Year End summary for the results screen.
 */
export function closeYear(
  state: RunState,
  perform: PerformResult,
  dealCashS = 0,
  dealEquityPct = 0,
): YearEndSummary {
  const rng = runRng(state.seed, state.year, 13);
  state.performs.push(perform);

  const revenue = state.stats.revenueAnnual;
  const costsAnnual = state.stats.burnMonthly * 12 + revenue * (state.stats.grossMarginPt / 100);
  const profit = revenue - Math.max(0, costsAnnual);
  const valuationBefore = state.stats.valuation;

  if (dealCashS > 0) {
    const res = applyOutcome(
      state,
      {
        effects: [
          { stat: "cash_S", amount: dealCashS },
          ...(dealEquityPct > 0
            ? [{ stat: "dilution_pct" as const, amount: dealEquityPct }]
            : []),
        ],
      },
      `deal-y${state.year}`,
      rng,
      perform.multiplier,
    );
    state.log.push(
      makeLine(
        state,
        "perform",
        dealEquityPct > 0
          ? `The check clears. You own ${Math.round(state.founderEquityPct)}% of what you built.`
          : "The check clears.",
        res.deltas,
      ),
    );
  }

  // Recurring yearly effects come due.
  for (const r of state.recurring) {
    const res = applyOutcome(state, { effects: [r.effect] }, r.sourceId, rng);
    if (res.deltas.length > 0)
      state.log.push(makeLine(state, "consequence", "Annual terms come due.", res.deltas));
  }

  state.hypePct = state.hypePct / 2; // hype decays
  tickRoster(state);
  tickHoldings(state);
  refreshBooks(state);

  const stageUp = stageCheck(state);
  if (stageUp) state.log.push(stageUpLine(state, stageUp, rng));

  const badge =
    state.year === 1
      ? "Year 1: Survived"
      : perform.score >= 8
        ? `Year ${state.year}: Closed loud`
        : `Year ${state.year}: Closed`;

  const summary: YearEndSummary = {
    year: state.year,
    revenue,
    profit,
    valuation: state.stats.valuation,
    valuationDelta: state.stats.valuation - valuationBefore,
    cash: state.stats.cash,
    score: perform.score,
    stageUp,
    badge,
  };

  state.log.push(
    makeLine(
      state,
      "milestone",
      `Fiscal Year ${state.year}: closed. Revenue ${fmtMoney(revenue)}. The shark logs the number.`,
    ),
  );

  state.year += 1;
  state.month = 1;
  state.redMonths = 0;
  if (state.tutorial && state.year > 1) state.tutorial = false;
  state.log.push(yearOpenLine(state, rng));
  return summary;
}

export type Allocation = "marketing" | "product" | "save";

/** Year-end investment choice (GDD T7): marketing / product / save it. */
export function applyAllocation(state: RunState, pick: Allocation): LogLine {
  const rng = runRng(state.seed, state.year, 14);
  const outcomes = {
    marketing: {
      effects: [
        { stat: "brand" as const, amount: 6 },
        { stat: "ctr_pt" as const, amount: 4 },
        { stat: "cash_S" as const, amount: -3 },
      ],
      narration: "You feed the megaphone. The market hears about you on schedule.",
    },
    product: {
      effects: [
        { stat: "qual" as const, amount: 6 },
        { stat: "cash_S" as const, amount: -3 },
      ],
      narration: "You feed the product. Quietly, it gets harder to compete with.",
    },
    save: {
      effects: [{ stat: "energy" as const, amount: 4 }],
      narration: "You save it. Boring. Solvent. The shark respects boring more than it lets on.",
    },
  };
  const res = applyOutcome(state, outcomes[pick], `alloc-y${state.year}`, rng);
  refreshBooks(state);
  const line = makeLine(state, "decision", outcomes[pick].narration, res.deltas);
  state.log.push(line);
  return line;
}

