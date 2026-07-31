import type { Industry, RunState, StageNum } from "./types";
import { S_UNIT, industryByCode } from "./constants";
import { hashString, mulberry32, type Rng } from "./rng";

/**
 * THE PORTFOLIO ENGINE — one subsystem, twelve lenses.
 *
 * Addendum A, §2.1: do not build twelve product systems. Build one generic
 * `LineItem` and give each industry a noun, a demand unit, one signature
 * mechanic, one signature failure and a handful of activities. Everything in
 * this file is shared across all twelve; everything industry-specific lives in
 * `industries.ts` as data.
 *
 * ── The one rule that governs the whole file ────────────────────────────────
 *
 * NOTHING HERE MAY BE SHOWN TO THE PLAYER BEFORE IT RESOLVES.
 *
 * `perceivedValue`, `priceRatio`, `wasteRate`, `returnRate`, `verdict` — every
 * one of these is computable at launch time and every one of them is withheld
 * until the year closes. That is failure P1 from the master prompt ("no answer
 * key") applied to the portfolio: learning what your product is worth is the
 * skill, so the engine must be able to tell you and must not.
 *
 * The qualitative pre-launch hint in `priceHint()` is the only exception, it is
 * deliberately vague, and it is gated on having earned market intuition.
 *
 * ── Why this is pure TypeScript ─────────────────────────────────────────────
 *
 * No React, no imports from anywhere outside lib/engine. It has to be runnable
 * headlessly by a balance harness, same as the rest of the engine. The bots in
 * `scripts/simulate-portfolio.mjs` import this file directly.
 */

// ── Model ───────────────────────────────────────────────────────────────────

export type ItemState =
  | "development" // launched this quarter, not yet earning
  | "live" // earning
  | "declining" // past peak, revenue decaying
  | "retired" // player killed it
  | "recalled"; // forcibly killed by an event (safety, legal, platform)

export type PriceTier = "budget" | "standard" | "premium" | "luxury";

export type Verdict = "hit" | "solid" | "quiet" | "flop";

export interface LineItemYear {
  year: number;
  units: number;
  /** Dollars. */
  revenue: number;
  /** Dollars per unit. */
  unitCost: number;
  /** Percentage points, derived. */
  grossMargin: number;
  /** % of company revenue that year. */
  share: number;
  /**
   * Units lost to same-tier, same-tag siblings launched since. Surfaced in the
   * year-end report as a named sentence, never predicted beforehand.
   */
  cannibalized: number;
  /** Industry signature loss (spoilage, returns, churn…) as a % of gross. */
  leakPct: number;
}

export interface LineItem {
  id: string;
  /** PLAYER-AUTHORED. The whole point. Max 28 chars. */
  name: string;
  industry: Industry;
  /** PLAYER-SET at launch, adjustable later at a cost. Dollars. */
  price: number;
  /** Derived. NEVER shown pre-launch. Dollars. */
  unitCost: number;
  tier: PriceTier;
  /** Index into the industry's invest tiers. Drives unitCost and quality. */
  investTier: 0 | 1 | 2;
  /** S units actually spent at launch. */
  qualityInvestS: number;
  tags: string[];
  launchedYear: number;
  launchedQuarter: number;
  retiredYear?: number;
  state: ItemState;
  /** Append-only. This is what the year-end report reads. */
  history: LineItemYear[];
  /** Hidden until the first full year closes. */
  verdict?: Verdict;
  /** Set by a refresh activity. Resets lifecycle decay, with diminishing returns. */
  lastRefreshedYear?: number;
  refreshCount: number;
  /**
   * Industry signature payload — the one field that differs by lens. FOOD keeps
   * a wasteRate here, ECOM an inventory position, GAMING a monetization model.
   * Kept as a loose bag on purpose: a typed union of twelve shapes would force
   * every consumer to switch on industry, which is the abstraction failure
   * Addendum A §"Shared vs specific" warns about.
   */
  meta: Record<string, number | string | boolean>;
}

export interface Portfolio {
  items: LineItem[];
  nextId: number;
  /** Fiscal years in which the player launched, for pacing events. */
  launchYears: number[];
}

export const emptyPortfolio = (): Portfolio => ({ items: [], nextId: 1, launchYears: [] });

/**
 * Saves written before the portfolio existed have no `portfolio` field, and a
 * run in progress must not be destroyed by shipping this. Every read goes
 * through here.
 */
export function ensurePortfolio(state: RunState): Portfolio {
  if (!state.portfolio) state.portfolio = emptyPortfolio();
  const p = state.portfolio;
  if (!Array.isArray(p.items)) p.items = [];
  if (typeof p.nextId !== "number") p.nextId = p.items.length + 1;
  if (!Array.isArray(p.launchYears)) p.launchYears = [];
  for (const it of p.items) {
    if (!Array.isArray(it.history)) it.history = [];
    if (typeof it.refreshCount !== "number") it.refreshCount = 0;
    if (!it.meta) it.meta = {};
  }
  return p;
}

// ── The industry lens ───────────────────────────────────────────────────────

export interface InvestTier {
  /** Qualitative only. The cash cost is shown; the consequence is not. */
  label: string;
  costS: number;
  /** Multiplier on unit cost. Cheap builds cost less to make and sell worse. */
  costMult: number;
  /** Multiplier on perceived value. */
  valueMult: number;
}

/**
 * The one per-item decision that only this lens has.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Every lens was written to read a signature choice out of `item.meta` —
 * FASHION's run size, GAMING's monetization model, EDTECH's delivery model — and
 * for a while nothing ever wrote one, because the launch flow called
 * `launchLineItem({ name, price, investTier, tags })` and dropped `meta` on the
 * floor. Seven lenses were reading a key no code path set, so seven signature
 * mechanics were dead: every drop was a `planned` run, every title was priced
 * into a model it never chose, and the branch each header called "the whole
 * point" was unreachable.
 *
 * Declaring the choice on the spec makes it the launch sheet's problem instead of
 * twelve separate problems. The UI renders whatever is here generically, so a
 * lens that wants a commitment gets one and a lens that does not (FOOD, whose
 * mechanic runs off tags) leaves it undefined.
 *
 * The options are QUALITATIVE. This is a commitment made before the information
 * arrives — that is the lesson — so no option may state what it costs or what it
 * will earn.
 */
export interface LaunchChoice {
  /** The `item.meta` key this lens reads. */
  metaKey: string;
  /** The question, in the lens's own vocabulary. */
  label: string;
  /** Two or three options. Labels carry no digits. */
  options: { value: string | number; label: string }[];
  /** Which option is selected when the sheet opens. */
  defaultIndex: number;
}

export interface IndustrySpec {
  code: Industry;
  /** What a LineItem is called here. "Menu item", "SKU", "Drop"… */
  noun: string;
  nounPlural: string;
  /** What demand is counted in. "covers", "orders", "subscribers"… */
  demandUnit: string;
  /** Year-end report heading. "THE MENU", "THE CATALOG"… */
  reportLabel: string;
  /** Price stepper bounds and increment, in dollars. */
  priceMin: number;
  priceMax: number;
  priceStep: number;
  /** The industry's anchor price — the centre of gravity for perceived value. */
  baselinePrice: number;
  /** Units a median item sells in its peak year at stage 1. */
  baseUnits: number;
  /** Gross margin the industry is expected to run at, percentage points. */
  baselineGmPt: number;
  /** 2-of-N chips offered at launch. Drive cannibalization and event targeting. */
  tags: string[];
  investTiers: [InvestTier, InvestTier, InvestTier];
  /** Placeholder for the name field. Suggestive, never prescriptive. */
  namePlaceholder: string;
  /**
   * The signature mechanic's name and the fraction of gross it can eat. The
   * mechanic itself is `signatureLeak` below; this is what the report calls it.
   */
  leakLabel: string;
  leakMax: number;
  /**
   * The one genuinely bespoke function per industry: how this lens loses money.
   * FOOD wastes prep, ECOM eats returns, CONTENT misses cadence. Returns a
   * fraction of gross revenue lost, 0..leakMax.
   *
   * Everything else in this file is shared. If a thirteenth code path appears
   * here, an abstraction has been missed.
   */
  signatureLeak(item: LineItem, state: RunState, rng: Rng, spec: IndustrySpec): number;
  /**
   * The commitment this lens asks for at launch, if it asks for one. Undefined
   * where the signature mechanic runs off price and tags alone.
   */
  launchChoice?: LaunchChoice;
}

// ── Stage caps ──────────────────────────────────────────────────────────────

/**
 * Addendum A §2.2. Not an arbitrary game limit — real companies die of SKU
 * proliferation, and the cap is what forces the kill decision. Being AT the cap
 * is fine; being over it bleeds through three different stats.
 */
export const PORTFOLIO_CAP: Record<StageNum, number> = { 1: 3, 2: 5, 3: 8, 4: 12, 5: 16 };

export function portfolioCap(state: RunState): number {
  // `operator` hires raise the ceiling; see people.ts roles.
  const bonus = Number(state.flags.portfolio_cap_plus1 ? 1 : 0) + (state.portfolioCapBonus ?? 0);
  return PORTFOLIO_CAP[state.stage] + bonus;
}

export const liveItems = (p: Portfolio): LineItem[] =>
  p.items.filter((i) => i.state === "development" || i.state === "live" || i.state === "declining");

export const earningItems = (p: Portfolio): LineItem[] =>
  p.items.filter((i) => i.state === "live" || i.state === "declining");

// ── Price tiers ─────────────────────────────────────────────────────────────

export function tierFor(price: number, spec: IndustrySpec): PriceTier {
  const r = price / spec.baselinePrice;
  if (r < 0.7) return "budget";
  if (r < 1.25) return "standard";
  if (r < 2.2) return "premium";
  return "luxury";
}

const TIER_ORDER: PriceTier[] = ["budget", "standard", "premium", "luxury"];

/** 1 when identical, 0 when three tiers apart. Drives cannibalization. */
function tierProximity(a: PriceTier, b: PriceTier): number {
  const d = Math.abs(TIER_ORDER.indexOf(a) - TIER_ORDER.indexOf(b));
  return Math.max(0, 1 - d / 3);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const A = new Set(a);
  const B = new Set(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter += 1;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

// ── §4.1 Price elasticity ───────────────────────────────────────────────────

export type ElasticityBand = "underpriced" | "sweet" | "rich" | "greedy";

/**
 * HIDDEN. The number the player is trying to guess by pricing things and
 * watching what happens. Never render this, never derive a visible figure from
 * it before the item's first year has closed.
 */
export function perceivedValue(item: LineItem, state: RunState, spec: IndustrySpec): number {
  const tiers = spec.investTiers;
  const invest = tiers[item.investTier] ?? tiers[1];
  const brandLift = 0.78 + 0.44 * (state.stats.brand / 100);
  const csatLift = 0.88 + 0.24 * (state.stats.csat / 100);
  const qualLift = 0.9 + 0.2 * (state.stats.qual / 100);
  // Tags that read as upmarket raise what people will pay for the same thing.
  const premiumTags = ["premium", "luxury", "limited", "certified", "enterprise", "chase", "core"];
  const tagLift = 1 + 0.08 * item.tags.filter((t) => premiumTags.includes(t)).length;
  return spec.baselinePrice * invest.valueMult * brandLift * csatLift * qualLift * tagLift;
}

export function priceRatio(item: LineItem, state: RunState, spec: IndustrySpec): number {
  const pv = perceivedValue(item, state, spec);
  return pv <= 0 ? 1 : item.price / pv;
}

export function elasticityBand(ratio: number): ElasticityBand {
  if (ratio < 0.7) return "underpriced";
  if (ratio <= 1.15) return "sweet";
  if (ratio <= 1.6) return "rich";
  return "greedy";
}

/** Units multiplier for the band. The shape of the whole pricing lesson. */
function bandUnitsMult(band: ElasticityBand): number {
  switch (band) {
    case "underpriced":
      return 1.45;
    case "sweet":
      return 1.0;
    case "rich":
      return 0.62;
    case "greedy":
      return 0.24;
  }
}

/**
 * The ONLY thing the player may see before committing, and only once they have
 * earned market intuition. Qualitative, digit-free, and hedged — it tells you
 * roughly where you are, never what to do.
 *
 * Below the intuition threshold this returns null and the player has to guess.
 * That is the intended experience for the first few years.
 */
export function priceHint(
  item: LineItem,
  state: RunState,
  spec: IndustrySpec,
): string | null {
  const earned = state.stats.csat >= 55 && state.stats.brand >= 40;
  if (!earned) return null;
  switch (elasticityBand(priceRatio(item, state, spec))) {
    case "underpriced":
      return "You could probably charge more for this.";
    case "sweet":
      return "That feels about right for what it is.";
    case "rich":
      return "That is punchy. It had better be good.";
    case "greedy":
      return "That is steep for what it is.";
  }
}

// ── §4.3 Lifecycle decay ────────────────────────────────────────────────────

/**
 * Year 1 novelty, a two-year peak, slow maturity decay, then real decline. The
 * trap this builds is deliberate: your year-1 hit becomes your year-9 anchor,
 * earning just enough that killing it feels wrong while it quietly eats a slot.
 */
export function lifecycleMult(item: LineItem, year: number): number {
  const since = year - Math.max(item.launchedYear, item.lastRefreshedYear ?? item.launchedYear);
  if (since <= 0) return 1.35; // launch novelty
  if (since <= 2) return 1.0; // peak
  if (since <= 5) return Math.pow(0.92, since - 2); // maturity
  return Math.pow(0.92, 3) * Math.pow(0.82, since - 5); // decline
}

/** A refresh resets the clock — and each one buys less than the last. */
export function refreshEffectiveness(item: LineItem): number {
  return Math.pow(0.8, item.refreshCount);
}

// ── §4.2 Cannibalization ────────────────────────────────────────────────────

/**
 * How much of `item`'s demand a newer sibling steals. Never warned about in
 * advance; named explicitly in the year-end report after the fact, which is the
 * only way this lesson lands.
 */
export function cannibalizationLoss(
  item: LineItem,
  portfolio: Portfolio,
  year: number,
): { loss: number; culprit: LineItem | null } {
  let worst = 0;
  let culprit: LineItem | null = null;
  for (const other of earningItems(portfolio)) {
    if (other.id === item.id) continue;
    if (other.launchedYear <= item.launchedYear) continue; // only newer items steal
    if (other.launchedYear > year) continue;
    const overlap = jaccard(item.tags, other.tags) * tierProximity(item.tier, other.tier);
    if (overlap <= 0.6) continue;
    // 0.6 → 30%, 1.0 → 60%. Linear across the band above the threshold.
    const loss = 0.3 + 0.75 * (overlap - 0.6);
    if (loss > worst) {
      worst = loss;
      culprit = other;
    }
  }
  return { loss: Math.min(0.6, worst), culprit };
}

// ── §4.4 Portfolio drag ─────────────────────────────────────────────────────

export interface Drag {
  burnS: number;
  qualPenalty: number;
  energyPenalty: number;
  over: number;
}

export function portfolioDrag(state: RunState): Drag {
  const p = ensurePortfolio(state);
  const n = liveItems(p).length;
  const over = Math.max(0, n - portfolioCap(state));
  return {
    burnS: n * 0.06,
    // Compounding, not linear: two over is worse than twice one over.
    qualPenalty: over === 0 ? 0 : over * (over + 1) * 0.5,
    energyPenalty: over * 2,
    over,
  };
}

// ── §4.5 Verdicts ───────────────────────────────────────────────────────────

function median(ns: number[]): number {
  if (ns.length === 0) return 0;
  const s = [...ns].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function assignVerdict(
  item: LineItem,
  yearRow: LineItemYear,
  medianUnits: number,
  spec: IndustrySpec,
): Verdict {
  const contribution = yearRow.revenue - yearRow.units * yearRow.unitCost;
  if (contribution <= 0 || (medianUnits > 0 && yearRow.units < 0.4 * medianUnits)) return "flop";
  if (medianUnits > 0 && yearRow.units > 2.2 * medianUnits && yearRow.grossMargin >= spec.baselineGmPt)
    return "hit";
  if (medianUnits > 0 && yearRow.units > medianUnits) return "solid";
  return "quiet";
}

// ── The yearly tick ─────────────────────────────────────────────────────────

export interface PortfolioYearResult {
  year: number;
  /** Dollars the portfolio contributed this year. */
  revenue: number;
  /** Weighted gross margin, percentage points. */
  grossMarginPt: number;
  rows: { item: LineItem; row: LineItemYear }[];
  /** Facts, for the report's two insight lines. Never fabricated. */
  insights: string[];
  newVerdicts: { item: LineItem; verdict: Verdict }[];
}

/**
 * Close the books on every earning item for `year`. Appends one `LineItemYear`
 * per item, assigns first-year verdicts, and returns the numbers the year-end
 * report renders.
 *
 * Deterministic: the only randomness comes from the seeded rng derived from the
 * run seed and the year, so a replay produces identical history.
 */
export function tickPortfolioYear(
  state: RunState,
  specFor: (code: Industry) => IndustrySpec,
  year = state.year,
): PortfolioYearResult {
  const p = ensurePortfolio(state);
  const spec = specFor(state.industry);
  const rng = mulberry32(hashString(`portfolio:${state.seed}:${year}`));
  const seasonAvg =
    industryByCode(state.industry).season.reduce((a, b) => a + b, 0) / 4;

  // Development items start earning once a year has turned.
  for (const it of p.items) if (it.state === "development") it.state = "live";

  const earning = earningItems(p);
  const stageScale = S_UNIT[state.stage] / S_UNIT[1];
  const rows: { item: LineItem; row: LineItemYear }[] = [];

  for (const item of earning) {
    const band = elasticityBand(priceRatio(item, state, spec));
    const { loss, culprit } = cannibalizationLoss(item, p, year);
    const life = lifecycleMult(item, year);

    const marketPull =
      0.7 + 0.6 * (state.stats.brand / 100) + 0.3 * (state.stats.cacPt / 100);
    const gross =
      spec.baseUnits *
      Math.sqrt(stageScale) *
      bandUnitsMult(band) *
      life *
      marketPull *
      seasonAvg *
      (0.92 + rng() * 0.16);

    const units = Math.max(0, Math.round(gross * (1 - loss)));
    const invest = spec.investTiers[item.investTier] ?? spec.investTiers[1];
    const unitCost = (spec.baselinePrice * 0.42) * invest.costMult;

    const leak = Math.min(spec.leakMax, Math.max(0, spec.signatureLeak(item, state, rng, spec)));
    const revenue = units * item.price * (1 - leak);
    const cogs = units * unitCost;
    const grossMargin = revenue <= 0 ? 0 : Math.round(((revenue - cogs) / revenue) * 100);

    item.unitCost = unitCost;
    item.tier = tierFor(item.price, spec);
    if (life < 0.75 && item.state === "live") item.state = "declining";

    const row: LineItemYear = {
      year,
      units,
      revenue,
      unitCost,
      grossMargin,
      share: 0, // filled once the portfolio total is known
      cannibalized: Math.round(gross * loss),
      leakPct: Math.round(leak * 100),
    };
    // Idempotent: re-ticking the same year overwrites rather than duplicating.
    const existing = item.history.findIndex((h) => h.year === year);
    if (existing >= 0) item.history[existing] = row;
    else item.history.push(row);
    rows.push({ item, row });

    if (culprit && loss > 0) item.meta.lastCulprit = culprit.name;
  }

  const total = rows.reduce((s, r) => s + r.row.revenue, 0);
  for (const r of rows) r.row.share = total <= 0 ? 0 : Math.round((r.row.revenue / total) * 100);

  // Verdicts, once an item has a full year behind it.
  const medUnits = median(rows.map((r) => r.row.units));
  const newVerdicts: { item: LineItem; verdict: Verdict }[] = [];
  for (const { item, row } of rows) {
    if (item.verdict || item.launchedYear >= year) continue;
    const v = assignVerdict(item, row, medUnits, spec);
    item.verdict = v;
    newVerdicts.push({ item, verdict: v });
  }

  const cogsTotal = rows.reduce((s, r) => s + r.row.units * r.row.unitCost, 0);
  const gmPt = total <= 0 ? spec.baselineGmPt : Math.round(((total - cogsTotal) / total) * 100);

  return {
    year,
    revenue: total,
    grossMarginPt: gmPt,
    rows: rows.sort((a, b) => b.row.units - a.row.units),
    insights: buildInsights(rows, total, spec),
    newVerdicts,
  };
}

/**
 * Exactly two lines, both computed from real numbers. Concentration risk and
 * cannibalization are the two that matter; if neither applies we say something
 * else true, and if there is nothing true to say we say nothing. Never pad.
 */
function buildInsights(
  rows: { item: LineItem; row: LineItemYear }[],
  total: number,
  spec: IndustrySpec,
): string[] {
  const out: string[] = [];
  if (rows.length === 0 || total <= 0) return out;
  const sorted = [...rows].sort((a, b) => b.row.revenue - a.row.revenue);
  const top = sorted[0];

  if (top.row.share >= 40) {
    out.push(`Your top ${spec.noun.toLowerCase()} is ${top.row.share}% of revenue.`);
  }

  const bitten = rows
    .filter((r) => r.row.cannibalized > 0 && r.item.meta.lastCulprit)
    .sort((a, b) => b.row.cannibalized - a.row.cannibalized)[0];
  if (bitten) {
    const pct = Math.round(
      (bitten.row.cannibalized / (bitten.row.units + bitten.row.cannibalized)) * 100,
    );
    out.push(
      `${bitten.item.meta.lastCulprit} took ${pct}% of ${bitten.item.name}'s ${spec.demandUnit}.`,
    );
  }

  if (out.length < 2) {
    const leaky = [...rows].sort((a, b) => b.row.leakPct - a.row.leakPct)[0];
    if (leaky && leaky.row.leakPct >= 8) {
      out.push(
        `You lost ${leaky.row.leakPct}% of ${leaky.item.name} to ${spec.leakLabel.toLowerCase()}.`,
      );
    }
  }
  if (out.length < 2) {
    const dying = rows.find((r) => r.item.state === "declining");
    if (dying) out.push(`${dying.item.name} is past its peak and still holding a slot.`);
  }
  return out.slice(0, 2);
}

// ── Launch / retire / refresh ───────────────────────────────────────────────

export interface LaunchInput {
  name: string;
  price: number;
  investTier: 0 | 1 | 2;
  tags: string[];
  meta?: Record<string, number | string | boolean>;
}

export function canLaunch(state: RunState, spec: IndustrySpec, invest: InvestTier): {
  ok: boolean;
  reason?: string;
} {
  const p = ensurePortfolio(state);
  if (liveItems(p).length >= portfolioCap(state)) {
    const cap = portfolioCap(state);
    return {
      ok: false,
      reason: `Your team can support ${cap} ${cap === 1 ? spec.noun.toLowerCase() : spec.nounPlural.toLowerCase()} well. You have ${cap}.`,
    };
  }
  if (state.stats.cash < invest.costS * S_UNIT[state.stage]) {
    return { ok: false, reason: "Not enough cash on hand." };
  }
  return { ok: true };
}

export const sanitizeName = (raw: string): string =>
  raw.replace(/\s+/g, " ").trim().slice(0, 28);

export function launchItem(
  state: RunState,
  spec: IndustrySpec,
  input: LaunchInput,
): LineItem | null {
  const invest = spec.investTiers[input.investTier] ?? spec.investTiers[1];
  if (!canLaunch(state, spec, invest).ok) return null;

  const p = ensurePortfolio(state);
  const name = sanitizeName(input.name) || `${spec.noun} ${p.nextId}`;
  const price = clampPrice(input.price, spec);

  state.stats.cash -= invest.costS * S_UNIT[state.stage];
  // Support, inventory and maintenance, per §4.4. Charged on launch, refunded
  // on retire, so the drag is a real standing cost rather than a recomputation.
  state.burnDeltaS += 0.06;

  const item: LineItem = {
    id: `item-${p.nextId}`,
    name,
    industry: state.industry,
    price,
    unitCost: spec.baselinePrice * 0.42 * invest.costMult,
    tier: tierFor(price, spec),
    investTier: input.investTier,
    qualityInvestS: invest.costS,
    tags: input.tags.slice(0, 2),
    launchedYear: state.year,
    launchedQuarter: Math.ceil(state.month / 3),
    state: "development",
    history: [],
    refreshCount: 0,
    /*
     * Seeded with the lens's declared default BEFORE the caller's meta, so a
     * launch that skips the choice still lands on a real value rather than
     * leaving the key absent. Absent was the bug: every lens fell through to its
     * defensive fallback and the branch never varied.
     */
    meta: {
      ...(spec.launchChoice
        ? {
            [spec.launchChoice.metaKey]:
              spec.launchChoice.options[spec.launchChoice.defaultIndex]?.value ??
              spec.launchChoice.options[0].value,
          }
        : {}),
      ...(input.meta ?? {}),
    },
  };
  p.items.push(item);
  p.nextId += 1;
  if (!p.launchYears.includes(state.year)) p.launchYears.push(state.year);
  return item;
}

export function clampPrice(price: number, spec: IndustrySpec): number {
  const steps = Math.round((price - spec.priceMin) / spec.priceStep);
  const snapped = spec.priceMin + steps * spec.priceStep;
  return Math.min(spec.priceMax, Math.max(spec.priceMin, Number(snapped.toFixed(2))));
}

export function retireItem(state: RunState, itemId: string): LineItem | null {
  const p = ensurePortfolio(state);
  const item = p.items.find((i) => i.id === itemId);
  if (!item || item.state === "retired" || item.state === "recalled") return null;
  item.state = "retired";
  item.retiredYear = state.year;
  state.burnDeltaS -= 0.06;
  return item;
}

export function refreshItem(state: RunState, itemId: string, costS: number): boolean {
  const p = ensurePortfolio(state);
  const item = p.items.find((i) => i.id === itemId);
  if (!item || (item.state !== "live" && item.state !== "declining")) return false;
  if (state.stats.cash < costS * S_UNIT[state.stage]) return false;
  state.stats.cash -= costS * S_UNIT[state.stage];
  item.lastRefreshedYear = state.year;
  item.refreshCount += 1;
  if (item.state === "declining") item.state = "live";
  return true;
}

/** Forced kill — safety, legal, platform. Harsher than retiring by choice. */
export function recallItem(state: RunState, itemId: string): LineItem | null {
  const p = ensurePortfolio(state);
  const item = p.items.find((i) => i.id === itemId);
  if (!item) return null;
  item.state = "recalled";
  item.retiredYear = state.year;
  state.burnDeltaS -= 0.06;
  return item;
}

// ── Event interpolation ─────────────────────────────────────────────────────

/**
 * `{topItem}` / `{worstItem}` / `{newestItem}` in authored event text.
 *
 * Addendum A calls this the highest-leverage line in the document and it is
 * right: 279 authored events become personal for the cost of one string
 * replacement. Falls back to a generic noun when the portfolio is empty, so an
 * event can use these tokens unconditionally.
 */
export function interpolateItems(text: string, state: RunState, spec: IndustrySpec): string {
  if (!/\{(topItem|worstItem|newestItem)\}/.test(text)) return text;
  const p = ensurePortfolio(state);
  const ranked = earningItems(p)
    .map((i) => ({ i, u: i.history.at(-1)?.units ?? 0 }))
    .sort((a, b) => b.u - a.u);
  const generic = `your ${spec.noun.toLowerCase()}`;
  return text
    .replace(/\{topItem\}/g, ranked[0]?.i.name ?? generic)
    .replace(/\{worstItem\}/g, ranked.at(-1)?.i.name ?? generic)
    .replace(
      /\{newestItem\}/g,
      [...earningItems(p)].sort((a, b) => b.launchedYear - a.launchedYear)[0]?.name ?? generic,
    );
}
