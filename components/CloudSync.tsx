"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

import { awaitPurchase, returningFromCheckout } from "@/lib/cloud/billing";
import { installHeartbeat } from "@/lib/cloud/heartbeat";
import { restoreOnBoot } from "@/lib/cloud/sync";

/**
 * Routes with no saved state to restore and no way into one.
 *
 * These are read, not played: a privacy policy opened from an App Store listing,
 * a terms page linked from an email, the download page. Booting the cloud
 * restore on them spends two sequential round trips — POST /api/session, then
 * GET /api/sync — on a document whose only job is to render text.
 */
const READ_ONLY_ROUTES = ["/privacy", "/terms", "/download"];

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
  const pathname = usePathname();

  useEffect(() => {
    /*
     * Deferred rather than skipped, and the difference matters.
     *
     * This component is mounted by the root layout, so its effect runs once per
     * document — not once per route. Returning early on a legal page without a
     * dependency on the path would mean a visitor who lands on /privacy and
     * then clicks into the app never restores at all, for the whole tab.
     *
     * With `pathname` in the deps the effect re-runs on the client navigation
     * out, and `restoreOnBoot` memoises its own promise (sync.ts:421), so the
     * re-entry costs nothing and the restore still happens exactly once.
     */
    if (READ_ONLY_ROUTES.includes(pathname)) return;

    // The once-a-minute "does the server still agree" check: an account the
    // admin console deleted signs this device out, and a revoked or granted
    // Pro lands on the open screens without a manual reload.
    installHeartbeat();
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
  }, [pathname]);
  return null;
}
