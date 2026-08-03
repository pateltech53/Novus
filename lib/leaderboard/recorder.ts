import type { Industry, RunState } from "@/lib/engine/types";

import { MAX_TAPE_ENTRIES, type RunTape, type TapeEntry } from "./tape";

/**
 * The recorder — the client half of the tape.
 *
 * ── Why this is not part of RunState ────────────────────────────────────────
 *
 * `lib/engine/types.ts` is additive-only by house rule and the engine is
 * deliberately ignorant of everything outside the simulation. A tape is not
 * part of the run; it is a record OF the run, kept beside it — the same
 * argument `OpenTable` makes in `lib/engine/save.ts`, for the same reason.
 * Adding 4000 entries to the object `saveRun()` serialises on every commit
 * would also mean mirroring them to the cloud on every debounce, and the tape
 * has exactly one destination and it is not the save file.
 *
 * ── Why it is written at the same moments the run is ────────────────────────
 *
 * Every append below happens inside the call that mutates the run, before
 * `commit()`. A recorder that runs afterwards, or on a timer, or in an effect,
 * eventually records a tap the run did not take or misses one it did — and a
 * tape that disagrees with the save by one entry replays to a different
 * company. There is no partial credit here: the tape is either the run or it
 * is nothing.
 *
 * ── What it never records ───────────────────────────────────────────────────
 *
 * The founder's name, the player's age, and anything a microphone heard.
 * `PerformScreen` hands over the TRANSCRIPT because the scorer reads words and
 * nothing else (Brand Law 5), which is also why there is no audio to keep
 * (docs/LEADERBOARD.md §9.1).
 */

const KEY = "novus:tape:v1";

interface StoredTape {
  /** Which company these taps belong to. A different run never inherits them. */
  runId: string;
  seed: number;
  industry: Industry;
  /** Captured at founding — the run clears its own flag after year 1. */
  tutorial: boolean;
  entries: TapeEntry[];
  /** Set once the run has been submitted, so it cannot be submitted twice. */
  submittedAt?: string;
}

const canStore = () => typeof window !== "undefined" && !!window.localStorage;

function read(): StoredTape | null {
  if (!canStore()) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredTape>;
    if (typeof parsed.runId !== "string" || !Array.isArray(parsed.entries)) return null;
    return {
      runId: parsed.runId,
      seed: Number(parsed.seed ?? 0),
      industry: (parsed.industry ?? "FOOD") as Industry,
      tutorial: parsed.tutorial === true,
      entries: parsed.entries as TapeEntry[],
      submittedAt: parsed.submittedAt,
    };
  } catch {
    return null;
  }
}

function write(tape: StoredTape | null) {
  if (!canStore()) return;
  try {
    if (tape) localStorage.setItem(KEY, JSON.stringify(tape));
    else localStorage.removeItem(KEY);
  } catch {
    /*
     * A full or blocked store must not take the game down with it. The failure
     * mode is a run that cannot be submitted to a leaderboard, which is a
     * disappointment; throwing here would be a run that cannot be PLAYED, which
     * is a bug. The board is the optional half of this app and behaves like it.
     */
  }
}

/** Starts a fresh tape. Called once, from `startRun`. */
export function startTape(run: RunState) {
  write({
    runId: run.id,
    seed: run.seed,
    industry: run.industry,
    tutorial: run.tutorial,
    entries: [],
  });
}

export function clearTape() {
  write(null);
}

/**
 * Appends one entry.
 *
 * Silently does nothing when the stored tape belongs to another run. That is
 * the important case, not an edge one: a player who abandons a company and
 * founds another must not carry the old taps into the new tape, and checking
 * here means no caller has to remember to.
 */
export function record(run: RunState, entry: TapeEntry) {
  const tape = read();
  if (!tape || tape.runId !== run.id) return;
  if (tape.entries.length >= MAX_TAPE_ENTRIES) return;
  tape.entries.push(entry);
  write(tape);
}

/** Convenience for the `advance` entry, whose date is always "now". */
export const todayISO = () => new Date().toISOString().slice(0, 10);

export interface TapeStatus {
  /** True when there is a tape for this run with something on it. */
  present: boolean;
  entries: number;
  submitted: boolean;
  /** False when the tape belongs to a different company than the one open. */
  matchesRun: boolean;
}

export function tapeStatus(run: RunState | null): TapeStatus {
  const tape = read();
  if (!tape || !run) return { present: false, entries: 0, submitted: false, matchesRun: false };
  return {
    present: tape.entries.length > 0,
    entries: tape.entries.length,
    submitted: !!tape.submittedAt,
    matchesRun: tape.runId === run.id,
  };
}

/**
 * Builds the submission.
 *
 * Company name and industry are read from the RUN rather than from the stored
 * tape, because Settings can rename a company and the board should show what it
 * was called when it died. `founderName` is hard-coded empty and typed that
 * way: §9.2 is not a policy this function chooses to follow, it is a shape it
 * cannot express otherwise.
 */
export function buildTape(run: RunState): RunTape | null {
  const tape = read();
  if (!tape || tape.runId !== run.id || tape.entries.length === 0) return null;
  return {
    seed: tape.seed,
    founderName: "",
    companyName: run.companyName,
    industry: run.industry,
    // From the tape, not the run: `closeYear` clears `run.tutorial` after the
    // first year, so by submission time the run no longer remembers being one.
    tutorial: tape.tutorial,
    entries: tape.entries,
  };
}

/** Marks the tape spent. The unique index on (profile, hash) is the backstop. */
export function markSubmitted(run: RunState) {
  const tape = read();
  if (!tape || tape.runId !== run.id) return;
  tape.submittedAt = new Date().toISOString();
  write(tape);
}
