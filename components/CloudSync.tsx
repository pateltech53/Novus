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
      // Fall through to the ordinary restore if the wait gives up.
      //
      // awaitPurchase polls for ~11s and then stops, because the webhook is
      // authoritative and will land in its own time. But `?purchase=ok` stays
      // in the URL — so on this load and every reload of it, taking the early
      // return would mean restoreOnBoot never runs at all, and a player who
      // just paid sits on a page that never asks the server for anything.
      void awaitPurchase().then((adopted) => {
        if (!adopted) void restoreOnBoot();
      });
      return;
    }
    void restoreOnBoot();
  }, []);
  return null;
}
