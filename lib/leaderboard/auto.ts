"use client";

import type { RunState } from "@/lib/engine/types";

import { submitRun, type SubmitResult } from "./client";
import { tapeStatus } from "./recorder";

/**
 * Automatic submission — the board finds out on its own.
 *
 * ── Why the button went away ────────────────────────────────────────────────
 *
 * Submitting used to be a thing the player did: open Still Standing, read a
 * panel explaining what a tape is, press SUBMIT THIS RUN. Everything that
 * panel explained is still true and none of it was ever the player's problem.
 * The consequence of making it their problem was a board missing most of the
 * game — every player who never opened the screen, everyone who opened it and
 * did not realise the button was the point, and every company that died at
 * 11pm and was never mentioned to anybody.
 *
 * So the run is sent when it has something new to say, and the screen reports
 * what happened rather than asking for permission. Nothing about what the
 * board TRUSTS changes: the tape is still the player's own taps, the server
 * still replays them against `lib/engine`, and the number beside a name is
 * still one nobody — including this function — could type.
 *
 * ── When it fires ───────────────────────────────────────────────────────────
 *
 *   · a fiscal year closes         (GameProvider.submitPerform)
 *   · the company ends             (GameProvider.advance, on `turn.died`)
 *   · the board screen is opened   (StillStandingScreen)
 *
 * `tapeStatus().stale` is the guard for all three: never sent, or sent at an
 * earlier year, or sent while it was alive and it has since ended. A run with
 * nothing new to say costs one localStorage read and no request at all.
 *
 * ── Why it is fire-and-forget, and synchronous up to its first await ────────
 *
 * Every caller is inside a state transition that is about to commit, and none
 * of them can wait for a network round trip — the year-end screen must appear
 * now, not after Vercel answers. `void autoSubmitRun(run)` starts this
 * function, which reads the tape and calls `submitRun` before it awaits
 * anything, so the tape is captured as it stands at the moment of the call
 * even if the caller clears it a line later (which `abandonRun` does).
 */

/** The verdict, plus the two refusals that are not failures. */
export type AutoSubmitOutcome =
  | { kind: "skipped" }
  /** No board handle yet — the screen has to ask for one before this can work. */
  | { kind: "needs-handle" }
  /** The day's ten submissions are spent. Not an error; a later moment. */
  | { kind: "rate-limited" }
  | { kind: "done"; result: SubmitResult };

/**
 * The floor between two automatic submissions of a company that is STILL
 * ALIVE, in milliseconds.
 *
 * `DAILY_SUBMISSION_LIMIT` is ten a day (lib/leaderboard/season.ts) and Pro
 * closes up to 99 fiscal years in one, so "send it every year" would spend the
 * whole day's quota inside an afternoon and then fail loudly for every year
 * after it — the board no better off, because `record_board_entry` upserts one
 * row per player per board and only replaces it when the new run is strictly
 * better. A live company's row is therefore worth refreshing occasionally, not
 * every year.
 *
 * The floor does not apply to a company that has ENDED. That submission is the
 * one that matters — it is the final, best version of the run — and it is at
 * most one per company.
 */
const LIVE_RESUBMIT_FLOOR_MS = 5 * 60_000;

/*
 * One in flight at a time, process-wide.
 *
 * The year-end path and the board screen can fire within a frame of each other
 * — closing a year and then opening Still Standing to look at it is the normal
 * thing to do — and two submissions of one run race to the same upsert. The
 * flag is a module global rather than a ref because the callers are in
 * different components and the run is not.
 */
let inFlight = false;

/**
 * The last result, so a screen mounting after the fact can show what happened
 * without asking the server again. Keyed by run id: a verdict about the
 * company before this one is not a verdict about this one.
 */
let lastResult: { runId: string; result: SubmitResult } | null = null;

export function lastAutoSubmit(run: RunState | null): SubmitResult | null {
  return run && lastResult?.runId === run.id ? lastResult.result : null;
}

export async function autoSubmitRun(run: RunState | null): Promise<AutoSubmitOutcome> {
  if (!run || inFlight) return { kind: "skipped" };

  const tape = tapeStatus(run);
  if (!tape.stale) return { kind: "skipped" };

  // The quota floor, live companies only. See LIVE_RESUBMIT_FLOOR_MS.
  if (run.alive && tape.submittedAt) {
    const since = Date.now() - Date.parse(tape.submittedAt);
    if (Number.isFinite(since) && since < LIVE_RESUBMIT_FLOOR_MS) return { kind: "skipped" };
  }

  inFlight = true;
  try {
    const result = await submitRun(run);

    /*
     * A refusal for want of a handle is not a failure to remember — it is a
     * question for the player, and the screen that can ask it may not be open.
     * Deliberately NOT recorded as the last result: the moment they pick a
     * name this run has something to say again, and a stored "you have no
     * name" would be the verdict shown beside a run that has since listed.
     */
    if (result.reason === "needs-handle") return { kind: "needs-handle" };

    /*
     * Spending the day's tenth submission is not a failure either, and it is
     * emphatically not something to put in front of a child as "this run has
     * not reached the board". The tape stays unmarked, so the next moment that
     * fires — the next year, the company ending, the next time the board is
     * opened — sends it. Also not recorded as the last result, for the same
     * reason as a missing handle: it would be a verdict about the quota shown
     * beside a run that has since listed.
     */
    if (result.reason === "rate-limited") return { kind: "rate-limited" };

    // Everything else is kept, including the failures — "could not reach the
    // board" is exactly what the screen should say, and saying nothing is how
    // an automatic system reads as a broken one.
    lastResult = { runId: run.id, result };
    return { kind: "done", result };
  } finally {
    inFlight = false;
  }
}
