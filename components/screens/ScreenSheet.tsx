"use client";

import { motion } from "framer-motion";

import { Glass, GlassScrim } from "@/components/ui/Glass";

/**
 * The shell every activity tab opens into.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Company, Team, Product and Assets were four copies of the same forty lines —
 * the same `fixed inset-0`, the same `max-h-[88dvh]` sheet, the same spring,
 * the same header row, the same CLOSE chip. Four copies is how three of them
 * end up with a glass header and the fourth does not, and nobody notices until
 * a player opens them back to back.
 *
 * ── What it gives them that they did not have ───────────────────────────────
 *
 * **A scrim that is actually glass.** design.md has listed the modal scrim as
 * a glass surface from the beginning; these sheets rendered it as a flat fill,
 * so the board behind them went dark rather than out of focus.
 *
 * **A header that stays.** The header used to be the first thing in a
 * scrolling column, so the title and the way out both left the screen the
 * moment a player read anything. It is pinned now, and it is glass — which is
 * the exact clause design.md allows glass under, "a sheet header once content
 * scrolls under it". The content genuinely scrolls under it: the section is
 * the scroll container and the header is `sticky top-0` inside it, so the
 * roster or the ledger passes beneath a pane rather than being clipped by a
 * bar.
 *
 * **A grabber**, solid, on the glass. Deliberately not glass itself: a glass
 * pill on a glass header is glass behind glass, which is the smudge this app
 * just finished deleting from the top of the play screen.
 *
 * `subnav` rides inside the pinned header rather than under it. Assets is the
 * only caller with one, and a segmented control that scrolls away is a control
 * you have to go and find.
 */
export function ScreenSheet({
  label,
  closeLabel,
  onClose,
  eyebrow,
  title,
  blurb,
  subnav,
  children,
}: {
  /** The dialog's accessible name. */
  label: string;
  /** What the scrim's tap does — "Close the team screen". */
  closeLabel: string;
  onClose: () => void;
  /** A small line above the title. Company is the only caller with one. */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /**
   * The line under the title. Every screen has one; it is what the screen is
   * for.
   *
   * Prose, and only prose. This header is glass, and "money is read on solid
   * ground" is not relaxed by a surface being chrome — a figure that belongs
   * here belongs in the body instead, which is where Company's equity line
   * went when this header stopped being opaque.
   */
  blurb?: React.ReactNode;
  /** Pinned with the header. A segmented control, where a screen has one. */
  subnav?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      <GlassScrim label={closeLabel} onClose={onClose} />

      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={label}
        className="relative flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[1.75rem] bg-[var(--sheet)] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--e3)]"
        initial={{ y: "8%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      >
        <Glass
          as="header"
          /*
           * The radius is repeated here on purpose. The section clips its own
           * corners, but a `backdrop-filter` element establishes a stacking
           * context of its own and Safari has been known to paint one past a
           * rounded ancestor's clip — a square glass corner over a rounded
           * sheet is the kind of thing that only shows up on a device.
           */
          className="sticky top-0 z-10 shrink-0 rounded-t-[1.75rem] px-5 pt-2.5 pb-3.5"
        >
          <div
            aria-hidden="true"
            className="mx-auto mb-2.5 h-[5px] w-9 rounded-full bg-[var(--n-6)]"
          />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {eyebrow ? (
                <p className="truncate text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                  {eyebrow}
                </p>
              ) : null}
              <h2 className="truncate text-xl font-extrabold tracking-[-0.01em]">{title}</h2>
            </div>
            {/* Solid, on the glass. See the note on the grabber. */}
            <button
              type="button"
              onClick={onClose}
              className="nv-press shrink-0 rounded-full bg-[var(--chip)] px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
            >
              CLOSE
            </button>
          </div>
          {subnav ? <div className="mt-3">{subnav}</div> : null}
        </Glass>

        {/*
          Below the pinned header, not inside it.

          Assets' line runs to five lines at 320px, and pinned that was half the
          sheet permanently given over to a sentence you read once. What has to
          stay reachable is the title, the way out and the control that changes
          what you are looking at; the description of it can scroll away like
          everything else it describes.
        */}
        {blurb ? (
          <div className="px-5 pt-3.5 text-sm leading-snug text-[var(--text-secondary)]">
            {blurb}
          </div>
        ) : null}

        {children}
      </motion.section>
    </motion.div>
  );
}
