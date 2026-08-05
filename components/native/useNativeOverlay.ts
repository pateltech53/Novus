"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  NovusGlass,
  type NativeOverlayButton,
  type NativeOverlayState,
  type OverlayInsets,
} from "@/lib/native/glass";
import { useNativeChromeOwned } from "@/lib/native/chrome";
import { useResolvedTheme } from "@/lib/native/theme";

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

/**
 * The dock's contents, when something other than the screen supplies them.
 *
 * One slot, because there is one dock. It overrides whatever `actions` the
 * screen on top declared — a screen with both a dock of its own and a mounted
 * contributor is a screen that has changed its mind about what its primary
 * action is, and the more specific answer wins.
 */
let dock: { key: object; actions: NativeOverlayButton[]; onAction: (id: string) => void } | null =
  null;

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
    await add<{ id: string }>("overlayAction", (d) => {
      // The dock's own ids go to whoever contributed them; everything else —
      // the toolbar's close, a screen's own dock — goes to the screen.
      if (dock?.actions.some((a) => a.id === d.id)) dock.onAction(d.id);
      else top()?.handlers.onAction(d.id);
    });
    await add<{ id: string }>("overlaySegment", (d) => top()?.handlers.onSegment?.(d.id));
    await add<OverlayInsets>("overlayInsets", writeOverlayInsets);
  })().catch(() => {
    /* No bridge. Every caller's DOM chrome is what the player is looking at. */
  });
  return attaching;
}

function flush() {
  const base = top()?.state ?? HIDDEN;
  const state =
    dock && base.mode === "shown" ? { ...base, actions: dock.actions } : base;
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
 * Every screen's chrome withdrawn at once, with no unmount to do it.
 *
 * The stack is emptied rather than popped, because this is not a screen
 * closing — it is the document that held all of them going away. Which is a
 * case the stack could not otherwise see: several routes in this app leave by
 * `window.location` (signing out, deleting an account, and the door out of
 * Settings back to the islands, which all have to empty the device), a
 * document navigation runs no effect cleanup at all, and every native surface
 * is a UIKit view owned by the view controller rather than by the page.
 *
 * So Settings' toolbar and its account dock survived the trip and sat on top
 * of the islands screen — a close button for a screen that was gone, over a
 * page that had never declared any chrome, with the dock in the same place the
 * play screen's ADVANCE capsule lands.
 *
 * Called from `pagehide`. Native repeats it in `configure()` on the far side,
 * for the case where the bridge message does not outlive the unload.
 */
export function hideNativeOverlay(): void {
  stack.length = 0;
  dock = null;
  flush();
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
 * The dock, contributed by a component that does not own the screen.
 *
 * ── Why this is not just a prop ─────────────────────────────────────────────
 *
 * A screen's chrome is declared by the screen. But the thing that belongs in
 * the dock often is not the screen's to know: Settings' account actions depend
 * on whether anyone is signed in, whether a request is in flight, and whether
 * the player has tapped delete once already — and all three of those live in
 * the section that draws the account, three components down.
 *
 * The obvious fix is to lift that state to the screen. The obvious fix is
 * wrong: it moves four pieces of state and two async handlers away from the
 * only code that uses them, so that a bar at the bottom of the screen can read
 * them.
 *
 * The other obvious fix — have the section push its own overlay state — is
 * worse. Registration is a stack and the section mounts *after* the screen, so
 * its entry would land on top and take the toolbar with it. Closing Settings
 * would stop being possible.
 *
 * So a contribution, not an entry: the screen keeps its toolbar and its
 * segments, and whatever is mounted supplies the dock. One at a time, because
 * there is one dock.
 *
 * @param actions Null when this component has nothing to put there, which
 *   withdraws the dock rather than leaving the last thing it said.
 */
export function useNativeOverlayDock(
  actions: NativeOverlayButton[] | null,
  onAction: (id: string) => void,
): boolean {
  const owns = useNativeOverlayOwned();
  const handlerRef = useRef(onAction);
  handlerRef.current = onAction;
  const keyRef = useRef<object>({});

  const key = JSON.stringify(actions ?? null);

  useEffect(() => {
    if (!owns) return;
    const mine = keyRef.current;
    dock =
      actions && actions.length > 0
        ? { key: mine, actions, onAction: (id) => handlerRef.current(id) }
        : dock?.key === mine
          ? null
          : dock;
    flush();

    return () => {
      if (dock?.key === mine) dock = null;
      flush();
    };
    // `key` rather than `actions`: a caller rebuilds this array every render,
    // and re-registering sixty times a second to say the same thing is the
    // cost this whole module is written to avoid.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owns, key]);

  return owns;
}

/**
 * The way out of an overlay, drawn by UIKit.
 *
 * Almost every overlay in this app wants exactly this and nothing else: one
 * glass circle, top right, that closes the thing. Eight of them declaring the
 * same six-line state object is eight places for it to drift, and the drift is
 * invisible — a screen whose close button is 2pt off, or whose theme is stale,
 * or which forgot to withdraw its chrome on unmount.
 *
 * Returns whether UIKit took it, so the caller knows not to render its own.
 * `false` off iOS, without the plugin, or on an old binary — in which case the
 * DOM button is the way out, exactly as before.
 *
 * @param label What the button does, for VoiceOver. "Close the dossier".
 * @param symbol `xmark` unless the gesture is genuinely "back" rather than
 *   "close" — a screen inside a screen, where dismissing returns you to the one
 *   underneath instead of to the board.
 */
export function useNativeGlassClose(
  label: string,
  onClose: () => void,
  symbol: "xmark" | "chevron.backward" = "xmark",
): boolean {
  const owns = useNativeOverlayOwned();
  const theme = useResolvedTheme();

  useNativeOverlay(
    useMemo(
      () => ({
        mode: "shown" as const,
        theme,
        // No title plate: every one of these overlays already carries its own
        // heading inside the surface it names, and a second copy floating over
        // the scrim would be the same words twice.
        title: null,
        trailing: [{ id: "close", symbol, label, style: "plain" as const }],
      }),
      [theme, label, symbol],
    ),
    { onAction: onClose },
  );

  return owns;
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
