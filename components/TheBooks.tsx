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
   * Two-up on a phone, four-up from 440px.
   *
   * Four columns across 375px leaves ~85px a card, which at the 12px type
   * floor truncates "VALUATION" to "VALUATI…" — and a financial label you
   * cannot read is worse than one that takes a second row. The 8px type this
   * replaced fit, which is exactly why it was 8px.
   */
  return (
    <div className="grid grid-cols-2 gap-1.5 px-3 pt-3 min-[440px]:grid-cols-4">
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
      className={`nv-card min-w-0 px-2 py-2 text-left transition-transform duration-200 active:scale-[0.97] ${
        flash ? "ring-2 ring-[var(--n-8)]" : ""
      }`}
    >
      <span className="block truncate text-2xs font-bold tracking-[0.08em] text-[var(--text-tertiary)] sm:text-2xs sm:tracking-[0.12em]">
        {label}
      </span>
      <span
        className={`tnum mt-0.5 block truncate text-xs font-extrabold leading-tight sm:text-[0.9375rem] ${
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
        <span className="mt-0.5 block text-2xs leading-[1.25] text-[var(--text-tertiary)]">
          {gloss.rookie}
        </span>
      )}
    </button>
  );
}
