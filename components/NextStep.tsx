"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { RunState } from "@/lib/engine/types";
import { nextStep } from "@/lib/engine/nudges";
import { ENTER } from "@/components/ui/Motion";
import { haptic } from "@/lib/haptics";

/**
 * ONE THING WORTH DOING — the nudge row on /play.
 *
 * The tutorial names PRODUCT and TEAM individually because players reported
 * never finding them, but a tutorial speaks once, at minute zero, to someone
 * who has not yet met the problem. This is the same information delivered at
 * the moment it becomes true: nothing on the shelf, nobody employed, or room
 * on the shelf the team has already paid for.
 *
 * ── Why it is allowed to be dismissed, and why that is remembered ──────────
 *
 * A row that cannot be closed is a row that gets ignored, and a row that
 * reappears on the next tap is worse than one that never appeared. Dismissal
 * is held for the current game month and for that nudge only — advance time and
 * a nudge that is STILL true comes back once, which is the honest cadence for
 * "this is still costing you". A nudge that stopped being true never returns,
 * because `nextStep` recomputes from the run rather than from a checklist.
 *
 * Deliberately not a modal, not a toast and not a coachmark: it takes no taps
 * to get past, it blocks nothing, and it sits in the flow of the page rather
 * than over it. The rule this screen already follows is that nothing moves
 * unless the player moved it.
 */
export function NextStep({
  run,
  onOpen,
}: {
  run: RunState;
  /** Opens the tab this nudge is about — the page owns the activity state. */
  onOpen: (tab: "product" | "team") => void;
}) {
  /** `${nudge.id}:${year}:${month}` for whatever is currently dismissed. */
  const [dismissed, setDismissed] = useState<string[]>([]);

  const nudge = nextStep(run);
  if (!nudge) return null;

  const key = `${nudge.id}:${run.year}:${run.month}`;
  if (dismissed.includes(key)) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={key}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0 }}
        transition={{ ...ENTER }}
        className="nv-gc mx-3 mt-2 rounded-[var(--radius-card)] p-3"
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm font-bold leading-snug text-[var(--text-primary)]">
            {nudge.title}
          </p>
          <button
            type="button"
            onClick={() => setDismissed((d) => [...d, key])}
            aria-label="Dismiss this suggestion"
            /* 30px minimum, the bar `npm run audit:phone` enforces. */
            className="nv-press -my-1 -mr-1 flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-[var(--radius-chip)] text-[var(--text-tertiary)]"
          >
            <span aria-hidden="true" className="text-sm leading-none">
              ✕
            </span>
          </button>
        </div>
        <p className="mt-1 text-2xs leading-snug text-[var(--text-secondary)]">{nudge.body}</p>
        <button
          type="button"
          onClick={() => {
            haptic("choice");
            onOpen(nudge.tab);
          }}
          className="nv-gc mt-2.5 w-full rounded-[var(--radius-row)] px-4 py-2.5 text-2xs font-extrabold tracking-[0.08em] text-[var(--n-10)]"
        >
          {nudge.action} ▸
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
