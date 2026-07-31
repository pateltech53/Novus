"use client";

import { haptic } from "@/lib/haptics";

import { YEAR_END_MONTH } from "@/lib/engine/constants";

/**
 * The heartbeat. Two states, visibly different:
 *   ADVANCE MONTH ▸ — orange pill, free, moves time (11 months of the year)
 *   CLOSE THE YEAR ▸ — gold, heavier, LOCKED. Tapping opens the camera.
 *
 * Months are free; years are earned out loud. Nothing else advances time.
 */
export function AdvanceButton({
  month,
  atGate,
  disabled,
  onAdvance,
  onOpenGate,
}: {
  month: number;
  atGate: boolean;
  disabled?: boolean;
  onAdvance: () => void;
  onOpenGate: () => void;
}) {
  return (
    <div className="mx-auto w-full max-w-2xl px-4">
      <YearMeter month={month} atGate={atGate} />
      {atGate ? (
        <button
          type="button"
          onClick={() => {
            haptic("yearClosed");
            onOpenGate();
          }}
          disabled={disabled}
          className="flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] bg-[var(--color-prestige)] text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--on-prestige)] shadow-[var(--e3)] transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60"
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
          className="flex h-14 w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] bg-[var(--action)] text-[1.0625rem] font-extrabold tracking-[0.04em] text-[var(--on-action)] shadow-[var(--e3)] transition-transform duration-150 ease-[var(--ease-out)] active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-45"
        >
          ADVANCE MONTH
          <span aria-hidden="true">▸</span>
        </button>
      )}
      <p className="mt-1.5 text-center text-2xs font-semibold tracking-[0.12em] text-[var(--text-tertiary)]">
        {atGate
          ? "THE YEAR DOES NOT CLOSE UNTIL YOU PITCH"
          : `MONTH ${month} OF ${YEAR_END_MONTH}`}
      </p>
    </div>
  );
}

/** Twelve ticks filling toward the gold gate — the year made visible. */
function YearMeter({ month, atGate }: { month: number; atGate: boolean }) {
  return (
    <div className="mb-2.5 flex gap-[3px]" aria-hidden="true">
      {Array.from({ length: YEAR_END_MONTH }, (_, i) => {
        const filled = i < month;
        const isGate = i === YEAR_END_MONTH - 1;
        return (
          <span
            key={i}
            className={`h-[3px] flex-1 rounded-full transition-colors duration-300 ${
              isGate
                ? atGate
                  ? "bg-[var(--color-prestige)]"
                  : "bg-[var(--color-prestige)]/35"
                : filled
                  ? "bg-[var(--n-8)]"
                  : "bg-[var(--hairline)]"
            }`}
          />
        );
      })}
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
