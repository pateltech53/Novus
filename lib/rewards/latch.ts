"use client";

/**
 * Facts carried from one moment to the next.
 *
 * ── The one mission that needs it ───────────────────────────────────────────
 *
 * Template D7 — "Reject every offer, then end the next quarter cash-positive"
 * — is the only mission in the set whose condition spans two moments that
 * happen on different screens, minutes apart. `advanceBy` grades ONE event
 * against ONE slot and deliberately holds no memory, so the fact that the
 * panel was walked away from has to travel with the quarter that follows it.
 *
 * ── Why sessionStorage and not the run ──────────────────────────────────────
 *
 * The obvious home is `RunState`, and it is the wrong one: the run is a tape
 * the leaderboard verifier replays server-side, and a field that exists only
 * to satisfy a cosmetic daily has no business changing what that tape means.
 * sessionStorage is the right size for the fact — it dies with the tab, which
 * is also roughly when the mission stops being winnable.
 *
 * Reads are destructive (`take`), so the latch cannot pay out twice.
 */

const KEY = "novus.rewards.latch";
const YEAR_KEY = "novus.rewards.lastyear";

const store = (): Storage | null => {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    // Safari in private mode, and any browser with site data blocked.
    return null;
  }
};

/** Remember that this panel ended with offers on the table and none taken. */
export function latchRejectedOffers(): void {
  try { store()?.setItem(KEY, "1"); } catch { /* nothing depends on it */ }
}

/** Read the latch and clear it. False when it was never set. */
export function takeRejectedOffers(): boolean {
  const s = store();
  if (!s) return false;
  try {
    const had = s.getItem(KEY) === "1";
    if (had) s.removeItem(KEY);
    return had;
  } catch {
    return false;
  }
}


/**
 * Last year's books, so a year-over-year mission can be graded.
 *
 * ── Why the reward system remembers this itself ─────────────────────────────
 *
 * Three missions compare a year against the one before it — grow revenue by
 * n%, raise willingness-to-pay by n%, turn a losing year profitable — and the
 * engine keeps no per-year history: `RunState.quarters` holds four numbers and
 * they are all from the year being closed. The alternative to remembering it
 * here was adding a history array to the run, and the run is a tape the
 * leaderboard verifier replays: growing it to satisfy a cosmetic daily would
 * put reward bookkeeping inside the thing that decides whether a score is
 * real.
 *
 * Missing memory reads as zero growth rather than as a completed mission. A
 * player on their first close of the session, or one who cleared their session
 * storage, is told the mission is not done yet — which is the honest answer
 * when there is nothing to compare against.
 */
export interface YearBooks {
  /** Which run and which year, so a different company's numbers are ignored. */
  runId: string;
  year: number;
  revenue: number;
  profit: number;
  /** Willingness to pay, 0-100. */
  wtp: number;
}

export function rememberYear(books: YearBooks): void {
  try { store()?.setItem(YEAR_KEY, JSON.stringify(books)); } catch { /* fine */ }
}

/** The remembered close, only if it is the year before this one on this run. */
export function previousYear(runId: string, year: number): YearBooks | null {
  const s = store();
  if (!s) return null;
  try {
    const raw = s.getItem(YEAR_KEY);
    if (!raw) return null;
    const books = JSON.parse(raw) as Partial<YearBooks>;
    if (books.runId !== runId || books.year !== year - 1) return null;
    return books as YearBooks;
  } catch {
    return null;
  }
}
