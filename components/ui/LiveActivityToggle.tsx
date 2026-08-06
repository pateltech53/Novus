"use client";

import { useEffect, useState } from "react";
import {
  liveActivitiesEnabled,
  probeOutside,
  setLiveActivitiesEnabled,
  useOutsideCapabilities,
} from "@/lib/outside/publish";

/**
 * Whether the company is allowed on the lock screen.
 *
 * This governs Live Activities and nothing else. A home screen widget is not
 * behind a switch, because a widget exists only because the player went and
 * placed it; an activity puts itself there, so it asks.
 *
 * The row is absent entirely where the question does not arise — Android, the
 * web, an iOS below the extension's floor, and an iPhone where the player has
 * already turned Live Activities off system-wide. A switch that cannot change
 * anything is worse than no switch: it says the feature is broken.
 */
export function LiveActivityToggle() {
  const caps = useOutsideCapabilities();
  // Read on mount rather than at module scope: the stored value is only known
  // in the browser, and reading it during render would desync hydration.
  const [on, setOn] = useState(true);
  useEffect(() => {
    setOn(liveActivitiesEnabled());
    void probeOutside();
  }, []);

  if (!caps.available || !caps.liveActivities) return null;

  const toggle = () => {
    const next = !on;
    setOn(next);
    // Takes the activity down immediately when it goes off — waiting for the
    // next publish means waiting for the next tap that moves time, which may
    // be tomorrow.
    setLiveActivitiesEnabled(next);
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={toggle}
      className="nv-gc flex w-full items-center justify-between rounded-[var(--radius-row)] px-4 py-3.5 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-[var(--text-primary)]">
          Company on the Lock Screen
        </span>
        <span className="mt-0.5 block text-2xs leading-snug text-[var(--text-tertiary)]">
          {on
            ? "Runway, the month, and the year gate — in the Dynamic Island while you are out of the app."
            : "Off. The Books are still on your Home Screen if you have the widget."}
        </span>
      </span>

      {/* Same track as the sound switch: the material, flat, because this
          control has already blurred what is behind it. */}
      <span
        aria-hidden="true"
        className={`nv-gc nv-flat ml-3 flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 ${
          on ? "nv-t-action" : ""
        }`}
      >
        <span
          // Fixed white, not --n-11: the knob rides on the action orange in
          // both themes, so it must not follow the neutral ramp.
          className={`h-6 w-6 rounded-full bg-white shadow-[var(--e1)] transition-transform duration-200 ease-[var(--ease-out)] ${
            on ? "translate-x-5" : "translate-x-0"
          }`}
        />
      </span>
    </button>
  );
}
