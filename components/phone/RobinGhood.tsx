"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { useGame } from "@/lib/state/GameProvider";
import {
  TICKERS,
  history,
  minuteOf,
  news,
  portfolioValue,
  priceAt,
  quote,
  quotes,
  tickerBySymbol,
  unrealised,
  type Quote,
  type StockPosition,
} from "@/lib/engine/market";
import { Glass } from "@/components/ui/Glass";

/**
 * RobinGhood — the brokerage app on the founder's phone.
 *
 * The whole point of this screen is that it runs on the player's REAL clock:
 * market.ts derives every price from (ticker, minute-since-epoch), so the tape
 * genuinely moves while the phone is open and nothing has to be stored. We only
 * have to keep asking what minute it is.
 *
 * Deliberately NOT gated by Pro. Brand Law 4 says Pro is content only and can
 * never improve an outcome — and every ticker here is tradeable money, so
 * locking one behind a paywall would hand paying players a better P/L. TICKERS
 * carries no `pro` flag for exactly that reason. Cosmetics live elsewhere.
 */

/** Solvency green and alert red, darkened for legibility on white surfaces. */
const UP = "var(--solvency)";
const DOWN = "var(--alert)";

/** How often we re-read the clock. Fast enough to feel live, cheap enough to ignore. */
const TICK_MS = 15_000;

type Tab = "portfolio" | "market" | "news";

const TABS: { id: Tab; label: string }[] = [
  { id: "portfolio", label: "PORTFOLIO" },
  { id: "market", label: "MARKET" },
  { id: "news", label: "NEWS" },
];

export function RobinGhood({
  onBuy,
  onSell,
  onTransfer,
}: {
  onBuy: (symbol: string, shares: number) => void;
  onSell: (symbol: string, shares: number) => void;
  onTransfer: (amountUsd: number) => void;
}) {
  const { run } = useGame();
  const [tab, setTab] = useState<Tab>("portfolio");
  /** Symbol of the open detail view, or null for the list. */
  const [detail, setDetail] = useState<string | null>(null);
  /**
   * Null until mount. The server has no idea what minute it is on the player's
   * clock, so rendering a price during SSR would guarantee a hydration mismatch.
   */
  const [minute, setMinute] = useState<number | null>(null);

  useEffect(() => {
    setMinute(minuteOf());
    const id = window.setInterval(() => setMinute(minuteOf()), TICK_MS);
    return () => window.clearInterval(id);
  }, []);

  const openDetail = (symbol: string) => setDetail(symbol);
  const closeDetail = () => setDetail(null);

  if (!run) return null;

  return (
    <div className="flex h-full min-h-0 w-full flex-col bg-[var(--bg)]">
      {/*
        Inside the scroller, not above it.

        It was a `shrink-0` sibling of the list, which is a bar that reserves
        its own height — nothing ever passed beneath it, so making it glass
        would have refracted a flat colour and looked like a tinted rectangle.
        Pinned inside the scroll container instead, the tape genuinely travels
        under it, which is the thing the material is for and the clause
        design.md allows a header glass under.
      */}
      <div className="min-h-0 flex-1 overflow-y-auto pb-[max(1.25rem,env(safe-area-inset-bottom))]">
        <Glass as="header" className="sticky top-0 z-10 px-4 pt-4 pb-3">
          <div className="flex items-end justify-between gap-3">
            <h1 className="min-w-0 truncate text-xl font-extrabold tracking-[-0.02em]">
              RobinGhood
            </h1>
            <p className="tnum shrink-0 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              {minute === null ? "TAPE" : `TAPE · ${clockOf(minute)}`}
            </p>
          </div>
          <p className="mt-1 text-xs leading-snug text-[var(--text-secondary)]">
            Real minutes, real prices. The tape moves whether you are watching or not.
          </p>

          <div
            role="tablist"
            aria-label="RobinGhood sections"
            className="mt-3 flex gap-1 rounded-[var(--radius-pill)] bg-[var(--chip)] p-1"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => {
                  setTab(t.id);
                  closeDetail();
                }}
                className={`min-w-0 flex-1 truncate rounded-[var(--radius-pill)] px-2 py-2 text-2xs font-bold tracking-[0.12em] transition-colors duration-150 ${
                  tab === t.id
                    ? "bg-[var(--card)] text-[var(--text)] shadow-[var(--e1)]"
                    : "text-[var(--text-secondary)]"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </Glass>

        <div className="px-3 pt-3">
          {minute === null ? (
            <p className="px-2 pt-6 text-sm text-[var(--text-secondary)]">Reading the tape…</p>
          ) : detail ? (
            <TickerDetail
              symbol={detail}
              minute={minute}
              positions={run.positions}
              buyingPower={run.brokerageCash}
              onBack={closeDetail}
              onBuy={onBuy}
              onSell={onSell}
            />
          ) : tab === "portfolio" ? (
            <PortfolioTab
              minute={minute}
              positions={run.positions}
              buyingPower={run.brokerageCash}
              companyCash={run.stats.cash}
              onOpen={openDetail}
              onTransfer={onTransfer}
            />
          ) : tab === "market" ? (
            <MarketTab minute={minute} onOpen={openDetail} />
          ) : (
            <NewsTab minute={minute} onOpen={openDetail} />
          )}
        </div>
      </div>
    </div>
  );
}

// ── Portfolio ───────────────────────────────────────────────────────────────

function PortfolioTab({
  minute,
  positions,
  buyingPower,
  companyCash,
  onOpen,
  onTransfer,
}: {
  minute: number;
  positions: StockPosition[];
  buyingPower: number;
  companyCash: number;
  onOpen: (symbol: string) => void;
  onTransfer: (amountUsd: number) => void;
}) {
  const [transferOpen, setTransferOpen] = useState(false);

  const value = portfolioValue(positions, minute);
  const cost = positions.reduce((s, p) => s + p.avgCost * p.shares, 0);
  const pl = positions.reduce((s, p) => s + unrealised(p, minute), 0);
  const plPct = cost > 0 ? (pl / cost) * 100 : 0;

  // The index is the market's mood ring — it heads the portfolio either way.
  const index = TICKERS[0];
  const series = useMemo(() => history(index, 48, 30, minute), [index, minute]);
  const periodUp = series[series.length - 1].price >= series[0].price;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <Tile label="PORTFOLIO" value={usd(value)} />
        <Tile label="BUYING POWER" value={usd(buyingPower)} />
      </div>

      <div className="nv-card px-4 py-3">
        <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
          UNREALISED P/L
        </p>
        {/* Wraps rather than truncates — a P/L you cannot read is worse than two lines. */}
        <p
          className="tnum mt-0.5 flex flex-wrap items-baseline gap-x-2 text-2xl font-extrabold leading-tight"
          style={{ color: pl === 0 ? undefined : pl > 0 ? UP : DOWN }}
        >
          <span className="min-w-0 truncate">{signedUsd(pl)}</span>
          <span className="text-base font-bold">{signedPct(plPct)}</span>
        </p>
        <p className="mt-1 text-xs leading-snug text-[var(--text-secondary)]">
          Paper money. It is not yours until you sell.
        </p>
      </div>

      <section className="nv-card px-4 py-3.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            {index.symbol} · LAST 24 HOURS
          </p>
          <p
            className="tnum shrink-0 text-xs font-extrabold"
            style={{ color: periodUp ? UP : DOWN }}
          >
            {signedPct(quote(index, minute).changePct)}
          </p>
        </div>
        <LineChart
          data={series}
          up={periodUp}
          height={104}
          label={`${index.name} over the last 24 hours`}
        />
      </section>

      {positions.length === 0 ? (
        <div className="nv-card px-4 py-5">
          <h2 className="text-base font-extrabold tracking-[-0.01em]">
            You own nothing. That is a position too.
          </h2>
          <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">
            Buying power does not appear on its own. It comes out of the
            company&apos;s cash — every dollar you move here is a dollar that is
            no longer paying salaries, and it shortens your runway by exactly
            that much.
          </p>
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            className="mt-4 h-14 w-full rounded-[var(--radius-pill)] bg-[var(--action)] text-sm font-extrabold tracking-[0.06em] text-[var(--n-11)] transition-transform duration-150 active:scale-[0.97]"
          >
            MOVE MONEY IN
          </button>
        </div>
      ) : (
        <>
          <div className="flex items-center justify-between gap-3 px-1 pt-1">
            <h2 className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              POSITIONS
            </h2>
            <button
              type="button"
              onClick={() => setTransferOpen((o) => !o)}
              className="shrink-0 rounded-full bg-[var(--chip)] px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
            >
              {transferOpen ? "CLOSE" : "MOVE MONEY IN"}
            </button>
          </div>
          <ul className="space-y-2">
            {positions.map((pos) => (
              <li key={pos.symbol}>
                <PositionRow pos={pos} minute={minute} onOpen={onOpen} />
              </li>
            ))}
          </ul>
        </>
      )}

      {/* No AnimatePresence anywhere in this app — closed means unmounted. */}
      {transferOpen && (
        <TransferPanel
          companyCash={companyCash}
          onTransfer={(amount) => {
            onTransfer(amount);
            setTransferOpen(false);
          }}
          onCancel={() => setTransferOpen(false)}
        />
      )}
    </div>
  );
}

function PositionRow({
  pos,
  minute,
  onOpen,
}: {
  pos: StockPosition;
  minute: number;
  onOpen: (symbol: string) => void;
}) {
  const ticker = tickerBySymbol(pos.symbol);
  if (!ticker) return null;

  const price = priceAt(ticker, minute);
  const pl = unrealised(pos, minute);
  const basis = pos.avgCost * pos.shares;
  const plPct = basis > 0 ? (pl / basis) * 100 : 0;
  const tone = pl === 0 ? undefined : pl > 0 ? UP : DOWN;

  return (
    <button
      type="button"
      onClick={() => onOpen(pos.symbol)}
      aria-label={`${ticker.name}, ${pos.shares} shares, ${signedUsd(pl)} unrealised`}
      className="nv-card flex w-full items-center gap-3 px-4 py-3 text-left transition-transform duration-150 active:scale-[0.985]"
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-extrabold leading-tight">
          {ticker.symbol}
        </span>
        <span className="block truncate text-xs text-[var(--text-secondary)]">
          {ticker.name}
        </span>
        <span className="tnum mt-0.5 block truncate text-2xs text-[var(--text-tertiary)]">
          {pos.shares} @ {usd(pos.avgCost)} avg
        </span>
      </span>
      <span className="shrink-0 text-right">
        <span className="tnum block text-[0.9375rem] font-extrabold leading-tight">
          {usd(price)}
        </span>
        <span className="tnum block text-xs font-bold" style={{ color: tone }}>
          {signedUsd(pl)}
        </span>
        <span className="tnum block text-2xs" style={{ color: tone }}>
          {signedPct(plPct)}
        </span>
      </span>
    </button>
  );
}

function TransferPanel({
  companyCash,
  onTransfer,
  onCancel,
}: {
  companyCash: number;
  onTransfer: (amountUsd: number) => void;
  onCancel: () => void;
}) {
  // Fractions of company cash, not fixed dollars — a seed round and a Series C
  // do not agree on what "a small transfer" means.
  const options = [0.05, 0.1, 0.25]
    .map((f) => ({ f, amount: roundAmount(companyCash * f) }))
    .filter((o) => o.amount > 0);

  return (
    <section
      aria-label="Move money into the brokerage"
      className="nv-card px-4 py-4"
    >
      <h2 className="text-base font-extrabold tracking-[-0.01em]">
        Move company cash into the market
      </h2>
      <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
        This leaves the company today and comes back only if you sell well.
        Company cash: <span className="tnum font-bold">{usd(companyCash)}</span>.
      </p>

      {options.length === 0 ? (
        <p className="mt-3 text-sm font-semibold" style={{ color: DOWN }}>
          There is nothing to move. The company has no cash to spare.
        </p>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2">
          {options.map((o) => (
            <button
              key={o.f}
              type="button"
              onClick={() => onTransfer(o.amount)}
              className="min-w-0 rounded-[var(--radius-row)] bg-[var(--action)] px-2 py-3 text-center transition-transform duration-150 active:scale-[0.97]"
            >
              <span className="tnum block truncate text-sm font-extrabold text-[var(--n-11)]">
                {usd(o.amount, false)}
              </span>
              <span className="block text-2xs font-bold tracking-[0.08em] text-[var(--n-9)]">
                {Math.round(o.f * 100)}% OF CASH
              </span>
            </button>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="mt-3 block w-full text-xs font-semibold text-[var(--text-secondary)] underline underline-offset-4"
      >
        Leave it in the company
      </button>
    </section>
  );
}

// ── Market ──────────────────────────────────────────────────────────────────

function MarketTab({
  minute,
  onOpen,
}: {
  minute: number;
  onOpen: (symbol: string) => void;
}) {
  const list = useMemo(() => quotes(minute), [minute]);

  return (
    <div className="space-y-2">
      <p className="px-1 pb-1 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
        {list.length} INSTRUMENTS · 24H CHANGE
      </p>
      <ul className="space-y-2">
        {list.map((q) => (
          <li key={q.ticker.symbol}>
            <MarketRow quote={q} minute={minute} onOpen={onOpen} />
          </li>
        ))}
      </ul>
      <p className="px-1 pt-2 text-2xs leading-relaxed text-[var(--text-tertiary)]">
        Crypto is the loudest line on this board on purpose. Volatility is not
        the same thing as return.
      </p>
    </div>
  );
}

function MarketRow({
  quote: q,
  minute,
  onOpen,
}: {
  quote: Quote;
  minute: number;
  onOpen: (symbol: string) => void;
}) {
  const t = q.ticker;
  const spark = useMemo(() => history(t, 24, 60, minute), [t, minute]);
  const up = q.changePct >= 0;

  return (
    <button
      type="button"
      onClick={() => onOpen(t.symbol)}
      aria-label={`${t.name}, ${usd(q.price)}, ${signedPct(q.changePct)} in 24 hours`}
      className="nv-card flex w-full items-center gap-2.5 px-3.5 py-3 text-left transition-transform duration-150 active:scale-[0.985]"
    >
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-[0.9375rem] font-extrabold leading-tight">
            {t.symbol}
          </span>
          {t.crypto && (
            <span className="shrink-0 rounded bg-[var(--chip)] px-1 py-0.5 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)]">
              CRYPTO
            </span>
          )}
        </span>
        <span className="block truncate text-xs text-[var(--text-secondary)]">{t.name}</span>
      </span>

      <Sparkline data={spark} up={up} />

      <span className="w-[4.75rem] shrink-0 text-right">
        <span className="tnum block truncate text-[0.9375rem] font-extrabold leading-tight">
          {usd(q.price)}
        </span>
        <span
          className="tnum block truncate text-xs font-bold"
          style={{ color: up ? UP : DOWN }}
        >
          {signedPct(q.changePct)}
        </span>
      </span>
    </button>
  );
}

// ── Ticker detail ───────────────────────────────────────────────────────────

function TickerDetail({
  symbol,
  minute,
  positions,
  buyingPower,
  onBack,
  onBuy,
  onSell,
}: {
  symbol: string;
  minute: number;
  positions: StockPosition[];
  buyingPower: number;
  onBack: () => void;
  onBuy: (symbol: string, shares: number) => void;
  onSell: (symbol: string, shares: number) => void;
}) {
  const [shares, setShares] = useState(1);
  const ticker = tickerBySymbol(symbol);

  // Chart + story recompute on every tick, which is the whole illusion.
  const series = useMemo(
    () => (ticker ? history(ticker, 60, 24, minute) : []),
    [ticker, minute],
  );
  const story = useMemo(
    () => news(minute, TICKERS.length).find((n) => n.symbol === symbol),
    [minute, symbol],
  );

  if (!ticker) return null;

  const q = quote(ticker, minute);
  const price = q.price;
  const held = positions.find((p) => p.symbol === symbol);
  const owned = held?.shares ?? 0;
  const cost = price * shares;
  const overBy = cost - buyingPower;
  const canBuy = shares > 0 && overBy <= 0;
  const canSell = shares > 0 && shares <= owned;
  const periodUp = series[series.length - 1].price >= series[0].price;
  const maxShares = Math.floor(buyingPower / price);

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={onBack}
        className="rounded-full bg-[var(--chip)] px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
      >
        ← BACK
      </button>

      <section className="nv-card px-4 py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-1.5">
              <h2 className="truncate text-xl font-extrabold tracking-[-0.01em]">
                {ticker.symbol}
              </h2>
              {ticker.crypto && (
                <span className="shrink-0 rounded bg-[var(--chip)] px-1 py-0.5 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)]">
                  CRYPTO
                </span>
              )}
            </div>
            <p className="truncate text-xs text-[var(--text-secondary)]">
              {ticker.name} · {ticker.sector}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <p className="tnum text-xl font-extrabold leading-tight">
              {usd(price)}
            </p>
            <p
              className="tnum text-xs font-bold"
              style={{ color: q.changePct >= 0 ? UP : DOWN }}
            >
              {signedPct(q.changePct)} · 24h
            </p>
          </div>
        </div>

        <LineChart
          data={series}
          up={periodUp}
          height={128}
          label={`${ticker.name} over the last 24 hours`}
        />
      </section>

      {story && (
        <article className="nv-card px-4 py-3.5">
          <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            THE DESK · {toneWord(story.tone)}
          </p>
          <h3 className="mt-1 text-sm font-extrabold leading-snug">
            {story.headline}
          </h3>
          <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
            {story.body}
          </p>
          <p className="mt-2.5 rounded-[var(--radius-row)] bg-[var(--chip)] px-3 py-2 text-xs leading-relaxed text-[var(--text-secondary)]">
            <span className="block text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              THE DESK EXPECTS
            </span>
            {story.prediction}
          </p>
        </article>
      )}

      <section className="nv-card px-4 py-4" aria-label={`Trade ${ticker.symbol}`}>
        <div className="flex items-center justify-between gap-3">
          <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            SHARES
          </p>
          <p className="tnum text-2xs text-[var(--text-secondary)]">
            You hold {owned} · buying power {usd(buyingPower)}
          </p>
        </div>

        <Stepper
          value={shares}
          max={Math.max(1, Math.max(maxShares, owned))}
          onChange={setShares}
          symbol={ticker.symbol}
        />

        <div className="mt-3 flex gap-1.5">
          {[1, 5, 10].map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => setShares(n)}
              className="tnum flex-1 rounded-[var(--radius-pill)] bg-[var(--chip)] py-2 text-xs font-bold text-[var(--text-secondary)]"
            >
              {n}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShares(Math.max(1, maxShares))}
            className="flex-1 rounded-[var(--radius-pill)] bg-[var(--chip)] py-2 text-xs font-bold text-[var(--text-secondary)]"
          >
            MAX
          </button>
        </div>

        <p className="tnum mt-3 text-sm font-bold">
          {shares} × {usd(price)} ={" "}
          <span className="text-base font-extrabold">{usd(cost)}</span>
        </p>

        {overBy > 0 && (
          <p className="mt-1 text-xs font-semibold leading-snug" style={{ color: DOWN }}>
            That order is {usd(overBy)} more than your buying power. Buy fewer
            shares or move more cash out of the company.
          </p>
        )}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={!canBuy}
            onClick={() => onBuy(ticker.symbol, shares)}
            className="h-14 rounded-[var(--radius-pill)] bg-[var(--action)] text-sm font-extrabold tracking-[0.06em] text-[var(--n-11)] transition-transform duration-150 enabled:active:scale-[0.97] disabled:opacity-40"
          >
            BUY
          </button>
          <button
            type="button"
            disabled={!canSell}
            onClick={() => onSell(ticker.symbol, shares)}
            className="h-14 rounded-[var(--radius-pill)] bg-[var(--chip)] text-sm font-extrabold tracking-[0.06em] text-[var(--text)] transition-transform duration-150 enabled:active:scale-[0.97] disabled:opacity-40"
          >
            SELL
          </button>
        </div>

        {!canSell && owned > 0 && (
          <p className="mt-2 text-xs text-[var(--text-secondary)]">
            You only hold {owned}. You cannot sell what you never bought.
          </p>
        )}
      </section>
    </div>
  );
}

function Stepper({
  value,
  max,
  onChange,
  symbol,
}: {
  value: number;
  max: number;
  onChange: (n: number) => void;
  symbol: string;
}) {
  return (
    <div className="mt-2 flex items-center gap-3">
      <button
        type="button"
        aria-label={`One fewer ${symbol} share`}
        disabled={value <= 1}
        onClick={() => onChange(Math.max(1, value - 1))}
        className="h-11 w-11 shrink-0 rounded-full bg-[var(--chip)] text-lg font-extrabold text-[var(--text)] transition-transform duration-150 enabled:active:scale-[0.94] disabled:opacity-40"
      >
        −
      </button>
      <span
        aria-live="polite"
        className="tnum min-w-0 flex-1 truncate text-center text-2xl font-extrabold"
      >
        {value}
      </span>
      <button
        type="button"
        aria-label={`One more ${symbol} share`}
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="h-11 w-11 shrink-0 rounded-full bg-[var(--chip)] text-lg font-extrabold text-[var(--text)] transition-transform duration-150 enabled:active:scale-[0.94] disabled:opacity-40"
      >
        +
      </button>
    </div>
  );
}

// ── News ────────────────────────────────────────────────────────────────────

function NewsTab({
  minute,
  onOpen,
}: {
  minute: number;
  onOpen: (symbol: string) => void;
}) {
  const items = useMemo(() => news(minute, 6), [minute]);

  return (
    <div className="space-y-2">
      {/* The honest line. It is the most useful sentence on the page. */}
      <p className="rounded-[var(--radius-row)] bg-[var(--chip)] px-4 py-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        The desk is often wrong. Every prediction below is a guess written after
        the price already moved, and none of it is advice.
      </p>

      {items.map((item) => {
        const t = tickerBySymbol(item.symbol);
        const q = t ? quote(t, minute) : null;
        const up = item.tone === "up";
        const flat = item.tone === "flat";
        return (
          <article key={item.id} className="nv-card px-4 py-3.5">
            <button
              type="button"
              onClick={() => onOpen(item.symbol)}
              aria-label={`Open ${item.symbol}`}
              className="flex w-full items-center gap-2"
            >
              <span className="rounded bg-[var(--chip)] px-1.5 py-0.5 text-2xs font-extrabold tracking-[0.08em] text-[var(--text-secondary)]">
                {item.symbol}
              </span>
              <span
                className="tnum text-2xs font-bold"
                style={{ color: flat ? undefined : up ? UP : DOWN }}
              >
                {flat ? "→" : up ? "▲" : "▼"}{" "}
                {q ? signedPct(q.changePct) : toneWord(item.tone)}
              </span>
            </button>

            <h3 className="mt-2 text-[0.9375rem] font-extrabold leading-snug">
              {item.headline}
            </h3>
            <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
              {item.body}
            </p>

            <div className="mt-2.5 rounded-[var(--radius-row)] bg-[var(--chip)] px-3 py-2">
              <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                THE DESK EXPECTS
              </p>
              <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                {item.prediction}
              </p>
            </div>
          </article>
        );
      })}
    </div>
  );
}

// ── Charts (hand-rolled, no library) ────────────────────────────────────────

/**
 * Prices are normalised to the visible window, so the line always fills the box.
 * `preserveAspectRatio="none"` lets the SVG stretch to any phone width; the
 * stroke survives that stretch because of `vector-effect`.
 */
function LineChart({
  data,
  up,
  height,
  label,
}: {
  data: { minute: number; price: number }[];
  up: boolean;
  height: number;
  label: string;
}) {
  const gradientId = useId();
  if (data.length < 2) return null;

  const W = 320;
  const H = 100;
  const PAD = 6;
  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const x = (i: number) => (i / (data.length - 1)) * W;
  const y = (p: number) => H - PAD - ((p - min) / span) * (H - PAD * 2);

  const line = data.map((d, i) => `${x(i).toFixed(2)},${y(d.price).toFixed(2)}`).join(" ");
  const area = `${line} ${W},${H} 0,${H}`;
  const openY = y(prices[0]).toFixed(2);
  const stroke = up ? UP : DOWN;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="mt-3 w-full"
      style={{ height }}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* The period's opening price — everything above it is profit. */}
      <line
        x1="0"
        y1={openY}
        x2={W}
        y2={openY}
        stroke="var(--hairline)"
        strokeWidth="1"
        strokeDasharray="4 4"
        vectorEffect="non-scaling-stroke"
      />
      <polygon points={area} fill={`url(#${gradientId})`} />
      <polyline
        points={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

function Sparkline({
  data,
  up,
}: {
  data: { minute: number; price: number }[];
  up: boolean;
}) {
  if (data.length < 2) return null;

  const W = 64;
  const H = 22;
  const prices = data.map((d) => d.price);
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  const span = max - min || 1;
  const points = data
    .map((d, i) => {
      const x = (i / (data.length - 1)) * W;
      const y = H - 2 - ((d.price - min) / span) * (H - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      aria-hidden="true"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      className="h-[22px] w-16 shrink-0"
    >
      <polyline
        points={points}
        fill="none"
        stroke={up ? UP : DOWN}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ── Small parts & formatting ────────────────────────────────────────────────

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="nv-card min-w-0 px-3.5 py-3">
      <p className="truncate text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
        {label}
      </p>
      <p className="tnum mt-0.5 truncate text-lg font-extrabold leading-tight">
        {value}
      </p>
    </div>
  );
}

const toneWord = (tone: "up" | "down" | "flat") =>
  tone === "up" ? "MOVED UP" : tone === "down" ? "MOVED DOWN" : "WENT NOWHERE";

/**
 * Share prices need cents; portfolio totals do not. The house `fmtMoney` starts
 * compressing at $10K, which is right for the books and wrong for a price tag,
 * so this keeps exact dollars up to a million and hands off above that.
 */
function usd(n: number, cents = true): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs >= 1_000_000) {
    return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`;
  }
  const digits = cents && abs < 10_000 ? 2 : 0;
  return `${sign}$${abs.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })}`;
}

const signedUsd = (n: number) => (n > 0 ? `+${usd(n)}` : usd(n));

const signedPct = (n: number) => {
  const r = Math.round(n * 100) / 100;
  return `${r > 0 ? "+" : r < 0 ? "−" : ""}${Math.abs(r).toFixed(2)}%`;
};

/** Round a transfer to something a human would type. */
function roundAmount(n: number): number {
  if (n <= 0) return 0;
  if (n >= 1000) return Math.round(n / 100) * 100;
  return Math.floor(n);
}

const clockOf = (minute: number) =>
  new Date(minute * 60_000).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
