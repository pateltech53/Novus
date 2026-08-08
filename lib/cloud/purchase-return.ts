"use client";

import { Browser } from "@capacitor/browser";

import { pollForPurchase, restorePurchases } from "@/lib/cloud/billing";
import { isNative } from "@/lib/native/platform";

/**
 * COMING BACK FROM A PURCHASE MADE SOMEWHERE ELSE.
 *
 * ── What was missing ────────────────────────────────────────────────────────
 *
 * A store build cannot sell, so GET PRO opens the pricing page in the player's
 * own browser (lib/commerce.ts). They pay. And then the flow simply ended: the
 * browser sat on a "thanks" page, the app was still behind it holding the
 * screen it was on, and the only way to make Pro appear was to know that
 * Restore existed and go and find it. Everything worked and nothing happened,
 * which is the worst shape a payment can take — the player has been charged and
 * the app is showing them the paywall.
 *
 * So the return trip gets built out of two independent halves, because on a
 * phone neither one is reliable enough to be the only one:
 *
 * 1. **The hop.** The success page deep-links `novus://purchase?state=ok`
 *    (components/ReturnToApp.tsx). The app closes the browser it opened and
 *    reads its receipt. This is the fast path and it is the one that feels
 *    designed.
 * 2. **The resume.** Any return to the foreground while a purchase is in
 *    flight does the same read (lib/native/boot.ts). This is the path for
 *    everyone the first one loses: a scheme link a browser declined to follow,
 *    a player who used the app switcher, a payment finished ten minutes later
 *    in a different tab.
 *
 * Both land on the same function, which is idempotent and cheap, so the pair
 * doing it twice is not a bug.
 *
 * ── Why there is a marker at all ────────────────────────────────────────────
 *
 * Without one, the resume half would poll billing every time the app came
 * forward, forever, for every player — six requests on a backoff for a
 * purchase nobody made. The marker says a purchase is genuinely outstanding
 * and expires by itself, so the polling exists only in the twenty minutes
 * where it can find something.
 *
 * localStorage rather than sessionStorage, deliberately and unlike
 * lib/cloud/pending-pro.ts: the webview may be evicted while the player is off
 * in Safari paying, and coming back to a relaunched app is exactly the case
 * this has to survive.
 */

const KEY = "novus:purchase-in-flight";

/** How long a trip out to a browser may plausibly still be going on. */
const WINDOW_MS = 20 * 60 * 1000;

/** The purchase link has just been opened. Watch for it coming back. */
export function purchaseStarted(): void {
  try {
    window.localStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage refused. The deep link still works; only the resume half is lost.
  }
}

/** True while a purchase opened from this device could still be landing. */
export function purchaseInFlight(): boolean {
  try {
    const at = Number(window.localStorage.getItem(KEY));
    if (!Number.isFinite(at) || at <= 0) return false;
    if (Date.now() - at > WINDOW_MS) {
      window.localStorage.removeItem(KEY);
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

export function purchaseSettled(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * Close the browser we opened and adopt whatever the account now owns.
 *
 * Returns true when something actually changed, which is the caller's cue to
 * say so. `pollForPurchase` waits ~11s for the webhook and then gives up; the
 * single `restorePurchases` after it is for the case where the grant was
 * already recorded before the player came back, where polling from a backoff
 * would have made them wait 400ms to be told something that was true when they
 * pressed the button.
 *
 * The marker is cleared on a change and LEFT for a poll that found nothing: a
 * webhook running late is the ordinary case, and the resume half should still
 * be watching when it lands.
 */
export async function finishPurchase(closeBrowser = true): Promise<boolean> {
  if (closeBrowser && isNative()) {
    try {
      await Browser.close();
    } catch {
      // No browser open, or a shell without the plugin. Nothing to close is a
      // perfectly ordinary way to arrive here — the player may have dismissed
      // it themselves before the link fired.
    }
  }

  const now = await restorePurchases();
  if (now.ok && now.changed) {
    purchaseSettled();
    return true;
  }

  const found = await pollForPurchase();
  if (found) purchaseSettled();
  return found;
}
