/**
 * The wardrobe track — Pro's long cosmetic ladder.
 *
 * Six fits, unlocked by FINISHING runs. A run counts when it ends — the
 * company goes under or you close it yourself — never when it starts, so the
 * track rewards playing whole games rather than farming good openings. The
 * count is legacy.runsCompleted, written by GameProvider when a run is buried.
 *
 * ── Brand Law 4, stated where it would break ─────────────────────────────────
 * Skins are COSMETIC ONLY. Equipping one swaps the image FounderAvatar renders
 * and touches nothing else: no stat, no multiplier, no score, no survival
 * odds, no leaderboard weight. Nothing in this file imports the sim and the
 * sim imports nothing from here; the equipped skin lives under its own storage
 * key precisely so it cannot ride along inside run state.
 *
 * The TRACK is Pro (a chapter seat counts — see isPro in monetization.ts).
 * Free players see the whole track with live progress: aspiration, not a
 * wall. Their finished runs bank now and every earned fit opens the moment
 * Pro turns on. The tier portraits (avatar.ts) stay the default for everyone
 * and are never for sale at any price.
 */

import type { Gender } from "./avatar";
import { loadLegacy } from "./save";
import { isPro, loadEntitlements } from "@/lib/monetization";

export type SkinId =
  | "chef"
  | "gamer"
  | "coder"
  | "gymbro"
  | "mathgenius"
  | "drippedout";

export interface SkinDef {
  id: SkinId;
  label: string;
  /** Finished runs needed. A real count of real games — never a currency. */
  unlockAtRuns: number;
  /** What the fit says. Shown on the track row once it opens. */
  blurb: string;
}

/**
 * Ordered by cost, so the track reads top-to-bottom as a ladder. The spacing
 * widens on purpose: the first fit lands after one finished run so the track
 * pays out immediately, the last asks for twelve so it still means something
 * months in.
 */
export const SKINS: readonly SkinDef[] = [
  {
    id: "chef",
    unlockAtRuns: 1,
    label: "The Chef",
    blurb: "Kitchen whites. You have survived a dinner rush; a board is quieter.",
  },
  {
    id: "gamer",
    unlockAtRuns: 2,
    label: "The Gamer",
    blurb: "Headset on. You have lost runs on purpose just to learn the map.",
  },
  {
    id: "coder",
    unlockAtRuns: 4,
    label: "The Coder",
    blurb: "The hoodie was always a uniform. This one admits it.",
  },
  {
    id: "gymbro",
    unlockAtRuns: 6,
    label: "The Gym Rat",
    blurb: "Six companies logged. The market is one more set to failure.",
  },
  {
    id: "mathgenius",
    unlockAtRuns: 9,
    label: "The Math Genius",
    blurb: "You read the unit economics before the sharks finish asking.",
  },
  {
    id: "drippedout",
    unlockAtRuns: 12,
    label: "Dripped Out",
    blurb: "Twelve endings, and you dress like none of them left a mark.",
  },
];

export const skinDef = (id: SkinId): SkinDef =>
  SKINS.find((s) => s.id === id) as SkinDef;

/** Keyed to transparency by scripts/make-skins.mjs, same as the tier art. */
export const skinSrc = (id: SkinId, gender: Gender): string =>
  `/founder/skins/${id}-${gender}.webp`;

/** Earned is runs alone; wearing also needs Pro. Kept as two questions so the
 *  UI can tell a free player "earned, banked" instead of a bare lock. */
export const isSkinEarned = (def: SkinDef, runsCompleted: number): boolean =>
  runsCompleted >= def.unlockAtRuns;

export const isSkinWearable = (
  def: SkinDef,
  runsCompleted: number,
  proActive: boolean,
): boolean => proActive && isSkinEarned(def, runsCompleted);

/** Track-row math: progress toward a fit as a real fraction of finished runs.
 *  Clamped so eleven runs against a one-run fit still draws a full bar. */
export function skinProgress(def: SkinDef, runsCompleted: number) {
  const done = Math.max(0, Math.min(runsCompleted, def.unlockAtRuns));
  return {
    done,
    need: def.unlockAtRuns,
    frac: done / def.unlockAtRuns,
    earned: isSkinEarned(def, runsCompleted),
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
}

const isSkinId = (v: unknown): v is SkinId => SKINS.some((s) => s.id === v);

const canStore = () => typeof window !== "undefined" && !!window.localStorage;

/** A save naming a renamed or removed skin falls back to the tier portrait —
 *  never a broken image, never a crash. */
export function loadWardrobe(): WardrobeState {
  if (!canStore()) return { equipped: null };
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { equipped: null };
    const parsed = JSON.parse(raw) as Partial<WardrobeState>;
    return { equipped: isSkinId(parsed.equipped) ? parsed.equipped : null };
  } catch {
    return { equipped: null };
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

/** Equip a skin, or null for the tier fit. The only mutation this file offers,
 *  and all it mutates is which image gets rendered. */
export function equipSkin(id: SkinId | null): void {
  saveWardrobe({ equipped: id });
}

/**
 * The skin actually worn right now, re-checked against what is earned.
 *
 * Re-checked because storage says what was EQUIPPED, not what is still
 * DESERVED: Pro can lapse, and a copied save can name a fit its runs never
 * paid for. Either way the answer is the tier portrait, silently — the
 * wardrobe entry stays put, so the fit comes back the moment Pro does.
 */
export function resolveEquippedSkin(): SkinId | null {
  const { equipped } = loadWardrobe();
  if (!equipped) return null;
  const ok = isSkinWearable(
    skinDef(equipped),
    loadLegacy().runsCompleted,
    isPro(loadEntitlements()),
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
