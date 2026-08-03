"use client";

import { useGame } from "@/lib/state/GameProvider";

/**
 * Rookie Mode, on or off.
 *
 * It lived on the Company sheet, beside the sound switch, on the reasoning
 * that both are how the player wants to be spoken to. That reasoning was
 * right about the pairing and wrong about the address: neither switch is
 * about the company's numbers, and Settings' own header says exactly what
 * they are — "how the player wants to be spoken to". So the pair moved here
 * together, and the Company sheet is company data and actions again.
 *
 * The row is SoundToggle's, deliberately: two preferences that sit in one
 * group should not have two anatomies.
 */
export function RookieToggle() {
  const { run, setRookieMode } = useGame();
  if (!run) return null;

  const on = run.rookieMode;

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setRookieMode(!on)}
      className="nv-gc flex w-full items-center justify-between rounded-[var(--radius-row)] px-4 py-3.5 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--text-primary)]">
          Rookie Mode
        </span>
        <span className="mt-0.5 block text-2xs leading-snug text-[var(--text-tertiary)]">
          Adds a plain-English line under every term. The real word stays.
        </span>
      </span>

      {/* The track matches SoundToggle's for the reason given there: inside a
          control that already blurred its backdrop, a second pass is a smudge. */}
      <span
        aria-hidden="true"
        className={`nv-gc nv-flat ml-3 flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 ${
          on ? "nv-t-action" : ""
        }`}
      >
        <span
          className={`h-6 w-6 rounded-full bg-white shadow-[var(--e1)] transition-transform duration-200 ease-[var(--ease-out)] ${
            on ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}
