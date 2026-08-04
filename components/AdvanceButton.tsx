"use client";

import { haptic } from "@/lib/haptics";

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
        {atGate ? (
          <button
            type="button"
            onClick={() => {
              haptic("yearClosed");
              onOpenGate();
            }}
            disabled={disabled}
            className="flex h-14 w-full items-center justify-center gap-2 text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--on-prestige)] transition-transform duration-150 ease-[var(--ease-out)] nv-press disabled:cursor-not-allowed"
          >
            <LockGlyph />
            CLOSE THE YEAR
            <span aria-hidden="true">▸</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={onAdvance}
            disabled={disabled}
            className="flex h-14 w-full items-center justify-center gap-2 text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--on-action)] transition-transform duration-150 ease-[var(--ease-out)] nv-press disabled:cursor-not-allowed"
          >
            ADVANCE MONTH
            <span aria-hidden="true">▸</span>
          </button>
        )}
      </Glass>

      {/* Where the year is and where the tap takes it. Untinted, so the accent
          stays on the control that acts — and a figure the player reads rather
          than presses, which is why it is a span and not a second button. */}
      <Glass className="flex shrink-0 items-center rounded-[var(--radius-pill)] px-4">
        <span
          aria-label={monthBadgeLabel(month, year, atGate)}
          className={`whitespace-nowrap text-xs font-bold tracking-[0.08em] ${
            atGate ? "text-[var(--color-prestige)]" : "text-[var(--text-primary)]"
          }`}
        >
          {monthBadge(month, year, atGate)}
        </span>
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
