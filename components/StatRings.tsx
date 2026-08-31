"use client";

import type { RunState } from "@/lib/engine/types";
import { IMPACT_MS } from "@/components/ui/Motion";

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
    <>
      {/*
        ── Two treatments, and the phone's is the one that had to change ─────

        Three 72px donuts cost the masthead 110px — a fifth of an iPhone 15
        Pro's usable height — to say three two-digit numbers. That was
        affordable until it was measured against what sits under it:

          fold (top of the fixed bar)   678px
          masthead                      313
          The Books                     349
                                        ───
                                        662, leaving 16px

        THE STORY SO FAR needs 60, so it fell below the fold and had to be
        scrolled to. There is no other slack on this screen — the books are the
        point of it, and the founder's portrait is the brand — so the 110px the
        rings were spending is where the row had to come from.

        The bar says the same thing the arc did. Both are one magnitude out of
        a hundred; an arc is simply the expensive way to draw it, and it costs
        three times the height for the same reading. The number, the label and
        the neutral are all unchanged.

        Desktop keeps the rings. The left rail is a 100dvh column with nothing
        underneath competing for it, which is the condition the rings were
        composed under and the only one where they are free.
      */}
      <div className="flex w-full gap-4 desk:hidden">
        {rings.map((ring) => (
          <Bar key={ring.label} {...ring} />
        ))}
      </div>
      <div className="hidden desk:flex desk:gap-5">
        {rings.map((ring) => (
          <Ring key={ring.label} {...ring} />
        ))}
      </div>
    </>
  );
}

/**
 * The phone's reading of the same number.
 *
 * One neutral, for the reason the header above gives: hue here would be a
 * third brand colour spent on magnitude, and the accent belongs to ADVANCE
 * MONTH — which is 200px below this and would be competing with it.
 */
function Bar({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="min-w-0 flex-1" role="img" aria-label={`${label} ${pct} of 100`}>
      <div className="flex items-baseline justify-between gap-1.5">
        <span className="truncate text-2xs font-semibold tracking-[0.08em] text-[var(--n-8)]">
          {label}
        </span>
        <span className="tnum shrink-0 text-sm font-extrabold text-[var(--n-11)]">{pct}</span>
      </div>
      <div className="mt-1 h-[3px] w-full overflow-hidden rounded-[var(--radius-pill)] bg-[color-mix(in_oklch,var(--n-11)_16%,transparent)]">
        <div
          className="h-full rounded-[var(--radius-pill)] bg-[color-mix(in_oklch,var(--n-11)_78%,transparent)]"
          /* The same clock as the arc it replaces, and as The Books' flash and
             the impact chip — three reactions to one decision that must agree
             or a choice reads as several unrelated glitches. */
          style={{ width: `${pct}%`, transition: `width ${IMPACT_MS}ms var(--ease-out)` }}
        />
      </div>
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
      <div className="relative h-18 w-18 desk:h-16 desk:w-16">
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
          /* Same clock as The Books' flash and the impact chip. It was 600 ms
             against their 700 and 1700 — three reactions to one decision, none
             of which agreed with the others, which is why a choice read as
             several unrelated glitches rather than one consequence. */
          style={{ transition: `stroke-dashoffset ${IMPACT_MS}ms var(--ease-out)` }}
        />
      </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="tnum text-lg font-extrabold text-[var(--n-11)] desk:text-base">{pct}</span>
        </div>
      </div>
      <span className="text-2xs font-semibold tracking-[0.08em] text-[var(--n-8)]">
        {label}
      </span>
    </div>
  );
}
