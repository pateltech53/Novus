/**
 * The published numbers.
 *
 * This file is the ONE place the odds live, and it is deliberately free of
 * `server-only` so the Odds modal can render the same table the server rolls
 * against. That is the point: §14.2 requires the drop rates to be visible
 * in-app, and a second hand-typed copy in a UI component is how a published
 * table starts lying.
 *
 * What is NOT here is the roll itself — see roll.ts, which is server-only.
 * Shipping the tables to the browser tells a player what CAN happen; shipping
 * the roller would let them decide what DOES.
 */

export type Tier = 1 | 2 | 3 | 4 | 5;
export type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";
export type Band = "easy" | "medium" | "hard";

export const TIER_NAMES: Record<Tier, string> = {
  1: "Canvas Case",
  2: "Leather Attaché",
  3: "Titanium Case",
  4: "Obsidian Executive",
  5: "Gold Briefcase",
};

export const TIER_SLUGS: Record<Tier, string> = {
  1: "t1-canvas",
  2: "t2-leather",
  3: "t3-titanium",
  4: "t4-obsidian",
  5: "t5-gold",
};

export const RARITY_COLORS: Record<Rarity, string> = {
  common: "#8E9BAA",
  uncommon: "#2EC4B6",
  rare: "#3A6BFF",
  epic: "#FF6B00",
  legendary: "#F5C518",
};

export const RARITY_ORDER: Rarity[] = ["common", "uncommon", "rare", "epic", "legendary"];

/** A tier maps to the rarity a skin of that tier drops at. */
export const TIER_RARITY: Record<Tier, Rarity> = {
  1: "common",
  2: "uncommon",
  3: "rare",
  4: "epic",
  5: "legendary",
};

/**
 * The same map read backwards.
 *
 * Tier and rarity are one-to-one, which is what lets a grant travel with only
 * its rarity and still be enough to find the artwork (`/briefcase/skins/tN/`).
 * Derived from TIER_RARITY rather than typed out again, so the two cannot
 * drift apart in a later edit.
 */
export const RARITY_TIER = Object.fromEntries(
  Object.entries(TIER_RARITY).map(([tier, rarity]) => [rarity, Number(tier) as Tier]),
) as Record<Rarity, Tier>;

/**
 * Daily tier-roll odds, in percent, by slot difficulty (plan §4.1).
 *
 * The zeroes are the floor rule made data: a Medium slot cannot pay T1 because
 * its T1 cell is 0, so the rule needs no separate branch to enforce — it is
 * unrepresentable.
 */
export const TIER_ODDS: Record<Band, Record<Tier, number>> = {
  easy:   { 1: 86, 2: 10.5, 3: 3,    4: 0.4,  5: 0.1 },
  medium: { 1: 0,  2: 83,   3: 13.5, 4: 2.9,  5: 0.6 },
  hard:   { 1: 0,  2: 0,    3: 82,   4: 15.5, 5: 2.5 },
};

/** Rarity odds per item inside a case, in percent (plan §3.1). */
export const RARITY_ODDS: Record<Tier, Record<Rarity, number>> = {
  1: { common: 70, uncommon: 25, rare: 5,  epic: 0,    legendary: 0 },
  2: { common: 45, uncommon: 35, rare: 17, epic: 3,    legendary: 0 },
  3: { common: 20, uncommon: 42, rare: 30, epic: 7.5,  legendary: 0.5 },
  4: { common: 5,  uncommon: 25, rare: 42, epic: 25,   legendary: 3 },
  5: { common: 0,  uncommon: 10, rare: 37, epic: 40,   legendary: 13 },
};

/** Item type within a rarity, in percent. */
export const TYPE_ODDS = {
  skin: 55,
  boost: 20,
  trial: 8,
  cosmetic: 12,
  tokens: 5,
} as const;
export type ItemType = keyof typeof TYPE_ODDS;

/** Items revealed per open. T5 additionally guarantees at least one Epic. */
export const ITEMS_PER_OPEN: Record<Tier, number> = { 1: 1, 2: 1, 3: 1, 4: 2, 5: 3 };

/** What a duplicate is worth in Shark Tokens. */
export const DUPE_TOKENS: Record<Rarity, number> = {
  common: 15,
  uncommon: 40,
  rare: 100,
  epic: 250,
  legendary: 750,
};

/** Token-shop prices for buying a SPECIFIC skin by tier. */
export const SHOP_SKIN_PRICE: Record<Tier, number> = {
  1: 300, 2: 600, 3: 1200, 4: 2500, 5: 6000,
};
export const SHOP_REROLL = 200;
export const SHOP_STREAK_SHIELD = 150;

/** Pity thresholds (plan §3.2). */
export const PITY_RARE_AT = 10;
export const PITY_LEGENDARY_AT = 40;

/**
 * The 3-tap upgrade, borrowed from Duolingo's chest.
 *
 * The player taps three times and each tap MIGHT bump the case up a tier. It
 * is pure theatre over a decision the server already made: the final tier is
 * rolled first from TIER_ODDS above, then the path back down to a start tier
 * is derived, so the odds a player is shown are exactly the odds they get.
 * Tapping cannot improve them — it only reveals them one step at a time.
 *
 * Without this, a T1 result is a flat "you got the common one" the instant the
 * case lands. With it, the same T1 is three separate moments of hope, and the
 * rare upgrade is a genuine jolt.
 */
export const UPGRADE_TAPS = 3;

/** The daily reset, one global clock (build prompt §6). */
export const RESET_HOUR_UTC = 9;

/** Milliseconds until the next 09:00 UTC, from a server timestamp. */
export function nextResetAt(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(RESET_HOUR_UTC, 0, 0, 0);
  if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}

/**
 * The reward day a moment belongs to.
 *
 * Not the calendar date: a claim at 08:00 UTC belongs to the day that STARTED
 * at 09:00 yesterday. Every date key in the system goes through here so the
 * leaderboard, the dailies and the streak all agree on where the seam is.
 */
export function rewardDate(now: Date): string {
  const shifted = new Date(now.getTime() - RESET_HOUR_UTC * 3600_000);
  return shifted.toISOString().slice(0, 10);
}
