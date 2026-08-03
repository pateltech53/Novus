"use client";

import { useEffect, useRef } from "react";
import {
  NovusGlass,
  type NativeOverlayState,
  type OverlayInsets,
} from "@/lib/native/glass";
import { useNativeChromeOwned } from "@/lib/native/chrome";

/**
 * A screen's chrome, drawn by UIKit in the real material.
 *
 * ── Why a stack ─────────────────────────────────────────────────────────────
 *
 * There is one native overlay chrome and there are many screens, and they
 * genuinely nest: Settings opens a legal document over itself, the closet opens
 * a preview, an activity screen opens a decision. Whichever screen is on top is
 * the one whose chrome should be on screen, and when it closes the one
 * underneath has to come back — not stay withdrawn, and not be re-declared by
 * a component that never knew it had been covered.
 *
 * So registration is a stack rather than a setter. Every mounted caller is in
 * it, the last one is pushed across the bridge, and unmounting re-pushes
 * whatever is now on top. The alternative — last write wins — leaves a player
 * who closes a legal sheet looking at a settings screen with no way out of it.
 *
 * ── What it degrades to ─────────────────────────────────────────────────────
 *
 * Nothing at all. Off iOS, without the plugin, on an old binary, or if native
 * throws, this is a no-op and the screen's own DOM chrome — which every caller
 * still renders, hidden only when `useNativeChromeOwned()` says UIKit has it —
 * is what the player uses. There is no state in which a screen has no way out.
 */

export interface NativeOverlayHandlers {
  /** A top-cluster or dock button was tapped. */
  onAction: (id: string) => void;
  /** A segment was chosen. */
  onSegment?: (id: string) => void;
}

interface Entry {
  key: object;
  state: NativeOverlayState;
  handlers: NativeOverlayHandlers;
}

const stack: Entry[] = [];

/** The last thing pushed, serialised. The play screen's chrome hook diffs the
 *  same way and for the same reason: a screen re-renders far more often than
 *  its chrome changes, and a bridge call that says nothing is still a bridge
 *  call on the main thread. */
let lastSent: string | null = null;
let attaching: Promise<void> | null = null;

const HIDDEN: NativeOverlayState = { mode: "hidden", theme: "dark" };

function writeOverlayInsets(insets: OverlayInsets) {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;
  style.setProperty("--nv-overlay-top", `${insets.top}px`);
  style.setProperty("--nv-overlay-bottom", `${insets.bottom}px`);
}

/** Routes a native tap to whichever screen is currently on top. */
function top(): Entry | undefined {
  return stack[stack.length - 1];
}

/**
 * Attaches the three listeners once per launch.
 *
 * Once, not per caller: `addListener` registers a new handler every time it is
 * called, so a hook that attached on mount would deliver one tap N times on the
 * Nth screen a player opened.
 */
function attach(): Promise<void> {
  if (attaching) return attaching;
  attaching = (async () => {
    const add = async <T,>(event: string, fn: (data: T) => void) => {
      await (
        NovusGlass.addListener as unknown as (
          e: string,
          f: (data: T) => void,
        ) => Promise<{ remove: () => void }>
      )(event, fn);
    };
    await add<{ id: string }>("overlayAction", (d) => top()?.handlers.onAction(d.id));
    await add<{ id: string }>("overlaySegment", (d) => top()?.handlers.onSegment?.(d.id));
    await add<OverlayInsets>("overlayInsets", writeOverlayInsets);
  })().catch(() => {
    /* No bridge. Every caller's DOM chrome is what the player is looking at. */
  });
  return attaching;
}

function flush() {
  const state = top()?.state ?? HIDDEN;
  const key = JSON.stringify(state);
  if (key === lastSent) return;
  lastSent = key;
  NovusGlass.setOverlay(state)
    .then(writeOverlayInsets)
    .catch(() => {
      /* A failed push must never take the screen down with it. */
    });
}

/**
 * Declares this screen's native chrome for as long as it is mounted.
 *
 * `state` may be rebuilt on every render — it is diffed as a string before it
 * crosses the bridge, so an object identity that changes sixty times a second
 * costs one comparison rather than sixty main-thread hops.
 */
export function useNativeOverlay(
  state: NativeOverlayState | null,
  handlers: NativeOverlayHandlers,
): void {
  const owns = useNativeChromeOwned();

  // Handlers are read at tap time rather than captured, so a screen whose
  // callbacks close over fresh state does not need to re-register to get them.
  const handlerRef = useRef(handlers);
  handlerRef.current = handlers;

  // Identity for this caller's slot in the stack. An object rather than a
  // string id: two instances of the same screen must not collide, and this app
  // genuinely mounts two (the closet previews an item over itself).
  const keyRef = useRef<object>({});

  useEffect(() => {
    if (!owns) return;
    const key = keyRef.current;
    const entry: Entry = {
      key,
      state: HIDDEN,
      handlers: {
        onAction: (id) => handlerRef.current.onAction(id),
        onSegment: (id) => handlerRef.current.onSegment?.(id),
      },
    };
    stack.push(entry);
    void attach();

    return () => {
      const index = stack.findIndex((e) => e.key === key);
      if (index >= 0) stack.splice(index, 1);
      // Whatever is underneath comes back — or the chrome withdraws, if this
      // was the last screen open.
      flush();
    };
  }, [owns]);

  useEffect(() => {
    if (!owns) return;
    const entry = stack.find((e) => e.key === keyRef.current);
    if (!entry) return;
    entry.state = state ?? HIDDEN;
    // Only the screen on top is on screen. A screen underneath still keeps its
    // state up to date, so it is correct the moment it is uncovered.
    if (top() === entry) flush();
  }, [owns, state]);
}

/**
 * True when UIKit is drawing this screen's chrome and React must not.
 *
 * The DOM control is not rendered at all rather than hidden, which is the same
 * rule the play chrome follows and for the same reason: a `visibility: hidden`
 * button still takes a tap on iOS if the native view above it passes the touch
 * through, and the player gets a dead zone nobody can see.
 */
export function useNativeOverlayOwned(): boolean {
  return useNativeChromeOwned();
}
