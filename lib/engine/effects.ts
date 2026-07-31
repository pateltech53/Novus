import type {
  Branch,
  Cond,
  Effect,
  EffectStat,
  Outcome,
  RunState,
} from "./types";
import { KNOBS, S_UNIT } from "./constants";
import { jitter, type Rng } from "./rng";

/** Stats clamped to 0–100. */
const PCT_STATS = new Set<EffectStat>([
  "brand",
  "morale",
  "qual",
  "csat",
  "energy",
  "respect",
  "ctr_pt",
  "cac_pt",
  "cwp_pt",
]);

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function condMet(state: RunState, cond: Cond): boolean {
  if (cond.flag && !state.flags[cond.flag]) return false;
  if (cond.notFlag && state.flags[cond.notFlag]) return false;
  if (cond.stat) {
    const { key, gte, lt } = cond.stat;
    const value =
      key === "cash_S"
        ? state.stats.cash / S_UNIT[state.stage]
        : key === "churn_pt"
          ? state.stats.churnPt
          : state.stats[key];
    if (gte !== undefined && value < gte) return false;
    if (lt !== undefined && value >= lt) return false;
  }
  return true;
}

export interface ApplyResult {
  /** Human-legible deltas for floaters/log ("Cash −$3K", "Brand +2"). */
  deltas: { label: string; tone: "up" | "down" | "flat" }[];
  narration?: string;
}

/** Sign-preserving luck + PERFORM multiplier, then integer-round stat points. */
function tunedAmount(effect: Effect, rng: Rng, multiplier: number): number {
  const scaled = effect.amount * multiplier;
  const lucky = jitter(scaled, rng, KNOBS.luckBand);
  if (effect.stat === "cash_S" || effect.stat === "burn_S_mo") return lucky;
  // Stat points round away from zero so a nudge is never invisible.
  return lucky < 0 ? Math.min(-1, Math.round(lucky)) : Math.max(1, Math.round(lucky));
}

function applyStat(state: RunState, stat: EffectStat, amount: number): { label: string; tone: "up" | "down" | "flat" } | null {
  const s = state.stats;
  const S = S_UNIT[state.stage];
  switch (stat) {
    case "cash_S": {
      const dollars = amount * S;
      s.cash += dollars;
      return money("Cash", dollars);
    }
    case "burn_S_mo":
      state.burnDeltaS += amount;
      return { label: `Burn ${amount > 0 ? "+" : "−"}${fmtS(Math.abs(amount))}/mo`, tone: amount > 0 ? "down" : "up" };
    case "rev_pct": {
      // Permanent baseline shift (temporary versions arrive via modifiers).
      const q = state.quarters.map((v) => v * (1 + amount / 100));
      state.quarters = q;
      s.revenueAnnual = q.reduce((a, b) => a + b, 0);
      return { label: `Revenue ${signed(amount)}%`, tone: amount > 0 ? "up" : "down" };
    }
    case "gm_pt":
      s.grossMarginPt = clamp(s.grossMarginPt + amount, 2, 95);
      return { label: `Gross margin ${signed(amount)}pt`, tone: amount > 0 ? "up" : "down" };
    case "brand":
      s.brand = clamp(s.brand + amount, 0, 100);
      return { label: `Brand ${signed(amount)}`, tone: amount > 0 ? "up" : "down" };
    case "morale":
      s.morale = clamp(s.morale + amount, 0, 100);
      return { label: `Morale ${signed(amount)}`, tone: amount > 0 ? "up" : "down" };
    case "qual":
      s.qual = clamp(s.qual + amount, 0, 100);
      return { label: `Quality ${signed(amount)}`, tone: amount > 0 ? "up" : "down" };
    case "csat":
      s.csat = clamp(s.csat + amount, 0, 100);
      return { label: `CSAT ${signed(amount)}`, tone: amount > 0 ? "up" : "down" };
    case "churn_pt":
      s.churnPt = clamp(s.churnPt + amount, 0, 80);
      // more churn is damage
      return { label: `Churn ${signed(amount)}pt`, tone: amount > 0 ? "down" : "up" };
    case "emp":
      s.employees = Math.max(0, s.employees + amount);
      return { label: `Team ${signed(amount)}`, tone: "flat" };
    case "energy":
      s.energy = clamp(s.energy + amount, 0, 100);
      return { label: `Energy ${signed(amount)}`, tone: amount > 0 ? "up" : "down" };
    case "val_pct":
      state.hypePct += amount;
      return { label: `Valuation ${signed(amount)}%`, tone: amount > 0 ? "up" : "down" };
    case "respect":
      s.respect = clamp(s.respect + amount, 0, 100);
      return { label: `Respect ${signed(amount)}`, tone: amount > 0 ? "up" : "down" };
    case "share_pt":
      s.marketSharePt = clamp(s.marketSharePt + amount, 0, 100);
      return { label: `Share ${signed(amount)}pt`, tone: amount > 0 ? "up" : "down" };
    case "cac_pt":
      s.cacPt = clamp(s.cacPt + amount, 0, 100);
      return null;
    case "ctr_pt":
      s.ctrPt = clamp(s.ctrPt + amount, 0, 100);
      return null;
    case "cwp_pt":
      s.cwp = clamp(s.cwp + amount, 0, 100);
      return null;
    case "dilution_pct":
      state.founderEquityPct = clamp(state.founderEquityPct * (1 - amount / 100), 1, 100);
      return { label: `Dilution ${Math.abs(amount)}%`, tone: "down" };
    // hidden stats: applied silently — they surface in events and the autopsy
    case "risk":
      s.risk = Math.max(0, s.risk + amount);
      return null;
    case "tdebt":
      s.tdebt = Math.max(0, s.tdebt + amount);
      return null;
    case "suploy":
      s.suploy = clamp(s.suploy + amount, -5, 5);
      return null;
    case "invsent":
      s.invsent = clamp(s.invsent + amount, -5, 5);
      return null;
    case "teamloy":
      s.teamloy = clamp(s.teamloy + amount, -5, 5);
      return null;
  }
}

function money(label: string, dollars: number) {
  const sign = dollars < 0 ? "−" : "+";
  return {
    label: `${label} ${sign}${compact(Math.abs(dollars))}`,
    tone: dollars > 0 ? ("up" as const) : ("down" as const),
  };
}

function compact(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return `$${Math.round(n)}`;
}

const fmtS = (n: number) => compact(n * 1000).replace("$", "$"); // display-only helper for S-at-St1 scale

const signed = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `+${n}`);

/** "1Q" | "2q" | "2w" | "1y" | "3" → quarters. */
function parseQuarters(token: string | undefined, fallback = 1): number {
  if (!token) return fallback;
  const m = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]*)$/.exec(token.trim());
  if (!m) return fallback;
  const n = parseFloat(m[1]);
  switch (m[2].toLowerCase()) {
    case "w":
      return Math.max(1, Math.round(n / 6)); // weeks → quarters, min 1
    case "y":
    case "yr":
      return n * 4;
    case "mo":
      return Math.max(1, Math.round(n / 3));
    default:
      return n; // bare number or "q"/"Q"
  }
}

/**
 * Mechanics beyond the stat vocabulary. Families that move the Books are
 * implemented; the rest degrade to a queryable flag AND are recorded in
 * `unknownSpecials` so nothing disappears silently (validator reports them).
 */
function applySpecial(state: RunState, op: string, sourceId: string) {
  const [tag, ...args] = op.split(":");
  switch (tag) {
    // ── chains & armed future events ────────────────────────────────────
    case "arm_chain":
      state.followups.push({
        eventId: `${args[0]}-1`,
        dueYear: state.year,
        dueMonth: Math.min(12, state.month + 1),
      });
      return;
    case "chain_odds":
      state.flags[`chain_odds_${args[0]}_x${args[1] ?? "2"}`] = true;
      return;
    case "arm_event":
    case "arm_events":
      state.flags[`armed_${args[0]}`] = true;
      return;
    case "event_odds":
      state.flags[`armed_${args[0]}_${parseInt(args[1] ?? "50", 10) || 50}`] = true;
      return;
    case "refire_harder":
    case "refire_yearly":
    case "rearm_years":
      state.flags[`refire_${sourceId}`] = true;
      return;

    // ── Books-affecting mechanics ───────────────────────────────────────
    case "burn_pct": {
      const pct = parseFloat(args[0] ?? "0") || 0;
      state.burnScale = Math.max(0.1, state.burnScale * (1 + pct / 100));
      return;
    }
    case "emp_pct": {
      const pct = parseFloat(args[0] ?? "0") || 0;
      state.stats.employees = Math.max(0, Math.round(state.stats.employees * (1 + pct / 100)));
      return;
    }
    case "rev_delay":
    case "launch_delay":
    case "delay":
    case "rev_flat":
    case "features_pause":
    case "fires_q": {
      // Revenue stalls for N quarters — the authored "delayed launch" cost.
      const q = parseQuarters(args[0], 1);
      state.modifiers.push({ stat: "rev_pct", amount: -8, quartersLeft: q, sourceId });
      return;
    }
    case "rev_pull_forward":
      state.modifiers.push({ stat: "rev_pct", amount: 8, quartersLeft: 1, sourceId });
      state.pending.push({
        effect: { stat: "rev_pct", amount: -8, durationQ: 1 },
        monthsLeft: 3,
        sourceId,
      });
      return;
    case "hype_plus":
      state.hypePct += 5 * (parseFloat(args[0] ?? "1") || 1);
      return;
    case "hype_minus":
      state.hypePct -= 5 * (parseFloat(args[0] ?? "1") || 1);
      return;
    case "tdebt_cleared":
      state.stats.tdebt = 0;
      return;
    case "risk_cleared":
    case "risk_clear":
      state.stats.risk = 0;
      return;
    case "en_floor":
      state.stats.energy = 0;
      return;
    case "teamloy_max":
      state.stats.teamloy = 5;
      return;
    case "karma":
      state.karma += parseFloat(args[0] ?? "-1") || -1;
      return;

    // ── run-shaping state ───────────────────────────────────────────────
    case "autopsy_magnet":
      state.autopsyMagnets.push({ sourceId, label: sourceId });
      return;
    case "impair_choices":
      state.impairedChoices = Math.max(
        state.impairedChoices,
        parseInt(args[0] ?? "3", 10) || 3,
      );
      return;
    case "immunity":
    case "moat":
      state.flags[`immune_${args[0] ?? "generic"}`] = true;
      return;
    case "insurance_halves_damage":
      state.flags["insured"] = true;
      return;
    case "unlock":
    case "unlock_activity":
      state.flags[`unlock_${args[0]}`] = true;
      return;
    case "forced_rename":
      state.flags["forced_rename"] = true;
      return;
    case "merger_arc":
      state.flags["merger_arc"] = true;
      return;

    default:
      // Honest degrade: queryable by later events, and surfaced by the validator.
      state.unknownSpecials.push(`${sourceId}: ${op}`);
      state.flags[`special_${tag}`] = true;
  }
}

/**
 * Apply one Outcome to the run. `multiplier` is the PERFORM M (1 for taps).
 * Delayed / afterQ effects park in `pending`; durationQ effects apply now and
 * auto-revert via `modifiers` (rev_pct modifiers instead shape the sim tick).
 */
export function applyOutcome(
  state: RunState,
  outcome: Outcome,
  sourceId: string,
  rng: Rng,
  multiplier = 1,
): ApplyResult {
  const deltas: ApplyResult["deltas"] = [];

  for (const effect of outcome.effects ?? []) {
    const startDelayMonths = effect.delayed ? 12 : effect.afterQ ? effect.afterQ * 3 : 0;
    if (startDelayMonths > 0) {
      state.pending.push({
        effect: { ...effect, delayed: undefined, afterQ: undefined },
        monthsLeft: startDelayMonths,
        sourceId,
      });
      continue;
    }
    if (effect.perYear) {
      state.recurring.push({ effect: { ...effect, perYear: undefined }, sourceId });
      // also applies the first instance now, below
    }
    const amount = tunedAmount(effect, rng, multiplier);
    if (effect.durationQ && effect.stat === "rev_pct") {
      // Revenue modifiers shape the quarterly tick rather than the baseline.
      state.modifiers.push({ stat: "rev_pct", amount, quartersLeft: effect.durationQ, sourceId });
      deltas.push({ label: `Revenue ${signed(Math.round(amount))}% (${effect.durationQ}Q)`, tone: amount > 0 ? "up" : "down" });
      continue;
    }
    const delta = applyStat(state, effect.stat, amount);
    if (delta) deltas.push(delta);
    if (effect.durationQ && effect.stat !== "rev_pct") {
      // Temporary stat shift: schedule the reversal.
      state.modifiers.push({ stat: effect.stat, amount: -amount, quartersLeft: effect.durationQ, sourceId });
    }
  }

  for (const f of outcome.setFlags ?? []) state.flags[f] = true;
  for (const f of outcome.clearFlags ?? []) delete state.flags[f];
  for (const op of outcome.special ?? []) applySpecial(state, op, sourceId);

  if (outcome.followupId) {
    const delay = outcome.followupDelayYears ?? 0;
    state.followups.push({
      eventId: outcome.followupId,
      dueYear: state.year + delay,
      dueMonth: delay === 0 ? Math.min(12, state.month + 1) : state.month,
    });
  }

  return { deltas, narration: outcome.narration };
}

/** Resolve a Branch list: conditionals first (authored order), else weighted roll. */
export function resolveBranches(state: RunState, branches: Branch[], rng: Rng): Outcome {
  const conditional = branches.filter((b) => b.cond || b.fallback);
  if (conditional.length > 0) {
    for (const b of conditional) {
      if (b.cond && condMet(state, b.cond)) return b.outcome;
    }
    const fb = conditional.find((b) => b.fallback);
    if (fb) return fb.outcome;
  }
  const weighted = branches.filter((b) => b.weight !== undefined);
  if (weighted.length > 0) {
    let roll = rng() * 100;
    for (const b of weighted) {
      roll -= b.weight!;
      if (roll <= 0) return b.outcome;
    }
    return weighted[weighted.length - 1].outcome;
  }
  return branches[0]?.outcome ?? {};
}

/** Quarter rollover: expire temp modifiers (reverting stat shifts). */
export function tickModifiersQuarter(state: RunState, rngLocal: Rng) {
  const keep: typeof state.modifiers = [];
  for (const mod of state.modifiers) {
    const next = { ...mod, quartersLeft: mod.quartersLeft - 1 };
    if (next.quartersLeft > 0) {
      keep.push(next);
    } else if (mod.stat !== "rev_pct") {
      applyStat(state, mod.stat, mod.amount); // stored as the reversal
    }
  }
  state.modifiers = keep;
  void rngLocal;
}

/** Month rollover for delayed effects. Returns matured results for the log. */
export function tickPendingMonth(state: RunState, rng: Rng): ApplyResult[] {
  const matured: ApplyResult[] = [];
  const keep: typeof state.pending = [];
  for (const p of state.pending) {
    if (p.monthsLeft - 1 <= 0) {
      matured.push(applyOutcome(state, { effects: [p.effect] }, p.sourceId, rng));
    } else {
      keep.push({ ...p, monthsLeft: p.monthsLeft - 1 });
    }
  }
  state.pending = keep;
  return matured;
}

/** Active revenue modifier product for the quarterly tick. */
export function marketModifier(state: RunState): number {
  return state.modifiers
    .filter((m) => m.stat === "rev_pct")
    .reduce((acc, m) => acc * (1 + m.amount / 100), 1);
}
