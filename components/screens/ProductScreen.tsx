"use client";

import { useState } from "react";
import { useGame } from "@/lib/state/GameProvider";
import { ScreenSheet } from "@/components/screens/ScreenSheet";
import { activitiesFor, canAfford } from "@/lib/engine/activities";
import { specForRun } from "@/lib/engine/industries/index";
import { S_UNIT } from "@/lib/engine/constants";
import { fmtMoney } from "@/lib/engine/format";
import { ProductSheet } from "@/components/ProductSheet";

/**
 * The Product tab's screen.
 *
 * Same shell as CompanyScreen / TeamScreen / AssetsScreen — each activity tab in
 * play/page.tsx routes to its own full-height sheet rather than to the generic
 * ActivitySheet, and this follows that pattern rather than inventing a sixth one.
 *
 * Two halves:
 *   1. The portfolio itself (ProductSheet) — the ranked list, the launch flow and
 *      the per-item history. This is the screen's reason to exist.
 *   2. The industry's own product activities underneath it, which are the verbs
 *      that act ON the portfolio: reformulate, run a special, restock, sunset.
 *
 * The list is second because the portfolio is the noun and the activities only
 * make sense once you can see the things they apply to.
 */
export function ProductScreen({ onClose }: { onClose: () => void }) {
  const { run, runActivity } = useGame();
  // One per visit, matching the other screens: without it a player drains the
  // same lever ten times inside one month.
  const [spent, setSpent] = useState<string[]>([]);

  if (!run) return null;
  const spec = specForRun(run);
  const actions = activitiesFor("product", run);

  return (
    <ScreenSheet
      label={`${run.companyName} — ${spec.reportLabel.toLowerCase()}`}
      closeLabel="Close the product sheet"
      workspace
      onClose={onClose}
      title={spec.nounPlural}
      blurb="What you made, what you charged, and how each one is doing."
    >
      <div className="mt-4 px-5">
        <ProductSheet />
      </div>

      {actions.length > 0 && (
        <>
          <h3 className="px-5 pt-7 pb-2 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            WHAT YOU CAN DO TODAY
          </h3>
          <ul className="space-y-2 px-3">
            {actions.map((activity) => {
              const affordable = canAfford(activity, run);
              const used = spent.includes(activity.id);
              const price =
                activity.costS !== undefined
                  ? fmtMoney(activity.costS * S_UNIT[run.stage])
                  : null;
              return (
                <li key={activity.id}>
                  <button
                    type="button"
                    disabled={!affordable || used}
                    onClick={() => {
                      runActivity(activity.id);
                      setSpent((s) => [...s, activity.id]);
                    }}
                    className="nv-card flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition-transform duration-150 enabled:nv-press-row disabled:opacity-45"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block text-[0.9375rem] font-semibold leading-snug">
                        {activity.label}
                      </span>
                      {/* The qualitative signal. No effect preview — the cash
                          cost is the only number allowed before committing. */}
                      <span className="mt-0.5 block text-xs leading-snug text-[var(--text-secondary)]">
                        {used
                          ? "Done. The month has to move before you do that again."
                          : !affordable
                            ? `You don't have the ${price ?? "cash"}. That's the whole reason.`
                            : activity.signal}
                      </span>
                    </span>
                    {price && (
                      <span className="tnum shrink-0 text-2xs font-semibold text-[var(--text-primary)]">
                        {price}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="px-5 pt-5 text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">
        NONE OF THIS ADVANCES TIME
      </p>
    </ScreenSheet>
  );
}
