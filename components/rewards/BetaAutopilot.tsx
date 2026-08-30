"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { useGame } from "@/lib/state/GameProvider";

/**
 * BETA — drive a run to the year-end tank without playing it.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The tank is behind a fiscal year. Testing the panel — the questions, the
 * offers, the counter, the debrief, and now four daily missions that only the
 * panel can complete — meant twelve advances and a dozen event cards first,
 * every single time. That is minutes of tapping per attempt, and it is the
 * reason a bug in the last beat of the panel goes unnoticed.
 *
 * ── What it actually does ───────────────────────────────────────────────────
 *
 * Nothing a player could not do by hand. It taps ADVANCE, and when an event
 * card blocks the way it takes the FIRST choice — the same two controls, on a
 * timer, until the year-end gate is reached. Then it stops and takes its hands
 * off: the pitch, the panel and the deal are the thing being tested and are
 * never automated.
 *
 * Because it only replays legal taps through the same `advance` and `choose`
 * the screen uses, the tape it produces is a tape the leaderboard verifier
 * accepts. There is no privileged path here and nothing to gate: the URL flag
 * is a convenience, not a permission.
 *
 * ── Why it is a component and not a button in the beta panel ────────────────
 *
 * The beta panel lives on /rewards, outside the provider — it has no `advance`
 * to call. So the panel links to `/play?beta=tank` and this, mounted inside
 * the provider, is what the link arrives at.
 *
 * ── Why the URL check lives in the page and not here ────────────────────────
 *
 * /play has a first-load budget and this is a tool almost nobody loads. The
 * page reads the flag — one `URLSearchParams` it pays for anyway — and only
 * then imports this module, so a normal session never fetches the chunk at
 * all. Arming from inside would mean shipping the whole driver to everyone to
 * discover it was not wanted.
 */

/** How long between taps. Slow enough to watch, fast enough to be worth it. */
const STEP_MS = 220;
/** A hard stop, so a run that cannot reach a gate cannot spin forever. */
const MAX_STEPS = 400;

export default function BetaAutopilot() {
  const { run, queue, atGate, perform, busy, advance, choose } = useGame();
  // Mounted at all means armed — the page only renders this when the flag is
  // in the URL.
  const [running, setRunning] = useState(true);
  const steps = useRef(0);

  const stop = useCallback(() => {
    setRunning(false);
    steps.current = 0;
    // Clear the flag so a refresh, or a back-navigation, does not re-arm it.
    const url = new URL(window.location.href);
    if (url.searchParams.has("beta")) {
      url.searchParams.delete("beta");
      window.history.replaceState(null, "", url.toString());
    }
  }, []);

  useEffect(() => {
    if (!running) return;
    if (!run || !run.alive) { stop(); return; }
    // The destination. Also stops at the pitch itself — an event card that
    // wants the camera is a performance, and performances are not automated.
    if (atGate || perform) { stop(); return; }
    if (steps.current >= MAX_STEPS) { stop(); return; }
    if (busy) return;

    const timer = setTimeout(() => {
      steps.current += 1;
      // A card on the table blocks time. Take the first choice — which choice
      // is not what is being tested, arriving at the panel is.
      if (queue.length) choose(0);
      else advance();
    }, STEP_MS);
    return () => clearTimeout(timer);
  }, [running, run, queue.length, atGate, perform, busy, advance, choose, stop]);

  if (!running) return null;

  return (
    <div
      className="pointer-events-none fixed inset-x-0 top-0 z-[70] flex justify-center p-3"
      role="status"
      aria-live="polite"
    >
      <span className="pointer-events-auto flex items-center gap-2 rounded-[var(--radius-pill)] bg-[#FF6B00] px-3 py-1.5 text-2xs font-bold tracking-[0.1em] text-white shadow-[var(--e2)]">
        AUTOPILOT → THE TANK
        <button onClick={stop} className="rounded-full bg-black/25 px-2 py-0.5">
          STOP
        </button>
      </span>
    </div>
  );
}
