"use client";

import { useEffect } from "react";

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
    void restoreOnBoot();
  }, []);
  return null;
}
