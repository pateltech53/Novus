/**
 * The reward skin on the founder's back — the device-local record.
 *
 * ── What it is ───────────────────────────────────────────────────────────────
 *
 * The briefcase loop grants skins (docs/BRIEFCASES.md) and the server keeps
 * the inventory, including which one is `equipped`. Until this file existed
 * that flag was read by nothing outside components/rewards/: a player could
 * win a design, tap COLLECT & EQUIP, and walk back to a masthead still wearing
 * the tier portrait, because FounderAvatar reads its outfit synchronously
 * during render and there is no synchronous fetch.
 *
 * So this is the wardrobe store's twin (lib/engine/wardrobe.ts) for reward
 * skins: one localStorage key holding the three things a portrait needs to
 * draw the design — the catalog id, the tier (which is the folder the render
 * lives in), and the name (for the "WEARING …" row in the Closet). Same
 * pattern as the wardrobe: an in-tab event plus the browser's own "storage"
 * event, so every mounted avatar swaps outfit the moment one is put on.
 *
 * ── Why it is device-local, and who wins ─────────────────────────────────────
 *
 * The server is the authority on what is OWNED and what is EQUIPPED; this is
 * the cache the first paint can afford to know, exactly as lib/account.ts is
 * for the account. The precedence, stated once:
 *
 *   1. The server wins. `syncWornFromInventory` runs whenever the inventory
 *      is fetched and makes this record agree with the equipped row — writing
 *      it when the server says a skin is on, clearing it when the server says
 *      nothing is. A device that equipped a skin while offline, or a POST that
 *      failed silently, is corrected on the next load.
 *   2. Between syncs the local write is immediate. Tapping EQUIP in the
 *      collection or the ceremony writes here before the round trip settles,
 *      so the founder changes clothes on the tap rather than a second later.
 *   3. On the founder, a Closet fit outranks a reward skin. FounderAvatar
 *      draws the wardrobe track's fit if one resolves, else the reward skin,
 *      else the tier portrait. One outfit at a time is enforced at the point
 *      of dressing: putting a reward skin on calls `equipSkin(null)` so the
 *      fit comes off, and the Closet's own equip handler calls
 *      `takeOffRewardSkin()` before putting a fit on.
 *
 * ── The key is on the shared-device wipe list ───────────────────────────────
 *
 * `lib/cloud/auth.ts`'s `DEVICE_KEYS` is what a shared classroom iPad relies
 * on: everything a player's session touched is emptied on sign-out and
 * sign-in, so the next student never inherits the last one's company. This
 * key is on that list beside `novus:wardrobe:v1` — an equipped reward skin is
 * exactly the kind of leftover that list exists to catch, and the "server
 * wins on the next sync" rule above is not a substitute for it: that sync
 * runs only from MY SKINS, which a new sign-in has no reason to visit before
 * the old skin is already showing on the masthead.
 *
 * ── Brand Law 4, stated where it would break ─────────────────────────────────
 *
 * COSMETIC ONLY. The only reader of this record is the portrait (and the row
 * that names what is worn). Nothing in lib/engine imports it, nothing in the
 * sim can see it, and it is under its own storage key precisely so it cannot
 * ride along inside run state. Wearing a skin changes which image renders and
 * nothing else: no stat, no multiplier, no score, no survival odds, no
 * leaderboard weight. The record can be deleted, corrupted or absent and the
 * only consequence is the tier portrait.
 *
 * Client-safe by construction: nothing server-only, no network. The network
 * half (POST /api/rewards/equip) lives with the components that own the tap.
 */

import type { Gender } from "@/lib/engine/avatar";
import { equipSkin } from "@/lib/engine/wardrobe";
import type { Tier } from "@/lib/rewards/tables";

export interface WornRewardSkin {
  /** The catalog id — "001" … "101" — as it appears in the render's filename
   *  and in the inventory's `item_id` minus its "skin_" prefix. */
  id: string;
  /** The briefcase tier. Doubles as the folder the render lives in. */
  tier: Tier;
  /** For the "WEARING …" row. Display only. */
  name: string;
}

/** Own key, not the wardrobe's and not the profile's: deletable, corruptible
 *  and migratable without touching a fit or a run. */
const KEY = "novus:rewardskin:v1";

/** In-tab change signal. The browser's "storage" event only fires in OTHER
 *  tabs, so an equip in this one has to announce itself. */
const EVENT = "novus:rewardskin";

/** Catalog ids are three digits today; the pattern is loose enough for a
 *  future alphanumeric scheme and tight enough that nothing stored here can
 *  put a path separator or a query string into the image URL it is used in. */
const ID_RE = /^[A-Za-z0-9_-]{1,32}$/;

/** Long enough for any name in the catalog, short enough that a corrupted
 *  blob cannot become a paragraph on the Closet. */
const NAME_MAX = 48;

const canStore = () => typeof window !== "undefined" && !!window.localStorage;

const isTier = (v: unknown): v is Tier =>
  typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5;

/**
 * Validated rather than trusted, like every load in lib/engine/save.ts and
 * lib/account.ts: a blob missing any of the three fields, or carrying an id
 * that is not filename-safe, reads as "nothing worn". Storage that throws
 * (private mode, a blocked origin) reads the same way.
 */
export function loadWornRewardSkin(): WornRewardSkin | null {
  if (!canStore()) return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WornRewardSkin> | null;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.id !== "string" || !ID_RE.test(parsed.id)) return null;
    if (!isTier(parsed.tier)) return null;
    if (typeof parsed.name !== "string") return null;
    return { id: parsed.id, tier: parsed.tier, name: parsed.name.trim().slice(0, NAME_MAX) };
  } catch {
    return null;
  }
}

const announce = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(EVENT));
};

function write(next: WornRewardSkin | null): void {
  if (!canStore()) return;
  try {
    if (next) window.localStorage.setItem(KEY, JSON.stringify(next));
    else window.localStorage.removeItem(KEY);
  } catch {
    // A full or blocked store loses the outfit, never the screen.
  }
  announce();
}

/**
 * Put a reward skin on. Also takes the Closet fit off (`equipSkin(null)`), so
 * the founder is wearing one thing — the wardrobe store fires its own event,
 * and every mounted portrait re-reads both.
 *
 * An id that would not survive `loadWornRewardSkin` is refused up front rather
 * than written and then read back as nothing: the caller sees the same
 * outcome, and the store never holds a value it would not return.
 */
export function wearRewardSkin(skin: WornRewardSkin): void {
  if (!ID_RE.test(skin.id) || !isTier(skin.tier)) return;
  equipSkin(null);
  write({ id: skin.id, tier: skin.tier, name: String(skin.name ?? "").trim().slice(0, NAME_MAX) });
}

/** Back to whatever is underneath — a Closet fit if one is worn, else the
 *  tier portrait. Announces even when nothing was on, which is harmless. */
export function takeOffRewardSkin(): void {
  write(null);
}

/** For useSyncExternalStore and plain listeners alike: fires on wears and
 *  take-offs in this tab and on writes from other tabs. Returns the
 *  unsubscribe. Mirrors `subscribeWardrobe`. */
export function subscribeWorn(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

/**
 * Where the render lives.
 *
 * `scripts/` renders every design twice — `novus` is the male founder, `nova`
 * the female — in exactly the composition of `public/founder/<gender>-<tier>`,
 * which is what lets a reward skin stand in for a tier portrait at any size
 * without the call site knowing. The Ceremony builds this same path from the
 * grant's rarity; here the tier is stored directly.
 */
export const rewardSkinSrc = (id: string, tier: Tier, gender: Gender): string =>
  `/briefcase/skins/t${tier}/${id}_${gender === "female" ? "nova" : "novus"}.webp`;

/** The two shapes /api/rewards/inventory answers with — only the fields this
 *  file reads, so a caller's richer rows are assignable without a cast. */
export interface InventoryOwnedRow {
  item_id: string;
  kind: string;
  equipped: boolean;
}

export interface InventoryCatalogRow {
  id: string;
  name: string;
  tier: number;
}

/**
 * Make the local record agree with the server. Server wins.
 *
 * Called after every successful inventory fetch. If the server has a skin
 * equipped and it is in the catalog, that is what this device wears from now
 * on; if the server has nothing equipped — or names a skin the catalog no
 * longer carries, which cannot be drawn — the record is cleared. Writes only
 * when something actually changes, so a load that agrees with the store does
 * not announce a change to every mounted portrait.
 *
 * Deliberately does NOT touch the Closet fit. The wardrobe track is Pro's and
 * is settled on the device; the server has no opinion on it, and precedence
 * on the founder (fit over reward skin) is FounderAvatar's rule, not this one.
 */
export function syncWornFromInventory(
  owned: readonly InventoryOwnedRow[],
  catalog: readonly InventoryCatalogRow[],
): void {
  const row = owned.find((o) => o.kind === "skin" && o.equipped);
  const id = row ? row.item_id.replace(/^skin_/, "") : null;
  const entry = id ? catalog.find((c) => c.id === id) : undefined;
  const next: WornRewardSkin | null =
    id && entry && ID_RE.test(id) && isTier(entry.tier)
      ? { id, tier: entry.tier, name: String(entry.name ?? "").trim().slice(0, NAME_MAX) }
      : null;

  const current = loadWornRewardSkin();
  const same =
    (current === null && next === null) ||
    (current !== null &&
      next !== null &&
      current.id === next.id &&
      current.tier === next.tier &&
      current.name === next.name);
  if (same) return;
  write(next);
}
