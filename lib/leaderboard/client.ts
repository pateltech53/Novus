"use client";

import { API_CREDENTIALS, apiUrl } from "@/lib/native/origin";
import type { RunState } from "@/lib/engine/types";
import { deriveValuation } from "@/lib/engine/sim";

import { buildTape, markSubmitted } from "./recorder";
import type { Board } from "./boards";

/**
 * The browser's half of the leaderboard.
 *
 * Every call is browser → our own Route Handler → Supabase. The browser holds
 * no Supabase URL, no key and no session for Supabase itself — which is why
 * this file imports nothing from `@supabase/supabase-js` and never will. No new
 * network origin, no third-party cookie, no Google-side identifier on a product
 * for minors (docs/LEADERBOARD.md §1.4, §9.6).
 */

export interface BoardRow {
  rank: number;
  /** The entry's own id, so a row can be reported. Listed rows only. */
  id: string;
  founder_display_name: string;
  company_name: string;
  industry: string;
  peak_valuation: number;
  years_survived: number;
  ended_by: string | null;
  achieved_on: string;
  season: string;
}

/** Everyone, or only the caller's classroom. */
export type BoardScope = "global" | "chapter";

export interface BoardPage {
  configured: boolean;
  board: Board;
  season: string;
  scope?: BoardScope;
  rows: BoardRow[];
  /** This player's handle, so the screen can find their own row. */
  myHandle: string | null;
  /** The caller's own place among ALL listed rows — present even when their
   *  row is below the visible slice. Null when they are not on the board. */
  myRank?: { rank: number; total: number } | null;
  /** The caller's own row, rank included, for pinning under the list. */
  myRow?: BoardRow | null;
  /** Whether this account belongs to a chapter, so the screen knows to offer
   *  the MY CHAPTER scope at all. */
  chapterAvailable?: boolean;
}

const EMPTY: BoardPage = {
  configured: false,
  board: "survival",
  season: "",
  rows: [],
  myHandle: null,
  myRank: null,
  myRow: null,
  chapterAvailable: false,
};

export async function fetchBoard(
  board: Board,
  season?: string,
  scope: BoardScope = "global",
): Promise<BoardPage> {
  const query = new URLSearchParams({ board });
  if (season) query.set("season", season);
  if (scope !== "global") query.set("scope", scope);
  try {
    const res = await fetch(apiUrl(`/api/leaderboard?${query}`), {
      credentials: API_CREDENTIALS,
    });
    if (!res.ok) return { ...EMPTY, board };
    return (await res.json()) as BoardPage;
  } catch {
    /*
     * A board that cannot be reached is an empty board, never a broken screen.
     * This is the optional half of the app: a player with no network still has
     * a company to run, and the one thing they must not get for tapping a tab
     * is an error dialog about somebody else's server.
     */
    return { ...EMPTY, board };
  }
}

export interface HandleOffer {
  ok: boolean;
  current: string | null;
  options: string[];
  reason?: string;
}

export async function fetchHandles(): Promise<HandleOffer> {
  try {
    const res = await fetch(apiUrl("/api/leaderboard/handle"), {
      credentials: API_CREDENTIALS,
    });
    const body = (await res.json()) as HandleOffer;
    return res.ok ? body : { ok: false, current: null, options: [], reason: body.reason };
  } catch {
    return { ok: false, current: null, options: [], reason: "offline" };
  }
}

export async function claimHandle(handle: string): Promise<{ ok: boolean; reason?: string }> {
  try {
    const res = await fetch(apiUrl("/api/leaderboard/handle"), {
      method: "POST",
      credentials: API_CREDENTIALS,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ handle }),
    });
    const body = (await res.json()) as { ok: boolean; reason?: string };
    return { ok: res.ok && body.ok, reason: body.reason };
  } catch {
    return { ok: false, reason: "offline" };
  }
}

export type SubmitStatus =
  | "verified"
  | "flagged"
  | "rejected"
  | "duplicate"
  | "no-tape"
  | "error";

export interface SubmitResult {
  status: SubmitStatus;
  /** What the SERVER computed, not what this device claimed. */
  peakValuation: number | null;
  yearsSurvived: number | null;
  listed: boolean;
  message: string | null;
  reason?: string;
}

/**
 * Submits the run that is open.
 *
 * The two numbers sent are CLAIMS and are labelled that way all the way down.
 * They exist so the server can measure how often a claim differs from the
 * truth; no board query reads them, and the numbers that come back are the
 * server's own (§7.1). The screen shows what comes back, which is how a player
 * whose save was edited finds out here rather than by wondering why the board
 * disagrees with their year-end statement.
 */
export async function submitRun(run: RunState): Promise<SubmitResult> {
  const tape = buildTape(run);
  if (!tape) {
    return {
      status: "no-tape",
      peakValuation: null,
      yearsSurvived: null,
      listed: false,
      message:
        "This company was founded before the board existed, so there is nothing to verify. The next one counts.",
    };
  }

  try {
    const res = await fetch(apiUrl("/api/leaderboard/submit"), {
      method: "POST",
      credentials: API_CREDENTIALS,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tape,
        // The client's reading of its own run. Sent to be diffed, not believed.
        claimedPeakValuation: deriveValuation(run),
        claimedYearsSurvived: Math.max(1, run.year - (run.alive ? 1 : 0)),
        proAtSubmit: run.pro,
      }),
    });
    const body = (await res.json()) as {
      ok: boolean;
      status?: SubmitStatus;
      peakValuation?: number;
      yearsSurvived?: number;
      listed?: boolean;
      message?: string;
      reason?: string;
    };

    if (body.status === "duplicate") {
      markSubmitted(run);
      return {
        status: "duplicate",
        peakValuation: null,
        yearsSurvived: null,
        listed: false,
        message: "That run is already on the board.",
      };
    }

    if (!res.ok || !body.ok) {
      return {
        status: body.status === "rejected" ? "rejected" : "error",
        peakValuation: null,
        yearsSurvived: null,
        listed: false,
        message: body.message ?? null,
        reason: body.reason,
      };
    }

    markSubmitted(run);
    return {
      status: (body.status as SubmitStatus) ?? "verified",
      peakValuation: body.peakValuation ?? null,
      yearsSurvived: body.yearsSurvived ?? null,
      listed: body.listed === true,
      message: body.message ?? null,
    };
  } catch {
    return {
      status: "error",
      peakValuation: null,
      yearsSurvived: null,
      listed: false,
      message: "Could not reach the board. Your run is safe on this device.",
      reason: "offline",
    };
  }
}

/** One tap, and the row comes down while a person looks at it (§9.3). */
export async function reportEntry(entryId: string): Promise<boolean> {
  try {
    const res = await fetch(apiUrl("/api/leaderboard/report"), {
      method: "POST",
      credentials: API_CREDENTIALS,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ entryId }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
