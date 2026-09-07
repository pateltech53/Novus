"use client";

import { App as CapApp } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { Style, StatusBar } from "@capacitor/status-bar";
import { popBack } from "@/lib/native/back";
import { isAndroid, isIOS, isNative, markPlatformOnRoot } from "@/lib/native/platform";
import { followOutsideLink, parseOutsideLink } from "@/lib/outside/links";

/**
 * Everything the shell needs told to it once, at launch.
 *
 * Order matters here. The status bar is styled before the splash is dismissed,
 * so the first frame the player sees is already the right colour — hiding the
 * splash first gives you a white bar for one frame on a dark theme, which
 * reads as a crash recovering.
 */

let started = false;
let disposers: Array<() => void> = [];

function currentTheme(): "light" | "dark" {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.dataset.theme === "dark" ? "dark" : "light";
}

/** Light content on a dark ground, and the other way round. */
async function syncStatusBar(): Promise<void> {
  if (!isNative()) return;
  try {
    await StatusBar.setStyle({ style: currentTheme() === "dark" ? Style.Dark : Style.Light });
    if (isAndroid()) {
      await StatusBar.setOverlaysWebView({ overlay: true });
      await StatusBar.setBackgroundColor({ color: "#00000000" });
    }
  } catch {
    /* Not every device exposes a settable status bar. */
  }
}

/**
 * Watches `data-theme` on <html>, which is the single place the theme is
 * written. A settings toggle should repaint the status bar in the same frame
 * as the rest of the app, not on the next launch.
 */
function watchTheme(): () => void {
  if (typeof MutationObserver === "undefined") return () => {};
  const obs = new MutationObserver(() => void syncStatusBar());
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-theme"],
  });
  return () => obs.disconnect();
}

/**
 * Android's back button, wired to the same dismissal stack the sheets use.
 *
 * With nothing open, back leaves the app running rather than killing it. A
 * company mid-year is not something to throw away because someone's thumb
 * found the wrong edge of the screen.
 */
async function wireBackButton(): Promise<() => void> {
  const handle = await CapApp.addListener("backButton", ({ canGoBack }) => {
    if (popBack()) return;
    if (canGoBack) {
      window.history.back();
      return;
    }
    void CapApp.minimizeApp();
  });
  return () => void handle.remove();
}

/**
 * A tap on a widget, or on a Live Activity.
 *
 * The shell delivers `novus://…` here through `SceneDelegateProxy`, which is
 * already wired for it — the only thing that had to be added on the native
 * side is `CFBundleURLTypes` in Info.plist, declaring the scheme as ours.
 *
 * Anything that is not a `novus://` URL is left alone rather than swallowed:
 * this is a shared channel, and a listener that consumes every URL it is given
 * is how a future OAuth callback stops arriving.
 */
async function wireOutsideLinks(): Promise<() => void> {
  const handle = await CapApp.addListener("appUrlOpen", ({ url }) => {
    const link = parseOutsideLink(url);
    if (link) followOutsideLink(link);
  });
  return () => void handle.remove();
}

/** The keyboard resizes the webview; nothing should be left scrolled under it. */
async function wireKeyboard(): Promise<() => void> {
  const subs = [
    await Keyboard.addListener("keyboardWillShow", (info) => {
      document.documentElement.style.setProperty("--nv-keyboard", `${info.keyboardHeight}px`);
      document.documentElement.dataset.keyboard = "true";
    }),
    await Keyboard.addListener("keyboardWillHide", () => {
      document.documentElement.style.setProperty("--nv-keyboard", "0px");
      delete document.documentElement.dataset.keyboard;
    }),
  ];
  return () => subs.forEach((s) => void s.remove());
}

/**
 * Dismisses the launch screen.
 *
 * `launchAutoHide` is off, so this is the only thing that ends it — on a timer
 * the splash disappears before the first frame is painted and the player sees
 * an empty background. Two paint frames is what it takes for the destination
 * route to have laid out; the timeout is a floor under a pathological load,
 * never the normal path.
 */
export function releaseSplash(): void {
  if (!isNative()) return;
  const hide = () => void SplashScreen.hide({ fadeOutDuration: 180 }).catch(() => {});
  requestAnimationFrame(() => requestAnimationFrame(hide));
  window.setTimeout(hide, 2500);
}

export function startNativeShell(): () => void {
  markPlatformOnRoot();
  if (!isNative() || started) return () => {};
  started = true;

  void syncStatusBar();
  disposers.push(watchTheme());

  if (isIOS()) {
    // The scroll view is off at the webview level; this keeps a stray
    // long-press from offering "Copy" over the game's own controls.
    document.documentElement.dataset.iosApp = "true";
  }

  /*
   * ── The teardown is authoritative, even for listeners still arriving ──────
   *
   * `addListener` is async on every Capacitor plugin, so these three resolve
   * some time after this function returns. The disposers were pushed into the
   * module-level array unconditionally: a shell that was stopped before a
   * promise settled pushed its disposer into an array the stop had already
   * emptied, and the listener stayed attached with nothing tracking it. The
   * next start then added a SECOND set — Android's back peeling two layers per
   * press, a widget deep link followed twice. React's StrictMode double effect
   * produces exactly that sequence in development on every launch.
   *
   * `stopped` is captured per start, so a disposer that lands late is simply
   * run instead of stored.
   */
  let stopped = false;
  const keep = (d: () => void) => {
    if (stopped) d();
    else disposers.push(d);
  };

  void wireBackButton().then(keep);
  void wireKeyboard().then(keep);
  void wireOutsideLinks().then(keep);

  return () => {
    stopped = true;
    disposers.forEach((d) => d());
    disposers = [];
    started = false;
  };
}
