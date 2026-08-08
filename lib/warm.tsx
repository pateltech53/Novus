"use client";

import {
  useEffect,
  useRef,
  useSyncExternalStore,
  type ComponentType,
} from "react";

/**
 * CODE-SPLIT SCREENS THAT OPEN ON THE TAP, not a third of a second after it.
 *
 * ── What was measured ───────────────────────────────────────────────────────
 *
 * Reported as: the six activity tabs in the iOS app stutter, then the screen
 * comes out. Measured on the built export, from `pointerdown` to the sheet
 * existing in the DOM, with every module already fetched:
 *
 *     unthrottled  315ms      CPU ×4  335ms      CPU ×6  343ms
 *
 * A cost that barely moves when the CPU is six times slower is not work, it is
 * a wait. A CPU profile over the same window found no JS running in it. And
 * splitting the tap apart placed it exactly:
 *
 *     pointerdown → React commits, the tab lights up      14ms
 *     pointerdown → the screen enters the DOM            315ms
 *
 * So React had the state 14ms in and then sat on the screen for 300ms.
 *
 * ── Where the 300ms comes from ──────────────────────────────────────────────
 *
 * `dynamic(…, { loading: () => null })` is `React.lazy` inside a `Suspense`.
 * The first render of one suspends and commits the fallback — `null`, but a
 * committed fallback — and React then THROTTLES replacing a fallback with real
 * content by about 300ms, deliberately, so a boundary that resolves a few
 * frames later does not flash. It is charged in full even when the module is
 * already in memory, because the fallback was still committed.
 *
 * `startTransition` does not avoid it. React can skip the fallback for a
 * transition only when the boundary ALREADY has content to keep showing; a
 * boundary mounting for the first time has none, so it falls back and pays the
 * throttle. Measured with the transition in place: still 316ms.
 *
 * ── So: no Suspense boundary ────────────────────────────────────────────────
 *
 * `warm()` gives back a component that renders `null` until its module is in
 * hand and the real thing immediately afterwards — which is the exact visible
 * contract `loading: () => null` already promised — without suspending, and so
 * without a fallback to throttle. Warmed ahead of the tap (see `useWarm`), the
 * module is there before the first render and the screen mounts in the same
 * commit as the tap.
 *
 * The split is untouched: `import()` is what makes webpack emit a chunk, and
 * that is still the loader. This replaces next/dynamic's Suspense wrapper, not
 * the code splitting.
 *
 * `PerformScreen` deliberately keeps `dynamic()`. It REPLACES the board rather
 * than covering it, so it wants a real holding screen rather than `null`, and
 * against a screen that takes a second to assemble a 300ms throttle is not the
 * thing anybody notices.
 */

export interface WarmComponent<P> {
  (props: P): React.ReactNode;
  /** Fetch and evaluate the module now, without rendering. Idempotent. */
  preload: () => Promise<void>;
}

export function warm<P extends object>(
  load: () => Promise<ComponentType<P>>,
): WarmComponent<P> {
  let Loaded: ComponentType<P> | null = null;
  let inFlight: Promise<void> | null = null;
  const listeners = new Set<() => void>();

  const preload = (): Promise<void> => {
    if (Loaded) return Promise.resolve();
    inFlight ??= load().then(
      (component) => {
        Loaded = component;
        listeners.forEach((fn) => fn());
      },
      () => {
        // A chunk that failed to fetch is a screen that pays for its own module
        // when it is opened, not a screen that can never open again. Clearing
        // this lets the next attempt — the render, or a later warm — retry.
        inFlight = null;
      },
    );
    return inFlight;
  };

  const subscribe = (fn: () => void) => {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  };

  const ready = () => Loaded !== null;
  /* Never ready on the server. Every caller is a screen that could not render
     there anyway — they read a run out of localStorage — and a snapshot that
     said otherwise would be a hydration mismatch the moment a module happened
     to be loaded before hydration. */
  const neverOnServer = () => false;

  const Component = (props: P): React.ReactNode => {
    const has = useSyncExternalStore(subscribe, ready, neverOnServer);

    // Rendering IS a request for the module. This is the path where nothing
    // warmed it — an overlay opened inside the first second, or a warm that
    // failed — and it behaves exactly as `dynamic()` did: null, then the screen.
    useEffect(() => {
      void preload();
    }, []);

    return has && Loaded ? <Loaded {...props} /> : null;
  };

  Component.preload = preload;
  return Component;
}

/**
 * A module loader, or the `preload` of a `warm()` component. Anything that
 * fetches and evaluates a chunk when called and is safe to call twice.
 */
export type Preloadable = () => Promise<unknown>;

/**
 * Walk a queue of those, one per idle callback, once the screen has settled.
 *
 * ── Why one at a time ───────────────────────────────────────────────────────
 *
 * Each entry is a network fetch AND a module evaluation. Nineteen evaluations
 * fired together is one long task on the main thread — the stutter moved onto
 * a screen the player IS looking at, rather than removed. One per idle callback
 * keeps every one of them short.
 *
 * Each `requestIdleCallback` carries a timeout for the same reason
 * lib/prefetch.ts does: a phone that never goes idle must still end up with the
 * code, or this is an optimisation that only helps fast devices. Safari shipped
 * `requestIdleCallback` late enough that the timer fallback is a real path.
 *
 * In the shipped app every one of these is a local file read.
 */
export function useWarm(
  /** In the order a player reaches them. Most likely first. */
  queue: Preloadable[],
  /**
   * False until warming would be honest work — usually "this screen's own data
   * has loaded". Warming what comes next while the current screen is still
   * assembling itself is the cost this exists to avoid, moved earlier.
   */
  enabled = true,
  /**
   * A beat before the first entry, so the mount happening right now gets the
   * main thread to itself. Warming a screen nobody has asked for must never be
   * what makes the screen they ARE looking at arrive late.
   */
  delayMs = 700,
): void {
  // Held in a ref rather than a dependency: these arrays are module-scope
  // constants at every call site, but a caller building one inline would
  // otherwise restart the whole queue on every render.
  const queueRef = useRef(queue);
  queueRef.current = queue;

  useEffect(() => {
    if (!enabled) return;

    let index = 0;
    let idleId: number | undefined;
    let timerId: number | undefined;
    let cancelled = false;

    const step = () => {
      if (cancelled) return;
      // A rejection is a chunk that failed to fetch, and the answer is to carry
      // on: the screen still works, it just pays for its own module when it is
      // opened. An unhandled rejection would be a warm that takes down the
      // screen it was speeding up.
      void queueRef.current[index++]?.().catch(() => {});
      if (index < queueRef.current.length) schedule();
    };

    const schedule = () => {
      const idle = window.requestIdleCallback;
      if (idle) idleId = idle(step, { timeout: 2000 });
      else timerId = window.setTimeout(step, 150);
    };

    timerId = window.setTimeout(schedule, delayMs);

    return () => {
      cancelled = true;
      if (idleId !== undefined) window.cancelIdleCallback?.(idleId);
      if (timerId !== undefined) window.clearTimeout(timerId);
    };
  }, [enabled, delayMs]);
}
