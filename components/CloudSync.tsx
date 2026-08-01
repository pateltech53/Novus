"use client";

import { useEffect } from "react";

import { awaitPurchase, returningFromCheckout } from "@/lib/cloud/billing";
import { restoreOnBoot } from "@/lib/cloud/sync";

/**
 * Starts cloud persistence. Renders nothing.
 *
 * It lives in the root layout rather than inside GameProvider on purpose: the
 * restore has to run before any screen decides what to show, and every screen
 * — landing, welcome, found, play — reads saved state, not just the game one.
 * Mounting it here means one place turns the whole thing on.
 *
 * Everything it does is guarded and failure-tolerant (see restoreOnBoot). With
 * no Supabase project configured this is inert, which is why it is safe to
 * mount unconditionally.
 */
export function CloudSync() {
  useEffect(() => {
    // Coming back from Stripe is its own path. The tab is not new — checkout
    // left and returned to it — so the boot restore's once-per-tab flag is
    // already set and it would do nothing, which is the one moment a player
    // most needs it to work. awaitPurchase() waits for the webhook instead.
    if (returningFromCheckout() === "ok") {
      void awaitPurchase();
      return;
    }
    void restoreOnBoot();
  }, []);
  return null;
}
