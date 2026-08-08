"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  NovusGlass,
  ZERO_INSETS,
  type ChromeInsets,
  type NativeChromeState,
  type NativeRect,
} from "@/lib/native/glass";
import { isIOS, isNative } from "@/lib/native/platform";

/**
 * The handoff.
 *
 * When the native chrome is live it owns the tab bar, the advance button and
 * the masthead controls, and the DOM equivalents are not rendered at all —
 * hidden is not good enough, because a hidden button still takes a tap on iOS
 * if a native view above it lets the touch through.
 *
 * Everything here degrades to "the web chrome, exactly as before" the moment
 * anything is missing: not iOS, plugin absent, plugin threw. There is no state
 * in which the player ends up with no way to advance the month.
 */

type Listener = () => void;

let owned = false;
let insets: ChromeInsets = ZERO_INSETS;
let probed = false;
let probing: Promise<void> | null = null;

const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(fn: Listener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const snapshot = () => owned;
const serverSnapshot = () => false;

/**
 * The spotlit control's box, as its own store.
 *
 * Separate from the CSS variables because it is not a reservation — nothing
 * lays out around it. One component reads it, and it changes far more often
 * than the insets do (every layout pass while a coachmark is up), so it gets a
 * snapshot React can subscribe to rather than a custom property to parse back.
 */
let coachRect: NativeRect | null = null;
const coachListeners = new Set<Listener>();

function writeInsets(next: ChromeInsets) {
  insets = next;

  const rect = next.coach ?? null;
  const changed =
    !!rect !== !!coachRect ||
    (rect &&
      coachRect &&
      (Math.abs(rect.top - coachRect.top) > 0.5 ||
        Math.abs(rect.left - coachRect.left) > 0.5 ||
        Math.abs(rect.width - coachRect.width) > 0.5 ||
        Math.abs(rect.height - coachRect.height) > 0.5));
  if (changed) {
    coachRect = rect;
    coachListeners.forEach((fn) => fn());
  }

  if (typeof document === "undefined") return;
  const el = document.documentElement.style;
  el.setProperty("--nv-chrome-top", `${next.top}px`);
  el.setProperty("--nv-chrome-bottom", `${next.bottom}px`);
  el.setProperty("--nv-chrome-tabbar", `${next.tabBar}px`);
}

/** Where the native control being taught is, or null. */
export function useNativeCoachRect(): NativeRect | null {
  return useSyncExternalStore(
    (fn) => {
      coachListeners.add(fn);
      return () => coachListeners.delete(fn);
    },
    () => coachRect,
    () => null,
  );
}

function setOwned(next: boolean) {
  if (owned === next) return;
  owned = next;
  if (typeof document !== "undefined") {
    if (next) document.documentElement.dataset.nativeChrome = "true";
    else delete document.documentElement.dataset.nativeChrome;
  }
  emit();
}

/**
 * Writes down which material is actually on screen.
 *
 * There are two ways to end up looking at a native chrome that is not Liquid
 * Glass — an Xcode older than 26 compiled the fallback, or the device is older
 * than iOS 26 and the runtime check declined it — and until this existed there
 * was no way to tell either of them from "the glass is on and you are looking
 * right at it". `.systemThinMaterial` is a frosted pane; Liquid Glass is a
 * lens. Side by side the difference is obvious, and nobody has them side by
 * side.
 *
 * So it goes on the root element, where Web Inspector shows it without a
 * rebuild and without a debug build:
 *
 *     document.documentElement.dataset.liquidGlass  // "true" | "false"
 *     document.documentElement.dataset.nativeOs     // "26"
 *
 * Absent entirely on Android and the web, where the question does not arise.
 */
function recordMaterial(caps: { available: boolean; liquidGlass: boolean; osVersion: number }) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.nativeGlass = String(caps.available);
  root.dataset.liquidGlass = String(caps.liquidGlass);
  root.dataset.nativeOs = String(caps.osVersion);
  // One line, once per launch. A player never opens the console; the person
  // trying to work out why the app looks wrong opens it first.
  console.info(
    `[novus] native chrome ${caps.available ? "on" : "off"} · ` +
      `material ${caps.liquidGlass ? "Liquid Glass (UIGlassEffect)" : "systemThinMaterial — needs iOS 26"} · ` +
      `iOS ${caps.osVersion}`,
  );
}

/**
 * Asks the plugin whether it is there. Runs at most once per launch; every
 * later caller awaits the same promise rather than starting a second probe.
 */
export function probeNativeChrome(theme: "light" | "dark", tint: string): Promise<void> {
  if (probed) return Promise.resolve();
  if (probing) return probing;
  probing = (async () => {
    try {
      if (!isNative() || !isIOS()) return;
      const caps = await NovusGlass.capabilities();
      recordMaterial(caps);
      if (!caps.available) return;
      const next = await NovusGlass.configure({ theme, tint });
      writeInsets(next);
      setOwned(true);
    } catch {
      /* No plugin, an old binary, or a native throw. The web chrome stands. */
    } finally {
      probed = true;
      probing = null;
    }
  })();
  return probing;
}

/** True when UIKit is drawing the chrome and React must not. */
export function useNativeChromeOwned(): boolean {
  return useSyncExternalStore(subscribe, snapshot, serverSnapshot);
}

/** Nothing on screen, and nothing reserved. */
const HIDDEN: NativeChromeState = {
  mode: "hidden",
  theme: "dark",
  tabs: [],
  activeTab: null,
  cta: null,
  controls: [],
};

/**
 * The chrome withdrawn, with no React tree left to do it.
 *
 * `useNativeChrome` takes the chrome down on unmount, which covers every exit
 * this app makes through the router. It does not cover the exits that go
 * through `window.location` — signing out, deleting an account, the door out
 * of Settings back to the islands — because a document navigation destroys the
 * tree without running one cleanup, and the chrome is a UIKit view owned by
 * the view controller rather than by the page. It outlives the code that knew
 * about it, and lands on top of whatever document loads next.
 *
 * So the page says goodbye on `pagehide`, which is the last moment it gets.
 * Native clears itself again in `configure()` for the case where this message
 * does not survive the unload; this is what keeps the gap between the two
 * documents from showing the old screen's controls.
 */
export function hideNativeChrome(): void {
  if (!owned) return;
  NovusGlass.setChrome(HIDDEN).catch(() => {});
}

export function chromeInsets(): ChromeInsets {
  return insets;
}

export interface ChromeHandlers {
  onTab: (id: string) => void;
  onPrimary: () => void;
  onControl: (id: string) => void;
  /** The floating nudge was tapped — open the tab it names. */
  onNudgeAction: (id: string) => void;
  /** Its ✕ was tapped. UIKit has already taken the card off screen; this is
   *  what stops the next state push putting it straight back. */
  onNudgeDismiss: (id: string) => void;
}

/**
 * Pushes chrome state to UIKit and routes taps back.
 *
 * The state is diffed as a string rather than by identity: the play screen
 * rebuilds this object on every render, and crossing the bridge sixty times a
 * second to say nothing changed is exactly the kind of cost that shows up as
 * a dropped frame on a scroll.
 */
export function useNativeChrome(state: NativeChromeState | null, handlers: ChromeHandlers): void {
  const owns = useNativeChromeOwned();
  const handlerRef = useRef(handlers);
  handlerRef.current = handlers;

  const lastSent = useRef<string | null>(null);

  useEffect(() => {
    if (!owns) return;
    let cancelled = false;
    const subs: Array<{ remove: () => void }> = [];

    const attach = async () => {
      const add = async <T,>(
        event:
          | "tabSelected"
          | "primaryAction"
          | "controlSelected"
          | "insetsChanged"
          | "nudgeAction"
          | "nudgeDismissed",
        fn: (data: T) => void,
      ) => {
        // The overload set on the plugin is precise per event; this call site
        // is generic on purpose, so it is bridged through one cast rather
        // than four near-identical ones.
        const handle = await (
          NovusGlass.addListener as unknown as (
            e: string,
            f: (data: T) => void,
          ) => Promise<{ remove: () => void }>
        )(event, fn);
        if (cancelled) handle.remove();
        else subs.push(handle);
      };

      await add<{ id: string }>("tabSelected", (d) => handlerRef.current.onTab(d.id));
      await add<void>("primaryAction", () => handlerRef.current.onPrimary());
      await add<{ id: string }>("controlSelected", (d) => handlerRef.current.onControl(d.id));
      await add<ChromeInsets>("insetsChanged", (d) => writeInsets(d));
      await add<{ id: string }>("nudgeAction", (d) => handlerRef.current.onNudgeAction(d.id));
      await add<{ id: string }>("nudgeDismissed", (d) => handlerRef.current.onNudgeDismiss(d.id));
    };

    // A rejection here would be an unhandled promise, and the only thing that
    // can reject is the bridge being gone — in which case the DOM chrome is
    // already what the player is looking at.
    void attach().catch(() => {});
    return () => {
      cancelled = true;
      subs.forEach((s) => s.remove());
    };
  }, [owns]);

  useEffect(() => {
    if (!owns || !state) return;
    const key = JSON.stringify(state);
    if (key === lastSent.current) return;
    lastSent.current = key;
    NovusGlass.setChrome(state)
      .then(writeInsets)
      .catch(() => {
        /* A failed push must never take the screen down with it. */
      });
  }, [owns, state]);

  // Leaving the screen must never leave a tab bar floating over whatever comes
  // next. Unmount is the one moment the chrome has to be told to go away.
  useEffect(() => {
    if (!owns) return;
    return () => {
      lastSent.current = null;
      hideNativeChrome();
    };
  }, [owns]);
}
