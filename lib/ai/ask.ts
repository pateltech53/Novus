import type { RunState } from "@/lib/engine/types";
import { S_UNIT } from "@/lib/engine/constants";
import { standardAsk } from "./panel-context";

/**
 * THE ASK IS THE FOUNDER'S — a number they set, not one the books set for them.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * The Tank used to price the raise itself: `standardAsk()` read the books and
 * decided how much this founder wanted and for what equity, and the player
 * discovered "their" ask when a shark quoted it back at them. That inverts the
 * whole exercise. Deciding how much to raise, what slice to give up, and what
 * valuation those two numbers imply IS the lesson the room teaches — and a
 * founder who never chose the numbers cannot be usefully attacked over them.
 *
 * So the ask is now set by the player, on the numbers card they pitch from
 * (`components/PitchNotes.tsx`), and the panel reads it from here when the
 * session is built. `standardAsk()` is still the DEFAULT — a sensible opening
 * position for a player who never touches the sliders — and still what the
 * leaderboard replays, deterministically, for everyone (see `dealFor` in
 * lib/leaderboard/replay.ts; nothing here reaches a rank).
 *
 * ── Why a module store and not RunState ────────────────────────────────────
 *
 * The ask is per-raise ephemera: it matters from the moment the notes open to
 * the moment the room closes, and next year's raise starts from next year's
 * books. Same pattern as `lib/sound.ts` — module state, localStorage so a mid-
 * pitch reload keeps the number, listeners so React can see it change. Keyed
 * to run AND year so it resets exactly when the books it was priced against do.
 */

export interface PlayerAsk {
  amountUsd: number;
  equityPct: number;
}

export interface AskBounds {
  minUsd: number;
  maxUsd: number;
  stepUsd: number;
  minPct: number;
  maxPct: number;
  stepPct: number;
}

const STORAGE_KEY = "novus:ask:v1";

interface Stored extends PlayerAsk {
  runId: string;
  year: number;
}

let cached: Stored | null = null;
const listeners = new Set<() => void>();

/** What a founder who never touched the sliders walks in asking for. */
export function defaultAsk(run: RunState): PlayerAsk {
  // Same floor SharkPanel always used: a pre-revenue garage still asks for
  // something (you raise to buy runway, not to match a valuation).
  return standardAsk(run, 4 * S_UNIT[run.stage]);
}

/**
 * The sliders' rails. Wide on purpose: asking for far too much (or a sliver)
 * is a legitimate move with consequences the room will spell out — the rails
 * exist to keep the number sane, not to keep the player right.
 */
export function askBounds(run: RunState): AskBounds {
  const S = S_UNIT[run.stage];
  const base = defaultAsk(run).amountUsd;
  const minUsd = S;
  const maxUsd = niceCeil(Math.max(base * 2.5, run.stats.valuation * 0.8, 10 * S));
  return {
    minUsd,
    maxUsd,
    // ~150 stops across the range, snapped to a round figure so the readout
    // never shows $487,314 — nobody asks a room for that number.
    stepUsd: niceStep((maxUsd - minUsd) / 150),
    minPct: 1,
    maxPct: 49,
    stepPct: 0.5,
  };
}

/** What the two numbers say the whole company is worth. */
export function impliedValuation(ask: PlayerAsk): number {
  return ask.equityPct > 0 ? Math.round(ask.amountUsd / (ask.equityPct / 100)) : 0;
}

/** The founder's current ask for this run-year — theirs if they set one, the
 *  standard one otherwise. Always returned clamped to today's rails. */
export function getPlayerAsk(run: RunState): PlayerAsk {
  const stored = readStored();
  const raw =
    stored && stored.runId === run.id && stored.year === run.year
      ? { amountUsd: stored.amountUsd, equityPct: stored.equityPct }
      : defaultAsk(run);
  return clampAsk(run, raw);
}

export function setPlayerAsk(run: RunState, ask: PlayerAsk): void {
  const next = clampAsk(run, ask);
  cached = { runId: run.id, year: run.year, ...next };
  try {
    window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(cached));
  } catch {
    /* private mode — the in-memory copy still carries the session */
  }
  for (const fn of listeners) fn();
}

/** Subscribe to ask changes. Returns the unsubscribe. */
export function onAskChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// ── Internals ───────────────────────────────────────────────────────────────

function readStored(): Stored | null {
  if (cached) return cached;
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (
      typeof parsed.runId !== "string" ||
      typeof parsed.year !== "number" ||
      !Number.isFinite(parsed.amountUsd) ||
      !Number.isFinite(parsed.equityPct)
    ) {
      return null;
    }
    cached = parsed as Stored;
    return cached;
  } catch {
    return null;
  }
}

function clampAsk(run: RunState, ask: PlayerAsk): PlayerAsk {
  const b = askBounds(run);
  const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
  return {
    amountUsd: Math.round(clamp(ask.amountUsd, b.minUsd, b.maxUsd)),
    equityPct: Number(clamp(ask.equityPct, b.minPct, b.maxPct).toFixed(1)),
  };
}

/** The nearest 1/2/5×10ⁿ at or above `raw` — slider steps land on round money. */
function niceStep(raw: number): number {
  const mag = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  for (const m of [1, 2, 5, 10]) {
    if (m * mag >= raw) return m * mag;
  }
  return 10 * mag;
}

/** `raw` rounded UP to a figure the top of a slider can honestly say. */
function niceCeil(raw: number): number {
  const step = niceStep(Math.max(1, raw) / 10);
  return Math.ceil(raw / step) * step;
}
