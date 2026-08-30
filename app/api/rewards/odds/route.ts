import { NextResponse } from "next/server";

import {
  DUPE_TOKENS, ITEMS_PER_OPEN, RARITY_ODDS, SHOP_REROLL, SHOP_SKIN_PRICE,
  SHOP_STREAK_SHIELD, TIER_NAMES, TIER_ODDS, TYPE_ODDS,
} from "@/lib/rewards/tables";

export const runtime = "nodejs";

/**
 * The published drop rates (§14.2).
 *
 * Served from the same constants the server rolls against, so the numbers a
 * player reads are the numbers they get — the alternative is a marketing page
 * that drifts from the code and nobody notices until a regulator asks.
 *
 * No gate: odds are public by design. There is nothing here an account could
 * learn that a screenshot would not already tell them.
 */
export function GET() {
  return NextResponse.json({
    ok: true,
    tierOdds: TIER_ODDS,
    rarityOdds: RARITY_ODDS,
    typeOdds: TYPE_ODDS,
    itemsPerOpen: ITEMS_PER_OPEN,
    dupeTokens: DUPE_TOKENS,
    tierNames: TIER_NAMES,
    shop: { skin: SHOP_SKIN_PRICE, reroll: SHOP_REROLL, streakShield: SHOP_STREAK_SHIELD },
    notes: [
      "Briefcases are earned in play and are never sold for money.",
      "A roll never pays below its slot's base tier.",
      "Tapping to upgrade reveals the tier the server already rolled — it cannot improve it.",
    ],
  });
}
