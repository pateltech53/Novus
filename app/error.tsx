"use client";

import { useEffect } from "react";
import { isNative } from "@/lib/native/platform";

/**
 * What a render throw looks like, instead of nothing.
 *
 * ── Why this file did not exist, and why that was expensive ─────────────────
 *
 * There was no `error.tsx`, `global-error.tsx` or `not-found` boundary anywhere
 * under `app/` — so any throw during render unwound to Next's default, which in
 * production is an unstyled black page reading "Application error: a
 * client-side exception has occurred".
 *
 * On the web that is bad. In the shipped app it is terminal: the store build
 * runs inside a Capacitor webview with `webContentsDebuggingEnabled: false`
 * (capacitor.config.ts:64), so there is no console, no reload gesture, no URL
 * bar and no way back. The player's only recovery is to force-quit — and
 * because the app boots straight into `/play`, a throw that reproduces on a
 * saved run makes the game unopenable rather than merely broken once.
 *
 * So this offers the two recoveries that actually exist, in order of how much
 * they cost the player:
 *
 *   · `reset()` — re-render the segment. Fixes anything transient.
 *   · the front door — a full reload of the app's real entry point, which is
 *     `/boot.html` in the shell and `/` on the web. It re-reads the save from
 *     localStorage, so a run survives this.
 *
 * The run is NEVER touched here. A crash is not evidence that the save is bad,
 * and a boundary that clears it would turn one bad frame into a lost company.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The one place a stack can still be read: a webview attached to Xcode or
    // Android Studio during development. `digest` is what a production build
    // gives instead of a message, and it is what makes a bug report actionable.
    console.error("[novus] render error", error.digest ?? "", error);
  }, [error]);

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 text-center">
      <div>
        <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
          SOMETHING BROKE
        </p>
        <h1 className="mt-2 text-xl font-extrabold tracking-[-0.01em]">
          The screen failed to draw.
        </h1>
        <p className="mx-auto mt-2 max-w-[22rem] text-sm leading-snug text-[var(--text-secondary)]">
          Your company is saved. This is the screen, not the run — try drawing it
          again, and if it fails twice, go back to the front door.
        </p>
      </div>

      <div className="flex w-full max-w-[20rem] flex-col gap-2.5">
        <button
          type="button"
          onClick={reset}
          className="nv-gc h-14 w-full rounded-[var(--radius-pill)] nv-t-action text-base font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
        >
          TRY AGAIN ▸
        </button>
        <button
          type="button"
          // A full document load, not a router push: the router is part of what
          // may be wedged, and this has to work when it is.
          onClick={() => {
            window.location.href = isNative() ? "/boot.html" : "/";
          }}
          className="h-12 w-full rounded-[var(--radius-pill)] text-sm font-bold text-[var(--text-secondary)]"
        >
          Back to the front door
        </button>
      </div>

      {error.digest ? (
        <p className="tnum text-2xs text-[var(--text-tertiary)]">
          Reference {error.digest}
        </p>
      ) : null}
    </main>
  );
}
