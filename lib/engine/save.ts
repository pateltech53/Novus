import type { LegacyState, RunState } from "./types";
import { DEFAULT_AVATAR } from "./avatar";
import { queueLegacy, queuePrefs, queueRun } from "@/lib/cloud/sync";

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
  queueRun(state);
  if (!canStore()) return;
  localStorage.setItem(KEYS.run, JSON.stringify(state));
}

export function clearRun() {
  // null is an instruction, not an absence: it deletes the cloud row too.
  // Without this a buried company would resurrect on the next device.
  queueRun(null);
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
  run?: RunState | null;
  legacy?: LegacyState | null;
  prefs?: {
    rookieMode: boolean;
    onboarded: boolean;
    micCalibration: number | null;
    founderName: string;
  } | null;
}) {
  if (!canStore()) return;
  if (data.run) {
    // The server has never seen playerAge (it is stripped on the way out, and
    // again on arrival), so a run pulled from the cloud comes back without it.
    // Restore it from this device — the same move the prefs branch below makes,
    // and for the same reason: age-gating is local, and a restored company must
    // not silently un-gate itself because the field came back undefined.
    const local = loadProfile();
    localStorage.setItem(
      KEYS.run,
      JSON.stringify({ ...migrate(data.run), playerAge: local?.playerAge ?? null }),
    );
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
