"use client";

import Image from "next/image";
import { useMemo, useState, useSyncExternalStore } from "react";
import { avatarSrc, type AvatarConfig, type Gender, type Tier } from "@/lib/engine/avatar";
import {
  resolveEquippedSkin,
  skinSrc,
  subscribeWardrobe,
  type SkinId,
} from "@/lib/engine/wardrobe";
import {
  loadWornRewardSkin,
  rewardSkinSrc,
  subscribeWorn,
} from "@/lib/rewards/wear";
import type { Tier as RewardTier } from "@/lib/rewards/tables";

/**
 * The founder, everywhere.
 *
 * The old avatar appeared on exactly one screen — the Closet that sold it —
 * because only that one call site passed the config through. This component
 * takes the whole AvatarConfig, so any surface that has the run can show the
 * player's actual character: the masthead, the panel seat, the year-end
 * statement, a Still Standing row, a share card.
 *
 * Sizes are real pixel budgets rather than CSS guesses, so Next can serve a
 * 48px portrait to a list row instead of the 640px source.
 *
 * ── What the founder can wear ───────────────────────────────────────────────
 *
 * Two wardrobes, one body. The Closet's wardrobe track (lib/engine/wardrobe.ts)
 * is Pro's six earned fits; the briefcase loop (lib/rewards/wear.ts) is the
 * hundred-and-one reward designs won from cases. Both are read straight from
 * their own stores rather than threaded through props — cosmetics must not
 * ride inside game state, so no provider carries them — and both are drawn
 * by the same `<Image>`, because the reward renders are composed exactly like
 * the tier portraits (public/briefcase/skins/tN/<id>_novus|nova.webp against
 * public/founder/<gender>-<tier>.webp).
 *
 * Precedence, in one line: a Closet fit if one resolves, else the reward skin,
 * else the tier. The stores enforce one-at-a-time at the point of dressing
 * (wearing either takes the other off), so in practice the fit branch is the
 * tie-break for a stale record, not a daily occurrence.
 *
 * FounderPortrait stays literal (the ladder and the founding picker draw
 * specific tiers on purpose) and only wears a skin it is handed.
 */

/** A briefcase reward skin, by the two things its file path needs. */
export interface RewardSkinRef {
  kind: "reward";
  /** Catalog id — "001" … "101". */
  id: string;
  tier: RewardTier;
}

/**
 * Anything the portrait can wear instead of the tier: a wardrobe-track fit
 * by id, or a reward skin by reference. `null` is the tier portrait itself.
 * A plain string is a SkinId, so every call site written before reward skins
 * existed (`skin={s.id}`, `skin={null}`) reads exactly as it did.
 */
export type PortraitSkin = SkinId | RewardSkinRef;

const subscribeOutfit = (onChange: () => void) => {
  const offWardrobe = subscribeWardrobe(onChange);
  const offWorn = subscribeWorn(onChange);
  return () => {
    offWardrobe();
    offWorn();
  };
};

/*
 * The snapshot is a STRING, never an object.
 *
 * useSyncExternalStore compares snapshots with Object.is, and a getSnapshot
 * that builds a fresh `{ kind, id, tier }` on every call would never be equal
 * to the last one — React treats that as a store that changes during render
 * and re-renders until it gives up. So the store reads collapse to a key
 * ("fit:coder", "reward:017:3", or "" for the tier) and the hook parses the
 * key back into a value memoised on the key.
 */
const FIT = "fit:";
const REWARD = "reward:";

function outfitKey(): string {
  const fit = resolveEquippedSkin();
  if (fit) return `${FIT}${fit}`;
  const worn = loadWornRewardSkin();
  return worn ? `${REWARD}${worn.tier}:${worn.id}` : "";
}

/** SSR has no storage, and the tier portrait is the correct first paint
 *  everywhere. */
const outfitKeyOnServer = () => "";

function parseOutfitKey(key: string): PortraitSkin | null {
  if (key.startsWith(FIT)) return key.slice(FIT.length) as SkinId;
  if (key.startsWith(REWARD)) {
    const [tier, id] = key.slice(REWARD.length).split(":");
    const t = Number(tier);
    if (!id || !Number.isInteger(t) || t < 1 || t > 5) return null;
    return { kind: "reward", id, tier: t as RewardTier };
  }
  return null;
}

/** What the founder is wearing, live: every mounted avatar changes outfit
 *  the moment the Closet equips a fit or a case hands over a skin. */
function useEquippedSkin(): PortraitSkin | null {
  const key = useSyncExternalStore(subscribeOutfit, outfitKey, outfitKeyOnServer);
  return useMemo(() => parseOutfitKey(key), [key]);
}

/**
 * The reward skin alone, ignoring the Closet fit — for the Closet itself,
 * which computes the worn fit from its own state (it holds the ledger, the
 * record and Pro live) and only needs to know what is underneath it.
 */
export function useWornRewardSkin(): RewardSkinRef | null {
  const key = useSyncExternalStore(subscribeWorn, rewardKey, outfitKeyOnServer);
  return useMemo(() => {
    const parsed = parseOutfitKey(key);
    return parsed && typeof parsed !== "string" ? parsed : null;
  }, [key]);
}

function rewardKey(): string {
  const worn = loadWornRewardSkin();
  return worn ? `${REWARD}${worn.tier}:${worn.id}` : "";
}

export function FounderAvatar({
  avatar,
  size = 96,
  className = "",
  priority = false,
  skin,
}: {
  avatar: Pick<AvatarConfig, "gender" | "tier">;
  size?: number;
  className?: string;
  priority?: boolean;
  /** Omit to wear whatever is equipped. Pass null to force the tier portrait
   *  (surfaces that must show the EARNED tier, like a year-end statement),
   *  or a SkinId / RewardSkinRef to preview one. Purely which image renders —
   *  nothing else. */
  skin?: PortraitSkin | null;
}) {
  const equipped = useEquippedSkin();
  return (
    <FounderPortrait
      gender={avatar.gender}
      tier={avatar.tier}
      skin={skin === undefined ? equipped : skin}
      size={size}
      className={className}
      priority={priority}
    />
  );
}

/** The file for an outfit, or the tier's own portrait. */
function portraitSrc(skin: PortraitSkin | null, gender: Gender, tier: Tier): string {
  if (!skin) return avatarSrc(gender, tier);
  if (typeof skin === "string") return skinSrc(skin, gender);
  return rewardSkinSrc(skin.id, skin.tier, gender);
}

/** Same thing, for the places that hold a gender+tier but no full config. */
export function FounderPortrait({
  gender,
  tier,
  size = 96,
  className = "",
  priority = false,
  dimmed = false,
  skin = null,
}: {
  gender: Gender;
  tier: Tier;
  size?: number;
  className?: string;
  priority?: boolean;
  /** Locked tiers render at full fidelity, just quieter — never greyed out.
   *  The player should see exactly what the next tier is, so it reads as
   *  something to reach rather than something to buy. (Brand Law 4.) */
  dimmed?: boolean;
  /** An outfit worn instead of the tier portrait — a wardrobe-track SkinId or
   *  a briefcase RewardSkinRef. Deliberately NOT read from storage here — this
   *  component draws literal tiers, so substitution is opt-in per call site. */
  skin?: PortraitSkin | null;
}) {
  const wanted = portraitSrc(skin, gender, tier);
  /*
   * A render that has not shipped yet. A handful of the reward designs are in
   * the catalog ahead of their artwork, and a worn skin whose file 404s must
   * not leave the masthead showing the browser's broken-image glyph. The
   * failed URL is remembered and the tier portrait drawn instead; keyed to
   * the URL, so a change of outfit gets a fresh attempt automatically.
   */
  const [failed, setFailed] = useState<string | null>(null);
  const src = failed === wanted ? avatarSrc(gender, tier) : wanted;
  return (
    <Image
      src={src}
      alt=""
      width={size}
      height={size}
      priority={priority}
      onError={() => setFailed(wanted)}
      className={`select-none object-contain ${dimmed ? "opacity-45" : ""} ${className}`}
      // The renders are already keyed to transparency, so there is no box to
      // hide — they sit directly on whatever surface they are dropped onto.
      //
      // The size goes through a custom property so a container can shrink a
      // portrait without the call site knowing: the masthead gives height back
      // to the log on a short phone (globals.css), and an inline `width` set
      // in pixels is the one thing a stylesheet cannot override.
      style={{
        width: `var(--nv-portrait-size, ${size}px)`,
        height: `var(--nv-portrait-size, ${size}px)`,
      }}
      draggable={false}
    />
  );
}
