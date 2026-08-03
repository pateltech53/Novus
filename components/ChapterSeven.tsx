"use client";

import { useEffect } from "react";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sound";

import { motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import type { AutopsyReport } from "@/lib/engine/autopsy";
import { fmtMoney } from "@/lib/engine/format";

/**
 * Chapter 7 — the autopsy. A toe-tag document, deliberately narrow and
 * centered: red stamp, three ruled lines naming the decisions that killed the
 * company, quoted from the actual run log. Death is content.
 */
export function ChapterSeven({ report }: { report: AutopsyReport }) {
  // Fires on mount rather than on a tap: the company died as a consequence,
  // not because the player pressed something.
  useEffect(() => {
    haptic("chapterSeven");
    play("fail");
  }, []);

  const game = useGame();

  return (
    <div className="fixed inset-0 z-[70] overflow-y-auto bg-[var(--bg)]">
      <motion.div
        className="mx-auto w-full max-w-md px-6 pt-[max(2.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <div className="relative border border-[var(--hairline)] px-5 py-7">
          <motion.p
            className="absolute -top-3 right-4 border-2 border-[var(--alert)] px-2.5 py-0.5 text-sm font-extrabold tracking-[0.2em] text-[var(--alert)]"
            style={{ transform: "rotate(-6deg)" }}
            initial={{ scale: 1.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.35, duration: 0.3, ease: [0.7, 0, 0.84, 0] }}
          >
            CLOSED
          </motion.p>

          <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
            CHAPTER 7 · LIQUIDATION
          </p>
          <h1 className="mt-2 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
            {report.companyName}
          </h1>
          <p className="mt-1 text-sm text-[var(--text-secondary)]">
            Survived {report.yearsSurvived}{" "}
            {report.yearsSurvived === 1 ? "fiscal year" : "fiscal years"}. Final
            valuation {fmtMoney(report.finalValuation)}.
          </p>

          <h2 className="mt-7 text-2xs font-bold tracking-[0.16em] text-[var(--alert)]">
            CAUSE OF DEATH
          </h2>
          <ol className="mt-2.5">
            {report.fatalDecisions.map((d, i) => (
              <li
                key={`${d.eventTitle}-${i}`}
                className="border-b border-[var(--hairline)] py-3 first:border-t"
              >
                <p className="text-[0.9375rem] font-semibold leading-snug">
                  &ldquo;{d.choiceLabel}&rdquo;
                </p>
                <p className="mt-0.5 text-xs text-[var(--text-tertiary)]">
                  Year {d.year} · {d.eventTitle}
                  {d.impact < 0 && (
                    <span className="tnum ml-2 text-[var(--alert)]">
                      {fmtMoney(d.impact)}
                    </span>
                  )}
                </p>
              </li>
            ))}
            {report.fatalDecisions.length === 0 && (
              <li className="py-3 text-sm text-[var(--text-secondary)]">
                No single decision did this. The burn did. That is its own lesson.
              </li>
            )}
          </ol>

          {report.hiddenTruths.length > 0 && (
            <>
              <h2 className="mt-7 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
                WHAT YOU COULDN&rsquo;T SEE
              </h2>
              <ul className="mt-2 space-y-1.5">
                {report.hiddenTruths.map((truth) => (
                  <li
                    key={truth}
                    className="text-sm leading-snug text-[var(--text-secondary)]"
                  >
                    {truth}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={game.abandonRun}
          className="nv-gc mt-6 w-full rounded-[var(--radius-card)] nv-t-action px-5 py-4 text-base font-extrabold tracking-[0.06em]"
        >
          FOUND ANOTHER ONE ▸
        </button>
        <p className="mt-2 text-center text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">
          THE SHARK REMEMBERS. SO DO YOU.
        </p>
      </motion.div>
    </div>
  );
}
