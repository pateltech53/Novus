"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import {
  NovusGlass,
  ZERO_INSETS,
  type ChromeInsets,
  type NativeChromeState,
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

function writeInsets(next: ChromeInsets) {
  insets = next;
  if (typeof document === "undefined") return;
  const el = document.documentElement.style;
  el.setProperty("--nv-chrome-top", `${next.top}px`);
  el.setProperty("--nv-chrome-bottom", `${next.bottom}px`);
  el.setProperty("--nv-chrome-tabbar", `${next.tabBar}px`);
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

export function chromeInsets(): ChromeInsets {
  return insets;
}

export interface ChromeHandlers {
  onTab: (id: string) => void;
  onPrimary: () => void;
  onControl: (id: string) => void;
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
        event: "tabSelected" | "primaryAction" | "controlSelected" | "insetsChanged",
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
    };

    void attach();
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
      NovusGlass.setChrome({
        mode: "hidden",
        theme: "dark",
        tabs: [],
        activeTab: null,
        cta: null,
        controls: [],
      }).catch(() => {});
    };
  }, [owns]);
}
