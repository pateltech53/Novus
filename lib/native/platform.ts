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
 * This attribute used to be what decided whether the DOM drew glass or a
 * solid surface — `globals.css` keyed every backdrop-filter off
 * `[data-platform="ios"]`, and deciding after hydration meant one frame of
 * glass on every page load. The CSS material is retired now (the owner's
 * call: the only Liquid Glass is UIKit's own chrome, and a DOM imitation one
 * row away from it reads as exactly that), so the material no longer consumes
 * this — but the attribute still answers "which shell am I in?" for anything
 * styled per shell, and before-first-paint is still when that answer has to
 * exist.
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
 * Absent entirely on the web.
 */
export const PLATFORM_INIT_SCRIPT = `
(function(){try{
  var c = window.Capacitor;
  var p = (c && typeof c.getPlatform === 'function') ? c.getPlatform()
        : (location.protocol === 'capacitor:' ? 'ios' : '');
  if (p === 'ios' || p === 'android') document.documentElement.dataset.platform = p;
  if (p === 'ios') {
    var s = window.screen || {};
    var long = Math.max(s.width || 0, s.height || 0);
    if (long >= 812) document.documentElement.dataset.notch = 'true';
  }
}catch(e){}})();
`.trim();

/*
 * ── Why `data-notch` exists, and why it is decided from the screen ──────────
 *
 * Reported: on the FIRST screen after launch — and only the first — the title
 * sits under the status bar and the mascot's head is behind the Dynamic
 * Island. Navigate into a company and back and it is correct. That is not a
 * layout bug in any of those screens; it is `env(safe-area-inset-top)`
 * answering **0** on WKWebView's first load, before the web view has been laid
 * out inside its safe area. Everything derived from it collapses to the 0.75rem
 * gap, so ~59pt of hardware becomes 12pt of padding, once, on the screen a
 * player opens the app to.
 *
 * It cannot be fixed by asking again: nothing on the web side can make the web
 * view re-report, and by the time a `useEffect` could measure it the first
 * paint has already happened. It has to be answered BEFORE first paint, which
 * is what this script is for — and the only thing available that early which
 * correlates with a top inset is the screen itself.
 *
 * 812 is the line. Every iPhone with a notch or an island is at least 812pt on
 * its long edge (the X at 812, through to 956); the SE is 667. So a phone that
 * has hardware in the way is marked, and one that does not is left alone
 * rather than being given a gap it has no reason for.
 *
 * The floor this unlocks (globals.css) is a `max()`, so it is inert the moment
 * `env()` starts telling the truth: 59 never beats a real island's 71, and a
 * notched phone's own 44–50 lands within a few points of it. It only ever wins
 * against zero.
 */

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
