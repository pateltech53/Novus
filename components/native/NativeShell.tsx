"use client";

import { useEffect } from "react";
import { probeNativeChrome } from "@/lib/native/chrome";
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
    return stop;
  }, []);

  return null;
}
