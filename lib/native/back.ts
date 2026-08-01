"use client";

import { useEffect } from "react";

/**
 * One back gesture, one dismissal.
 *
 * Every overlay in this app is React state rather than a history entry, so
 * Android's back button and the iOS edge swipe have nothing to pop. Instead of
 * rewriting every sheet to own a route, screens push a dismiss function onto
 * this stack while they are open. Back runs the top one.
 *
 * A stack, not a single handler: the phone can be open over the play screen
 * with an app open inside it, and back has to peel exactly one layer.
 */

type Handler = () => void;

const stack: Handler[] = [];

/** Runs the topmost handler. Returns false when nothing was open. */
export function popBack(): boolean {
  const fn = stack[stack.length - 1];
  if (!fn) return false;
  fn();
  return true;
}

export function backDepth(): number {
  return stack.length;
}

/**
 * Registers a dismissal for as long as `active` is true.
 *
 * The handler is read through a ref-like closure on every call, so a screen
 * can re-render freely without churning the stack — re-ordering the stack on
 * every render is how back starts closing the wrong thing.
 */
export function useBackHandler(active: boolean, handler: Handler): void {
  useEffect(() => {
    if (!active) return;
    const entry: Handler = () => handler();
    stack.push(entry);
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
    // `handler` is deliberately not a dependency: the identity of an inline
    // arrow changes every render, and re-registering would move this entry to
    // the top of the stack each time, ahead of anything opened after it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
