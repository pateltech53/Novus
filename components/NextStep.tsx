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
        /* Named so a probe can measure it. This card is the LAST thing in the
           phone flow whenever it renders, which makes it the one element that
           can end up under the dock and under the fade above the dock — see
           `npm run test:home:fold`, which now fails if it does. */
        data-nudge="next-step"
        className="nv-gc relative mx-3 mt-2 rounded-[var(--radius-card)]"
      >
        {/*
          ── The card IS the button ────────────────────────────────────────

          It used to carry a full-width action button of its own under the
          copy, which cost 48px to repeat what the card already said and made
          this 131px on a screen that measures its slack in tens. On a phone
          that mattered: the row under it is the log, the fixed dock is under
          that, and 131px was the difference between "there is more below" and
          a card sliced in half by the dock — which is exactly what it was
          reported as.

          So the whole surface opens the tab, the chevron says so, and the ✕
          sits above it in the stacking order rather than inside it, because a
          dismiss nested in a button is a tap that does both.
        */}
        <button
          type="button"
          onClick={() => {
            haptic("choice");
            onOpen(nudge.tab);
          }}
          className="nv-press-row flex w-full items-start gap-3 rounded-[var(--radius-card)] p-3 text-left"
        >
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold leading-snug text-[var(--text-primary)]">
              {nudge.title}
            </span>
            <span className="mt-0.5 block text-2xs leading-snug text-[var(--text-secondary)]">
              {nudge.body}
            </span>
            <span className="mt-1 block text-2xs font-extrabold tracking-[0.08em] text-[var(--n-10)]">
              {nudge.action} ▸
            </span>
          </span>
          {/* The dismiss's own footprint, kept out of the label so the row's
              text never runs under it. */}
          <span aria-hidden="true" className="h-[30px] w-[30px] shrink-0" />
        </button>

        <button
          type="button"
          onClick={() => setDismissed((d) => [...d, key])}
          aria-label="Dismiss this suggestion"
          /* 30px minimum, the bar `npm run audit:phone` enforces. */
          className="nv-press absolute right-2 top-2 flex h-[30px] w-[30px] items-center justify-center rounded-[var(--radius-chip)] text-[var(--text-tertiary)]"
        >
          <span aria-hidden="true" className="text-sm leading-none">
            ✕
          </span>
        </button>
      </motion.div>
    </AnimatePresence>
  );
}
