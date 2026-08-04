"use client";

import { useEffect, useRef, useState } from "react";
import type { RunState } from "@/lib/engine/types";
import { fmtDelta, fmtMoney, fmtMonths, fmtMonthsDelta } from "@/lib/engine/format";
import { deriveRunwayMonths } from "@/lib/engine/sim";
import { previousValue, series, type LedgerKey } from "@/lib/engine/ledger";
import { GLOSSARY } from "@/lib/engine/constants";

/**
 * The Books — pinned, never dismissed. Four raised cards rather than a flat
 * strip, matching the prototype's card language. Runway ticking down is how
 * players learn the word.
 *
 * ── What a card carries, and why ──────────────────────────────────────────
 *
 * It used to carry a label and a figure, and that is a value without a
 * velocity: runway 11mo and runway 11mo look identical whether you gained two
 * months or lost four, so the player had to remember last month to know which
 * way the company was going. Every card now also carries:
 *
 *   · the month-over-month CHANGE, signed and coloured by whether the money
 *     moved the right way — which is not the same as "up". Burn rising is
 *     damage; burn falling is upside. `goodWhenUp` per column, never inferred.
 *   · a twelve-month TREND, drawn from `run.ledger`. Absent on a fresh run, on
 *     a save written before the history existed, and under the harnesses that
 *     drive `advanceMonth` directly — so every reader here treats missing as
 *     normal rather than as zero.
 *
 * Runway's trend slot is a twelve-segment gauge instead of a line, because
 * runway is the only one of the four with a death line: the number says how
 * many months, the gauge says how close that is to none. The other three have
 * no threshold worth drawing, so they get the line.
 */
export function TheBooks({
  run,
  onTermTap,
}: {
  run: RunState;
  onTermTap?: (term: string) => void;
}) {
  const runway = deriveRunwayMonths(run);
  const burn = run.stats.burnMonthly;

  const cols: BookCardProps[] = [
    {
      label: "CASH",
      term: "cash",
      value: fmtMoney(run.stats.cash),
      danger: run.stats.cash < 0,
      delta: moneyDelta(run, "c", run.stats.cash, true),
      trend: { kind: "line", points: series(run, "c", run.stats.cash) },
    },
    {
      label: "BURN",
      term: "burn rate",
      value: burn <= 0 ? `+${fmtMoney(-burn)}` : fmtMoney(burn),
      good: burn <= 0, // negative burn is profit
      // Burn is the one figure where up is the bad direction.
      delta: moneyDelta(run, "b", burn, false),
      trend: { kind: "line", points: series(run, "b", burn) },
    },
    {
      label: "RUNWAY",
      term: "runway",
      value: fmtMonths(runway),
      danger: runway < 4,
      delta: runwayDelta(run, runway),
      trend: { kind: "gauge", months: runway },
    },
    {
      label: "VALUATION",
      term: "valuation",
      value: fmtMoney(run.stats.valuation),
      delta: moneyDelta(run, "v", run.stats.valuation, true),
      trend: { kind: "line", points: series(run, "v", run.stats.valuation) },
    },
  ];

  /*
   * Two-up on a phone, four-up on the desktop rail.
   *
   * Four columns across 375px leaves ~85px a card, which at the 12px type
   * floor truncates "VALUATION" to "VALUATI…" — and a financial label you
   * cannot read is worse than one that takes a second row. The 8px type this
   * replaced fit, which is exactly why it was 8px.
   *
   * The phone stays two-up at every width now, because the phone's cards
   * carry display-size figures — the log is one row instead of half the
   * screen, and the ledger is what got the reclaimed room. Four-up returns at
   * `lg`, where the desktop rail keeps the compact cards this component had
   * before.
   */
  return (
    <div className="grid grid-cols-2 gap-2 px-3 pt-3 lg:grid-cols-4 lg:gap-1.5">
      {cols.map((col) => (
        <BookCard key={col.label} {...col} rookie={run.rookieMode} onTermTap={onTermTap} />
      ))}
    </div>
  );
}

/* ── The change line ─────────────────────────────────────────────────────── */

interface Delta {
  /** What the player reads. Empty string means "there is no previous month". */
  text: string;
  /** Which way the money went, in the terms that matter for THIS figure. */
  tone: "up" | "down" | "flat";
  /** The same fact as a sentence, for the live region. */
  spoken: string;
}

const NO_HISTORY: Delta = { text: "", tone: "flat", spoken: "" };

/**
 * A money change against last month.
 *
 * `goodWhenUp` is passed rather than inferred because it is genuinely per
 * column: more cash is upside, more burn is damage, and a component that
 * guessed would eventually paint a rising burn green.
 */
function moneyDelta(
  run: RunState,
  key: LedgerKey,
  live: number,
  goodWhenUp: boolean,
): Delta {
  const prev = previousValue(run, key);
  if (prev === null) return NO_HISTORY;
  const change = live - prev;
  /*
   * The dead band is a display threshold, not a rounding error. `fmtMoney`
   * shows at most one decimal of a K, so a $40 move inside "$1.2M" would print
   * "+$40" beside a figure that did not visibly change — a delta contradicting
   * the number it belongs to. Below half of what the figure can show, say
   * nothing changed.
   */
  if (Math.abs(change) < Math.max(1, Math.abs(live) * 0.0005)) {
    return { text: "unchanged", tone: "flat", spoken: "no change this month" };
  }
  const rose = change > 0;
  return {
    text: fmtDelta(change),
    tone: rose === goodWhenUp ? "up" : "down",
    spoken: `${rose ? "up" : "down"} ${fmtMoney(Math.abs(change))} this month`,
  };
}

/** Runway's change, in whole months — the unit the figure itself is in. */
function runwayDelta(run: RunState, live: number): Delta {
  const prev = previousValue(run, "r");
  if (prev === null) return NO_HISTORY;
  // Both sides are clamped the way the sample is, so a profitable month does
  // not report a change of Infinity.
  const now = Number.isFinite(live) ? Math.min(999, live) : 999;
  const change = Math.round(now) - Math.round(prev);
  if (change === 0) return { text: "unchanged", tone: "flat", spoken: "no change this month" };
  return {
    text: fmtMonthsDelta(change),
    tone: change > 0 ? "up" : "down",
    spoken: `${change > 0 ? "up" : "down"} ${Math.abs(change)} months this month`,
  };
}

/* ── The trend ───────────────────────────────────────────────────────────── */

type Trend =
  | { kind: "line"; points: number[] }
  | { kind: "gauge"; months: number };

/** How many months the runway gauge draws. One fiscal year. */
const GAUGE_SEGMENTS = 12;

/**
 * Twelve months, filled from the left, one segment per month of runway left.
 *
 * The number above it says how many; this says how close that is to none,
 * which is the only thing the player is actually deciding on. Purely
 * decorative to assistive tech — the figure and its change already say it in
 * words, and a row of twelve divs read out one by one is noise.
 */
function Gauge({ months, danger }: { months: number; danger: boolean }) {
  const filled = Number.isFinite(months)
    ? Math.max(0, Math.min(GAUGE_SEGMENTS, Math.round(months)))
    : GAUGE_SEGMENTS; // a profitable company is not running out
  return (
    /*
      The row is the same height as a sparkline's (h-4 / lg:h-3) with the bar
      centred inside it, so all four cards put their trend on one baseline and
      whatever sits under them — the Rookie line — lines up across the row.
      The bar itself stays thin; only the box it sits in is standardised.
    */
    <span aria-hidden="true" className="mt-1.5 flex h-4 items-center gap-px lg:mt-1 lg:h-3">
      {Array.from({ length: GAUGE_SEGMENTS }, (_, i) => (
        <span
          key={i}
          className={`h-1.5 flex-1 rounded-[1px] lg:h-1 ${
            i < filled
              ? danger
                ? "bg-[var(--alert)]"
                : "bg-[var(--text-secondary)]"
              : "bg-[var(--hairline)]"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * The twelve-month line.
 *
 * `preserveAspectRatio="none"` because this is a shape, not a chart: it is
 * read for direction at a glance and never for a value, so stretching it to
 * the card's width costs nothing and reading a number off it was never on
 * offer. A flat series still draws a flat line rather than dividing by zero.
 */
function Spark({ points }: { points: number[] }) {
  /*
   * Nothing to draw still occupies the row.
   *
   * Runway's slot is a gauge, which is derived from the live figure and so
   * always draws; the other three are drawn from history and do not, until the
   * third month. Returning null there made three cards one element shorter
   * than the fourth, and the Rookie line under them stopped lining up across
   * the row — visible on the very first screen a new player sees.
   */
  if (points.length === 0) {
    return <span aria-hidden="true" className="mt-1.5 block h-4 lg:mt-1 lg:h-3" />;
  }
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = 100 / (points.length - 1);
  const d = points
    .map((p, i) => `${(i * step).toFixed(2)},${(22 - ((p - min) / span) * 20).toFixed(2)}`)
    .join(" ");
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 24"
      preserveAspectRatio="none"
      className="mt-1.5 block h-4 w-full text-[var(--text-tertiary)] lg:mt-1 lg:h-3"
    >
      <polyline
        points={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/* ── One card ────────────────────────────────────────────────────────────── */

interface BookCardProps {
  label: string;
  term: string;
  value: string;
  danger?: boolean;
  good?: boolean;
  delta: Delta;
  trend: Trend;
}

function BookCard({
  label,
  term,
  value,
  danger,
  good,
  delta,
  trend,
  rookie,
  onTermTap,
}: BookCardProps & {
  rookie: boolean;
  onTermTap?: (term: string) => void;
}) {
  const prev = useRef(value);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    if (prev.current !== value) {
      prev.current = value;
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 700);
      return () => clearTimeout(t);
    }
  }, [value]);

  const gloss = GLOSSARY[term];

  return (
    <button
      type="button"
      onClick={() => onTermTap?.(term)}
      aria-label={gloss ? `${label}: ${gloss.rookie}` : label}
      /*
       * The ledger is glass now, and that is a change to §0 rather than an
       * exception to it — see design.md. Money used to be read on solid
       * ground, full stop; it is read on a lens here, and what pays for that
       * is everything below: the figure keeps `--text` at full strength and
       * the label keeps its own colour. Nothing about a number got quieter to
       * make room for a material.
       *
       * (Under the current `[data-css-glass]` gate this renders as the solid
       * fallback on every platform. The reasoning stays because the gate is
       * one attribute, not a deletion.)
       *
       * The change-flash is an `outline` rather than a `ring` because a ring
       * IS a box-shadow, and the material declares box-shadow unlayered — a
       * ring here would be a ring that never draws, on the one cue whose whole
       * job is to be seen.
       */
      /*
       * Two sizes of the same card: display-size on the phone, compact on the
       * desktop rail. The phone's figures were 12px — the legal floor spent on
       * the four numbers the whole game runs on — because the log needed the
       * rest of the screen. The log is one row now, and this is where that
       * room went. Every `lg:` below is the rail keeping the compact card.
       */
      className={`nv-gc min-w-0 rounded-[var(--radius-row)] px-3.5 py-3 text-left lg:px-2 lg:py-2 ${
        flash ? "outline outline-2 -outline-offset-2 outline-[var(--n-8)]" : ""
      }`}
    >
      <span className="block truncate text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <span
        className={`tnum mt-1 block truncate text-2xl font-extrabold leading-tight lg:mt-0.5 lg:text-[0.9375rem] ${
          danger
            ? "text-[var(--alert)]"
            : good
              ? "text-[var(--solvency)]"
              : "text-[var(--text)]"
        }`}
      >
        {value}
      </span>
      {/*
        The change line always occupies its row, even with nothing to say, so a
        run that reaches its second month does not shove every card below it
        down the screen. `min-h` rather than a non-breaking space: an empty
        span is silent to a screen reader, and a hard space is not.
      */}
      <span
        className={`tnum mt-0.5 block min-h-[1.05rem] truncate text-2xs font-bold leading-[1.05rem] lg:min-h-[1rem] lg:leading-[1rem] ${
          delta.tone === "up"
            ? "text-[var(--solvency)]"
            : delta.tone === "down"
              ? "text-[var(--alert)]"
              : "text-[var(--text-tertiary)]"
        }`}
      >
        {delta.text}
      </span>
      {trend.kind === "gauge" ? (
        <Gauge months={trend.months} danger={!!danger} />
      ) : (
        <Spark points={trend.points} />
      )}
      {/*
        design.md §"Live regions on The Books when figures change". The visible
        card is a button whose accessible name is the term's definition — that
        name must stay put, or tapping through the glossary loses its label —
        so the announcement lives in its own polite region beside it. One
        sentence, not four spans read in sequence.
      */}
      <span className="sr-only" aria-live="polite">
        {delta.spoken ? `${label} ${value}, ${delta.spoken}.` : ""}
      </span>
      {rookie && gloss && (
        // Rookie Mode ADDS a plain-English line. The real term stays.
        <span className="mt-1 block text-sm leading-snug text-[var(--text-tertiary)] lg:mt-0.5 lg:text-2xs lg:leading-[1.25]">
          {gloss.rookie}
        </span>
      )}
    </button>
  );
}
