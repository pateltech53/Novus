import type { Industry, StageNum, Stats } from "./types";

/**
 * Tunable config. Everything here is a [DECISION KNOB] unless it quotes the
 * GDD directly. Balance numbers not specified by the GDD are marked INFERRED
 * and chosen to make Year 1 survivable but tight (runway ~12mo at start).
 */

// ── Stages & the S unit (GDD §6, verbatim) ──────────────────────────────────

export const S_UNIT: Record<StageNum, number> = {
  1: 1_000,
  2: 10_000,
  3: 100_000,
  4: 1_000_000,
  5: 10_000_000,
};

export const STAGE_NAME: Record<StageNum, string> = {
  1: "Garage",
  2: "Startup",
  3: "Growth",
  4: "Scale",
  5: "Public/Unicorn",
};

/** Trailing annual revenue band that promotes you INTO the stage (GDD §6). */
export const STAGE_REVENUE_FLOOR: Record<StageNum, number> = {
  1: 0,
  2: 100_000,
  3: 1_000_000,
  4: 20_000_000,
  5: 250_000_000,
};

// ── Industries ──────────────────────────────────────────────────────────────

export const INDUSTRIES: {
  code: Industry;
  name: string;
  free: boolean;
  multiple: number; // valuation industry_multiple [DECISION KNOB per GDD §6]
  season: [number, number, number, number]; // quarterly demand seasonality
}[] = [
  { code: "FOOD", name: "Food & Beverage", free: true, multiple: 2, season: [0.95, 1.0, 1.0, 1.05] },
  { code: "ECOM", name: "E-commerce / Retail", free: true, multiple: 3, season: [0.9, 0.95, 1.0, 1.15] },
  { code: "TECH", name: "Tech App", free: true, multiple: 8, season: [1.0, 1.0, 1.0, 1.0] },
  { code: "CONTENT", name: "Content / Creator", free: true, multiple: 5, season: [1.0, 0.95, 1.0, 1.05] },
  { code: "FASHION", name: "Fashion / Streetwear", free: false, multiple: 3, season: [0.9, 1.0, 1.05, 1.05] },
  { code: "GAMING", name: "Gaming", free: false, multiple: 7, season: [0.95, 0.9, 1.0, 1.15] },
  { code: "FITNESS", name: "Fitness", free: false, multiple: 4, season: [1.2, 1.0, 0.9, 0.9] },
  { code: "BEAUTY", name: "Beauty", free: false, multiple: 4, season: [1.0, 1.0, 1.0, 1.0] },
  { code: "EDTECH", name: "EdTech", free: false, multiple: 6, season: [1.05, 0.85, 1.15, 0.95] },
  { code: "SUSTAIN", name: "Sustainability", free: false, multiple: 5, season: [1.0, 1.05, 1.0, 0.95] },
  { code: "TOYS", name: "Toys & Collectibles", free: false, multiple: 3, season: [0.85, 0.9, 1.0, 1.25] },
  { code: "PET", name: "Pet", free: false, multiple: 4, season: [1.0, 1.0, 1.0, 1.0] },
];

export const industryByCode = (code: Industry) =>
  INDUSTRIES.find((i) => i.code === code)!;

// ── Starting state (GDD §4 T1: Cash 25S, Burn 2S/mo) ────────────────────────

export const STARTING_STATS: Stats = {
  cash: 25 * S_UNIT[1],
  revenueAnnual: 0,
  burnMonthly: 2 * S_UNIT[1],
  valuation: 0, // derived on first tick
  grossMarginPt: 55, // INFERRED
  netMarginPt: 0,
  marketSharePt: 0.5, // INFERRED
  brand: 18, // INFERRED
  qual: 52, // INFERRED
  csat: 62, // INFERRED
  churnPt: 10, // %/yr INFERRED
  cwp: 50,
  cacPt: 50,
  ctrPt: 40,
  employees: 0,
  morale: 70,
  energy: 80,
  respect: 10,
  risk: 0,
  tdebt: 0,
  suploy: 0,
  invsent: 0,
  teamloy: 0,
};

// ── Sim knobs ───────────────────────────────────────────────────────────────

/** Quarterly organic growth baseline per stage. A garage compounds; a public company does not. */
const STAGE_GROWTH_BASE: Record<number, number> = {
  1: 0.15,
  2: 0.11,
  3: 0.075,
  4: 0.045,
  5: 0.025,
};

export const KNOBS = {
  /** Fixed monthly cost floor in S at the current stage (matches Burn 2S at start). */
  fixedCostS: 2,
  /** Monthly payroll per employee in S. INFERRED */
  salaryPerEmployeeS: 0.15,
  /** Event surfacing per month tap: P(one event), P(second event). INFERRED */
  pEvent: 0.6,
  pSecondEvent: 0.18,
  /** ±15% luck band (Brand Law 2, verbatim: never flips sign). */
  luckBand: 0.15,
  /** Unmarked rev% modifiers last this many quarters. DECISION KNOB */
  defaultRevDurationQ: 2,
  /**
   * Organic quarterly revenue growth. INFERRED, tuned against
   * scripts/simulate.mjs: the GDD's stage bands expect a company to cross
   * $100K (Startup) within a few years, so the baseline is startup-shaped
   * and quality/brand steer it up or down from there.
   *
   * The baseline decays by stage — a garage compounds fast, a public company
   * cannot. Without this the late game runs away to absurd valuations.
   */
  organicGrowth: (qual: number, brand: number, share: number, stage: number) =>
    (STAGE_GROWTH_BASE[stage] ?? 0.05) +
    (qual - 50) / 400 +
    (brand - 25) / 500 +
    share / 200,
  /**
   * First revenue, annualized in S. The growth model is multiplicative, so the
   * first quarterly tick seeds this floor rather than compounding zero.
   * At St1 that's ~$3K in quarter one — real money, nowhere near solvency.
   */
  seedRevenueS: 12,
  /** Months allowed in the red before Chapter 7 (with warnings). DECISION KNOB */
  redMonthsBeforeDeath: 3,
  /** Valuation floor for pre-revenue companies, in S. INFERRED */
  preRevValuationFloorS: 20,
  /** PERFORM multiplier (GDD §6 verbatim): M = 0.4 + 0.12 × score. */
  performMultiplier: (score: number) => 0.4 + 0.12 * score,
  /** Tutorial pitch floor (the first year cannot be failed). */
  tutorialScoreFloor: 5,
  /** Energy regained on a quiet month. */
  quietMonthEnergy: 3,
  /** Low-energy threshold that impairs judgment (E-LIF-003 trigger). */
  lowEnergy: 25,
} as const;

// ── Perform gate ────────────────────────────────────────────────────────────

export const YEAR_END_MONTH = 12;

// ── Rookie Mode glossary (GDD §12, verbatim rookie lines) ───────────────────

export const GLOSSARY: Record<string, { pro: string; rookie: string }> = {
  cash: { pro: "Liquid money on hand", rookie: "money in the bank right now." },
  revenue: { pro: "Total money from sales", rookie: "everything customers paid you." },
  profit: { pro: "Revenue minus all costs", rookie: "what's actually left over." },
  "gross margin": { pro: "(revenue − COGS) / revenue", rookie: "of each $1 sold, what you keep before rent & salaries." },
  cogs: { pro: "Direct cost of making the product", rookie: "what one unit costs you to make." },
  "net margin": { pro: "Profit / revenue", rookie: "of each $1, what you truly keep after everything." },
  "burn rate": { pro: "Net cash lost per month", rookie: "how fast the bank account shrinks." },
  runway: { pro: "Cash ÷ burn", rookie: "months left before $0." },
  "break-even": { pro: "Revenue = costs", rookie: "the point where you stop losing money." },
  "cash flow": { pro: "Money in vs out over time", rookie: "the rhythm of money moving, not just the total." },
  valuation: { pro: "Market value of the company", rookie: "the price tag on the whole company." },
  equity: { pro: "Ownership share", rookie: "a slice of the company pie." },
  dilution: { pro: "Your % shrinking when new shares are issued", rookie: "your slice gets thinner when you sell new slices." },
  "term sheet": { pro: "Investment offer document", rookie: "the deal, in writing." },
  "cap table": { pro: "Who owns what", rookie: "the list of everyone's slices." },
  "down round": { pro: "Raising at a lower valuation", rookie: "new money that says you're worth LESS than before. Ouch." },
  ipo: { pro: "Selling shares to the public", rookie: "your company hits the stock market." },
  "chapter 7": { pro: "Liquidation bankruptcy", rookie: "the company dies and its stuff gets sold off." },
  cac: { pro: "Cost to acquire a customer", rookie: "ad money spent per new customer won." },
  ltv: { pro: "Lifetime value", rookie: "total money one customer ever gives you." },
  "ltv:cac": { pro: "The ratio that decides marketing sanity", rookie: "earn more per customer than they cost, ideally 3×." },
  churn: { pro: "% of customers leaving per period", rookie: "the leak in your bucket." },
  ctr: { pro: "Clicks ÷ views on an ad", rookie: "of 100 who see it, how many click." },
  cwp: { pro: "Willingness to pay", rookie: "the most someone would pay before walking." },
  "market share": { pro: "Your % of the category", rookie: "your slice of everyone buying this thing." },
  tam: { pro: "Total addressable market — the whole category in dollars", rookie: "if every possible customer bought, that's the pot." },
  sam: { pro: "Serviceable addressable market — the slice you could realistically reach", rookie: "the part of the pot a company like yours can actually go after." },
  franchise: { pro: "Licensing your model", rookie: "letting others open your store and pay you for it." },
  "m&a": { pro: "Mergers & acquisitions", rookie: "companies buying companies." },
  roi: { pro: "Return ÷ investment", rookie: "what you got back for what you put in." },
  batna: { pro: "Best alternative to a negotiated agreement", rookie: "your walk-away plan — the source of your power." },
  "tech debt": { pro: "Shortcuts that cost later", rookie: "duct tape you'll pay to remove." },
  payroll: { pro: "Total salaries", rookie: "what your team costs." },
  anchoring: { pro: "First number sets the negotiation", rookie: "whoever says a number first bends the whole deal toward it." },
};
