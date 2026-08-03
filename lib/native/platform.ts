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
 * Which shell this is, written on <html> before the first paint.
 *
 * ── Why this is a blocking script and not a `useEffect` ─────────────────────
 *
 * Liquid Glass is the iOS app's material and nowhere else's — `globals.css`
 * keys every backdrop-filter in the app off `[data-platform="ios"]`, so this
 * attribute is what decides whether a browser draws glass or a solid surface.
 * Deciding that after hydration means one frame of glass on every page load on
 * Android and the web, which is the flash this app already learned about once
 * with the theme.
 *
 * Two signals, in order:
 *
 * · `Capacitor.getPlatform()` — injected as a `WKUserScript` at documentStart,
 *   so it is there before this runs. The real answer when it exists.
 * · `capacitor:` — the scheme `capacitor.config.ts` sets for iOS
 *   (`iosScheme: "capacitor"`), and Android is `https`. A fallback for the
 *   case where the bridge has not attached yet, which costs nothing to check
 *   and cannot be wrong in the direction that matters: a browser is never on
 *   this protocol.
 *
 * Absent entirely on the web, which is what `:not([data-platform="ios"])`
 * wants — the default is no glass, and the app opts in.
 */
export const PLATFORM_INIT_SCRIPT = `
(function(){try{
  var c = window.Capacitor;
  var p = (c && typeof c.getPlatform === 'function') ? c.getPlatform()
        : (location.protocol === 'capacitor:' ? 'ios' : '');
  if (p === 'ios' || p === 'android') document.documentElement.dataset.platform = p;
}catch(e){}})();
`.trim();

/**
 * Root-level flags so CSS can answer "am I in the app?" without a React
 * render. Written once, before hydration paints anything that depends on it.
 *
 * The script above has usually run first and agreed; this re-states it from
 * the real Capacitor API, which is the authority once the bridge is up.
 */
export function markPlatformOnRoot(): void {
  if (typeof document === "undefined") return;
  const el = document.documentElement;
  el.dataset.platform = platform();
  if (isNative()) el.dataset.native = "true";
}
