import { hasSavedRun, loadProfile } from "@/lib/engine/save";

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
export type EntryRoute = "/play" | "/found" | "/welcome";

/** Every route the entry points may send someone to. Prefetch fodder. */
export const ENTRY_ROUTES: readonly EntryRoute[] = ["/play", "/found", "/welcome"];

export function entryRoute(): EntryRoute {
  // A dead company routes here too, on purpose: /play shows Chapter Seven, and
  // reading what killed it is how a run ends. Founding again is one tap from
  // that screen, and it is the player's tap.
  if (hasSavedRun()) return "/play";
  return loadProfile()?.onboarded ? "/found" : "/welcome";
}
