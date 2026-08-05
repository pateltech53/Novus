import type { GameEvent, LegacyState, RunState } from "./types";
import type { YearEndSummary } from "./run";
import { DEFAULT_AVATAR } from "./avatar";
import { queueLegacy, queuePrefs, queueRun } from "@/lib/cloud/sync";
import { ISLAND_CAP } from "@/lib/monetization";

/**
 * Persistence adapter. localStorage AND Supabase, in that order.
 *
 * The six functions below kept their synchronous signatures through the
 * Supabase migration, exactly as this file promised they would. That is not
 * cosmetic: callers read them during render (AccountGate's `destination()`,
 * ClosetScreen's lazy `useState`), and there is no synchronous fetch.
 *
 * So localStorage stays the cache the game reads, and every write is mirrored
 * to the server on a debounce by lib/cloud/sync.ts. If Supabase is not
 * configured, or the network is gone, the queue calls are no-ops and this file
 * behaves precisely as it did before — a cloud backup may fail; a save may not.
 *
 * One field is deliberately never mirrored: `Profile.playerAge`. It is local
 * age-gating, and shipping it would turn a device preference into stored data
 * about a child (docs/LEADERBOARD.md §9.4).
 */

/**
 * ── Islands ────────────────────────────────────────────────────────────────
 *
 * A player holds up to ISLAND_CAP companies at once, and every one of them is
 * a full RunState. `public.saves` has been keyed `(profile_id, slot)` since
 * 0001; this file is the device's half of the same idea.
 *
 * The run and the open table are therefore PER SLOT. Legacy, profile and the
 * entitlements beside them are not: legacy is the founder's record and follows
 * the person across companies (0001 keeps it one row per profile), and the
 * profile is the person.
 *
 * `novus:run:v1` and `novus:table:v1` — the pre-islands keys — are migrated
 * into slot 0 on first touch and removed. See `adoptLegacyKeys`.
 */
const KEYS = {
  legacy: "novus:legacy:v1",
  profile: "novus:profile:v1",
  /** Which island the player is on. A number, 0..ISLAND_CAP-1. */
  active: "novus:island:v1",
  /** The picker's cache. Derived; `listIslands()` rebuilds it when it drifts. */
  index: "novus:islands:v1",
} as const;

/** What this device called the single company before islands existed. */
const PRE_ISLANDS = { run: "novus:run:v1", table: "novus:table:v1" } as const;

/** Every localStorage key this file may write, for the sign-out wipe. */
export const SAVE_KEY_PREFIXES: readonly string[] = [
  "novus:run:v1",
  "novus:table:v1",
  KEYS.legacy,
  KEYS.profile,
  KEYS.active,
  KEYS.index,
];

const runKey = (slot: number) => `novus:run:v1:${slot}`;
const tableKey = (slot: number) => `novus:table:v1:${slot}`;

/** A slot number that is certainly storable, whatever a caller passed. */
const safeSlot = (slot: number): number =>
  Math.min(ISLAND_CAP - 1, Math.max(0, Math.trunc(Number.isFinite(slot) ? slot : 0)));

/*
 * The one-time move from "one company" to "island 0".
 *
 * Runs before any island read or write, exactly once per page. It is written
 * to be safe to interrupt: the new key is set BEFORE the old one is removed,
 * so a tab killed between the two lines has the company twice rather than not
 * at all, and the second run of this function tidies up. A copy, in other
 * words, never a move.
 */
let legacyAdopted = false;
function adoptLegacyKeys(): void {
  if (legacyAdopted || !canStore()) return;
  legacyAdopted = true;
  try {
    const run = localStorage.getItem(PRE_ISLANDS.run);
    if (run !== null) {
      if (localStorage.getItem(runKey(0)) === null) localStorage.setItem(runKey(0), run);
      localStorage.removeItem(PRE_ISLANDS.run);
    }
    const table = localStorage.getItem(PRE_ISLANDS.table);
    if (table !== null) {
      if (localStorage.getItem(tableKey(0)) === null) localStorage.setItem(tableKey(0), table);
      localStorage.removeItem(PRE_ISLANDS.table);
    }
  } catch {
    // A blocked store leaves the old key where it is; the player keeps their
    // company under the old name and the next boot tries again.
  }
}

export interface Profile {
  founderName: string;
  playerAge: number | null;
  rookieMode: boolean;
  onboarded: boolean;
  micCalibration: number | null; // O2 volume baseline (0..1)
}

const canStore = () => typeof window !== "undefined" && !!window.localStorage;

/**
 * Saves outlive schema changes. A run stored before a field existed must not
 * crash the screen that reads it, so every load is backfilled to the current
 * shape rather than trusted.
 */
function migrate(raw: Partial<RunState>): RunState {
  const state = raw as RunState;
  state.pro ??= false;
  state.roster ??= [];
  state.holdings ??= [];
  state.positions ??= [];
  state.brokerageCash ??= 0;
  state.readMail ??= [];
  state.avatar ??= { ...DEFAULT_AVATAR, name: state.founderName ?? "" };
  state.burnScale ??= 1;
  state.karma ??= 0;
  state.quarters ??= [0, 0, 0, 0];
  // A run saved before the ledger existed has no history, and an empty history
  // is a sparkline that does not draw — never a crash.
  state.ledger ??= [];
  state.autopsyMagnets ??= [];
  state.unknownSpecials ??= [];
  state.recurring ??= [];
  state.decisions ??= [];
  state.performs ??= [];
  state.seenTerms ??= [];
  return state;
}

export function loadRun(slot: number = activeIsland()): RunState | null {
  if (!canStore()) return null;
  adoptLegacyKeys();
  // A held write must never be invisible to a read. See saveRun's note.
  flushRun();
  try {
    const raw = localStorage.getItem(runKey(safeSlot(slot)));
    return raw ? migrate(JSON.parse(raw) as Partial<RunState>) : null;
  } catch {
    return null;
  }
}

/**
 * Is there a company on this device?
 *
 * Cheaper than loadRun() and answers the only question the entry points ask —
 * "continue, or found?" (lib/entry.ts). A corrupt blob reads as "no run", the
 * same answer loadRun() gives it, so the two can never disagree about whether
 * /play has something to open.
 */
export function hasSavedRun(slot: number = activeIsland()): boolean {
  if (!canStore()) return false;
  adoptLegacyKeys();
  flushRun();
  try {
    const raw = localStorage.getItem(runKey(safeSlot(slot)));
    if (!raw) return false;
    return typeof (JSON.parse(raw) as Partial<RunState>)?.companyName === "string";
  } catch {
    return false;
  }
}

/** Is there a company on ANY island? The entry points' real question. */
export function hasAnySavedRun(): boolean {
  return occupiedSlots().length > 0;
}

/*
 * ── The write is coalesced. It is never deferred past anything that can lose
 *    it. ───────────────────────────────────────────────────────────────────
 *
 * `GameProvider.commit()` is the sole write path for every decision, activity
 * and month advance, and it called straight through to a synchronous
 * `JSON.stringify` + `localStorage.setItem` of the entire run. Measured with
 * the balance harness (8 runs × 10 years, seed 1, clock frozen): median
 * 40,650 B, p95 83,191 B, max 90,010 B — and `setItem` blocks the main thread
 * while it writes. That cost sat on the critical path of the one interaction
 * the whole game is made of, and it grew all run, so year 9 taps were heavier
 * than year 1 taps for a reason no player could see.
 *
 * Coalescing is safe here ONLY because losing a write is not. The rules:
 *
 *   · the cloud queue still runs on every call, unchanged — `queueRun` has
 *     always had its own debounce and its own flush
 *   · the local write is held for one short window, so a burst of commits
 *     inside one interaction costs one serialisation instead of several
 *   · every path that could end the page flushes SYNCHRONOUSLY first:
 *     `visibilitychange` → hidden (which is what a Capacitor app backgrounding
 *     fires), `pagehide`, and `beforeunload`
 *   · `loadRun` and `hasSavedRun` flush before reading, so nothing in-process
 *     can ever observe a stale device
 *   · `clearRun` DROPS the pending write rather than flushing it. This one is
 *     not an optimisation — without it, a debounced save from the run being
 *     ended would land after the delete and resurrect a buried company.
 */
const SAVE_COALESCE_MS = 120;

/*
 * One held write PER ISLAND, not one held write.
 *
 * A single `pendingRun` was correct while a device held one company. With
 * several it would be a data-loss bug rather than a stale read: saving island
 * 2 while island 0's write was still held would silently drop island 0's write
 * and then flush island 2's bytes — and, before the key was parameterised,
 * flush them over island 0's key. A Map keyed by slot cannot do either.
 *
 * The timer stays single. It flushes everything held, which is what every
 * caller of `flushRun()` has always meant by it.
 */
const pendingRuns = new Map<number, RunState>();
let pendingTimer: number | null = null;

/** Writes any held run immediately. Safe to call at any time, including twice. */
export function flushRun(): void {
  if (pendingTimer !== null) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  if (pendingRuns.size === 0) return;
  // Drained before writing: a `setItem` that throws must not leave the entry
  // held for a later flush to retry forever against a store that is full.
  const held = [...pendingRuns.entries()];
  pendingRuns.clear();
  if (!canStore()) return;
  for (const [slot, state] of held) {
    try {
      localStorage.setItem(runKey(slot), JSON.stringify(state));
      writeIndexEntry(summarise(state, slot));
    } catch {
      // A full or disabled store is the same answer it has always been here:
      // the run lives in memory and the cloud queue is unaffected.
    }
  }
}

/**
 * Drops a held write without performing it.
 *
 * Two callers, and both are cases where performing the write would be actively
 * wrong rather than merely late: `clearRun` below (burying a company), and
 * `wipeDevice` in lib/cloud/auth.ts (this device is being handed to a different
 * player, on sign-in as well as sign-out). Everything else flushes.
 */
export function dropPendingRun(slot?: number): void {
  if (slot === undefined) {
    if (pendingTimer !== null) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    pendingRuns.clear();
    return;
  }
  // One island's held write. The timer stays armed for the others — burying
  // one company must not delay another's save.
  pendingRuns.delete(safeSlot(slot));
}

let flushHooksInstalled = false;
function installFlushHooks(): void {
  if (flushHooksInstalled || typeof window === "undefined") return;
  flushHooksInstalled = true;
  // `visibilitychange` is the one that matters on a phone: iOS does not
  // reliably fire `beforeunload`, and a Capacitor app being backgrounded —
  // or the player swiping up — surfaces here.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushRun();
  });
  window.addEventListener("pagehide", flushRun);
  window.addEventListener("beforeunload", flushRun);
}

export function saveRun(state: RunState, slot: number = activeIsland()) {
  const at = safeSlot(slot);
  /*
   * The high-water mark is maintained HERE, and this is the only place it is
   * written.
   *
   * lib/engine/sim.ts computes valuation and is protected (docs/DO-NOT-TOUCH
   * .md); `peakValuation` is an additive optional field on RunState, so the
   * additive path is to raise it at the choke point every run write already
   * passes through. Mutating `state` rather than copying is deliberate: the
   * caller holds this object in React state and expects the field to be there
   * on the next render, not one save later.
   */
  const valuation = state.stats?.valuation;
  if (typeof valuation === "number" && Number.isFinite(valuation)) {
    state.peakValuation = Math.max(state.peakValuation ?? 0, valuation);
  }

  queueRun(state, at);
  if (!canStore()) return;
  adoptLegacyKeys();
  installFlushHooks();
  pendingRuns.set(at, state);
  if (pendingTimer === null) {
    pendingTimer = window.setTimeout(flushRun, SAVE_COALESCE_MS);
  }
}

export function clearRun(slot: number = activeIsland()) {
  const at = safeSlot(slot);
  // Before anything else: a held write from the run being ended must not be
  // allowed to land after the removeItem below. See the note above. Scoped to
  // this island — the others' held writes are not part of this burial.
  dropPendingRun(at);
  // null is an instruction, not an absence: it deletes the cloud row too.
  // Without this a buried company would resurrect on the next device.
  queueRun(null, at);
  if (!canStore()) return;
  adoptLegacyKeys();
  localStorage.removeItem(runKey(at));
  localStorage.removeItem(tableKey(at));
  dropIndexEntry(at);
}

// ── What is on the table but not yet in the run ──────────────────────────────

/**
 * The decisions that are waiting on the player.
 *
 * `advanceMonth()` moves time and saves — and the cards it surfaced lived only
 * in React state, so closing the app between the tap and the answer threw them
 * away. That is not a cosmetic loss:
 *
 *   · `dueFollowups()` has already spliced the chain step out of
 *     `state.followups`, so an authored chain loses its middle and never
 *     resumes.
 *   · `todaysMarket()` has already stamped `state.marketDayISO` with today, so
 *     the shared daily case is spent for the rest of the day without ever
 *     having been read.
 *   · And it was a free skip: force-quitting was the cheapest way to duck a
 *     card you did not like, with the month already banked.
 *
 * The same is true of the year-end statement, which is a decision the game
 * refuses to let you leave without — the INTO YEAR N button is disabled until
 * the money is allocated — and which vanished on a reload just as quietly.
 *
 * So the table is saved beside the run. It is deliberately NOT part of
 * `RunState`: the engine is pure and knows nothing about which cards are still
 * face-up, and `lib/engine/types.ts` is additive-only by house rule. It is
 * also deliberately local-only — the cloud copy is the run, and a card is a
 * moment at a table, not a thing to hand another device mid-hand.
 */
export interface OpenTable {
  /** The run these belong to. A different company never inherits them. */
  runId: string;
  /** Where the run stood when this was written; anything else is stale. */
  year: number;
  month: number;
  /** Frozen decision cards, in the order they were surfaced. */
  cards: GameEvent[];
  /** Which of them is today's shared market case, if any. */
  marketId: string | null;
  /** The year-end statement, while it is still on screen. */
  yearEnd: YearEndSummary | null;
}

/**
 * Reads the table back, and only if the world has not moved since.
 *
 * The run's own year/month is the check: a table written at Y1 M4 is
 * meaningless once the player is at M5, and re-surfacing it would replay a
 * decision the engine has already accounted for.
 */
export function loadTable(run: RunState, slot: number = activeIsland()): OpenTable | null {
  if (!canStore()) return null;
  adoptLegacyKeys();
  const key = tableKey(safeSlot(slot));
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const table = JSON.parse(raw) as Partial<OpenTable>;
    if (table.runId !== run.id || table.year !== run.year || table.month !== run.month) {
      localStorage.removeItem(key);
      return null;
    }
    return {
      runId: table.runId,
      year: table.year,
      month: table.month,
      cards: table.cards ?? [],
      marketId: table.marketId ?? null,
      yearEnd: table.yearEnd ?? null,
    };
  } catch {
    return null;
  }
}

export function saveTable(table: OpenTable | null, slot: number = activeIsland()) {
  if (!canStore()) return;
  adoptLegacyKeys();
  const key = tableKey(safeSlot(slot));
  try {
    if (table) localStorage.setItem(key, JSON.stringify(table));
    else localStorage.removeItem(key);
  } catch {
    // A full or blocked store must not take the screen down with it. The
    // failure mode is the old behaviour — a lost card — not a crash.
  }
}

const defaultLegacy = (): LegacyState => ({
  bestYear: 0,
  runsCompleted: 0,
  sharkRespect: 10,
  badges: [],
  autopsies: [],
});

export function loadLegacy(): LegacyState {
  if (!canStore()) return defaultLegacy();
  try {
    const raw = localStorage.getItem(KEYS.legacy);
    if (raw) {
      // Backfill like migrate() above: a legacy blob written before a field
      // existed must read as zero, not undefined — the wardrobe track does
      // arithmetic on runsCompleted and NaN never unlocks anything.
      const merged = { ...defaultLegacy(), ...(JSON.parse(raw) as Partial<LegacyState>) };
      if (!Number.isFinite(merged.runsCompleted)) merged.runsCompleted = 0;
      return merged;
    }
  } catch {
    /* fall through */
  }
  return defaultLegacy();
}

export function saveLegacy(legacy: LegacyState) {
  queueLegacy(legacy);
  if (!canStore()) return;
  localStorage.setItem(KEYS.legacy, JSON.stringify(legacy));
}

export function loadProfile(): Profile | null {
  if (!canStore()) return null;
  try {
    const raw = localStorage.getItem(KEYS.profile);
    return raw ? (JSON.parse(raw) as Profile) : null;
  } catch {
    return null;
  }
}

export function saveProfile(profile: Profile) {
  // playerAge is not in this payload, and must not be added to it.
  queuePrefs({
    rookieMode: profile.rookieMode,
    onboarded: profile.onboarded,
    micCalibration: profile.micCalibration,
    founderName: profile.founderName,
  });
  if (!canStore()) return;
  localStorage.setItem(KEYS.profile, JSON.stringify(profile));
}

/**
 * Writes a cloud copy into localStorage without echoing it straight back to
 * the server. Used once on boot by the hydration in GameProvider; going
 * through saveRun/saveLegacy/saveProfile instead would queue a push of the
 * very bytes we just pulled.
 */
export function adoptFromCloud(data: {
  /** Every island the account holds, by slot. */
  runs?: { slot: number; state: RunState }[] | null;
  legacy?: LegacyState | null;
  prefs?: {
    rookieMode: boolean;
    onboarded: boolean;
    micCalibration: number | null;
    founderName: string;
  } | null;
}) {
  if (!canStore()) return;
  adoptLegacyKeys();
  if (data.runs?.length) {
    // The server has never seen playerAge (it is stripped on the way out, and
    // again on arrival), so a run pulled from the cloud comes back without it.
    // Restore it from this device — the same move the prefs branch below makes,
    // and for the same reason: age-gating is local, and a restored company must
    // not silently un-gate itself because the field came back undefined.
    const local = loadProfile();
    for (const { slot, state } of data.runs) {
      const at = safeSlot(slot);
      const restored = { ...migrate(state), playerAge: local?.playerAge ?? null };
      try {
        localStorage.setItem(runKey(at), JSON.stringify(restored));
        writeIndexEntry(summarise(restored, at));
      } catch {
        // Ten companies can exceed a device's quota where one never did. The
        // islands that fit are kept, the rest stay on the server, and the
        // picker draws what is actually here rather than throwing.
      }
    }
  }
  if (data.legacy) localStorage.setItem(KEYS.legacy, JSON.stringify(data.legacy));
  if (data.prefs) {
    // playerAge never left this device, so it is restored from whatever is
    // already here rather than from the server, which has never seen it.
    const local = loadProfile();
    localStorage.setItem(
      KEYS.profile,
      JSON.stringify({ ...data.prefs, playerAge: local?.playerAge ?? null } satisfies Profile),
    );
  }
}


// ── Which island, and what is on the others ─────────────────────────────────

/**
 * A company, small enough to draw a card with and never big enough to parse
 * ten of on a phone.
 *
 * Deliberately the same set of fields the `saves` listing cache holds
 * (supabase/migrations/0012_islands.sql), for the same stated reason: a UI
 * that lists companies must not have to read megabytes of RunState to do it.
 * Like that cache, this is derived and never the truth — `loadRun` is.
 */
export interface IslandSummary {
  slot: number;
  runId: string;
  companyName: string;
  founderName: string;
  industry: RunState["industry"];
  year: number;
  month: number;
  stage: number;
  alive: boolean;
  endedBy: RunState["endedBy"] | null;
  valuation: number;
  peakValuation: number;
  cash: number;
  revenueAnnual: number;
  employees: number;
  avatar: RunState["avatar"] | null;
  /** Device clock, epoch ms. For "last played", never for conflict resolution. */
  savedAt: number;
}

function summarise(state: RunState, slot: number): IslandSummary {
  const s = state.stats;
  const valuation = num(s?.valuation);
  return {
    slot,
    runId: state.id,
    companyName: state.companyName,
    founderName: state.founderName,
    industry: state.industry,
    year: state.year,
    month: state.month,
    stage: state.stage,
    alive: state.alive,
    endedBy: state.endedBy ?? null,
    valuation,
    peakValuation: Math.max(num(state.peakValuation), valuation),
    cash: num(s?.cash),
    revenueAnnual: num(s?.revenueAnnual),
    employees: num(s?.employees),
    avatar: state.avatar ?? null,
    savedAt: Date.now(),
  };
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * The slots that currently hold a company.
 *
 * Existence only — no JSON.parse. The picker needs the shape of the
 * archipelago far more often than it needs what is on each island, and ten
 * parses of a 90 KB run is not a thing to do on a screen transition.
 */
function occupiedSlots(): number[] {
  if (!canStore()) return [];
  adoptLegacyKeys();
  const out: number[] = [];
  for (let slot = 0; slot < ISLAND_CAP; slot += 1) {
    try {
      if (localStorage.getItem(runKey(slot)) !== null) out.push(slot);
    } catch {
      /* one unreadable key is not the whole archipelago */
    }
  }
  return out;
}

function readIndex(): IslandSummary[] {
  if (!canStore()) return [];
  try {
    const raw = localStorage.getItem(KEYS.index);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as IslandSummary[]) : [];
  } catch {
    return [];
  }
}

function writeIndex(list: IslandSummary[]): void {
  if (!canStore()) return;
  try {
    localStorage.setItem(KEYS.index, JSON.stringify(list));
  } catch {
    // The index is a cache. Losing it costs one rebuild, never a company.
  }
}

function writeIndexEntry(entry: IslandSummary): void {
  writeIndex([...readIndex().filter((i) => i.slot !== entry.slot), entry].sort(bySlot));
}

function dropIndexEntry(slot: number): void {
  writeIndex(readIndex().filter((i) => i.slot !== slot));
}

const bySlot = (a: IslandSummary, b: IslandSummary) => a.slot - b.slot;

/**
 * Every company on this device, cheapest way first.
 *
 * The index is a cache and caches drift — a cloud adopt that partly failed, a
 * tab killed mid-write, a hand-edited devtools session. So the cache is
 * TRUSTED ONLY IF IT AGREES with the run keys about which slots are occupied;
 * on any disagreement the answer is rebuilt from the runs themselves, which
 * are the truth. That check costs one existence read per slot and no parsing,
 * which is the whole reason it is affordable to do on every call.
 */
export function listIslands(): IslandSummary[] {
  const occupied = occupiedSlots();
  const cached = readIndex().filter((i) => occupied.includes(i.slot));
  if (cached.length === occupied.length) return cached.sort(bySlot);

  const rebuilt: IslandSummary[] = [];
  for (const slot of occupied) {
    const state = loadRun(slot);
    if (state) rebuilt.push(summarise(state, slot));
  }
  writeIndex(rebuilt);
  return rebuilt;
}

/**
 * Which island the player is on.
 *
 * Falls back to the lowest occupied slot rather than to 0, so a pointer left
 * behind by a buried company — or a device that has only ever had island 3
 * restored from the cloud — opens something real instead of an empty slot the
 * player would have to escape from.
 */
export function activeIsland(): number {
  if (!canStore()) return 0;
  adoptLegacyKeys();
  const occupied = occupiedSlots();
  try {
    const raw = localStorage.getItem(KEYS.active);
    if (raw !== null) {
      const slot = safeSlot(Number(raw));
      if (occupied.includes(slot)) return slot;
    }
  } catch {
    /* fall through to the first island */
  }
  return occupied[0] ?? 0;
}

/** Point the game at an island. Does not load it — GameProvider does that. */
export function setActiveIsland(slot: number): void {
  if (!canStore()) return;
  try {
    localStorage.setItem(KEYS.active, String(safeSlot(slot)));
  } catch {
    // Losing the pointer costs the player one tap on the picker, not a company.
  }
}

/**
 * The lowest slot with nothing on it, or null when the archipelago is full.
 *
 * Lowest rather than next: burying the company on island 0 and founding again
 * should reuse island 0, not march rightwards until the cap is hit with two
 * empty slots behind it.
 */
export function firstFreeIsland(cap: number = ISLAND_CAP): number | null {
  const occupied = occupiedSlots();
  const limit = Math.min(ISLAND_CAP, Math.max(0, Math.trunc(cap)));
  for (let slot = 0; slot < limit; slot += 1) {
    if (!occupied.includes(slot)) return slot;
  }
  return null;
}
