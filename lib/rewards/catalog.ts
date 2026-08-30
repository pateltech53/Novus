import type { Rarity } from "./tables";

/**
 * The non-skin reward pool (plan §5).
 *
 * ── The rule this list is shaped by ─────────────────────────────────────────
 *
 * No drop ever grants permanent Pro. Every pro-feature reward here is a TIMED
 * TRIAL — an hour of a locked industry, a day of all of them — and permanent
 * access exists only through the paid plan, entirely outside this loop. That
 * is a design decision and a legal one: the audience is 13–18, and a
 * randomised box that can pay out the paid product is the exact shape
 * regulators are looking at.
 *
 * The trials are also the honest version of marketing. Taste it, lose it,
 * want it — with no invoice attached to the wanting.
 *
 * ── Why cosmetics may be permanent and boosts may not ───────────────────────
 *
 * A frame gates nothing, so owning one forever costs the game nothing. A cash
 * multiplier that never expired would quietly become a difficulty setting the
 * leaderboard cannot see, which Brand Law 4 forbids — so boosts are consumed.
 */

export interface CatalogReward {
  id: string;
  name: string;
  kind: "tokens" | "boost" | "trial" | "cosmetic" | "title" | "consumable";
  rarity: Rarity;
  payload: Record<string, unknown>;
  flags?: string[];
}

export const REWARDS: CatalogReward[] = [
  // ── Common — keeps the wheel spinning ────────────────────────────────────
  { id: "tokens_25", name: "25 Shark Tokens", kind: "tokens", rarity: "common", payload: { tokens: 25 } },
  { id: "retry_pitch", name: "+1 Pitch Retry", kind: "consumable", rarity: "common", payload: { retries: 1 } },
  { id: "energy_refill", name: "Energy Refill", kind: "consumable", rarity: "common", payload: { energy: "full" }, flags: ["requires:energy"] },
  { id: "confetti_paper_cash", name: "Confetti: Paper Cash", kind: "cosmetic", rarity: "common", payload: { slot: "confetti" } },
  { id: "title_go_getter", name: "Title: Go-Getter", kind: "title", rarity: "common", payload: { slot: "title" } },
  { id: "title_bootstrapper", name: "Title: Bootstrapper", kind: "title", rarity: "common", payload: { slot: "title" } },
  { id: "title_intern", name: "Title: Intern of the Year", kind: "title", rarity: "common", payload: { slot: "title" } },

  // ── Uncommon — small power and QoL ───────────────────────────────────────
  { id: "tokens_60", name: "60 Shark Tokens", kind: "tokens", rarity: "uncommon", payload: { tokens: 60 } },
  { id: "boost_cash_2x", name: "2× Cash Boost", kind: "boost", rarity: "uncommon", payload: { multiplier: 2, scope: "fiscal_year" } },
  { id: "boost_xp_hour", name: "XP Boost — 1 hour", kind: "boost", rarity: "uncommon", payload: { multiplier: 2, minutes: 60 } },
  { id: "daily_reroll", name: "Daily Re-roll Token", kind: "consumable", rarity: "uncommon", payload: { rerolls: 1 } },
  { id: "streak_shield", name: "Streak Shield", kind: "consumable", rarity: "uncommon", payload: { shields: 1 } },
  { id: "frame_bronze_ledger", name: "Frame: Bronze Ledger", kind: "cosmetic", rarity: "uncommon", payload: { slot: "frame" } },
  { id: "title_closer", name: "Title: Closer", kind: "title", rarity: "uncommon", payload: { slot: "title" } },
  { id: "title_ramen", name: "Title: Ramen Profitable", kind: "title", rarity: "uncommon", payload: { slot: "title" } },
  { id: "title_series_seed", name: "Title: Series Seed", kind: "title", rarity: "uncommon", payload: { slot: "title" } },

  // ── Rare — worth a screenshot; the trials live here ──────────────────────
  { id: "tokens_150", name: "150 Shark Tokens", kind: "tokens", rarity: "rare", payload: { tokens: 150 } },
  { id: "trial_golden_hour", name: "Golden Hour — 1h industry pack", kind: "trial", rarity: "rare", payload: { duration_h: 1, grants: "one_industry_pack" } },
  { id: "trial_coldcall_day", name: "Cold-Calling Day Pass", kind: "trial", rarity: "rare", payload: { duration_h: 24, grants: "coldcall" }, flags: ["requires:coldcall"] },
  { id: "premium_shark_session", name: "Premium Shark Session", kind: "consumable", rarity: "rare", payload: { panels: 1, feedback: "2x" } },
  { id: "frame_silver_portfolio", name: "Frame: Silver Portfolio", kind: "cosmetic", rarity: "rare", payload: { slot: "frame" } },
  { id: "cursor_orange_spark", name: "Cursor Trail: Orange Spark", kind: "cosmetic", rarity: "rare", payload: { slot: "cursor" } },
  { id: "case_denim_canvas", name: "Case Reskin: Denim Canvas", kind: "cosmetic", rarity: "rare", payload: { slot: "case_skin", tier: 1 } },
  { id: "confetti_shark_fins", name: "Confetti: Shark Fins", kind: "cosmetic", rarity: "rare", payload: { slot: "confetti" } },
  { id: "title_bulletproof", name: "Title: Bulletproof Pitch", kind: "title", rarity: "rare", payload: { slot: "title" } },
  { id: "title_margin_call", name: "Title: Margin Call", kind: "title", rarity: "rare", payload: { slot: "title" } },

  // ── Epic — flex cosmetics and big bundles ────────────────────────────────
  { id: "tokens_400", name: "400 Shark Tokens", kind: "tokens", rarity: "epic", payload: { tokens: 400 } },
  { id: "boost_bundle", name: "Boost Bundle", kind: "boost", rarity: "epic", payload: { cash: 2, xp_minutes: 60, retries: 1 } },
  { id: "trial_golden_shift", name: "Golden Shift — 5h industry pack", kind: "trial", rarity: "epic", payload: { duration_h: 5, grants: "one_industry_pack" } },
  { id: "trial_golden_day", name: "Golden Day — 24h all packs", kind: "trial", rarity: "epic", payload: { duration_h: 24, grants: "all_industry_packs" } },
  { id: "frame_gold_boardroom", name: "Frame: Gold Boardroom", kind: "cosmetic", rarity: "epic", payload: { slot: "frame" } },
  { id: "bg_skyline_office", name: "Background: Skyline Corner Office", kind: "cosmetic", rarity: "epic", payload: { slot: "background" } },
  { id: "confetti_gold_trophies", name: "Confetti: Gold Trophies", kind: "cosmetic", rarity: "epic", payload: { slot: "confetti" } },
  { id: "title_shark_bait", name: "Title: Shark Bait No More", kind: "title", rarity: "epic", payload: { slot: "title" } },
  { id: "title_term_sheet", name: "Title: Term Sheet Titan", kind: "title", rarity: "epic", payload: { slot: "title" } },

  // ── Legendary — identity items people build a profile around ─────────────
  { id: "tokens_1200", name: "1,200 Shark Tokens", kind: "tokens", rarity: "legendary", payload: { tokens: 1200 } },
  { id: "frame_molten_gold", name: "Animated Frame: Molten Gold", kind: "cosmetic", rarity: "legendary", payload: { slot: "frame", animated: true } },
  { id: "aura_founders_seal", name: "Aura: Founder's Seal", kind: "cosmetic", rarity: "legendary", payload: { slot: "aura" } },
  { id: "pose_trophy_lift", name: "Pose: Trophy Lift", kind: "cosmetic", rarity: "legendary", payload: { slot: "pose" } },
  { id: "title_apex_founder", name: "Title: Apex Founder", kind: "title", rarity: "legendary", payload: { slot: "title", animated: true } },
];
