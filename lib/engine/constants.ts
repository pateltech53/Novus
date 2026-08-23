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
  /**
   * Does this company's growth run through another company's phone?
   *
   * ── What it decides ────────────────────────────────────────────────────
   *
   * Whether The Room and the trade index exist at all for this industry. It
   * is not a difficulty setting and it is not a second paywall: it is the
   * answer to "would this founder ever cold call anybody?"
   *
   * A cold call is how you reach a BUSINESS you want to sell to, supply,
   * license to or raise from. It is not how you reach a walk-in customer. A
   * fast-food owner grows by being on the right corner and getting the queue
   * moving; there is nobody to ring. Handing them a phone full of buyers
   * would teach the wrong lesson about their own business — and, worse, put a
   * Pro upsell on a mechanic they should never want.
   *
   * ── How each answer was arrived at ─────────────────────────────────────
   *
   * Read off what the industry's own lens in lib/engine/industries/ already
   * models, not off taste. Where the lens has a business on the other side of
   * a transaction, the phone is real:
   *
   *   TECH      `enterprise` product tag and an `enterprise_ready` flag
   *   CONTENT   sponsors, and a `sponsor_heavy` flag — creators pitch brands
   *   TOYS      licensing royalties, wholesale and closeout buyers
   *   EDTECH    `district_contract` — the buyer is a school district
   *   SUSTAIN   retailers and buyers
   *   FASHION   wholesale buyers
   *   BEAUTY    retailers and buyers
   *   PET       clinics and retail buyers
   *   GAMING    publishers, studios, platform distribution
   *
   * And where the lens's only businesses are INBOUND — people it buys from —
   * or where it sells to individuals, it is not:
   *
   *   FOOD      twelve mentions of `supplier`, every one of them a purchase
   *             (`lock_supplier`, `food-change-supplier`). Sells to the queue.
   *   ECOM      supplier inbound; D2C goods sold to shoppers
   *   FITNESS   members, referrals, satisfaction — sells memberships
   *
   * Two of the four FREE industries keep it, so a free player can still find
   * out the mechanic exists. That is deliberate: an industry gate that also
   * hid the feature from every free player would be a paywall wearing a
   * different hat.
   */
  sellsToBusinesses: boolean;
}[] = [
  // prettier-ignore-start
  { code: "FOOD",    name: "Food & Beverage",      free: true,  multiple: 2, season: [0.95, 1.0, 1.0, 1.05],  sellsToBusinesses: false },
  { code: "ECOM",    name: "E-commerce / Retail",  free: true,  multiple: 3, season: [0.9, 0.95, 1.0, 1.15],  sellsToBusinesses: false },
  { code: "TECH",    name: "Tech App",             free: true,  multiple: 8, season: [1.0, 1.0, 1.0, 1.0],    sellsToBusinesses: true },
  { code: "CONTENT", name: "Content / Creator",    free: true,  multiple: 5, season: [1.0, 0.95, 1.0, 1.05],  sellsToBusinesses: true },
  { code: "FASHION", name: "Fashion / Streetwear", free: false, multiple: 3, season: [0.9, 1.0, 1.05, 1.05],  sellsToBusinesses: true },
  { code: "GAMING",  name: "Gaming",               free: false, multiple: 7, season: [0.95, 0.9, 1.0, 1.15],  sellsToBusinesses: true },
  { code: "FITNESS", name: "Fitness",              free: false, multiple: 4, season: [1.2, 1.0, 0.9, 0.9],    sellsToBusinesses: false },
  { code: "BEAUTY",  name: "Beauty",               free: false, multiple: 4, season: [1.0, 1.0, 1.0, 1.0],    sellsToBusinesses: true },
  { code: "EDTECH",  name: "EdTech",               free: false, multiple: 6, season: [1.05, 0.85, 1.15, 0.95], sellsToBusinesses: true },
  { code: "SUSTAIN", name: "Sustainability",       free: false, multiple: 5, season: [1.0, 1.05, 1.0, 0.95],  sellsToBusinesses: true },
  { code: "TOYS",    name: "Toys & Collectibles",  free: false, multiple: 3, season: [0.85, 0.9, 1.0, 1.25],  sellsToBusinesses: true },
  { code: "PET",     name: "Pet",                  free: false, multiple: 4, season: [1.0, 1.0, 1.0, 1.0],    sellsToBusinesses: true },
  // prettier-ignore-end
];

/**
 * Whether this company would ever pick up a phone to another business.
 *
 * The one place the question is asked. Everything that offers The Room — the
 * activity row, the phone's app grid, the trade index, the dialler — goes
 * through here, so a change to the table above reaches all four at once.
 */
export const sellsToBusinesses = (code: Industry): boolean =>
  industryByCode(code).sellsToBusinesses;

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

/**
 * The last year whose close REQUIRES facing The Tank. Years 1–3 teach the
 * loop — pitch, defend, price — and cannot be closed without it. From year 4
 * the pitch is a choice: skipping closes the books at a neutral 1.0× with no
 * deal, so the Tank is upside a veteran opts into rather than a toll. The
 * replay verifier enforces the same line, so a tape cannot skip year one.
 */
export const TANK_REQUIRED_THROUGH_YEAR = 3;

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
