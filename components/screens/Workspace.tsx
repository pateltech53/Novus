"use client";

import { createContext, useContext, useSyncExternalStore } from "react";

/**
 * Where a screen goes on a desktop.
 *
 * The play screen is three columns on desktop: the company and its activities
 * on the left, the books and the clock in the middle, the life log on the
 * right. The navigation moved to the left rail — and a rail whose items open a
 * full-screen modal over the whole layout is a rail that fights the layout it
 * lives in. You click a thing on the left and the screen you were reading
 * disappears behind it.
 *
 * So the centre column offers a slot. An activity screen that opts in
 * (`workspace` on its ScreenSheet) renders into that slot as a panel instead
 * of over everything as a sheet: the books stay visible above it, the life log
 * stays visible beside it, and the rail keeps its selected row lit.
 *
 * Three things must all be true before that happens, and ScreenSheet checks
 * every one:
 *
 *   · a slot is actually mounted (this context is non-null),
 *   · the viewport is wide enough that the slot is not `display: none` —
 *     portalling into a hidden node is content that silently vanishes,
 *   · UIKit is not drawing the chrome. On iOS an overlay is a real sheet with
 *     a real glass toolbar over it; there is no three-column workspace to
 *     dock into.
 *
 * Screens that are not activities — the log, the stage guide, the glossary —
 * never pass `workspace`, so they stay modal everywhere. Closet and Market are
 * activities but not panels: one is a dressing room, the other is the in-game
 * phone, and both are whole experiences rather than a page of the workspace.
 */
export const WorkspaceSlot = createContext<HTMLElement | null>(null);

export function useWorkspaceSlot(): HTMLElement | null {
  return useContext(WorkspaceSlot);
}

/**
 * The same `lg:` seam the play screen's grid is built on, read at runtime.
 *
 * Tailwind can hide the slot with a class; only JS can decide not to portal
 * into it. 64rem is `lg`, and it is written here in `rem` rather than `px` so
 * a player who scales their text moves this seam with everything else.
 */
const WIDE = "(min-width: 64rem)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mq = window.matchMedia(WIDE);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

export function useIsWide(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => !!window.matchMedia?.(WIDE).matches,
    // The server has no viewport. `false` means the first paint is the sheet,
    // which is the correct answer on a phone and a one-frame correction on a
    // desktop — the opposite default would flash a docked panel onto a phone.
    () => false,
  );
}
