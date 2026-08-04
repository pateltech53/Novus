"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A tap that leaves this screen, with something to show for it.
 *
 * ── The gap this closes ─────────────────────────────────────────────────────
 *
 * Every route change in this app is a `router.push` from a click handler, and
 * a `router.push` is not instant: the destination chunk has to arrive (or come
 * off the prefetch cache), the tree has to render, and only then does the
 * screen change. `/play` is 421 kB gz. In between, React does exactly nothing
 * visible — the button stays lit, the old screen stays put, and the player,
 * reasonably, taps it again.
 *
 * `AccountGate` already solved this once, well, including the part everyone
 * gets wrong. The pattern was never lifted out, so `app/found/page.tsx:167`
 * and `:228`, `app/welcome/page.tsx:82` and `components/landing/Landing.tsx:428`
 * each shipped the raw push. This is that pattern, extracted verbatim in
 * behaviour, so all five sites answer a tap the same way.
 *
 * ── Why it lets go ──────────────────────────────────────────────────────────
 *
 * The subtle half, quoting AccountGate's own note: a "busy" flag that guards
 * against a double tap will LATCH, because the only expected outcome is a
 * navigation that unloads the component holding the flag. Any outcome that is
 * not that — a push that resolves nowhere, a route the native shell cannot
 * find — leaves the one button on the screen permanently dead, with the second
 * press swallowed by the guard meant to protect it.
 *
 * So the flag is on a timer. If the navigation happens, this component is gone
 * long before it fires and the timer is moot. If it is still here when the
 * timer lands, the tap failed and the player gets their button back.
 *
 * Returns `[busy, run, release]`. Wrap the handler, and render the button
 * disabled with a changed label while `busy`:
 *
 *   const [going, go] = useNavigating();
 *   <button disabled={going} onClick={() => go(() => router.push("/play"))}>
 *     {going ? "OPENING…" : "CONTINUE ▸"}
 *   </button>
 *
 * `release` is for the handlers that can decide, part-way through, not to
 * navigate after all — the landing CTA awaits the cloud restore before it finds
 * out whether the visitor has an account, and if they do not it shows the
 * sign-up form instead. Those want the latch during the await and gone the
 * instant the answer is "not a navigation", rather than a button that reads
 * OPENING… for four seconds next to an error message.
 */
const RETRY_AFTER_MS = 4000;

export function useNavigating(): [
  boolean,
  (action: () => void | Promise<void>) => void,
  () => void,
] {
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  /*
   * The guard is a ref, not the `busy` state, and the action fires OUTSIDE the
   * updater. A state updater must be pure — React calls it twice in StrictMode
   * — so navigating from inside one would fire the push twice in development
   * and hide a real double-navigation bug behind "it works in production".
   */
  const going = useRef(false);

  // A pending timer on an unmounted component is a setState-after-unmount
  // warning in dev and a leak everywhere.
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );

  const run = useCallback((action: () => void | Promise<void>) => {
    if (going.current) return;
    going.current = true;
    setBusy(true);
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      going.current = false;
      setBusy(false);
    }, RETRY_AFTER_MS);
    void action();
  }, []);

  const release = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    going.current = false;
    setBusy(false);
  }, []);

  return [busy, run, release];
}
