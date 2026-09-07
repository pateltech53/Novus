"use client";

import type { PlayEvent } from "./progress";

/**
 * Reporting play to the reward system, from the game.
 *
 * ── Why it batches ──────────────────────────────────────────────────────────
 *
 * A fiscal year closing can emit half a dozen moments at once, and a pitch
 * emits several the instant it is scored. One request each would put a burst
 * of fetches on the same tick the UI is animating a result — on a mid-range
 * phone that is a visible stutter at exactly the wrong moment. So moments
 * queue and flush on a short timer, or immediately when the page is being
 * hidden (a player closing the tab mid-run should not lose their day).
 *
 * ── Why it never blocks and never throws ────────────────────────────────────
 *
 * The reward loop is a layer ON TOP of the game. If this endpoint is down, or
 * nobody is signed in on this device, or the network drops, the correct
 * outcome is that the player keeps playing and notices nothing. Every failure
 * here is swallowed on purpose — there is no state in the game that depends on
 * the answer, because progress lives on the server.
 */

let queue: PlayEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
/** Set once the endpoint 404s — a signed-out device stops trying. (The gate
 *  used to be a per-account beta flag; it is now "is anyone signed in".) */
let disabled = false;

const FLUSH_MS = 4000;

async function flush(): Promise<void> {
  if (disabled || !queue.length) return;
  const events = queue;
  queue = [];
  if (timer) { clearTimeout(timer); timer = null; }

  try {
    const res = await fetch("/api/rewards/progress", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ events }),
      keepalive: true,           // survives the tab closing
    });
    // 404 is the reward gate saying "nobody is signed in here". Stop asking.
    if (res.status === 404) disabled = true;
  } catch {
    // Offline, or the route is not deployed. The moments are dropped rather
    // than retried forever: a day's progress is worth less than a queue that
    // grows without bound in a browser tab left open overnight.
  }
}

/**
 * Report one moment of play.
 *
 * Safe to call from anywhere, including render paths — it does no work beyond
 * pushing onto an array until the timer fires.
 */
export function reportPlay(type: string, payload: Record<string, number | string | boolean> = {}): void {
  if (disabled || typeof window === "undefined") return;
  queue.push({ type, payload, at: new Date().toISOString() });
  // A burst bigger than one request's worth goes now rather than growing.
  if (queue.length >= 30) { void flush(); return; }
  timer ??= setTimeout(() => void flush(), FLUSH_MS);
}

/** Flush on the way out, so a closed tab does not cost the player their day. */
if (typeof window !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void flush();
  });
}

/**
 * The 30-second foreground heartbeat behind "play for N minutes today".
 *
 * Counts FOREGROUND time only — a tab left open in another window is not
 * playing, and the server caps the total at 2× wall clock anyway. Returns its
 * own stop function for a useEffect cleanup.
 */
export function startPlayHeartbeat(): () => void {
  if (typeof window === "undefined") return () => {};
  const tick = setInterval(() => {
    if (document.visibilityState === "visible") reportPlay("session.heartbeat");
  }, 30_000);
  return () => clearInterval(tick);
}
