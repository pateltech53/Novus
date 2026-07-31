import type { Employee } from "./people";
import type { Holding } from "./holdings";
import type { StockPosition } from "./market";
import type { AvatarConfig } from "./avatar";
import type { Portfolio } from "./portfolio";
import type { Positioning } from "./positioning";

/**
 * Novus engine types — the contract between the authored event library
 * (design/NOVUS_EVENT_LIBRARY_B1.md), the generated data/events.json, and the sim.
 *
 * Money in events is written in S units (GDD §6): St1=$1K St2=$10K St3=$100K
 * St4=$1M St5=$10M. The engine multiplies at apply time.
 */

// ── Stats ────────────────────────────────────────────────────────────────────

/** Visible stats (GDD §5). Hidden stats drive events and the autopsy only. */
export interface Stats {
  cash: number; // dollars
  revenueAnnual: number; // trailing 12mo, dollars
  burnMonthly: number; // dollars/mo net cash loss (negative = profitable)
  valuation: number; // dollars
  grossMarginPt: number; // 0–100
  netMarginPt: number; // derived
  marketSharePt: number; // 0–100
  brand: number; // 0–100
  qual: number; // 0–100
  csat: number; // 0–100
  churnPt: number; // %/yr
  cwp: number; // $ willingness to pay index 0–100
  cacPt: number; // efficiency index 0–100 (higher = cheaper acquisition)
  ctrPt: number; // 0–100
  employees: number;
  morale: number; // 0–100
  energy: number; // founder battery 0–100
  respect: number; // Shark Respect 0–100, persists across runs
  // hidden
  risk: number; // legal risk 0+
  tdebt: number; // tech debt 0+
  suploy: number; // supplier loyalty −5..+5
  invsent: number; // investor sentiment −5..+5
  teamloy: number; // team loyalty −5..+5
}

/** Effect stat vocabulary used by authored events. */
export type EffectStat =
  | "cash_S" // one-time cash in S units
  | "burn_S_mo" // permanent monthly fixed-cost delta in S units
  | "rev_pct" // revenue % modifier (durationQ; default 2 quarters)
  | "gm_pt"
  | "brand"
  | "morale"
  | "qual"
  | "csat"
  | "churn_pt"
  | "emp"
  | "energy"
  | "val_pct" // valuation % one-time shift
  | "respect"
  | "share_pt"
  | "cac_pt"
  | "ctr_pt"
  | "cwp_pt"
  | "dilution_pct" // founder ownership loss
  | "risk"
  | "tdebt"
  | "suploy"
  | "invsent"
  | "teamloy";

export interface Effect {
  stat: EffectStat;
  amount: number; // sign carries direction; S units where the stat says so
  /** Temporary effects: number of quarters the modifier lasts (rev_pct, qual…). */
  durationQ?: number;
  /** Effect starts after N quarters ("then GM +2" = afterQ 2). */
  afterQ?: number;
  /** `(d)` in the library — lands one year later (sugar for afterQ: 4). */
  delayed?: boolean;
  /** Recurring yearly amount (e.g. "Cash +2S/yr"). */
  perYear?: boolean;
}

// ── Conditions ───────────────────────────────────────────────────────────────

export interface StatCond {
  key:
    | "brand"
    | "qual"
    | "csat"
    | "morale"
    | "energy"
    | "respect"
    | "cash_S"
    | "churn_pt";
  gte?: number;
  lt?: number;
}

export interface Cond {
  stat?: StatCond;
  flag?: string; // requires flag set
  notFlag?: string; // requires flag absent
}

// ── Outcomes ─────────────────────────────────────────────────────────────────

/**
 * Special ops — mechanics the stat vocabulary can't carry. The engine
 * interprets known tags; unknown tags degrade to narration (and are logged
 * by the validator so nothing silently disappears).
 */
export type SpecialOp = string; // e.g. "arm_chain:K-TEC" | "chain_odds:K-SUP:2" |
// "autopsy_magnet" | "clear_flag_hard:data_loose" | "unlock_activity:pivot_lite" |
// "impair_choices:3" | "immunity:supply_crisis" | "insurance_halves_damage" |
// "merger_arc" | "cosmetic_unlock:mascot_line" | "teamloy_max"

export interface Outcome {
  effects?: Effect[];
  setFlags?: string[];
  clearFlags?: string[];
  special?: SpecialOp[];
  /** Authored consequence line, Voice v2, verbatim from the library when present. */
  narration?: string;
  followupId?: string;
  /** Years until the follow-up event is armed (chains use 0 = next day/month). */
  followupDelayYears?: number;
}

/** Probabilistic or conditional branch. Weighted branches must sum to 100. */
export interface Branch {
  /** Percent chance (probabilistic split). Omit when `cond` is used. */
  weight?: number;
  cond?: Cond;
  /** Marks the `else` arm of a conditional split. */
  fallback?: boolean;
  outcome: Outcome;
}

export type PerformType =
  | "pitch"
  | "nego"
  | "consult"
  | "board"
  | "allhands"
  | "media";

export interface PerformSpec {
  type: PerformType;
  /** Score required to take the pass branch (library default: 6). */
  passScore?: number;
  /** The player may decline the camera (e.g. `[P:media optional]`). */
  optional?: boolean;
  pass: Outcome;
  fail: Outcome;
}

// ── Choices & events ─────────────────────────────────────────────────────────

export interface Choice {
  /** Verbatim label from the library ("Absorb it"). */
  label: string;
  /** Mechanical summary of the KNOWN tradeoff shown on the card ("GM −3"). */
  known?: string;
  requiresFlag?: string;
  /** `req:{a} or {b}` — any one of these unlocks the choice. */
  requiresAnyFlags?: string[];
  excludesFlag?: string;
  outcome?: Outcome;
  branches?: Branch[];
  perform?: PerformSpec;
}

export interface WeightMod {
  flag?: string;
  industries?: string[];
  mult: number; // e.g. 2 for "2× weight if {ship_fast}"
}

export type Industry =
  | "FOOD"
  | "ECOM"
  | "TECH"
  | "CONTENT"
  | "FASHION"
  | "GAMING"
  | "FITNESS"
  | "BEAUTY"
  | "EDTECH"
  | "SUSTAIN"
  | "TOYS"
  | "PET";

export interface GameEvent {
  id: string; // "E-OPS-001"
  title: string; // verbatim
  category: string; // "OPS" | "PPL" | "FIN" | "MKT" | "PRD" | "CUS" | "RIV" | "LGL" | "LIF" | "OPP" | "K" | "MILE" | "IND" | "WILD"
  /** Situation text, verbatim, Voice v2. */
  text: string;
  /** Industry-specific rewrites of `text`, verbatim where authored. */
  reskins?: Partial<Record<Industry, string>>;
  stages: number[]; // subset of 1..5
  industries: "all" | Industry[];
  weight: number;
  weightMods?: WeightMod[];
  once?: boolean;
  cooldownYears?: number; // default 3 (GDD §9)
  minYear?: number;
  requiresFlags?: string[];
  excludesFlags?: string[];
  /** Stat-gated availability (e.g. `req:{burnout_risk} or En<25`). OR semantics with requiresFlags when `reqAnyOf` true. */
  requiresCond?: Cond[];
  reqAnyOf?: boolean;
  /** Event resolves by camera only — no tap choices (`[P:allhands only]`). */
  performOnly?: PerformSpec;
  /** Narration-only beat with automatic effects (E-PPL-018). */
  auto?: Outcome;
  /**
   * Event-scoped mechanics that belong to no single choice — e.g. the cost of
   * declining an optional camera moment (`decline_outcome:brand-2`).
   */
  special?: SpecialOp[];
  choices?: Choice[];
  rookieTerms?: string[];
  chain?: { id: string; step: number };
}

// ── Run state ────────────────────────────────────────────────────────────────

export type StageNum = 1 | 2 | 3 | 4 | 5;

export interface ActiveModifier {
  stat: EffectStat;
  amount: number;
  quartersLeft: number;
  sourceId: string;
}

export interface PendingEffect {
  effect: Effect;
  monthsLeft: number;
  sourceId: string;
}

export interface ScheduledFollowup {
  eventId: string;
  dueYear: number;
  dueMonth: number;
}

export interface LogLine {
  id: string;
  year: number;
  month: number;
  kind:
    | "month-rule"
    | "year-open"
    | "narration"
    | "finance"
    | "decision"
    | "consequence"
    | "shark"
    | "milestone"
    | "perform"
    | "system";
  text: string;
  /** Inline colored deltas: rendered green (solvency), red (alert) or plain. */
  deltas?: { label: string; tone: "up" | "down" | "flat" }[];
}

export interface DecisionRecord {
  eventId: string;
  eventTitle: string;
  choiceLabel: string;
  year: number;
  month: number;
  /** Realized valuation delta attributed to this decision (autopsy fuel). */
  valuationImpact: number;
  /** Cash spent (positive = money left the company). */
  cashCost: number;
  /** Permanent monthly burn added (positive = the company got heavier). */
  burnAdded: number;
  booksBefore: { cash: number; valuation: number };
}

export interface PerformResult {
  type: PerformType;
  score: number; // 0–10
  multiplier: number; // M = 0.4 + 0.12 × score
  year: number;
  transcriptId?: string;
}

export interface RunState {
  id: string;
  seed: number;
  /** Simulated Pro plan. Content only — never outcomes (Brand Law 4). */
  pro: boolean;
  founderName: string;
  playerAge: number | null;
  companyName: string;
  industry: Industry;
  year: number; // fiscal year, 1-based
  month: number; // 1..12
  stage: StageNum;
  stats: Stats;
  /** Trailing 4 quarterly revenues (dollars); revenueAnnual = their sum. */
  quarters: number[];
  /** Accumulated fixed-cost deltas from events, in S at current stage. */
  burnDeltaS: number;
  /** Multiplier on total burn from cost-surgery specials (burn_pct). */
  burnScale: number;
  /** Hidden karma counter — surfaces only in the autopsy. */
  karma: number;
  /** Valuation hype modifier in %, decays at year end. */
  hypePct: number;
  founderEquityPct: number; // starts 100, dilution shrinks it
  flags: Record<string, true>;
  modifiers: ActiveModifier[];
  pending: PendingEffect[];
  recurring: { effect: Effect; sourceId: string }[]; // "per year" effects
  followups: ScheduledFollowup[];
  firedOnce: string[]; // event ids consumed (once:true)
  cooldowns: Record<string, number>; // eventId -> year it can fire again
  lastCategory: string | null; // anti-repeat: never same category back-to-back
  impairedChoices: number; // low-energy: next N decisions hide one option
  autopsyMagnets: { sourceId: string; label: string }[];
  unknownSpecials: string[]; // special ops the engine didn't recognize (never silent)
  redMonths: number; // consecutive months with cash < 0
  marketDayISO: string | null; // last real day Today's Market surfaced
  lastPlayedISO: string | null;
  /** Named people, not a headcount. */
  roster: Employee[];
  /** Company + personal assets, revalued yearly. */
  holdings: Holding[];
  /**
   * The product portfolio — the things the player named and priced.
   *
   * Optional because runs saved before it existed have no such field, and
   * shipping this must not destroy a run in progress. Every read goes through
   * `ensurePortfolio()` in portfolio.ts, which fills it in on first touch.
   */
  portfolio?: Portfolio;
  /**
   * The strategy layer (Addendum B §5). Optional because it is answered at
   * first market contact, never at founding — a fresh run legitimately has
   * none, and saves from before the layer existed must keep loading.
   */
  positioning?: Positioning;
  /** Extra portfolio slots earned from `operator` hires. */
  portfolioCapBonus?: number;
  /**
   * Cold calls are rationed per REAL day, not per fiscal month — same clock
   * Today's Market runs on. Three a day is the whole point of the mechanic: you
   * cannot grind a hundred pitches in one sitting, so each one has to count.
   */
  coldCallDayISO?: string | null;
  coldCallsUsed?: number;
  /** Investors already pitched, so the roster does not offer them twice. */
  coldCallsClosed?: string[];
  /** RobinGhood positions. Prices come from the real clock, not from here. */
  positions: StockPosition[];
  /** Money moved out of the company into the market/personal side. */
  brokerageCash: number;
  /** The player's shark. Cosmetic only. */
  avatar: AvatarConfig;
  /** BeeMail: ids of messages already read. */
  readMail: string[];
  log: LogLine[];
  decisions: DecisionRecord[];
  performs: PerformResult[];
  rookieMode: boolean;
  tutorial: boolean; // fiscal year 1 guided run
  tutorialStep: number; // T1..T8 progression pointer (0 = done/skipped)
  seenTerms: string[]; // term-on-first-use bookkeeping
  alive: boolean;
  endedBy?: "chapter7" | "acquired" | "ipo";
}

export interface LegacyState {
  bestYear: number;
  runsCompleted: number;
  sharkRespect: number; // carries across runs
  badges: string[];
  autopsies: { companyName: string; years: number; causes: string[] }[];
}
