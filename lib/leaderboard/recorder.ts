import type { Industry, RunState } from "@/lib/engine/types";

import { activeIsland } from "@/lib/engine/save";

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

/*
 * ── One tape per island ────────────────────────────────────────────────────
 *
 * A single key was correct while a device held a single company. With islands
 * it fails in the quietest possible way: `record()` returns early when the
 * stored tape belongs to a different run, so switching to another company
 * would simply stop recording — no throw, no log — and the player would find
 * out at the Still Standing screen, told only that submission is unavailable.
 *
 * The key follows the island the player is on. `record()` keeps its runId
 * check: it is now a second line of defence rather than the only one, and it
 * still catches the case it was written for (a tape left over from the company
 * that used to be in this slot).
 *
 * The pre-islands key is adopted into slot 0 on first touch, exactly as
 * lib/engine/save.ts does for the run beside it — a player mid-company when
 * this shipped keeps a submittable tape.
 */
const KEY_BASE = "novus:tape:v1";
const keyFor = (slot: number) => `${KEY_BASE}:${slot}`;

let legacyAdopted = false;
function adoptLegacyTape(): void {
  if (legacyAdopted || !canStore()) return;
  legacyAdopted = true;
  try {
    const old = localStorage.getItem(KEY_BASE);
    if (old === null) return;
    // Written before removed: a tab killed between the two lines leaves the
    // tape twice rather than not at all.
    if (localStorage.getItem(keyFor(0)) === null) localStorage.setItem(keyFor(0), old);
    localStorage.removeItem(KEY_BASE);
  } catch {
    /* a blocked store keeps the old key; the next boot tries again */
  }
}

/**
 * The tape key for an island — the one named, or the one currently open.
 *
 * A caller names it when the island cannot answer for itself yet. `startTape`
 * runs at the moment a company is founded, BEFORE anything has been written to
 * its island, so "which island is open" is still the island being left: the new
 * company's tape would land on the old company's key and erase the record of
 * every tap it took. Everything after founding reads the open island, which by
 * then is the one holding the run.
 */
const KEY = (slot?: number): string => {
  adoptLegacyTape();
  return keyFor(slot ?? activeIsland());
};

interface StoredTape {
  /** Which company these taps belong to. A different run never inherits them. */
  runId: string;
  seed: number;
  industry: Industry;
  /** Captured at founding — the run clears its own flag after year 1. */
  tutorial: boolean;
  entries: TapeEntry[];
  /** Set once the run has been submitted. */
  submittedAt?: string;
  /*
   * The fiscal year the last submission carried, and whether the company was
   * still alive at the time.
   *
   * Submission used to be a button pressed once, so "has this been submitted"
   * was the only question worth asking. It is automatic now, and a company
   * that survives another year — or dies — is a DIFFERENT result for the same
   * run: `record_board_entry` (0006) upserts on the run, so re-submitting
   * replaces the row rather than adding one. These two fields are what stops
   * the automatic path from re-sending an unchanged run on every screen it
   * passes, and what makes it send again the moment there is something new to
   * say.
   */
  submittedYear?: number;
  submittedAlive?: boolean;
}

const canStore = () => typeof window !== "undefined" && !!window.localStorage;

function read(slot?: number): StoredTape | null {
  if (!canStore()) return null;
  try {
    const raw = localStorage.getItem(KEY(slot));
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
      submittedYear: typeof parsed.submittedYear === "number" ? parsed.submittedYear : undefined,
      submittedAlive: parsed.submittedAlive,
    };
  } catch {
    return null;
  }
}

function write(tape: StoredTape | null, slot?: number) {
  if (!canStore()) return;
  try {
    const key = KEY(slot);
    if (tape) localStorage.setItem(key, JSON.stringify(tape));
    else localStorage.removeItem(key);
  } catch {
    /*
     * A full or blocked store must not take the game down with it. The failure
     * mode is a run that cannot be submitted to a leaderboard, which is a
     * disappointment; throwing here would be a run that cannot be PLAYED, which
     * is a bug. The board is the optional half of this app and behaves like it.
     */
  }
}

/**
 * Starts a fresh tape. Called once, from `startRun`.
 *
 * `slot` is the island the company is being founded on. Pass it: at that moment
 * nothing has been written to that island, so the tape cannot work out where it
 * belongs by asking which one is open — see `KEY` above.
 */
export function startTape(run: RunState, slot?: number) {
  write(
    {
      runId: run.id,
      seed: run.seed,
      industry: run.industry,
      tutorial: run.tutorial,
      entries: [],
    },
    slot,
  );
}

/** Throws away an island's tape. `slot` for the same reason startTape takes one. */
export function clearTape(slot?: number) {
  write(null, slot);
}

/**
 * Appends one entry.
 *
 * Silently does nothing when the stored tape belongs to another run. That is
 * the important case, not an edge one: a player who abandons a company and
 * founds another must not carry the old taps into the new tape, and checking
 * here means no caller has to remember to.
 *
 * `slot` for the same reason `startTape` takes one, and it is not optional in
 * practice for one caller. `activeIsland()` only honours the pointer when the
 * slot it names is OCCUPIED, and a company being founded has had nothing
 * written to its island yet — so between `startTape(next, target)` and
 * `commit(next)` an unqualified `record()` reads the island being LEFT. Its
 * runId does not match, the entry is dropped without a sound, and the one tap
 * recorded in that window is `{t:"pro", on:true}`. A Pro player founding a
 * second company therefore submitted a tape that never said they were Pro, and
 * the verifier replaying it refuses the Pro industry the company was founded
 * in (lib/leaderboard/replay.ts).
 */
export function record(run: RunState, entry: TapeEntry, slot?: number) {
  const tape = read(slot);
  if (!tape || tape.runId !== run.id) return;
  if (tape.entries.length >= MAX_TAPE_ENTRIES) return;
  tape.entries.push(entry);
  write(tape, slot);
}

/** Convenience for the `advance` entry, whose date is always "now". */
export const todayISO = () => new Date().toISOString().slice(0, 10);

export interface TapeStatus {
  /** True when there is a tape for this run with something on it. */
  present: boolean;
  entries: number;
  submitted: boolean;
  /** When the last submission went out, or null. */
  submittedAt: string | null;
  /** False when the tape belongs to a different company than the one open. */
  matchesRun: boolean;
  /**
   * True when this run has something the board has not been told yet — never
   * submitted, or submitted at an earlier year, or submitted while it was
   * still alive and it has since ended. This is the whole condition the
   * automatic submitter runs on (lib/leaderboard/auto.ts).
   */
  stale: boolean;
}

export function tapeStatus(run: RunState | null): TapeStatus {
  const tape = read();
  if (!tape || !run) {
    return {
      present: false,
      entries: 0,
      submitted: false,
      submittedAt: null,
      matchesRun: false,
      stale: false,
    };
  }
  const matchesRun = tape.runId === run.id;
  const present = tape.entries.length > 0;
  const submitted = !!tape.submittedAt;
  return {
    present,
    entries: tape.entries.length,
    submitted,
    submittedAt: tape.submittedAt ?? null,
    matchesRun,
    stale:
      matchesRun &&
      present &&
      (!submitted ||
        run.year > (tape.submittedYear ?? 0) ||
        (tape.submittedAlive === true && !run.alive)),
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

/**
 * Records what was sent, and when.
 *
 * The year and the alive flag travel with the stamp because the board is told
 * about a run more than once now — every year it survives, and again when it
 * ends. Without them `stale` above could only ever mean "never sent", and the
 * automatic submitter would fall silent after a company's first fiscal year.
 */
export function markSubmitted(run: RunState) {
  const tape = read();
  if (!tape || tape.runId !== run.id) return;
  tape.submittedAt = new Date().toISOString();
  tape.submittedYear = run.year;
  tape.submittedAlive = run.alive;
  write(tape);
}
