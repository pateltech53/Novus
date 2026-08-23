"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ENTER, EXIT, SCRIM } from "@/components/ui/Motion";
import { useGame } from "@/lib/state/GameProvider";
import { activitiesFor } from "@/lib/engine/activities";
import { ActivityRow } from "@/components/screens/ActivityRow";
import { ProductSheet } from "@/components/ProductSheet";
import type { ActivityTab } from "@/components/ActivityBar";
import { useNativeGlassClose } from "@/components/native/useNativeOverlay";

const TAB_COPY: Record<ActivityTab, { title: string; line: string }> = {
  company: {
    title: "The company",
    line: "The machine itself. Nothing here moves the calendar.",
  },
  team: {
    title: "The team",
    line: "People cost money every month and decide everything.",
  },
  product: {
    title: "The product",
    line: "The things you made, what you charged, and how they are doing.",
  },
  assets: { title: "Assets", line: "What you own instead of rent." },
  market: { title: "The market", line: "Reach, price, and the cost of both." },
  closet: {
    title: "The closet",
    line: "Cosmetics only. Nothing here touches score, survival, or the leaderboard.",
  },
};

/**
 * Activity screens. Every action here spends resources and never advances
 * time — that separation is what makes the advance button the heartbeat.
 */
export function ActivitySheet({
  tab,
  onClose,
}: {
  tab: ActivityTab | null;
  onClose: () => void;
}) {
  const native = useNativeGlassClose("Close", onClose);
  const { run, runActivity } = useGame();
  const [done, setDone] = useState<string[]>([]);

  if (!run || !tab) return null;
  const list = activitiesFor(tab, run);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: EXIT }}
      transition={SCRIM}
    >
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 bg-[var(--scrim)]"
          />
          <motion.section
            role="dialog"
            aria-modal="true"
            aria-label={TAB_COPY[tab].title}
            className="relative flex max-h-[min(88dvh,calc(100dvh-var(--nv-overlay-top)-0.75rem))] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--sheet)] pb-[max(1rem,var(--nv-safe-bottom))] shadow-[var(--e3)]"
            initial={{ y: "8%", opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: "8%", opacity: 0, transition: EXIT }}
            transition={ENTER}
          >
            <div className="flex items-start justify-between gap-4 px-5 pt-5">
              <div>
                <h2 className="text-xl font-extrabold tracking-[-0.01em]">
                  {TAB_COPY[tab].title}
                </h2>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {TAB_COPY[tab].line}
                </p>
              </div>
              {native ? null : (
                <button
                  type="button"
                  onClick={onClose}
                  className="nv-gc shrink-0 rounded-full px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
                >
                  CLOSE
                </button>
              )}
            </div>

            {/* The product tab is a screen, not a list of buttons: the portfolio,
                its ranked history and the launch flow all live there. */}
            {tab === "product" && (
              <div className="mt-4 px-5">
                <ProductSheet />
              </div>
            )}

            <ul className={`space-y-2 px-3 ${tab === "product" ? "mt-5" : "mt-4"}`}>
              {list.map((activity) => (
                <ActivityRow
                  key={activity.id}
                  activity={activity}
                  run={run}
                  used={done.includes(activity.id)}
                  onRun={() => {
                    runActivity(activity.id);
                    setDone((d) => [...d, activity.id]);
                  }}
                />
              ))}
            </ul>

            <p className="px-5 pt-4 text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">
              NONE OF THIS ADVANCES TIME
            </p>
      </motion.section>
    </motion.div>
  );
}
