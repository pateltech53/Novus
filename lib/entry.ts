import { loadProfile, loadRun } from "@/lib/engine/save";

/**
 * Which door this device opens.
 *
 * The landing page asks this in two places — the account gate's CONTINUE AS
 * button and the pricing table's PLAY FREE — and both used to answer
 * "/found": the screen for founding a NEW company. For a returning player with
 * a company already running, that is the wrong room, and on the free plan it
 * is a locked one. One run a day is the free allowance and the ledger counts
 * STARTS, so the company they were coming back to had already spent the day's
 * slot: FOUND IT reads NO RUNS LEFT TODAY, disabled, with nothing on the
 * screen pointing at the live company. The only way back in was to know to
 * type /play.
 *
 * With a slot still free it was worse rather than better — the button worked,
 * and founding overwrites `novus:run:v1`, so coming back through the front
 * door and naming a second company silently buried the first.
 *
 * So: a saved company wins over everything. That includes a dead one — /play
 * shows Chapter 7, which is the screen that lets the player read the autopsy
 * and then found again, rather than a paperwork screen that pretends the
 * company never existed.
 *
 * Only reachable in the browser: both callers use it inside a click handler.
 */
export function entryRoute(): "/play" | "/found" | "/welcome" {
  if (loadRun()) return "/play";
  return loadProfile()?.onboarded ? "/found" : "/welcome";
}
