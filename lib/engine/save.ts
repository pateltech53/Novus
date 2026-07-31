import type { LegacyState, RunState } from "./types";
import { DEFAULT_AVATAR } from "./avatar";

/**
 * Persistence adapter. localStorage now; the same surface maps to Supabase
 * tables in P5 (runs, legacy, profiles) without touching callers.
 */

const KEYS = {
  run: "novus:run:v1",
  legacy: "novus:legacy:v1",
  profile: "novus:profile:v1",
} as const;

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
  state.autopsyMagnets ??= [];
  state.unknownSpecials ??= [];
  state.recurring ??= [];
  state.decisions ??= [];
  state.performs ??= [];
  state.seenTerms ??= [];
  return state;
}

export function loadRun(): RunState | null {
  if (!canStore()) return null;
  try {
    const raw = localStorage.getItem(KEYS.run);
    return raw ? migrate(JSON.parse(raw) as Partial<RunState>) : null;
  } catch {
    return null;
  }
}

export function saveRun(state: RunState) {
  if (!canStore()) return;
  localStorage.setItem(KEYS.run, JSON.stringify(state));
}

export function clearRun() {
  if (!canStore()) return;
  localStorage.removeItem(KEYS.run);
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
  if (!canStore()) return;
  localStorage.setItem(KEYS.profile, JSON.stringify(profile));
}
