"use client";

import Image from "next/image";
import { useSyncExternalStore } from "react";
import { avatarSrc, type AvatarConfig, type Gender, type Tier } from "@/lib/engine/avatar";
import {
  resolveEquippedSkin,
  skinSrc,
  subscribeWardrobe,
  type SkinId,
} from "@/lib/engine/wardrobe";

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
 * Wardrobe skins: FounderAvatar wears whatever the Closet equipped, read
 * straight from the wardrobe store rather than threaded through props —
 * cosmetics must not ride inside game state, so no provider carries them.
 * FounderPortrait stays literal (the ladder and the founding picker draw
 * specific tiers on purpose) and only wears a skin it is handed.
 */

const noSkinOnServer = () => null;

/** The equipped skin, live: every mounted avatar changes outfit the moment
 *  the Closet equips one. Server snapshot is null — SSR has no storage, and
 *  the tier portrait is the correct first paint everywhere. */
function useEquippedSkin(): SkinId | null {
  return useSyncExternalStore(subscribeWardrobe, resolveEquippedSkin, noSkinOnServer);
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
   *  or a SkinId to preview one. Purely which image renders — nothing else. */
  skin?: SkinId | null;
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
  /** A wardrobe skin worn instead of the tier portrait. Deliberately NOT read
   *  from storage here — this component draws literal tiers, so substitution
   *  is opt-in per call site. */
  skin?: SkinId | null;
}) {
  return (
    <Image
      src={skin ? skinSrc(skin, gender) : avatarSrc(gender, tier)}
      alt=""
      width={size}
      height={size}
      priority={priority}
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
