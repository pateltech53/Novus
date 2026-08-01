import { Capacitor } from "@capacitor/core";

/**
 * Which shell the app is running in.
 *
 * Everything here has to survive being evaluated on the server during the web
 * build, so every answer is derived rather than cached at module scope — a
 * value read once at import time is a value read before Capacitor has injected
 * itself, and that is how "native" silently becomes "web" in production.
 */

export type NativePlatform = "ios" | "android" | "web";

export function platform(): NativePlatform {
  if (typeof window === "undefined") return "web";
  const p = Capacitor.getPlatform();
  return p === "ios" || p === "android" ? p : "web";
}

/** True inside the iOS or Android shell. False in every browser, always. */
export function isNative(): boolean {
  return typeof window !== "undefined" && Capacitor.isNativePlatform();
}

export function isIOS(): boolean {
  return platform() === "ios";
}

export function isAndroid(): boolean {
  return platform() === "android";
}

/**
 * Root-level flags so CSS can answer "am I in the app?" without a React
 * render. Written once, before hydration paints anything that depends on it.
 */
export function markPlatformOnRoot(): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.dataset.platform = platform();
  if (isNative()) el.dataset.native = "true";
}
