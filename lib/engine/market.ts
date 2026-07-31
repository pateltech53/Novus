/**
 * RobinGhood — the market runs on the player's real clock.
 *
 * Prices are a PURE FUNCTION of (ticker, minute-since-epoch), so every client
 * shows the same tape at the same wall-clock minute, nothing needs storing, and
 * history can be recomputed backwards for the chart. Only the player's
 * positions are persisted.
 */

import { mulberry32, hashString } from "./rng";

export interface Ticker {
  symbol: string;
  name: string;
  sector: string;
  /** Anchor price in dollars. */
  base: number;
  /** Annualised drift, e.g. 0.12 = +12%/yr trend. */
  drift: number;
  /** Daily volatility. Coins are wild; utilities are not. */
  vol: number;
  crypto?: boolean;
}

export const TICKERS: Ticker[] = [
  { symbol: "NVSX", name: "Novus Index", sector: "Index", base: 148.2, drift: 0.09, vol: 0.9 },
  { symbol: "BRWZ", name: "Brewzo Coffee", sector: "Food & Beverage", base: 34.8, drift: 0.06, vol: 1.4 },
  { symbol: "GLRP", name: "Glorp Logistics", sector: "Industrials", base: 76.5, drift: 0.04, vol: 1.1 },
  { symbol: "PIXL", name: "Pixlfoundry", sector: "Tech", base: 212.4, drift: 0.18, vol: 2.2 },
  { symbol: "MRCO", name: "Marco Holdings", sector: "Rival", base: 58.9, drift: 0.11, vol: 1.8 },
  { symbol: "FINN", name: "FinnCoin", sector: "Crypto", base: 6.42, drift: 0.2, vol: 5.5, crypto: true },
];

export const tickerBySymbol = (s: string) => TICKERS.find((t) => t.symbol === s);

const MINUTE_MS = 60_000;
export const minuteOf = (date: Date | number = Date.now()) =>
  Math.floor((typeof date === "number" ? date : date.getTime()) / MINUTE_MS);

/**
 * Deterministic price for a ticker at a given minute. Layered so the tape looks
 * alive at every zoom: a slow trend, a session wave, and seeded minute noise.
 */
export function priceAt(ticker: Ticker, minute: number): number {
  const dayIndex = Math.floor(minute / 1440);
  const minuteOfDay = minute - dayIndex * 1440;

  // Long trend: drift applied per day.
  const trend = Math.pow(1 + ticker.drift / 365, dayIndex % 3650);

  // Session shape — a slow intraday wave, unique per ticker.
  const phase = hashString(ticker.symbol) % 1000;
  const session =
    1 +
    (ticker.vol / 100) *
      (Math.sin((minuteOfDay / 1440) * Math.PI * 2 + phase) * 0.6 +
        Math.sin((minuteOfDay / 1440) * Math.PI * 6 + phase) * 0.25);

  // Day-to-day gap: a seeded jump each day.
  const dayRng = mulberry32(hashString(`${ticker.symbol}:${dayIndex}`));
  const gap = 1 + (dayRng() - 0.5) * (ticker.vol / 45);

  // Minute noise, seeded so the tape is stable on reload.
  const minRng = mulberry32(hashString(`${ticker.symbol}:${minute}`));
  const noise = 1 + (minRng() - 0.5) * (ticker.vol / 260);

  return Math.max(0.01, ticker.base * trend * session * gap * noise);
}

export interface Quote {
  ticker: Ticker;
  price: number;
  /** Change vs the same ticker 1440 minutes (24h) ago. */
  changePct: number;
  changeAbs: number;
}

export function quote(ticker: Ticker, minute = minuteOf()): Quote {
  const price = priceAt(ticker, minute);
  const prior = priceAt(ticker, minute - 1440);
  return {
    ticker,
    price,
    changeAbs: price - prior,
    changePct: prior > 0 ? ((price - prior) / prior) * 100 : 0,
  };
}

export function quotes(minute = minuteOf()): Quote[] {
  return TICKERS.map((t) => quote(t, minute));
}

/** Price history for the chart: `points` samples spaced `stepMinutes` apart. */
export function history(ticker: Ticker, points = 48, stepMinutes = 30, minute = minuteOf()) {
  const out: { minute: number; price: number }[] = [];
  for (let i = points - 1; i >= 0; i--) {
    const m = minute - i * stepMinutes;
    out.push({ minute: m, price: priceAt(ticker, m) });
  }
  return out;
}

// ── The news desk ───────────────────────────────────────────────────────────

export interface NewsItem {
  id: string;
  symbol: string;
  headline: string;
  body: string;
  /** What the desk thinks happens next. Deliberately fallible. */
  prediction: string;
  tone: "up" | "down" | "flat";
  minute: number;
}

const UP_REASONS = [
  {
    h: "{name} beats on margin, and the street noticed",
    b: "Gross margin came in {pct} above the last print. Management credited a supplier renegotiation nobody had modelled.",
    p: "The desk expects the move to hold if next quarter's margin repeats. One good quarter is a data point, not a trend.",
  },
  {
    h: "An analyst upgrade lifts {name}",
    b: "A mid-tier bank moved {symbol} to buy, citing pricing power. Volume tripled inside an hour.",
    p: "Upgrades fade fast. Expect give-back unless earnings support the new price.",
  },
  {
    h: "{name} lands a distribution deal",
    b: "A national account signed. It adds real revenue and a customer-concentration risk nobody is pricing yet.",
    p: "Watch the concentration. One customer at this size cuts both ways.",
  },
  {
    h: "Short interest unwinds in {name}",
    b: "Sellers covered into strength, which mechanically amplified a {pct} move.",
    p: "Squeezes are not demand. The desk expects this to mean-revert.",
  },
];

const DOWN_REASONS = [
  {
    h: "{name} guides down, and the tape agrees",
    b: "Management trimmed the outlook {pct}. The phrase 'near-term headwinds' appeared four times.",
    p: "Guide-downs cluster. The desk expects a second cut before a recovery.",
  },
  {
    h: "A supply problem hits {name}",
    b: "A key input got more expensive overnight. Margin absorbs it or customers do — neither is free.",
    p: "If they pass it to customers, watch churn. If they eat it, watch margin.",
  },
  {
    h: "{name} loses a large customer",
    b: "The account was {pct} of revenue and left for a cheaper contract. Retention was the quiet risk all along.",
    p: "Recovery depends on replacing revenue, not cutting costs. Cost cuts buy time, not growth.",
  },
  {
    h: "Regulatory noise around {name}",
    b: "A filing raised a compliance question. Nothing proven, and the market rarely waits for proof.",
    p: "Headline risk. If the filing resolves quietly, this reverses.",
  },
];

const FLAT_REASONS = [
  {
    h: "{name} trades sideways",
    b: "No news, no volume, no conviction. The price moved {pct} and nobody could tell you why.",
    p: "Quiet tape. The desk expects direction to come from the next earnings print, not from here.",
  },
];

/**
 * News is derived from the actual price action, so the story always matches the
 * tape. Seeded per ticker-day: everyone reading at the same time reads the same
 * paper.
 */
export function news(minute = minuteOf(), limit = 6): NewsItem[] {
  const items: NewsItem[] = [];
  const dayIndex = Math.floor(minute / 1440);

  for (const ticker of TICKERS) {
    const q = quote(ticker, minute);
    const tone: NewsItem["tone"] =
      q.changePct > 1.2 ? "up" : q.changePct < -1.2 ? "down" : "flat";
    const bank = tone === "up" ? UP_REASONS : tone === "down" ? DOWN_REASONS : FLAT_REASONS;
    const rng = mulberry32(hashString(`${ticker.symbol}:news:${dayIndex}`));
    const pick = bank[Math.floor(rng() * bank.length) % bank.length];
    const pct = `${Math.abs(q.changePct).toFixed(1)}%`;

    items.push({
      id: `${ticker.symbol}-${dayIndex}`,
      symbol: ticker.symbol,
      headline: pick.h.replaceAll("{name}", ticker.name).replaceAll("{symbol}", ticker.symbol),
      body: pick.b
        .replaceAll("{name}", ticker.name)
        .replaceAll("{symbol}", ticker.symbol)
        .replaceAll("{pct}", pct),
      prediction: pick.p,
      tone,
      minute,
    });
  }

  // Biggest movers lead the page.
  return items
    .sort((a, b) => {
      const qa = Math.abs(quote(tickerBySymbol(a.symbol)!, minute).changePct);
      const qb = Math.abs(quote(tickerBySymbol(b.symbol)!, minute).changePct);
      return qb - qa;
    })
    .slice(0, limit);
}

// ── Positions ───────────────────────────────────────────────────────────────

export interface StockPosition {
  symbol: string;
  shares: number;
  /** Average cost per share, in dollars. */
  avgCost: number;
}

export function positionValue(pos: StockPosition, minute = minuteOf()): number {
  const t = tickerBySymbol(pos.symbol);
  if (!t) return 0;
  return priceAt(t, minute) * pos.shares;
}

export function portfolioValue(positions: StockPosition[], minute = minuteOf()): number {
  return positions.reduce((sum, p) => sum + positionValue(p, minute), 0);
}

export function unrealised(pos: StockPosition, minute = minuteOf()): number {
  return positionValue(pos, minute) - pos.avgCost * pos.shares;
}
