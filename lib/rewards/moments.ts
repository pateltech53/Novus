/**
 * Which activities count as which moment.
 *
 * ── Why a table and not a switch in GameProvider ────────────────────────────
 *
 * The reward system needs to know that "Run an ad campaign" and "Seed some
 * influencers" are both the thing template O3 is asking for. That knowledge
 * belongs to the reward system, not to the game: `Activity` has no `kind`
 * field — only a `tab`, which is a UI grouping — so the mapping has to be
 * written down somewhere, and writing it down in the provider would put a
 * growing switch inside the one function every activity in the game passes
 * through.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It maps activity ids to event NAMES and nothing else. It does not decide
 * whether the moment satisfies a mission — `lib/rewards/progress.ts` does that
 * on the server, from the day's actual template. An id missing from this table
 * simply emits nothing, which is the correct default: a new activity should
 * not silently start counting toward a mission nobody wrote for it.
 */

/**
 * Activity (or branch) id → the template event it satisfies.
 *
 * Two-level activities are keyed on the PARENT id, because that is what the
 * player chose; the branch travels in the payload for the rare template that
 * cares which one.
 */
export const ACTIVITY_MOMENT: Record<string, string> = {
  // O4 — "Finish a research push"
  rnd: "rnd.completed",

  // O3 — "Run a campaign", across the shared registry and the industry lenses
  "ad-campaign": "campaign.ended",
  "marketing-social": "campaign.ended",
  "marketing-street": "campaign.ended",
  sponsor: "campaign.ended",
  "beauty-seed-influencers": "campaign.ended",
  "ecom-q4-push": "campaign.ended",

  // O5 — "Open something new"
  "buy-office": "expansion.opened",
  warehouse: "expansion.opened",
  "real-estate": "expansion.opened",
  "food-second-location": "expansion.opened",
  "ecom-warehouse": "expansion.opened",
  popup: "expansion.opened",
  "beauty-retail-partner": "expansion.opened",

  // O7 — "Make a strategic move"
  rebrand: "strategy.executed",
  "price-up": "strategy.executed",
  "price-down": "strategy.executed",
  rename: "strategy.executed",
  "pricing-test": "strategy.executed",
  ipo: "strategy.executed",

  // R3 — "Look after the founder"
  rest: "founder.care",
  offsite: "founder.care",
  healthcare: "founder.care",

  // R4 — "Put yourself in the room"
  mentor: "event.network",
  "advisory-board": "event.network",
  "trade-body": "event.network",
  partner: "event.network",
  keynote: "event.network",
};

/** The moment an activity press is worth, or nothing. */
export const momentFor = (activityId: string): string | undefined =>
  ACTIVITY_MOMENT[activityId];
