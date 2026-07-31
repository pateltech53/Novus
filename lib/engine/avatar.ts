/**
 * The founder — your shark.
 *
 * This replaces the old mix-and-match Closet (skin / suit / shirt / accessory).
 * That system was structurally broken — the mesh had no separable parts, so
 * 29 pickable items rendered as at most one flat repaint, and the avatar was
 * invisible anywhere except the screen that sold it.
 *
 * What replaces it is simpler and says more: you pick a founder, and the
 * founder DRESSES AS THE COMPANY GROWS. Tier 1 is a hoodie in a garage. Tier 5
 * is a tuxedo and a gold watch. You do not choose the tuxedo; you earn it.
 *
 * ── On unlocking ─────────────────────────────────────────────────────────────
 * Tier IS company stage. There is no second currency, no coins, no XP — Brand
 * Law 6 forbids those words and Brand Law 4 forbids anything purchasable
 * touching progression. Stage is already the thing the whole game is about, it
 * is already earned through fiscal years and scored pitches, and it cannot be
 * bought at any price. So the wardrobe is a read-out of the business, which
 * makes it a trophy rather than a storefront.
 */

export type Gender = "male" | "female";
export type Tier = 1 | 2 | 3 | 4 | 5;

export interface AvatarConfig {
  /** What the sharks call you in the panel. */
  name: string;
  /** Chosen once, at founding. */
  gender: Gender;
  /** The tier currently worn. Never above the unlocked tier. */
  tier: Tier;
  /** Free-text vibe shown under the name. */
  title: string;
}

export interface TierDef {
  tier: Tier;
  /** Company stage that unlocks this tier — see STAGE_NAME in constants.ts. */
  unlocksAtStage: 1 | 2 | 3 | 4 | 5;
  label: string;
  /** What the fit says about where the company is. Shown on the unlock card. */
  blurb: string;
}

export const TIERS: TierDef[] = [
  {
    tier: 1,
    unlocksAtStage: 1,
    label: "The Garage",
    blurb: "A hoodie and an idea. Nobody has heard of you yet.",
  },
  {
    tier: 2,
    unlocksAtStage: 2,
    label: "First Payroll",
    blurb: "You own one jacket now. It is for meetings you used to take in a hoodie.",
  },
  {
    tier: 3,
    unlocksAtStage: 3,
    label: "The Growth Suit",
    blurb: "It fits. Somebody measured you for it. That is new.",
  },
  {
    tier: 4,
    unlocksAtStage: 4,
    label: "Boardroom",
    blurb: "You walk into rooms where people already know the number.",
  },
  {
    tier: 5,
    unlocksAtStage: 5,
    label: "Bell Day",
    blurb: "Tuxedo, gold watch, and a company that outlived the doubt.",
  },
];

export const tierDef = (t: Tier): TierDef => TIERS[t - 1];

/** The highest tier the company's current stage has earned. */
export function unlockedTier(stage: number): Tier {
  const found = [...TIERS].reverse().find((t) => stage >= t.unlocksAtStage);
  return (found?.tier ?? 1) as Tier;
}

export const isTierUnlocked = (t: Tier, stage: number): boolean => t <= unlockedTier(stage);

/** Portrait. Keyed to transparency, so it composites on any surface. */
export const avatarSrc = (gender: Gender, tier: Tier): string =>
  `/founder/${gender}-${tier}.webp`;

/**
 * The celebration clip, played once when a tier unlocks.
 * Deliberately NOT preloaded — ~4 MB each, and most players will see two.
 */
export const tierVideoSrc = (gender: Gender, tier: Tier): string =>
  `/founder/${gender}-${tier}.mp4`;

export const TITLES = [
  "Founder",
  "Founder & CEO",
  "Chief Everything Officer",
  "Still Standing",
  "Recovering Optimist",
  "Professional Explainer",
];

export const DEFAULT_AVATAR: AvatarConfig = {
  name: "",
  gender: "male",
  tier: 1,
  title: "Founder",
};

/** Migrate a save written against the old mix-and-match shape. */
export function normalizeAvatar(raw: unknown): AvatarConfig {
  const a = (raw ?? {}) as Partial<AvatarConfig> & Record<string, unknown>;
  const gender: Gender = a.gender === "female" ? "female" : "male";
  const t = Number(a.tier);
  const tier = (Number.isFinite(t) && t >= 1 && t <= 5 ? Math.round(t) : 1) as Tier;
  return {
    name: typeof a.name === "string" ? a.name : "",
    gender,
    tier,
    title: typeof a.title === "string" && a.title ? a.title : "Founder",
  };
}
