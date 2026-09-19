"use client";

import { useState } from "react";
import { useGame } from "@/lib/state/GameProvider";
import { ScreenSheet } from "@/components/screens/ScreenSheet";
import { activitiesFor } from "@/lib/engine/activities";
import { ActivityRow } from "@/components/screens/ActivityRow";
import { specForRun } from "@/lib/engine/industries/index";
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
            {actions.map((activity) => (
              <ActivityRow
                key={activity.id}
                activity={activity}
                run={run}
                used={spent.includes(activity.id)}
                onRun={(option) => {
                  runActivity(activity.id, option);
                  setSpent((s) => [...s, activity.id]);
                }}
              />
            ))}
          </ul>
        </>
      )}

      <p className="px-5 pt-5 text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">
        NONE OF THIS ADVANCES TIME
      </p>
    </ScreenSheet>
  );
}
