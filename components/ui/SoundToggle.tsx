"use client";

import { useEffect, useState } from "react";
import { isMuted, setMuted, stopAll } from "@/lib/sound";

/**
 * Sound effects, on or off.
 *
 * The switch is the single gate — `play()` checks it before touching an audio
 * element, so a cue added next week is muted by it automatically and cannot
 * leak through. Turning it off also stops anything already sounding, including
 * the ambient bed under The Tank; leaving a loop running under a mute switch is
 * the classic way this goes wrong.
 *
 * The preference persists, and it is the player's, not the app's.
 */
export function SoundToggle() {
  // Read on mount rather than at module scope: the stored value is only known
  // in the browser, and reading it during render would desync hydration.
  const [off, setOff] = useState(false);
  useEffect(() => setOff(isMuted()), []);

  const toggle = () => {
    const next = !off;
    setOff(next);
    setMuted(next);
    if (next) stopAll();
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={!off}
      onClick={toggle}
      // The switch must not click when you use it to turn clicking off.
      data-sfx="none"
      className="nv-press flex w-full items-center justify-between rounded-[var(--radius-row)] bg-[var(--surface)] px-4 py-3.5 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--text-primary)]">
          Sound effects
        </span>
        <span className="mt-0.5 block text-2xs leading-snug text-[var(--text-tertiary)]">
          {off
            ? "Off. The game plays exactly the same — every cue has something on screen."
            : "Clicks, cash, the room tone under The Tank."}
        </span>
      </span>

      <span
        aria-hidden="true"
        className={`ml-3 flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors duration-200 ${
          off ? "bg-[var(--n-5)]" : "bg-[var(--action)]"
        }`}
      >
        <span
          // Fixed white, not --n-11: the knob rides on the action orange in
          // both themes, so it must not follow the ramp — in light mode
          // --n-11 is near-black and the switch read as broken.
          className={`h-6 w-6 rounded-full bg-white shadow-[var(--e1)] transition-transform duration-200 ease-[var(--ease-out)] ${
            off ? "translate-x-0" : "translate-x-5"
          }`}
        />
      </span>
    </button>
  );
}
