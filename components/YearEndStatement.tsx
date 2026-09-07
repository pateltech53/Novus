"use client";

import { play } from "@/lib/sound";

import { useState } from "react";
import { motion } from "framer-motion";
import { ENTER, STAGGER } from "@/components/ui/Motion";
import { allocationFlag, useGame } from "@/lib/state/GameProvider";
import type { YearEndSummary } from "@/lib/engine/run";
import { fmtMoney } from "@/lib/engine/format";
import { STAGE_NAME } from "@/lib/engine/constants";

/**
 * Year End is a printed statement, not a card grid: ruled rows of figures in
 * a single column, then the allocation decision for next year.
 */
export function YearEndStatement({ summary }: { summary: YearEndSummary }) {
  const game = useGame();
  const [picked, setPicked] = useState<string | null>(null);
  /*
   * This statement now survives a reload, so "have you allocated yet" cannot
   * live only in this component: a player who allocated, quit, and came back
   * would be handed the money a second time. The run remembers instead. The
   * empty string means "yes, but on a previous visit" — nothing to highlight,
   * everything still locked.
   */
  const allocated =
    picked ?? (game.run?.flags[allocationFlag(game.run.year)] ? "" : null);
  const locked = allocated !== null;

  const rows = [
    { label: "Revenue", value: fmtMoney(summary.revenue) },
    {
      label: "Profit / loss",
      value: fmtMoney(summary.profit),
      tone: summary.profit >= 0 ? ("up" as const) : ("down" as const),
    },
    { label: "Cash on hand", value: fmtMoney(summary.cash) },
    {
      label: "Valuation",
      value: fmtMoney(summary.valuation),
      delta: summary.valuationDelta,
    },
  ];

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto overscroll-contain bg-[var(--bg)]">
      <motion.div
        className="mx-auto w-full max-w-lg px-6 pt-[max(2rem,var(--nv-safe-top))] pb-[max(2rem,var(--nv-safe-bottom))]"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...ENTER }}
      >
        <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
          STATEMENT OF THE YEAR
        </p>
        <h1 className="mt-1 text-[2rem] font-extrabold leading-none tracking-[-0.02em]">
          Fiscal Year {summary.year}
        </h1>
        <p className="mt-1.5 text-sm text-[var(--text-secondary)]">
          Closed out loud. Score {summary.score}/10.
        </p>

        {/*
          ── The app's one legitimately orchestrated moment ──────────────────
          │
          │ design.md §5 budgets ONE per screen and this is where it belongs:
          │ the four numbers a whole fiscal year resolved into, delivered as a
          │ verdict. They used to arrive as part of the single 0.35 s block
          │ fade above — cash, burn, runway and valuation appearing
          │ simultaneously, which reads as a card loading rather than as a
          │ result being read out.
          │
          │ Staggered at STAGGER (60 ms), so four rows take ~240 ms and land in
          │ reading order. Fast enough to still be one gesture; slow enough
          │ that the eye lands on each figure. Framer's reducedMotion="user"
          │ cuts the y-travel for anyone who asked for less, and the stagger
          │ becomes a very fast fade rather than a slide.
          │
          │ The rest of this screen keeps the block entrance deliberately —
          │ the §5 budget is one moment per SCREEN, not one per component.
        */}
        <motion.dl
          className="mt-7 border-t border-[var(--hairline)]"
          initial="rest"
          animate="shown"
          variants={{ shown: { transition: { staggerChildren: STAGGER, delayChildren: 0.12 } } }}
        >
          {rows.map((row) => (
            <motion.div
              key={row.label}
              variants={{
                rest: { opacity: 0, y: 8 },
                shown: { opacity: 1, y: 0, transition: ENTER },
              }}
              className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-3"
            >
              <dt className="text-sm text-[var(--text-secondary)]">{row.label}</dt>
              <dd className="flex items-baseline gap-2">
                {row.delta !== undefined && row.delta !== 0 && (
                  <span
                    className={`tnum text-xs font-semibold ${
                      row.delta > 0
                        ? "text-[var(--solvency)]"
                        : "text-[var(--alert)]"
                    }`}
                  >
                    {row.delta > 0 ? "▲" : "▼"} {fmtMoney(Math.abs(row.delta))}
                  </span>
                )}
                <span
                  className={`tnum text-lg font-bold ${
                    row.tone === "up"
                      ? "text-[var(--solvency)]"
                      : row.tone === "down"
                        ? "text-[var(--alert)]"
                        : "text-[var(--text)]"
                  }`}
                >
                  {row.value}
                </span>
              </dd>
            </motion.div>
          ))}
        </motion.dl>

        {summary.stageUp && (
          <p className="mt-5 border-l-2 border-[var(--color-prestige)] pl-3 text-sm font-semibold text-[var(--color-prestige)]">
            {STAGE_NAME[summary.stageUp as 1 | 2 | 3 | 4 | 5]} stage. Bigger checks,
            bigger fires.
          </p>
        )}

        <p className="mt-5 inline-block border border-[var(--color-prestige)]/40 px-2.5 py-1 text-2xs font-bold tracking-[0.14em] text-[var(--color-prestige)]">
          {summary.badge.toUpperCase()}
        </p>

        <section className="mt-9">
          <h2 className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
            WHERE NEXT YEAR&rsquo;S MONEY GOES
          </h2>
          <ul className="mt-3 border-t border-[var(--hairline)]">
            {(
              [
                { id: "marketing", label: "Marketing", known: "Brand +6 · CTR +4 · Cash −3S" },
                { id: "product", label: "Product", known: "Quality +6 · Cash −3S" },
                { id: "save", label: "Save it", known: "Nothing spent" },
              ] as const
            ).map((option) => (
              <li key={option.id}>
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => {
                    game.chooseAllocation(option.id);
                    setPicked(option.id);
                  }}
                  className={`nv-gc flex w-full items-baseline justify-between gap-4 border-b border-[var(--hairline)] px-1 py-3.5 text-left disabled:cursor-default ${
                    allocated === option.id
                      ? "text-[var(--action)]"
                      : locked
                        ?"opacity-40"
                        :"hover:bg-[var(--card)] active:bg-[var(--chip)]"
                  }`}
                >
                  <span className="text-[0.9375rem] font-semibold">{option.label}</span>
                  <span className="tnum text-xs text-[var(--text-tertiary)]">
                    {option.known}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <button
          type="button"
          onClick={game.closeYearEnd}
          disabled={!locked}
          className="nv-gc mt-8 w-full rounded-[var(--radius-card)] nv-t-action px-5 py-4 text-base font-extrabold tracking-[0.06em] disabled:cursor-not-allowed disabled:opacity-40"
        >
          INTO YEAR {summary.year + 1} ▸
        </button>
        {!locked && (
          <p className="mt-2 text-center text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">
            PICK WHERE THE MONEY GOES FIRST
          </p>
        )}
      </motion.div>
    </div>
  );
}
