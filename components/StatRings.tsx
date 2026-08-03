"use client";

import type { RunState } from "@/lib/engine/types";

/**
 * The prototype's three rings, wired to real stats instead of mock numbers.
 * Brand / Quality / Morale — the three levers a founder actually steers, and
 * the ones most events move.
 */
export function StatRings({ run }: { run: RunState }) {
  /**
   * All three arcs share one neutral. They previously carried the action
   * orange, the solvency green and the prestige gold — spending three brand
   * colours on what is really one magnitude, three times.
   *
   * That broke two rules at once: the accent is the primary CTA and nothing
   * else, and solvency is for financial upside only — morale is not money.
   * The rings are already labelled and already show their number, so hue was
   * carrying no information the reader did not already have.
   */
  const rings = [
    { label: "BRAND", value: Math.round(run.stats.brand) },
    { label: "QUALITY", value: Math.round(run.stats.qual) },
    { label: "MORALE", value: Math.round(run.stats.morale) },
  ];

  return (
    <div className="flex gap-6 lg:gap-5">
      {rings.map((ring) => (
        <Ring key={ring.label} {...ring} />
      ))}
    </div>
  );
}

const R = 26;
const CIRCUMFERENCE = 2 * Math.PI * R; // 163.4

function Ring({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  const offset = CIRCUMFERENCE * (1 - pct / 100);

  /*
   * The label sits UNDER the ring, not inside it.
   *
   * It used to be centred within the 64px circle at 8px. Raising the type
   * floor to 12px made "QUALITY" wider than the ring's inner width and it
   * clipped to "QUALIT" — a real regression from the sweep, caught in the
   * 1280 capture. Moving the label out gives it the full width of the column
   * and lets the number own the ring, which reads better at every size.
   */
  return (
    <div className="flex flex-col items-center gap-1" role="img" aria-label={`${label} ${pct} of 100`}>
      {/* The ring scales with the phone masthead it sits in; the viewBox keeps
          the geometry, so the stroke thickens with it rather than thinning.
          Desktop keeps the 64px ring it was composed with. */}
      <div className="relative h-18 w-18 lg:h-16 lg:w-16">
      <svg width="100%" height="100%" viewBox="0 0 64 64" aria-hidden="true">
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="color-mix(in oklch, var(--n-11) 6%, transparent)"
          stroke="color-mix(in oklch, var(--n-11) 16%, transparent)"
          strokeWidth="5"
        />
        <circle
          cx="32"
          cy="32"
          r={R}
          fill="none"
          stroke="color-mix(in oklch, var(--n-11) 78%, transparent)"
          strokeWidth="5"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={offset}
          transform="rotate(-90 32 32)"
          style={{ transition: "stroke-dashoffset 600ms var(--ease-out)" }}
        />
      </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="tnum text-lg font-extrabold text-[var(--n-11)] lg:text-base">{pct}</span>
        </div>
      </div>
      <span className="text-2xs font-semibold tracking-[0.08em] text-[var(--n-8)]">
        {label}
      </span>
    </div>
  );
}
