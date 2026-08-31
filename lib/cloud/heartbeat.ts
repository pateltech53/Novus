"use client";

import { forgetIdentity, identity, localAccount, sessionLost } from "./auth";
import { restorePurchases } from "./billing";
import { appPath } from "@/lib/native/href";
import { isNative } from "@/lib/native/platform";

/**
 * THE HEARTBEAT — how an open tab finds out the server changed its mind.
 *
 * Everything else in the cloud layer runs once per tab: entitlements are
 * adopted at boot, identity is cached for the session, and nothing ever asks
 * again. That was fine until the admin console could change the answer while
 * the player was mid-game — an account deleted from the console kept playing
 * until the tab closed, and a revoked Pro gift kept The Room open until the
 * next reload. Support actions have to actually land on the device they were
 * aimed at, while it is in use.
 *
 * So: once a minute while the tab is visible, and immediately when it becomes
 * visible again, ask two questions the server already answers —
 *
 *   1. `/api/auth/me` — does this account still exist? When the answer is a
 *      definitive no, the device is wiped exactly as sign-out would wipe it
 *      and the page reloads to the front door. Deleted means signed out,
 *      everywhere, within a minute.
 *   2. `/api/billing/entitlements` (via restorePurchases) — what may this
 *      account do right now? Adopting the answer fires the entitlement
 *      listeners, so a revoked gift drops Pro from the open screens without
 *      anyone reloading anything. Grants arrive the same way.
 *
 * ── Why the kick needs TWO misses ──────────────────────────────────────────
 *
 * The session cookie is a rotating refresh token, and two requests racing the
 * same rotation can leave one of them briefly holding the old token — a
 * transient "signed out" answer about a session that is perfectly healthy.
 * Wiping a device over that race would be sign-out by lottery. One miss is a
 * strike; only a second consecutive definitive miss (a different beat, ≥30s
 * later) wipes. A genuinely deleted account can never answer "signed in"
 * again, so it always accumulates the second strike within two beats.
 *
 * A network failure is neither a hit nor a miss: `identity()` reports those
 * as `configured: false`, and an offline player keeps their strikes at zero —
 * flaky wifi must never read as an account deletion.
 */

const BEAT_MS = 60_000;
/** Floor between two beats, so visibility flaps don't spam the server. */
const MIN_GAP_MS = 30_000;

let installed = false;
let lastBeat = 0;
let running = false;
let strikes = 0;

async function beat(): Promise<void> {
  if (running) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  if (Date.now() - lastBeat < MIN_GAP_MS) return;

  // Nobody is signed in on this device — nothing to revoke, nothing to ask.
  if (!localAccount()) return;

  lastBeat = Date.now();
  running = true;
  try {
    forgetIdentity();
    const who = await identity();

    // Not a definitive answer: the deploy has no Supabase, or the network ate
    // the request. Either way it says nothing about the account.
    if (!who.configured) return;

    if (!who.signedIn || who.anonymous) {
      strikes += 1;
      if (strikes >= 2) {
        sessionLost();
        // The reload is the kick: every screen re-decides what to show with
        // the device now empty. On the web that is the front door's sign-in;
        // in the app it is onboarding — "/" there is the marketing page, a
        // surface the shell is never meant to show (and, before the Landing
        // gate was fixed, one that flashed the price grid at whoever a
        // mid-game session kick landed on).
        window.location.replace(isNative() ? appPath("/welcome") : "/");
      }
      return;
    }

    strikes = 0;
    // Still signed in — refresh what they're entitled to. adoptEntitlements
    // inside fires onEntitlementsChange, which is what pulls a revoked Pro
    // out from under the open screens.
    await restorePurchases();
  } catch {
    // A throw anywhere above is a transport problem, not an answer.
  } finally {
    running = false;
  }
}

/**
 * Install the heartbeat for this tab. Idempotent; called from CloudSync so it
 * starts wherever the cloud layer starts.
 */
export function installHeartbeat(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.setInterval(() => void beat(), BEAT_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void beat();
  });
}
