"use client";

import { useEffect, useRef } from "react";

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
 * ── The handler is read at BACK time, not at registration time ──────────────
 *
 * This is what the comment here used to claim and the code did not do. The
 * entry was `() => handler()`, an arrow closing over the `handler` binding of
 * the one render where `active` flipped true — and since `active` is the only
 * dependency, that render is the only one the stack ever sees. Every later
 * render's handler was unreachable.
 *
 * For a screen whose dismissal is `() => setActivity(null)` that is harmless:
 * a setter is stable and closes over nothing. For the decision card it was
 * not. `advanceMonth` surfaces up to TWO cards per tap (`capped` in
 * lib/engine/run.ts), `GameProvider.dismissCard` is a `useCallback` over
 * `[queue]`, and `!!current` stays true across the pair — so answering the
 * first card left the stack holding a dismissal that still believed
 * `queue[0]` was that first card. Back then wrote `{t:"dismiss", eventId:
 * <the card already answered>}` into the leaderboard tape while dropping the
 * second one, and read `performOnly` off the wrong event: a camera-gated card
 * could be walked away from. The tape is replayed against the real engine by
 * the verifier (lib/leaderboard/replay.ts), so a tape naming the wrong card is
 * a run that no longer reproduces.
 *
 * A ref costs one assignment per render and keeps the stack order intact,
 * which is the property the old comment was actually defending.
 */
export function useBackHandler(active: boolean, handler: Handler): void {
  const latest = useRef(handler);
  latest.current = handler;

  useEffect(() => {
    if (!active) return;
    const entry: Handler = () => latest.current();
    stack.push(entry);
    return () => {
      const i = stack.lastIndexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
    // `handler` is deliberately not a dependency: the identity of an inline
    // arrow changes every render, and re-registering would move this entry to
    // the top of the stack each time, ahead of anything opened after it. The
    // ref above is what keeps the CONTENTS fresh without moving the entry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
