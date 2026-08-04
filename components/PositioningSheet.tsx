"use client";

import { motion } from "framer-motion";
import { ENTER, EXIT, SCRIM } from "@/components/ui/Motion";
import { haptic } from "@/lib/haptics";
import type { GameEvent, Industry } from "@/lib/engine/types";
import {
  STANCE_AXES,
  stanceLabel,
  stanceOptionsFor,
  type Positioning,
  type Stance,
} from "@/lib/engine/positioning";

/**
 * The stance question (Addendum B §5.3), asked at first market contact — never
 * at founding. The axis states itself in the industry's own vocabulary; the
 * three rows are the three stances.
 *
 * Deliberately absent (§9.4/§9.5): consequence chips, stat previews, anything
 * numeric. This is a claim the player will back or contradict for years — the
 * sheet's only honest disclosure is that the market is listening.
 *
 * Two ways in:
 *   - a drawn E-POS-ASK-* card (pass it as `event`; onChoose maps to its
 *     choices via STANCE_CHOICE_ORDER upstream)
 *   - the Year-2 fallback with no card (event omitted; onChoose calls
 *     setStance directly)
 * Repositioning reuses the same sheet: pass current `positioning` and the
 * player's existing answer is marked, with a warning that changing it costs.
 */
export function PositioningSheet({
  industry,
  event,
  positioning,
  onChoose,
  onDismiss,
}: {
  industry: Industry;
  /** Frozen ask-event driving this moment, when there is one. */
  event?: GameEvent | null;
  /** Current positioning — present only when this is a repositioning. */
  positioning?: Positioning | null;
  onChoose: (stance: Stance) => void;
  onDismiss: () => void;
}) {
  const axis = STANCE_AXES[industry];
  const options = stanceOptionsFor(industry);
  const current = positioning?.stance ?? null;

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: EXIT }}
      transition={SCRIM}
    >
      <div className="absolute inset-0 bg-[var(--scrim)]" onClick={onDismiss} />
      <motion.section
        role="dialog"
        aria-modal="true"
        aria-labelledby="positioning-title"
        className="relative flex max-h-[92dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[var(--radius-sheet)] bg-[var(--sheet)] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--e3)]"
        initial={{ y: "6%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: "6%", opacity: 0, transition: EXIT }}
        transition={ENTER}
      >
        <p className="px-5 pt-5 text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
          POSITIONING
        </p>

        <h2
          id="positioning-title"
          className="px-5 pt-2 text-[1.375rem] font-extrabold leading-[1.15] tracking-[-0.01em]"
          style={{ overflowWrap: "anywhere" }}
        >
          {axis.question}
        </h2>

        <p className="px-5 pt-2.5 text-[0.9375rem] leading-[1.55] text-[var(--text-secondary)]">
          {event
            ? (event.reskins?.[industry] ?? event.text)
            : "The market is about to file you somewhere. Choose the drawer, or it gets chosen for you."}
        </p>

        {current && positioning && (
          <p className="mx-5 mt-3.5 rounded-[var(--radius-row)] bg-[var(--chip)] p-3 text-xs leading-snug text-[var(--text-secondary)]">
            <span className="font-bold uppercase tracking-wide text-[var(--text)]">
              {stanceLabel(current)}
            </span>
            {" — your answer since Year "}
            {positioning.heldSinceYear}
            {". Changing it is allowed. It is never free."}
          </p>
        )}

        <ul className="mt-4 space-y-2 px-3 pb-1">
          {options.map((opt) => {
            const isCurrent = opt.stance === current;
            return (
              <li key={opt.stance}>
                <button
                  type="button"
                  onClick={() => {
                    haptic("choice");
                    // Re-choosing your own stance is not a decision.
                    if (isCurrent) onDismiss();
                    else onChoose(opt.stance);
                  }}
                  className="nv-card flex w-full flex-col items-start gap-1 px-4 py-3.5 text-left nv-press-row"
                >
                  <span className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                    {stanceLabel(opt.stance).toUpperCase()}
                    {isCurrent && (
                      <span className="ml-2 text-[var(--action)]">
                        YOUR ANSWER TODAY
                      </span>
                    )}
                  </span>
                  <span className="text-[0.9375rem] font-semibold leading-snug">
                    {opt.label}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        {/* §5.4's labeling rule for the strategy side, verbatim. */}
        <p className="px-5 pt-3 text-xs text-[var(--text-tertiary)]">
          This changes how the market reads you.
        </p>

        {!current && (
          <button
            type="button"
            onClick={onDismiss}
            className="mx-5 mt-3 self-start text-xs font-bold tracking-[0.08em] text-[var(--text-tertiary)] underline-offset-2 hover:underline"
          >
            Not yet
          </button>
        )}
      </motion.section>
    </motion.div>
  );
}
