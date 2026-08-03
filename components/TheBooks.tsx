"use client";

import { useEffect, useRef, useState } from "react";
import type { RunState } from "@/lib/engine/types";
import { fmtMoney, fmtMonths } from "@/lib/engine/format";
import { deriveRunwayMonths } from "@/lib/engine/sim";
import { GLOSSARY } from "@/lib/engine/constants";

/**
 * The Books — pinned, never dismissed. Four raised cards rather than a flat
 * strip, matching the prototype's card language. Runway ticking down is how
 * players learn the word.
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

  const cols = [
    {
      label: "CASH",
      term: "cash",
      value: fmtMoney(run.stats.cash),
      danger: run.stats.cash < 0,
    },
    {
      label: "BURN",
      term: "burn rate",
      value: burn <= 0 ? `+${fmtMoney(-burn)}` : fmtMoney(burn),
      good: burn <= 0, // negative burn is profit
    },
    {
      label: "RUNWAY",
      term: "runway",
      value: fmtMonths(runway),
      danger: runway < 4,
    },
    {
      label: "VALUATION",
      term: "valuation",
      value: fmtMoney(run.stats.valuation),
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

function BookCard({
  label,
  term,
  value,
  danger,
  good,
  rookie,
  onTermTap,
}: {
  label: string;
  term: string;
  value: string;
  danger?: boolean;
  good?: boolean;
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
      {rookie && gloss && (
        // Rookie Mode ADDS a plain-English line. The real term stays.
        <span className="mt-1 block text-sm leading-snug text-[var(--text-tertiary)] lg:mt-0.5 lg:text-2xs lg:leading-[1.25]">
          {gloss.rookie}
        </span>
      )}
    </button>
  );
}
