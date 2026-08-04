"use client";

import { AnimatePresence, motion } from "framer-motion";

import { haptic } from "@/lib/haptics";
import { SWAP } from "@/components/ui/Motion";

import { Glass } from "@/components/ui/Glass";
import { monthBadge, monthBadgeLabel } from "@/lib/engine/format";

/**
 * The heartbeat. Two states, visibly different:
 *   ADVANCE MONTH ▸ — orange glass, free, moves time (11 months of the year)
 *   CLOSE THE YEAR ▸ — gold, heavier, LOCKED. Tapping opens the camera.
 *
 * Months are free; years are earned out loud. Nothing else advances time.
 *
 * ── Two capsules, not three stacked elements ────────────────────────────────
 *
 * There used to be a twelve-tick meter above the button and a MONTH 4 OF 12
 * caption below it. Both said the same thing, neither was the material the rest
 * of the chrome is made of, and between them they wrapped the one control
 * anybody touches in two rows of decoration. They are one glass capsule now —
 * MAY → JUN — sitting beside the button, saying where the year is and where the
 * tap takes it.
 *
 * ── The change of state is the moment, and it used to be a repaint ────────
 *
 * Reaching month 12 is the whole shape of this game — eleven free taps, then
 * the year asks to be defended out loud. This control is the only thing that
 * announces it, and the announcement was a bare ternary: the label, the lock
 * glyph and the MAY→JUN badge all swapped between two frames, with nothing but
 * an inherited `background-color 200ms` from `.nv-gc` carrying any of it.
 *
 * `AnimatePresence mode="wait"` now crossfades the two buttons through each
 * other, and the badge is keyed so its text crossfades with them. The gate
 * arrives rather than appearing. Nothing about the two states changed — the
 * accent still moves from action orange to prestige gold, the lock still
 * lands — but they now land together, on one clock.
 *
 * This is the DOM chrome: the web, Android, and any iOS device the native
 * chrome declined. On iOS 26 the identical composition is real UIKit Liquid
 * Glass and this component is not rendered at all — see
 * components/native/usePlayChrome.ts, which authors the same two strings from
 * the same helpers so the two renderers can never drift.
 */
export function AdvanceButton({
  month,
  year,
  atGate,
  disabled,
  onAdvance,
  onOpenGate,
}: {
  month: number;
  year: number;
  atGate: boolean;
  disabled?: boolean;
  onAdvance: () => void;
  onOpenGate: () => void;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl items-stretch gap-2 px-4">
      <Glass
        // The one control that moves time, wearing the one colour that asks
        // you to do something — as a tint in the material, not a fill over it.
        tone={atGate ? "prestige" : "action"}
        className={`min-w-0 flex-1 overflow-hidden rounded-[var(--radius-pill)] transition-opacity duration-150 ${
          disabled ? "opacity-45" : ""
        }`}
      >
        {/* mode="wait" so the outgoing label is gone before the incoming one
            arrives: a 14-unit-tall capsule holding two overlapping strings for
            200 ms reads as a glitch, not as a change. */}
        <AnimatePresence mode="wait" initial={false}>
          {atGate ? (
            <motion.button
              key="gate"
              type="button"
              onClick={() => {
                haptic("yearClosed");
                onOpenGate();
              }}
              disabled={disabled}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={SWAP}
              className="flex h-14 w-full items-center justify-center gap-2 text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--on-prestige)] nv-press disabled:cursor-not-allowed"
            >
              <LockGlyph />
              CLOSE THE YEAR
              <span aria-hidden="true">▸</span>
            </motion.button>
          ) : (
            <motion.button
              key="advance"
              type="button"
              onClick={onAdvance}
              disabled={disabled}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={SWAP}
              className="flex h-14 w-full items-center justify-center gap-2 text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--on-action)] nv-press disabled:cursor-not-allowed"
            >
              ADVANCE MONTH
              <span aria-hidden="true">▸</span>
            </motion.button>
          )}
        </AnimatePresence>
      </Glass>

      {/* Where the year is and where the tap takes it. Untinted, so the accent
          stays on the control that acts — and a figure the player reads rather
          than presses, which is why it is a span and not a second button. */}
      <Glass className="flex shrink-0 items-center rounded-[var(--radius-pill)] px-4">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            // Keyed on the text, so MAY → JUN crossfades on the same clock as
            // the button beside it rather than swapping a frame apart.
            key={monthBadge(month, year, atGate)}
            aria-label={monthBadgeLabel(month, year, atGate)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SWAP}
            className={`whitespace-nowrap text-xs font-bold tracking-[0.08em] ${
              atGate ? "text-[var(--color-prestige)]" : "text-[var(--text-primary)]"
            }`}
          >
            {monthBadge(month, year, atGate)}
          </motion.span>
        </AnimatePresence>
      </Glass>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="13" height="15" viewBox="0 0 13 15" fill="none" aria-hidden="true">
      <path
        d="M3 6V4a3.5 3.5 0 1 1 7 0v2"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <rect x="1.5" y="6" width="10" height="7.5" rx="1.6" fill="currentColor" />
    </svg>
  );
}
