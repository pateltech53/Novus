"use client";

import { useEffect } from "react";
import { hideNativeChrome, probeNativeChrome } from "@/lib/native/chrome";
import { hideNativeOverlay } from "@/components/native/useNativeOverlay";
import { releaseSplash, startNativeShell } from "@/lib/native/boot";
import { BRAND_ACTION } from "@/lib/brand";

/**
 * The one place the app talks to its shell.
 *
 * Mounted from the root layout so it runs before any screen does, and so the
 * status bar, the back button and the native chrome probe all happen exactly
 * once per launch rather than once per route. On the web every call inside is
 * a no-op and this component renders nothing.
 */
export function NativeShell() {
  useEffect(() => {
    const stop = startNativeShell();
    const theme = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
    void probeNativeChrome(theme, BRAND_ACTION);
    releaseSplash();

    /*
     * ── The chrome does not belong to the page ──────────────────────────────
     *
     * Not every exit in this app goes through the router. Signing out,
     * deleting an account and the door out of Settings back to the islands all
     * have to EMPTY the device, so they navigate the document rather than push
     * a route — and a document navigation destroys the React tree without
     * running a single effect cleanup.
     *
     * Every native surface is a UIKit view owned by the view controller, not
     * by the page. So the chrome of the screen being left outlived it: Settings
     * arrived on the islands screen as a floating toolbar and a dock still
     * offering to sign you out, with nothing alive that knew they were there —
     * and the dock sits exactly where the play screen's ADVANCE capsule does,
     * so the control that moves time was taking taps meant for it.
     *
     * `pagehide` is the last moment this document gets. Native clears itself
     * again on the far side (`configure()`), which is the guarantee; this is
     * what keeps the gap between the two documents from showing the controls
     * of a screen nobody is looking at any more.
     */
    const leaving = (event: PageTransitionEvent) => {
      // Into the back/forward cache is not away: the same tree comes back, and
      // withdrawing chrome it still believes it declared would strand it.
      if (event.persisted) return;
      hideNativeOverlay();
      hideNativeChrome();
    };
    window.addEventListener("pagehide", leaving);

    return () => {
      window.removeEventListener("pagehide", leaving);
      stop();
    };
  }, []);

  return null;
}
