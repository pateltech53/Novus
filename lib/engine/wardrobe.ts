/**
 * The wardrobe track — Pro's long cosmetic ladder.
 *
 * Six fits, earned by what a founder has actually DONE across every company
 * they have run. Not by how many they have started, and — since this file was
 * rewritten — not by how many they have finished either.
 *
 * ── The incentive that pointed the wrong way ─────────────────────────────────
 *
 * The six fits used to cost 1, 2, 4, 6, 9 and 12 FINISHED RUNS and nothing
 * else. A run counted the moment it ended, however it ended, so the fastest
 * route to the whole track was to found a company, let it die in March, and do
 * it again — twelve times. That is the precise opposite of the behaviour a game
 * about compounding exists to teach, and it could not tell a founder who
 * reached fiscal year 12 from one who had never seen fiscal year 2.
 *
 * The demands below are the fix, and they are the founder's own words from the
 * brief: reach year 3; close five fiscal years across two companies; and up
 * from there. Four SHAPES of demand rather than one number in a coat, so the
 * ladder asks for four different kinds of play — go deep, go deep more than
 * once, keep playing, and finish what you start. See docs/PROGRESSION.md §4.3.
 *
 * ── Two properties that are not obvious ──────────────────────────────────────
 *
 * **Nothing un-earns.** `legacy.autopsies` is capped at ten entries, so a
 * career-total computed live FALLS as old companies age off the record — and a
 * player would lose a fit they had worn for a month. So the earned set is a
 * sticky ledger in this file's own store: a demand met once is met forever.
 *
 * **Nothing already unlocked is taken away.** The first read under the new
 * rules seeds that ledger from the OLD run-count thresholds (`legacyRuns`
 * below), so every fit a player had yesterday is a fit they have today, even
 * where the new demand would not yet be met.
 *
 * ── Brand Law 4, stated where it would break ─────────────────────────────────
 * Skins are COSMETIC ONLY. Equipping one swaps the image FounderAvatar renders
 * and touches nothing else: no stat, no multiplier, no score, no survival
 * odds, no leaderboard weight. Nothing in this file imports the sim and the
 * sim imports nothing from here; the equipped skin lives under its own storage
 * key precisely so it cannot ride along inside run state. The demands are
 * measured in FISCAL YEARS — a real unit the game already teaches — and never
 * in a points balance, which Brand Law 6 forbids outright.
 *
 * The TRACK is Pro (a chapter seat counts — see isPro in monetization.ts).
 * Free players see the whole track with live progress: aspiration, not a
 * wall. Their record banks now and every earned fit opens the moment Pro turns
 * on. The tier portraits (avatar.ts) stay the default for everyone and are
 * never for sale at any price.
 */

import type { Gender } from "./avatar";
import type { LegacyState } from "./types";
import { loadLegacy } from "./save";
import { isPro, loadEntitlements } from "@/lib/monetization";

export type SkinId =
  | "chef"
  | "gamer"
  | "coder"
  | "gymbro"
  | "mathgenius"
  | "drippedout";

/**
 * What a fit can ask for. Every one of these is derived from `LegacyState`,
 * which already crosses runs and already round-trips through the cloud — no
 * new column, no new counter, nothing that a save written last month cannot
 * answer.
 *
 *   bestYear     the furthest fiscal year reached in a single company
 *   topRuns      years summed across the best `across` companies on the record
 *   careerYears  every fiscal year ever closed, across the whole record
 *   runsFinished companies taken to an ending, however they ended
 *
 * `runsFinished` is deliberately never the ONLY demand on a fit. It is the one
 * number the old track used, it is the one that rewards abandoning companies,
 * and it survives here only as a companion clause on the two fits that also
 * ask for real depth.
 */
export type DemandKind = "bestYear" | "topRuns" | "careerYears" | "runsFinished";

export interface Demand {
  kind: DemandKind;
  need: number;
  /** `topRuns` only: how many companies are summed. Ignored otherwise. */
  across?: number;
}

export interface SkinDef {
  id: SkinId;
  label: string;
  /** Every clause must be met. Rendered as one row each on the track. */
  demands: Demand[];
  /**
   * The OLD rule — finished runs — kept for exactly one purpose: seeding the
   * earned ledger the first time a save is read under the new demands, so
   * nobody loses a fit they already had. Never consulted again after that.
   */
  legacyRuns: number;
  /** What the fit says. Shown on the track row once it opens. */
  blurb: string;
}

/**
 * Ordered by what they cost, so the track reads top-to-bottom as a ladder.
 *
 * The first fit is the founder's own example from the brief — reach fiscal year
 * 3 — and it is deliberately cheap, because a track that pays nothing out for a
 * week is a track nobody believes in. The last asks for a decade in one company
 * AND forty years across the record, which is months of play and is meant to
 * be.
 */
export const SKINS: readonly SkinDef[] = [
  {
    id: "chef",
    label: "The Chef",
    demands: [{ kind: "bestYear", need: 3 }],
    legacyRuns: 1,
    blurb: "Kitchen whites. You have survived a dinner rush; a board is quieter.",
  },
  {
    id: "gamer",
    label: "The Gamer",
    demands: [{ kind: "topRuns", across: 2, need: 5 }],
    legacyRuns: 2,
    blurb: "Headset on. You have lost runs on purpose just to learn the map.",
  },
  {
    id: "coder",
    label: "The Coder",
    demands: [{ kind: "bestYear", need: 6 }],
    legacyRuns: 4,
    blurb: "The hoodie was always a uniform. This one admits it.",
  },
  {
    id: "gymbro",
    label: "The Gym Rat",
    demands: [{ kind: "topRuns", across: 3, need: 12 }],
    legacyRuns: 6,
    blurb: "Three companies, twelve years between them. The market is one more set to failure.",
  },
  {
    id: "mathgenius",
    label: "The Math Genius",
    demands: [
      { kind: "careerYears", need: 25 },
      { kind: "runsFinished", need: 4 },
    ],
    legacyRuns: 9,
    blurb: "You read the unit economics before the sharks finish asking.",
  },
  {
    id: "drippedout",
    label: "Dripped Out",
    demands: [
      { kind: "bestYear", need: 10 },
      { kind: "careerYears", need: 40 },
    ],
    legacyRuns: 12,
    blurb: "A decade in one company and forty years on the record. You dress like none of it left a mark.",
  },
];

export const skinDef = (id: SkinId): SkinDef =>
  SKINS.find((s) => s.id === id) as SkinDef;

/** Keyed to transparency by scripts/make-skins.mjs, same as the tier art. */
export const skinSrc = (id: SkinId, gender: Gender): string =>
  `/founder/skins/${id}-${gender}.webp`;

// ── The record ───────────────────────────────────────────────────────────────

/**
 * Everything the demands are measured against, read out of `LegacyState` once
 * so a screen drawing six rows does not re-derive it six times.
 *
 * `careerYears` is a FLOOR rather than a true career total, and the difference
 * is worth stating: `legacy.autopsies` holds the last ten companies, so a
 * founder on their fifteenth has five that no longer appear. It can therefore
 * understate and can never overstate — which is the safe direction, and is
 * exactly why the earned ledger below is sticky.
 *
 * `liveYears` is the company currently open, if any: a run in fiscal year 4 has
 * closed three, and those three are real whether or not it has ended. Callers
 * without a run in hand pass nothing; anything already earned is already in the
 * ledger, so the only thing they miss is a threshold crossed this minute.
 */
export interface FounderRecord {
  bestYear: number;
  runsFinished: number;
  /** Years closed by each company on the record, longest first. */
  yearsByRun: number[];
  careerYears: number;
}

export function founderRecord(legacy: LegacyState, liveYears = 0): FounderRecord {
  const live = Math.max(0, Math.trunc(liveYears));
  const yearsByRun = (legacy.autopsies ?? [])
    .map((a) => Math.max(0, Math.trunc(a.years ?? 0)))
    .concat(live > 0 ? [live] : [])
    .sort((a, b) => b - a);
  return {
    bestYear: Math.max(0, Math.trunc(legacy.bestYear ?? 0), live),
    runsFinished: Math.max(0, Math.trunc(legacy.runsCompleted ?? 0)),
    yearsByRun,
    careerYears: yearsByRun.reduce((sum, y) => sum + y, 0),
  };
}

/** The record as the app sees it right now. */
export const currentRecord = (liveYears = 0): FounderRecord =>
  founderRecord(loadLegacy(), liveYears);

// ── Demands ──────────────────────────────────────────────────────────────────

/** What a player has, against what a clause asks for. Never above `need`. */
export function demandProgress(demand: Demand, record: FounderRecord) {
  const need = Math.max(1, Math.trunc(demand.need));
  let have = 0;
  switch (demand.kind) {
    case "bestYear":
      have = record.bestYear;
      break;
    case "topRuns":
      have = record.yearsByRun
        .slice(0, Math.max(1, Math.trunc(demand.across ?? 2)))
        .reduce((sum, y) => sum + y, 0);
      break;
    case "careerYears":
      have = record.careerYears;
      break;
    case "runsFinished":
      have = record.runsFinished;
      break;
  }
  const done = Math.max(0, Math.min(have, need));
  return { have, done, need, frac: done / need, met: have >= need };
}

/**
 * The clause in words, for the track row.
 *
 * Written as a demand rather than as a score — "Reach fiscal year 3", not
 * "fiscal year 3/3" — because a demand tells a player what to go and do and a
 * score only tells them where they stand. The standing is the bar underneath.
 */
export function demandText(demand: Demand): string {
  const n = Math.max(1, Math.trunc(demand.need));
  switch (demand.kind) {
    case "bestYear":
      return `Reach fiscal year ${n} in one company.`;
    case "topRuns": {
      const across = Math.max(1, Math.trunc(demand.across ?? 2));
      return `Close ${n} fiscal years across your ${across === 2 ? "two" : across === 3 ? "three" : across} best companies.`;
    }
    case "careerYears":
      return `Close ${n} fiscal years across your whole record.`;
    case "runsFinished":
      return `Finish ${n} companies — going under counts, walking away counts.`;
  }
}

/** Met on the record alone, before the sticky ledger is consulted. */
export const meetsDemands = (def: SkinDef, record: FounderRecord): boolean =>
  def.demands.every((d) => demandProgress(d, record).met);

/**
 * Track-row math: the whole fit's progress, and each clause's separately.
 *
 * The headline fraction is the WEAKEST clause rather than the mean. A fit that
 * needs a decade in one company and forty years on the record is not 50% done
 * because one of those is finished, and a bar that said so would be selling
 * something.
 */
export function skinProgress(def: SkinDef, record: FounderRecord, earned = false) {
  const clauses = def.demands.map((d) => ({ demand: d, ...demandProgress(d, record) }));
  return {
    clauses,
    earned: earned || clauses.every((c) => c.met),
    frac: clauses.reduce((lowest, c) => Math.min(lowest, c.frac), 1),
  };
}

// ── Persistence ──────────────────────────────────────────────────────────────

/** Own key, not the profile: the wardrobe must be deletable, corruptible and
 *  migratable without any chance of taking run or legacy state with it. */
const KEY = "novus:wardrobe:v1";

/** In-tab change signal, so every rendered avatar swaps outfit on equip.
 *  The browser's own "storage" event only fires in OTHER tabs. */
const EVENT = "novus:wardrobe";

export interface WardrobeState {
  equipped: SkinId | null;
  /**
   * THE STICKY LEDGER — every fit whose demands have ever been met.
   *
   * Two things make this necessary rather than a cache.
   *
   * The record it is derived from can SHRINK. `legacy.autopsies` keeps ten
   * companies, so a career total computed live falls off a cliff on the
   * eleventh founding, and a player would watch a fit they had worn for a month
   * grey out for reasons no screen could explain.
   *
   * And the rules themselves changed. A save written under the old track —
   * finished runs, 1/2/4/6/9/12 — has to keep everything it had. `loadWardrobe`
   * seeds this list from `legacyRuns` the first time it reads a blob without
   * one, which is the migration, and it happens exactly once per device.
   *
   * `undefined` in storage means "never seeded". An empty ARRAY means seeded
   * and nothing was owed — the two are different and must stay different, or
   * the migration would re-run every load and could never be finished.
   */
  earned?: SkinId[];
}

const isSkinId = (v: unknown): v is SkinId => SKINS.some((s) => s.id === v);

const canStore = () => typeof window !== "undefined" && !!window.localStorage;

/**
 * The fits a save written under the OLD run-count rule had already bought.
 *
 * Every device in the wild carries a wardrobe blob from before the demands
 * existed, and reading it under them must not cost anybody a fit they had
 * yesterday. `legacyRuns` is kept on each `SkinDef` for this one purpose.
 */
const grandfathered = (): SkinId[] => {
  const runs = Math.max(0, Math.trunc(loadLegacy().runsCompleted ?? 0));
  return SKINS.filter((s) => runs >= s.legacyRuns).map((s) => s.id);
};

/**
 * A save naming a renamed or removed skin falls back to the tier portrait —
 * never a broken image, never a crash.
 *
 * ── Pure, deliberately ─────────────────────────────────────────────────────
 *
 * It would be tidier to write the grandfathered list back the first time this
 * runs, and it would be wrong: `resolveEquippedSkin` is the `getSnapshot` of a
 * `useSyncExternalStore` in FounderAvatar, so this function is called during
 * render, and a render that writes to localStorage is a side effect in the one
 * place React guarantees nothing about how often it happens.
 *
 * So a blob with no `earned` array reads as the old rule's answer IN MEMORY,
 * which is enough for every read path, and `syncEarnedSkins` — which runs at a
 * year close, at a burial and when the closet opens — is what persists it.
 */
export function loadWardrobe(): WardrobeState {
  if (!canStore()) return { equipped: null, earned: [] };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { equipped: null, earned: [] };
    const parsed = JSON.parse(raw) as Partial<WardrobeState>;
    const equipped = isSkinId(parsed.equipped) ? parsed.equipped : null;
    /*
     * `undefined` means "written before the demands existed" and an empty
     * ARRAY means "seeded, and nothing was owed". The two must stay different:
     * collapsing them would re-grant the old rule's fits after a sign-out had
     * wiped the record they were earned against.
     */
    const earned = Array.isArray(parsed.earned)
      ? parsed.earned.filter(isSkinId)
      : grandfathered();
    return { equipped, earned };
  } catch {
    return { equipped: null, earned: [] };
  }
}

export function saveWardrobe(next: WardrobeState): void {
  if (!canStore()) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store loses the outfit, never the screen.
  }
  window.dispatchEvent(new Event(EVENT));
}

/** Equip a skin, or null for the tier fit. The only mutation this file offers
 *  that a player can ask for, and all it mutates is which image gets rendered. */
export function equipSkin(id: SkinId | null): void {
  const state = loadWardrobe();
  saveWardrobe({ ...state, equipped: id });
}

/**
 * Bank every fit the record now deserves, and never remove one.
 *
 * Called wherever the record moves — a fiscal year closes, a company is buried,
 * the closet opens — rather than being computed at read time, because the
 * record can shrink and a fit must not. Returns the fits that were newly
 * banked, so a caller can celebrate one; returns an empty array otherwise, and
 * writes nothing at all in that case.
 */
export function syncEarnedSkins(liveYears = 0): SkinId[] {
  if (!canStore()) return [];
  const state = loadWardrobe();
  const held = new Set(state.earned ?? []);
  const record = currentRecord(liveYears);
  const fresh = SKINS.filter((s) => !held.has(s.id) && meetsDemands(s, record)).map(
    (s) => s.id,
  );

  /*
   * Persist even when nothing is fresh, IF the stored blob never had an
   * `earned` array. That is the migration off the run-count rule, and this is
   * the only place it is written — `loadWardrobe` stays pure because it is
   * called during render. Once the array is on disk this branch never runs
   * again, so an empty grandfather list is recorded as done rather than
   * recomputed forever.
   */
  const stored = canStore() ? localStorage.getItem(KEY) : null;
  let needsSeed = false;
  try {
    needsSeed = !!stored && !Array.isArray(JSON.parse(stored).earned);
  } catch {
    needsSeed = false;
  }
  if (fresh.length === 0 && !needsSeed) return [];

  saveWardrobe({ ...state, earned: [...(state.earned ?? []), ...fresh] });
  return fresh;
}

/** Earned is the ledger, or the record right now. Wearing also needs Pro.
 *  Kept as two questions so the UI can tell a free player "earned, banked"
 *  instead of a bare lock. */
export function isSkinEarned(
  def: SkinDef,
  record: FounderRecord,
  ledger: readonly SkinId[] = [],
): boolean {
  return ledger.includes(def.id) || meetsDemands(def, record);
}

export const isSkinWearable = (
  def: SkinDef,
  record: FounderRecord,
  proActive: boolean,
  ledger: readonly SkinId[] = [],
): boolean => proActive && isSkinEarned(def, record, ledger);

/**
 * The skin actually worn right now, re-checked against what is earned.
 *
 * Re-checked because storage says what was EQUIPPED, not what is still
 * DESERVED: Pro can lapse, and a copied save can name a fit its record never
 * paid for. Either way the answer is the tier portrait, silently — the
 * wardrobe entry stays put, so the fit comes back the moment Pro does.
 */
export function resolveEquippedSkin(): SkinId | null {
  const { equipped, earned } = loadWardrobe();
  if (!equipped) return null;
  const ok = isSkinWearable(
    skinDef(equipped),
    currentRecord(),
    isPro(loadEntitlements()),
    earned ?? [],
  );
  return ok ? equipped : null;
}

/** For useSyncExternalStore: fires on equips in this tab and writes from
 *  other tabs. Returns the unsubscribe. */
export function subscribeWardrobe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}
