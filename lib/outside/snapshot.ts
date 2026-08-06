import type { Industry, RunState } from "@/lib/engine/types";
import type { IslandSummary } from "@/lib/engine/save";
import { INDUSTRIES, STAGE_NAME } from "@/lib/engine/constants";
import { previousValue } from "@/lib/engine/ledger";
import { fmtDelta, fmtMoney, monthBadge } from "@/lib/engine/format";
import {
  minuteOf,
  positionValue,
  tickerBySymbol,
  type StockPosition,
} from "@/lib/engine/market";

/**
 * The company as the phone sees it when the app is shut.
 *
 * A widget and a Live Activity run in a different process from the game. They
 * cannot call the engine, they cannot read `localStorage`, and they get no
 * chance to ask a follow-up question — whatever is in this object at publish
 * time is the whole of what the lock screen knows until the next publish. So
 * this file is the entire contract, and it is built from the engine rather
 * than beside it.
 *
 * ── Why every figure carries its own text ──────────────────────────────────
 *
 * `fmtMoney` is the app's answer to "what does $12,400 look like" — 12.4K,
 * with a U+2212 for a minus and a trim rule for the decimal. Re-deriving that
 * in Swift would put a second implementation of a *display rule* on the other
 * side of a bridge, and the two would disagree the first time either changed.
 *
 * So each figure ships as a pair: the raw number, which is what a gauge or a
 * meter needs, and the exact string the app itself would print, which is what
 * the widget renders. Swift formats nothing that has a name here.
 *
 * ── What is deliberately absent ────────────────────────────────────────────
 *
 * The log, the roster, the portfolio, the decisions. None of them fit on a
 * lock screen, all of them are large, and every byte here is written to a
 * shared container on every tap that moves time.
 */

/** Wire format version. Native refuses a snapshot it does not recognise. */
export const OUTSIDE_VERSION = 1 as const;

/** How the app colours a change. Solvency green, alert red, or neither. */
export type OutsideTone = "up" | "down" | "flat";

/**
 * One number, twice: as a quantity and as the app's own rendering of it.
 *
 * `deltaText` is null rather than "+$0" when there is no history to compare
 * against — the ledger draws that distinction deliberately (see
 * `previousValue`) and flattening it here would make a fresh company look
 * like a stalled one.
 */
export interface OutsideFigure {
  value: number;
  text: string;
  deltaText: string | null;
  /** Already resolved for the direction that is GOOD: cash up is `up`, burn up is `down`. */
  deltaTone: OutsideTone | null;
}

/**
 * One of the five stats the game actually steers by.
 *
 * ── Why these five and not the other fourteen ──────────────────────────────
 *
 * They are not a selection. `weakestCategory()` in lib/engine/events.ts — the
 * function that decides which category of event to aim at a player next —
 * reads exactly this list: morale, qual, brand, csat, energy. Everything else
 * in `Stats` is either money, derived, or hidden.
 *
 * So a widget showing these is not a dashboard somebody assembled. It is the
 * same five numbers the engine is looking at when it picks what happens to you
 * next month, which is the only reason they are worth a lock screen.
 */
export interface OutsideScore {
  /** "BRAND". The app's own label, as `StatRings` prints it. */
  label: string;
  /** 0–100, rounded the way the rings round it. */
  value: number;
  /** SF Symbol. */
  symbol: string;
  /**
   * The event category the engine aims at this stat — MKT, PRD, PPL, CUS, LIF.
   * Not drawn anywhere yet; it is here because the pairing IS the reason the
   * five are on the card, and a reader of the wire format should be able to see
   * that without opening events.ts.
   */
  category: string;
}

export interface OutsideCompany {
  slot: number;
  runId: string;
  name: string;
  founder: string;
  industry: Industry;
  industryName: string;
  /** SF Symbol, chosen here for the same reason `NativeTab.symbol` is. */
  symbol: string;
  stage: number;
  stageName: string;
  year: number;
  /** 1..12. */
  month: number;
  /**
   * Month 12. The year does not close without a scored camera performance
   * (Brand Law 1), so this is not "nearly done" — it is a different state,
   * and every surface outside the app draws it in prestige gold.
   */
  atGate: boolean;
  alive: boolean;
  endedBy: string | null;
  /** "MAY → JUN", or "DEC → FY4" at the gate. The app's own capsule, verbatim. */
  badge: string;
  /** The same, spoken. An arrow is a picture; VoiceOver reads it as nothing. */
  badgeLabel: string;

  cash: OutsideFigure;
  burn: OutsideFigure;
  valuation: OutsideFigure;

  /**
   * Brand, Quality, Morale, CSAT, Energy — in that order, always all five.
   *
   * Order is fixed rather than sorted so a widget drawing the first three gets
   * `StatRings`' own trio every time: the three levers a founder actually
   * steers, and the ones most events move.
   */
  scores: OutsideScore[];
  /**
   * Which of them is lowest — the one the engine is about to aim events at.
   * An index rather than a copy, so there is one score object per stat and no
   * way for the two to disagree.
   */
  weakestIndex: number;
  /**
   * The weakest score is under 45.
   *
   * Not a number chosen for a widget: 45 is the line `weakestCategory()` draws
   * in lib/engine/events.ts, below which the draw starts biasing toward that
   * stat's category. Above it the game is not aiming at you; below it, it is.
   * Sent from here rather than compared in Swift so the constant lives once.
   */
  underPressure: boolean;

  employees: number;
  equityPct: number;
  peakValuationText: string;
}

/** One held ticker, with everything the extension needs to price it itself. */
export interface OutsidePosition {
  symbol: string;
  name: string;
  shares: number;
  avgCost: number;
  /** The ticker's own constants, so the extension never carries a second copy. */
  base: number;
  drift: number;
  vol: number;
  /** Market value at `minute`, dollars, as the engine computes it. */
  value: number;
  /** Unrealised gain or loss at `minute`, dollars. */
  unrealised: number;
}

/**
 * RobinGhood, which runs on the player's real clock rather than the fiscal one.
 *
 * Prices are a pure function of (ticker, minute-since-epoch) — see
 * lib/engine/market.ts — which is the only reason a Live Activity can keep
 * moving while the app is shut. The extension re-derives them from the
 * constants above; `value`, `unrealised` and `minute` are the engine's own
 * answer at publish time, and the extension treats them as the anchor it must
 * agree with. See ios/App/Shared/MarketMath.swift for the other half.
 */
export interface OutsideMarket {
  positions: OutsidePosition[];
  /** Money moved out of the company and not yet spent, dollars. */
  brokerageCash: number;
  value: number;
  cost: number;
  unrealised: number;
  /** Minutes since epoch — the clock both sides price against. */
  minute: number;
}

export interface OutsideIsland {
  slot: number;
  name: string;
  industry: Industry;
  symbol: string;
  year: number;
  alive: boolean;
  endedBy: string | null;
  valuation: number;
  valuationText: string;
  peak: number;
  peakText: string;
}

export interface OutsideSnapshot {
  v: typeof OUTSIDE_VERSION;
  /** Null when no company is open — the widgets draw their empty state. */
  company: OutsideCompany | null;
  /** Null when the player holds nothing. No positions, no activity. */
  market: OutsideMarket | null;
  /** Every company on this device, for the Still Standing widget. */
  islands: OutsideIsland[];
  /**
   * The player's switch for Live Activities, and only for those. A widget is
   * on the home screen because somebody put it there; a Live Activity puts
   * itself on a lock screen, so it asks first.
   */
  liveActivities: boolean;
  /** Device clock, epoch ms. For "as of", never for conflict resolution. */
  at: number;
}

// ── Iconography ─────────────────────────────────────────────────────────────

/**
 * One SF Symbol per industry, unfilled to match the chrome in
 * components/native/usePlayChrome.ts. Chosen here rather than in Swift for the
 * same reason `NativeTab.symbol` is: the web layer describes what it wants and
 * native draws it.
 */
const INDUSTRY_SYMBOL: Record<Industry, string> = {
  FOOD: "fork.knife",
  ECOM: "shippingbox",
  TECH: "cpu",
  CONTENT: "video",
  FASHION: "tshirt",
  GAMING: "gamecontroller",
  FITNESS: "figure.run",
  BEAUTY: "sparkles",
  EDTECH: "graduationcap",
  SUSTAIN: "leaf",
  TOYS: "teddybear",
  PET: "pawprint",
};

export const industrySymbol = (code: Industry): string =>
  INDUSTRY_SYMBOL[code] ?? "building.2";

const industryName = (code: Industry): string =>
  INDUSTRIES.find((i) => i.code === code)?.name ?? code;

// ── The five ────────────────────────────────────────────────────────────────

/**
 * The stats the engine aims at, their labels, their symbols and the category
 * each one is attacked through.
 *
 * The order is `StatRings`' first: Brand, Quality, Morale are the three the
 * masthead draws and the three a widget with room for three should show. CSAT
 * and Energy follow, so a surface with room for five gets the whole set the
 * draw is actually reading.
 *
 * The category tags are lifted from `weakestCategory()` in
 * lib/engine/events.ts. If a stat is ever added to or removed from that
 * function, this list is the other half of the change.
 */
const SCORES: {
  key: "brand" | "qual" | "morale" | "csat" | "energy";
  label: string;
  symbol: string;
  category: string;
}[] = [
  { key: "brand", label: "BRAND", symbol: "megaphone", category: "MKT" },
  { key: "qual", label: "QUALITY", symbol: "checkmark.seal", category: "PRD" },
  { key: "morale", label: "MORALE", symbol: "person.2", category: "PPL" },
  { key: "csat", label: "CSAT", symbol: "heart", category: "CUS" },
  { key: "energy", label: "ENERGY", symbol: "bolt", category: "LIF" },
];

/**
 * Below this the engine starts aiming events at your weakest stat.
 *
 * Copied from `weakestCategory()` rather than imported, because that function
 * is private to a protected file (docs/DO-NOT-TOUCH §"Protected files") and
 * exporting the constant would be a change to `lib/engine/events.ts` for the
 * benefit of a widget. The comment above `underPressure` says where it comes
 * from; the pair is checked by nothing, which is exactly why it is written
 * down twice rather than inferred once.
 */
const PRESSURE_LINE = 45;

// ── Figures ─────────────────────────────────────────────────────────────────

/**
 * A money figure and its month-over-month change.
 *
 * `goodDirection` is what makes the tone honest without Swift knowing anything
 * about the game: cash rising is solvency, burn rising is damage, and both
 * arrive here as a plain number that went up.
 */
function moneyFigure(
  value: number,
  previous: number | null,
  goodDirection: 1 | -1,
): OutsideFigure {
  const change = previous === null ? null : value - previous;
  return {
    value,
    text: fmtMoney(value),
    deltaText: change === null || change === 0 ? null : fmtDelta(change),
    deltaTone: change === null ? null : tone(change * goodDirection),
  };
}

const tone = (n: number): OutsideTone => (n > 0 ? "up" : n < 0 ? "down" : "flat");

/** The five, in `StatRings`' order, rounded the way the rings round them. */
function scoresOf(stats: RunState["stats"]): OutsideScore[] {
  return SCORES.map((s) => ({
    label: s.label,
    value: Math.round(Math.max(0, Math.min(100, stats[s.key]))),
    symbol: s.symbol,
    category: s.category,
  }));
}

// ── The company ─────────────────────────────────────────────────────────────

/**
 * Build the company half of a snapshot.
 *
 * `slot` is passed rather than read, because `activeIsland()` answers "which
 * company is the picker pointing at" and the caller already knows which one it
 * is actually holding — and those two are briefly different every time a
 * player switches islands.
 */
export function companySnapshot(run: RunState, slot: number): OutsideCompany {
  const stats = run.stats;
  const atGate = run.month >= 12;

  const scores = scoresOf(stats);
  // `reduce` rather than a sort: the order of `scores` is load-bearing (a
  // widget with room for three draws the first three) and sorting a copy to
  // find one index is a second array for no reason. Ties keep the earlier
  // entry, which matches `weakestCategory()`'s stable sort.
  const weakestIndex = scores.reduce(
    (low, s, i) => (s.value < scores[low].value ? i : low),
    0,
  );

  return {
    slot,
    runId: run.id,
    name: run.companyName,
    founder: run.founderName,
    industry: run.industry,
    industryName: industryName(run.industry),
    symbol: industrySymbol(run.industry),
    stage: run.stage,
    stageName: STAGE_NAME[run.stage] ?? `Stage ${run.stage}`,
    year: run.year,
    month: run.month,
    atGate,
    alive: run.alive,
    endedBy: run.endedBy ?? null,
    badge: monthBadge(run.month, run.year, atGate),
    badgeLabel: `${run.companyName}. Fiscal year ${run.year}.`,

    cash: moneyFigure(stats.cash, previousValue(run, "c"), 1),
    // Burn is a cost, so a bigger number is a worse month. The engine reports
    // a negative burn for a profitable company and the sign carries through
    // untouched — "−$4.1K a month" is the company making money, and it should
    // read as exactly that rather than as a formatting accident.
    burn: moneyFigure(stats.burnMonthly, previousValue(run, "b"), -1),
    valuation: moneyFigure(stats.valuation, previousValue(run, "v"), 1),

    scores,
    weakestIndex,
    underPressure: scores[weakestIndex].value < PRESSURE_LINE,

    employees: stats.employees,
    equityPct: Math.round(run.founderEquityPct),
    peakValuationText: fmtMoney(Math.max(run.peakValuation ?? 0, stats.valuation)),

  };
}

// ── RobinGhood ──────────────────────────────────────────────────────────────

/**
 * Null when the player holds nothing, which is the common case and the reason
 * this is a separate object rather than an empty array inside the company: a
 * position activity that exists with nothing in it is a lock screen row that
 * says zero all day.
 */
export function marketSnapshot(
  positions: StockPosition[],
  brokerageCash: number,
  minute = minuteOf(),
): OutsideMarket | null {
  const held = positions.filter((p) => p.shares > 0);
  if (held.length === 0) return null;

  const rows: OutsidePosition[] = [];
  for (const pos of held) {
    const ticker = tickerBySymbol(pos.symbol);
    // A position in a ticker the table no longer has is not something to
    // guess a price for. It stays in the save and off the lock screen.
    if (!ticker) continue;
    const value = positionValue(pos, minute);
    rows.push({
      symbol: ticker.symbol,
      name: ticker.name,
      shares: pos.shares,
      avgCost: pos.avgCost,
      base: ticker.base,
      drift: ticker.drift,
      vol: ticker.vol,
      value,
      unrealised: value - pos.avgCost * pos.shares,
    });
  }
  if (rows.length === 0) return null;

  // Biggest holding first: the Dynamic Island has room for one name and it
  // should be the one the player has the most riding on.
  rows.sort((a, b) => b.value - a.value);

  const value = rows.reduce((sum, r) => sum + r.value, 0);
  const cost = rows.reduce((sum, r) => sum + r.avgCost * r.shares, 0);

  return { positions: rows, brokerageCash, value, cost, unrealised: value - cost, minute };
}

// ── The archipelago ─────────────────────────────────────────────────────────

export function islandSnapshot(island: IslandSummary): OutsideIsland {
  const peak = Math.max(island.peakValuation, island.valuation);
  return {
    slot: island.slot,
    name: island.companyName,
    industry: island.industry,
    symbol: industrySymbol(island.industry),
    year: island.year,
    alive: island.alive,
    // `IslandSummary` types this as nullable OR absent — a summary rebuilt
    // from an older save has neither. One of those two on the wire, never both.
    endedBy: island.endedBy ?? null,
    valuation: island.valuation,
    valuationText: fmtMoney(island.valuation),
    peak,
    peakText: fmtMoney(peak),
  };
}

/** How many companies the Still Standing widget can draw before it truncates. */
export const OUTSIDE_ISLAND_LIMIT = 6;

// ── The whole thing ─────────────────────────────────────────────────────────

export function buildSnapshot(input: {
  run: RunState | null;
  slot: number;
  islands: IslandSummary[];
  liveActivities: boolean;
  now?: number;
}): OutsideSnapshot {
  const { run, slot, islands, liveActivities } = input;
  return {
    v: OUTSIDE_VERSION,
    company: run ? companySnapshot(run, slot) : null,
    market: run ? marketSnapshot(run.positions ?? [], run.brokerageCash ?? 0) : null,
    islands: islands
      // The picker's order is by slot; a widget with room for six should show
      // the six worth showing, so this one is by what the company got to.
      .slice()
      .sort((a, b) => Math.max(b.peakValuation, b.valuation) - Math.max(a.peakValuation, a.valuation))
      .slice(0, OUTSIDE_ISLAND_LIMIT)
      .map(islandSnapshot),
    liveActivities,
    at: input.now ?? Date.now(),
  };
}

/**
 * Whether two snapshots would draw the same lock screen.
 *
 * The publisher is debounced, and a debounce alone still writes on every
 * render that produced an identical object — a shared container write and a
 * `reloadAllTimelines` per keystroke in the company namer, for a widget whose
 * pixels did not move. `at` is excluded because it changes every time by
 * construction and means nothing on its own.
 */
export function sameSnapshot(a: OutsideSnapshot | null, b: OutsideSnapshot): boolean {
  if (!a) return false;
  return JSON.stringify({ ...a, at: 0 }) === JSON.stringify({ ...b, at: 0 });
}
