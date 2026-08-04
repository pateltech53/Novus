"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { ENTER, EXIT, SCRIM } from "@/components/ui/Motion";
import { useGame } from "@/lib/state/GameProvider";
import { activitiesFor, canAfford } from "@/lib/engine/activities";
import { ProductSheet } from "@/components/ProductSheet";
import { fmtMoney } from "@/lib/engine/format";
import { S_UNIT } from "@/lib/engine/constants";
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
            className="relative flex max-h-[min(88dvh,calc(100dvh-var(--nv-overlay-top)-0.75rem))] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[1.75rem] bg-[var(--sheet)] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--e3)]"
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
              {list.map((activity) => {
                const affordable = canAfford(activity, run);
                const used = done.includes(activity.id);
                return (
                  <li key={activity.id}>
                    <button
                      type="button"
                      disabled={!affordable || used}
                      onClick={() => {
                        runActivity(activity.id);
                        setDone((d) => [...d, activity.id]);
                      }}
                      className="nv-card flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition-transform duration-150 enabled:nv-press-row disabled:opacity-45"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block text-[0.9375rem] font-semibold leading-snug">
                          {activity.label}
                        </span>
                        {/*
                          The signal, given room to be a sentence.
                          It used to live in the narrow chip on the right, which
                          was correct when it read "Cash −1S · Brand +4" and wrong
                          the moment Addendum A §7.1 made it qualitative prose —
                          "Cheap reach. Rents by the week." in a 60px chip wraps to
                          five lines. The chip now carries only the cash cost,
                          which is the one number the player is allowed to see
                          before committing.
                        */}
                        <span className="mt-0.5 block text-xs leading-snug text-[var(--text-secondary)]">
                          {used
                            ? "Done. The month has to move before you do that again."
                            : !affordable
                              ? "You can't afford this right now."
                              : activity.signal}
                        </span>
                      </span>
                      {activity.costS ? (
                        <span className="tnum shrink-0 rounded-md bg-[var(--chip)] px-1.5 py-0.5 text-2xs font-bold text-[var(--text-secondary)]">
                          {fmtMoney(activity.costS * S_UNIT[run.stage])}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>

            <p className="px-5 pt-4 text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">
              NONE OF THIS ADVANCES TIME
            </p>
      </motion.section>
    </motion.div>
  );
}
