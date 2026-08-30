import "server-only";

import {
  DUPE_TOKENS, ITEMS_PER_OPEN, PITY_LEGENDARY_AT, PITY_RARE_AT,
  RARITY_ODDS, RARITY_ORDER, TIER_ODDS, TYPE_ODDS, UPGRADE_TAPS,
  type Band, type ItemType, type Rarity, type Tier,
} from "./tables";
import { rngFor, weighted } from "./seed";

/**
 * Every random decision in the reward system.
 *
 * `import "server-only"` at the top is load-bearing, not decoration: the build
 * prompt's acceptance criteria include a grep proving no client bundle
 * contains roll logic, and this import is what makes that a build error rather
 * than a code-review habit. tables.ts ships to the browser so the odds can be
 * published; this file must not.
 *
 * ── Seeded, not `Math.random()` ─────────────────────────────────────────────
 *
 * Each roll is derived from a seed the caller supplies — the briefcase id for
 * an open, the date for the daily generator. That buys three things: the same
 * open always produces the same result (so a retry after a dropped connection
 * cannot re-roll into something better), any day's challenges can be recomputed
 * on any server without storing them, and a bug is reproducible from the id in
 * the support ticket.
 */

// ── tier ────────────────────────────────────────────────────────────────────

/**
 * The tier a completed daily pays, and the three-tap path that reveals it.
 *
 * The FINAL tier is rolled first, honestly, from the slot's published odds.
 * Only then is a start tier chosen below it and a path built up — so the taps
 * are a reveal, never a second roll. A player who taps all three and a player
 * who skips the animation entirely receive exactly the same case.
 *
 * The floor rule needs no code: a band's ineligible tiers carry weight 0 in
 * TIER_ODDS, so they cannot be drawn and the start tier is clamped to the
 * lowest tier the band can actually pay.
 */
export function rollTier(band: Band, seed: string): { tier: Tier; path: Tier[] } {
  const rand = rngFor(`tier:${seed}`);
  const tier = Number(weighted(TIER_ODDS[band], rand)) as Tier;

  const floor = (Object.entries(TIER_ODDS[band]) as [string, number][])
    .filter(([, w]) => w > 0)
    .map(([t]) => Number(t))
    .sort((a, b) => a - b)[0] as Tier;

  // How many of the three taps actually upgrade. A case that landed on its
  // floor has nothing to reveal, so it stays put and the taps are suspense
  // that resolves to "no" — which is most opens, and is the honest shape.
  const room = tier - floor;
  const upgrades = Math.min(room, UPGRADE_TAPS);
  const start = (tier - upgrades) as Tier;

  // Spread the upgrades across the three taps: which taps pay is cosmetic, so
  // it is drawn here and stored, never decided by the client.
  const payingTaps = new Set<number>();
  while (payingTaps.size < upgrades) payingTaps.add(Math.floor(rand() * UPGRADE_TAPS));

  const path: Tier[] = [];
  let current = start;
  for (let tap = 0; tap < UPGRADE_TAPS; tap++) {
    if (payingTaps.has(tap)) current = (current + 1) as Tier;
    path.push(current);
  }
  return { tier, path };
}

// ── the open ────────────────────────────────────────────────────────────────

export interface RollableItem {
  id: string;
  kind: string;
  rarity: Rarity;
  name: string;
  /** Trials only: how long the borrowed feature lasts. */
  durationH?: number;
  /** Tokens only: how many. */
  tokens?: number;
}

export interface RevealItem {
  grantId: string;
  itemId: string;
  kind: string;
  name: string;
  rarity: Rarity;
  wasDupe: boolean;
  tokens: number;
  expiresAt?: string;
}

export interface OpenInput {
  briefcaseId: string;
  tier: Tier;
  /** Every skin in the pool, with the rarity its tier maps to. */
  skins: RollableItem[];
  /** The non-skin pool: boosts, trials, cosmetics, titles. */
  rewards: RollableItem[];
  /** item_ids the player already holds — drives the dupe path. */
  owned: Set<string>;
  pity: { sinceRare: number; sinceLegendary: number };
  /** Injected so the caller owns id generation (and tests can be stable). */
  uuid: () => string;
  now?: Date;
}

export interface OpenResult {
  items: RevealItem[];
  pity: { sinceRare: number; sinceLegendary: number };
  /** The best rarity in the case — the ceremony lights the interior with it. */
  best: Rarity;
}

/**
 * Roll the contents of one case.
 *
 * Deterministic in `briefcaseId`, so calling twice is safe: the route commits
 * through open_briefcase, which stores the first payload and replays it, and
 * even if that failed the second roll would agree with the first.
 */
export function rollOpen(input: OpenInput): OpenResult {
  const { briefcaseId, tier, skins, rewards, owned, uuid } = input;
  const now = input.now ?? new Date();
  const rand = rngFor(`open:${briefcaseId}`);
  const count = ITEMS_PER_OPEN[tier];

  let { sinceRare, sinceLegendary } = input.pity;
  const items: RevealItem[] = [];
  // A dupe of something won earlier in THIS case is still a dupe; the set has
  // to grow as we go or a T5 could pay the same skin three times.
  const held = new Set(owned);

  for (let i = 0; i < count; i++) {
    let rarity: Rarity = weighted(RARITY_ODDS[tier], rand);

    // Pity A — ten opens with nothing Rare or better owes the player one.
    if (sinceRare + 1 >= PITY_RARE_AT && RARITY_ORDER.indexOf(rarity) < 2) {
      rarity = weighted({ rare: 70, epic: 25, legendary: 5 } as Record<Rarity, number>, rand);
    }
    // Pity B — forty T3+ opens with no Legendary guarantees Epic-or-Legendary.
    if (tier >= 3 && sinceLegendary + 1 >= PITY_LEGENDARY_AT && rarity !== "legendary") {
      rarity = weighted({ epic: 75, legendary: 25 } as Record<Rarity, number>, rand);
    }
    // A Gold case owes at least one Epic. If the last slot has not paid one,
    // it pays one now.
    const isLastSlot = i === count - 1;
    if (tier === 5 && isLastSlot && !items.some((it) => RARITY_ORDER.indexOf(it.rarity) >= 3)) {
      if (RARITY_ORDER.indexOf(rarity) < 3) rarity = "epic";
    }

    items.push(rollItem({ rarity, rand, skins, rewards, held, uuid, now }));

    // Counters move on the ITEM, not the open, so a two-item Obsidian that
    // pays two Commons advances pity twice — which is what a player counting
    // their bad luck would expect.
    const index = RARITY_ORDER.indexOf(rarity);
    sinceRare = index >= 2 ? 0 : sinceRare + 1;
    if (tier >= 3) sinceLegendary = rarity === "legendary" ? 0 : sinceLegendary + 1;
  }

  // Best last: the ceremony reveals ascending so the case ends on its high
  // note rather than opening with it.
  items.sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));

  return {
    items,
    pity: { sinceRare, sinceLegendary },
    best: items[items.length - 1]?.rarity ?? "common",
  };
}

function rollItem(args: {
  rarity: Rarity;
  rand: () => number;
  skins: RollableItem[];
  rewards: RollableItem[];
  held: Set<string>;
  uuid: () => string;
  now: Date;
}): RevealItem {
  const { rarity, rand, skins, rewards, held, uuid, now } = args;

  let type = weighted(TYPE_ODDS as unknown as Record<ItemType, number>, rand);

  const poolFor = (t: ItemType) =>
    t === "skin"
      ? skins.filter((s) => s.rarity === rarity)
      : rewards.filter((r) => r.rarity === rarity && kindMatches(t, r.kind));

  // An empty pool at this rarity — no Legendary trials exist, say — must not
  // produce an empty reveal. Tokens are the universal fallback, which is also
  // what the spec asks for when the skin pool is exhausted.
  if (poolFor(type).length === 0) type = "tokens";

  if (type === "tokens") {
    const amount = DUPE_TOKENS[rarity];
    const id = `tokens_${rarity}`;
    return {
      grantId: uuid(), itemId: id, kind: "tokens", name: `${amount} Shark Tokens`,
      rarity, wasDupe: false, tokens: amount,
    };
  }

  const pool = poolFor(type);
  const pick = pool[Math.floor(rand() * pool.length)];

  // Already owned → tokens instead of a second copy. Cosmetics and skins are
  // the only things this can happen to; consumables stack.
  if (held.has(pick.id) && pick.kind !== "boost" && pick.kind !== "consumable") {
    return {
      grantId: uuid(), itemId: pick.id, kind: pick.kind, name: pick.name,
      rarity, wasDupe: true, tokens: DUPE_TOKENS[rarity],
    };
  }
  held.add(pick.id);

  const expiresAt = pick.durationH
    ? new Date(now.getTime() + pick.durationH * 3600_000).toISOString()
    : undefined;

  return {
    grantId: uuid(), itemId: pick.id, kind: pick.kind, name: pick.name,
    rarity, wasDupe: false, tokens: pick.tokens ?? 0, expiresAt,
  };
}

/** Maps the roll's five type buckets onto the `rewards.kind` column. */
function kindMatches(type: ItemType, kind: string): boolean {
  if (type === "boost") return kind === "boost" || kind === "consumable";
  if (type === "trial") return kind === "trial";
  if (type === "cosmetic") return kind === "cosmetic" || kind === "title";
  return false;
}

/**
 * The rule that cannot be allowed to rot: a reward may LEND a pro feature and
 * may never GRANT one.
 *
 * Called on every payload before it is committed. The database has the same
 * check as a constraint; this is the half that produces a readable error and a
 * test that can assert on it.
 */
export function assertNoPermanentPro(payload: { kind: string; durationH?: number; raw?: unknown }): void {
  if (payload.kind === "trial") {
    if (!payload.durationH || ![1, 5, 24].includes(payload.durationH)) {
      throw new Error(`trial rewards must last 1, 5 or 24 hours, got ${payload.durationH}`);
    }
  }
  const raw = payload.raw as Record<string, unknown> | undefined;
  if (raw && ("pro" in raw || "comp_pro" in raw)) {
    throw new Error("a reward payload may never grant pro; trials only");
  }
}
