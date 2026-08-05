import { hasAnySavedRun, loadProfile } from "@/lib/engine/save";

/**
 * Where a player goes when they open Novus.
 *
 * ── The bug this file exists to stop ─────────────────────────────────────────
 *
 * Every web entry point used to ask one question — "have they onboarded?" — and
 * send an onboarded player to /found. That is right for someone whose last
 * company is over and wrong for everyone else: a player with a live company
 * came back to a screen demanding a NEW one, and on the free plan (one founding
 * a real day, `runsRemainingToday()`) the button read NO RUNS LEFT TODAY. Their
 * company was safe in localStorage the whole time. Nothing on the screen could
 * reach it.
 *
 * A saved run is therefore the FIRST question, not an afterthought. This is
 * exactly what the native launcher has always done (native/boot.html reads
 * `novus:run:v1` before `novus:profile:v1`); the web now agrees with it, and
 * both read from the same rule instead of two copies that drift.
 *
 * Synchronous, because callers evaluate it inside a click handler and there is
 * no synchronous fetch — see lib/engine/save.ts for why that constraint holds
 * across the whole persistence layer.
 */
export type EntryRoute = "/islands" | "/found" | "/welcome";

/** Every route the entry points may send someone to. Prefetch fodder. */
export const ENTRY_ROUTES: readonly EntryRoute[] = ["/islands", "/found", "/welcome"];

export function entryRoute(): EntryRoute {
  /*
   * ── Why the front door is the picker and not the game ──────────────────
   *
   * This used to answer "/play", because a player had one company and opening
   * it was unambiguous. With islands it is a question, and answering it on the
   * player's behalf is how a second company becomes invisible: send someone
   * straight into island 0 and the other one exists only for whoever thinks to
   * go looking.
   *
   * A company that ENDED still routes here rather than to founding. Its books
   * stay readable — the picker offers READ THE BOOKS, which opens /play on
   * Chapter Seven — and founding again is one tap from the same screen. That
   * was the reasoning when this returned "/play" for a dead run, and the
   * picker keeps it while adding the choice.
   */
  if (hasAnySavedRun()) return "/islands";
  return loadProfile()?.onboarded ? "/found" : "/welcome";
}
