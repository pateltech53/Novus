"use client";

import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { RunState } from "@/lib/engine/types";
import { nextStep, type Nudge } from "@/lib/engine/nudges";
import { ENTER } from "@/components/ui/Motion";
import { haptic } from "@/lib/haptics";

/**
 * WHICH NUDGE IS UP, for whichever renderer is drawing it.
 *
 * The page owns this rather than the card owning it, because on iOS the card
 * is not this component at all — it is a UIKit panel above the deck, pushed
 * through `usePlayChrome` (see GlassChromeController.buildNudge). Two
 * renderers, one answer to "is there a nudge and has it been dismissed": if
 * the state lived in the DOM card, closing the native one would leave the web
 * one still open for every fallback path — no plugin, an older OS, Android,
 * the browser — and the two would disagree the moment the chrome handed back.
 *
 * Dismissal is held for the current game month and for that nudge only. Advance
 * time and a nudge that is STILL true comes back once, which is the honest
 * cadence for "this is still costing you". One that stopped being true never
 * returns, because `nextStep` recomputes from the run rather than a checklist.
 */
export function useNudge(run: RunState | null): {
  nudge: Nudge | null;
  dismiss: (id: string) => void;
} {
  /** `${nudge.id}:${year}:${month}` for everything dismissed so far. */
  const [dismissed, setDismissed] = useState<string[]>([]);

  // Nullable because the page runs its hooks before it knows whether a run
  // loaded — /play renders a skeleton until storage answers, and a hook cannot
  // be called conditionally.
  const nudge = useMemo(() => {
    if (!run) return null;
    const next = nextStep(run);
    if (!next) return null;
    return dismissed.includes(`${next.id}:${run.year}:${run.month}`)
      ? null
      : next;
  }, [run, dismissed]);

  const dismiss = useCallback(
    (id: string) => {
      if (!run) return;
      setDismissed((d) => [...d, `${id}:${run.year}:${run.month}`]);
    },
    [run],
  );

  return { nudge, dismiss };
}

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
 * ── Why it floats, having spent its whole life in the flow ────────────────
 *
 * It used to sit in the document, under the log row, and the comment here said
 * that was the point: not a modal, not a toast, no taps to get past. What that
 * reasoning missed is where the end of this document IS on a phone. The play
 * screen is a scrolling page with a fixed dock over its foot, and the flow
 * above this card — masthead, The Books, the log row — is already taller than
 * an iPhone 15 Pro. So "in the flow, after the log row" resolved to "past the
 * bottom of the screen", and a nudge you have to go looking for is not a nudge.
 * Reported twice, the second time as: it is down there and I cannot tap it.
 *
 * So on a phone it is pinned to the viewport, immediately above whatever
 * chrome the platform is drawing — the measured DOM dock, or the height UIKit
 * reports for its own deck. It cannot be scrolled away from and it is inside
 * thumb reach, which is the whole of what "one thing worth doing" was for.
 *
 * That makes it a toast, which design.md §3 lists among the surfaces this app
 * floats — the same allowance the term-on-first-use note has, and the same
 * bargain: it is up for as long as it is true, it covers the log row while it
 * is, and the ✕ gives that row straight back. It is still not a modal — it
 * blocks nothing, it takes no tap to get past, and everything under it stays
 * live.
 *
 * Desktop keeps it in the flow. The working column there is a thousand
 * pixels with the nudge sitting mid-way up it, visible without scrolling and
 * with nothing fixed over the foot of it — the problem this solves does not
 * exist on that composition, and floating it would only cover a log that has
 * its own column.
 */
export function NextStep({
  nudge,
  onOpen,
  onDismiss,
  bottom,
}: {
  /** From `useNudge`, which the page owns — see the hook above for why. */
  nudge: Nudge | null;
  /** Opens the tab this nudge is about — the page owns the activity state. */
  onOpen: (tab: "product" | "team") => void;
  onDismiss: (id: string) => void;
  /**
   * How much chrome stands under it on a phone, as a CSS length.
   *
   * The page owns this number and there is no way to derive it from here: on
   * the web it is the dock's measured height, which changes with the term
   * coach and with a second row of tabs under 360px, and in the app the dock
   * is a UIKit view that reports itself through `--nv-chrome-bottom`. Ignored
   * at `lg`, where the card is static again.
   */
  bottom: string;
}) {
  if (!nudge) return null;

  return (
    <AnimatePresence>
      <motion.div
        key={nudge.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 8 }}
        transition={{ ...ENTER }}
        /* Named so a probe can find it. `npm run test:home:fold` loads the
           screen, does not scroll, and hit-tests this card and its ✕ with
           `elementFromPoint` — the literal form of the report that it could
           not be tapped. Geometry alone would not have caught it. */
        data-nudge="next-step"
        /* Through a custom property rather than as `style={{ bottom }}`, so
           that `desk:static` can drop it on desktop. An inline declaration beats
           a stylesheet rule whatever media query that rule is in.

           `z-30` clears the dock's `z-20` and, with it, the fade the dock
           hangs above itself: the card is over that wash rather than under it,
           which is the other half of what "cut off" meant. */
        style={{ "--nudge-bottom": bottom } as CSSProperties}
        /*
          ── The placement is a WRAPPER, and it has to be ────────────────────

          `.nv-gc` — the material every control in this app is made of — sets
          `position: relative` itself, and it is a single class, so it ties
          with Tailwind's `.fixed` on specificity and wins on source order:
          globals.css is emitted after the utilities. Putting `fixed` beside
          `nv-gc` on one element therefore does nothing at all, silently, and
          the card renders exactly where it always did. Measured: computed
          `position` stayed `relative` with `bottom: 186px` sitting inert on it.

          So placement lives out here on a plain div and the material stays on
          the card inside. `desk:static` then genuinely drops the float on
          desktop, because a static box ignores `inset` and `bottom` both.
        */
        /* max-w-2xl + mx-auto: pinned above the dock it must stay the width
           of the controls it sits over, not the window's — an iPad-wide
           nudge card is a banner, not a nudge. */
        className="fixed inset-x-3 bottom-[var(--nudge-bottom)] z-30 mx-auto max-w-2xl desk:static desk:mx-3 desk:mt-2"
      >
        <div className="nv-gc relative rounded-[var(--radius-card)] shadow-[var(--e3)] desk:shadow-none">
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
            onClick={() => onDismiss(nudge.id)}
            aria-label="Dismiss this suggestion"
            /* 30px minimum, the bar `npm run audit:phone` enforces. */
            className="nv-press absolute right-2 top-2 flex h-[30px] w-[30px] items-center justify-center rounded-[var(--radius-chip)] text-[var(--text-tertiary)]"
          >
            <span aria-hidden="true" className="text-sm leading-none">
              ✕
            </span>
          </button>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
