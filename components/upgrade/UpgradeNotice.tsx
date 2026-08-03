"use client";

import { motion } from "framer-motion";
import { Glass } from "@/components/ui/Glass";
import { EXIT, SHEET_SPRING } from "@/components/ui/Motion";
import type { Gate } from "@/lib/upgrade";

/**
 * The notification a free player gets when something refuses them.
 *
 * ── Why it comes from the top ───────────────────────────────────────────────
 *
 * The obvious place for a toast is the bottom, and the bottom is taken: /play
 * fixes the advance button and the tab bar there, the in-game phone puts its
 * dock there, and on iOS all three are UIKit views that composite ABOVE the
 * webview — a bottom toast would not merely crowd them, it would render behind
 * them. From the top it also reads as what it is: a notification arriving, the
 * same gesture the player's own phone makes.
 *
 * ── Why it is Glass, and why it is Glass's opaque half ──────────────────────
 *
 * design.md sanctions glass for exactly one content-shaped thing — toasts — and
 * in the next breath forbids it over the WebGL canvas, because compositing a
 * backdrop-filter over a live canvas janks on iOS Safari and will not reproduce
 * in a desktop browser. On a phone /play opens with the mascot stage at the top
 * of the scroll, which is precisely where this banner lands.
 *
 * So it takes `solid` unconditionally rather than a prop each caller has to
 * reason about — a gate can fire from six screens and getting it wrong on one
 * of them buys stutter on the one device that matters. What that keeps is the
 * rest of the material: the specular top edge, the hairline ring and the
 * underside, so the banner still reads as the same component the tab bar and
 * the phone dock are made of, just without a blur nobody can see behind a
 * notification anyway.
 *
 * ── The accent it does not spend ────────────────────────────────────────────
 *
 * §1.5 allows `--color-action` on one element per screen and /play has already
 * spent it on ADVANCE MONTH. So the button here is prestige gold, which is what
 * every PRO badge in the app is already wearing — the notification arrives in
 * the colour the thing it is about has always been.
 */
export function UpgradeNotice({
  gate,
  onOpen,
  onDismiss,
}: {
  gate: Gate;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[96] flex justify-center px-3 pt-[max(0.75rem,env(safe-area-inset-top))] sm:justify-end sm:px-4"
      role="status"
      aria-live="polite"
    >
      <motion.div
        className="pointer-events-auto w-full max-w-[26rem] sm:w-[22rem]"
        initial={{ y: -18, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: -12, opacity: 0, transition: EXIT }}
        transition={SHEET_SPRING}
      >
        <Glass
          as="section"
          solid
          aria-label="Novus Pro"
          className="rounded-[var(--radius-card)] px-4 py-3.5 shadow-[var(--e3)]"
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-extrabold leading-snug [overflow-wrap:anywhere]">
                {gate.title}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                {gate.body}
              </p>
            </div>

            {/* Square, iconless, and labelled for the screen reader rather than
                drawn as a glyph the sentence beside it already implies. */}
            <button
              type="button"
              onClick={onDismiss}
              aria-label="Dismiss"
              className="nv-gc nv-flat nv-t-quiet -mr-1 -mt-1 grid h-8 w-8 shrink-0 place-items-center rounded-full"
            >
              <CloseGlyph />
            </button>
          </div>

          <button
            type="button"
            onClick={onOpen}
            className="nv-gc nv-flat mt-3 h-11 w-full rounded-[var(--radius-pill)] nv-t-prestige text-2xs font-extrabold tracking-[0.14em]"
          >
            SEE WHAT PRO ADDS
          </button>
        </Glass>
      </motion.div>
    </div>
  );
}

function CloseGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
      <path
        d="M1 1l9 9M10 1l-9 9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  );
}
