"use client";

import { App as CapApp } from "@capacitor/app";
import { Keyboard } from "@capacitor/keyboard";
import { SplashScreen } from "@capacitor/splash-screen";
import { Style, StatusBar } from "@capacitor/status-bar";
import { popBack } from "@/lib/native/back";
import { isAndroid, isIOS, isNative, markPlatformOnRoot } from "@/lib/native/platform";

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

  void wireBackButton().then((d) => disposers.push(d));
  void wireKeyboard().then((d) => disposers.push(d));

  return () => {
    disposers.forEach((d) => d());
    disposers = [];
    started = false;
  };
}
