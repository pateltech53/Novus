import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { badRequest, rewardGate } from "@/lib/rewards/gate";
import {
  SHOP_REROLL, SHOP_SKIN_PRICE, SHOP_STREAK_SHIELD, type Tier,
} from "@/lib/rewards/tables";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The token shop — the agency valve that makes the RNG tolerable.
 *
 * Everything here is bought with SHARK TOKENS, which are earned by playing and
 * by converting duplicates. There is no code path from money to this route,
 * and there never may be: the audience is 13–18, and a randomised box that can
 * be bought is the exact thing Belgium bans and the FTC is probing. Selling a
 * SPECIFIC skin for earned currency is the version that stays on the right
 * side of that line — the player knows what they are getting before they
 * spend.
 *
 * ── Why the purchase still arrives in a briefcase ───────────────────────────
 *
 * Rule 5: no item ever appears silently in inventory. A bought skin is
 * wrapped in a case at its own tier and opened through the SHORT ceremony —
 * rise, open, reveal, ~2.5 s. The full three-tap suspense would be
 * patronising on an item the player chose off a shelf, but skipping the
 * ceremony entirely would make bought items feel like a different class of
 * thing from earned ones, and they are not.
 */

export async function GET(req: NextRequest) {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate.res;
  const db = adminClient();

  const [{ data: skins }, { data: owned }, { data: balance }] = await Promise.all([
    db.from("skins").select("id, name, tier, collection").eq("in_pool", true).order("id"),
    db.from("inventory").select("item_id").eq("user_id", gate.userId),
    db.rpc("token_balance", { p_user: gate.userId }),
  ]);

  const held = new Set((owned ?? []).map((r) => r.item_id as string));

  return withSession(
    NextResponse.json({
      ok: true,
      tokens: typeof balance === "number" ? balance : 0,
      prices: { skin: SHOP_SKIN_PRICE, reroll: SHOP_REROLL, streakShield: SHOP_STREAK_SHIELD },
      skins: (skins ?? [])
        .filter((s) => !held.has(`skin_${s.id}`))
        .map((s) => ({ ...s, price: SHOP_SKIN_PRICE[s.tier as Tier] })),
    }),
    gate.session,
  );
}

export async function POST(req: NextRequest) {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(NextResponse.json({ ok: false }, { status: 403 }), gate.session);
  }

  let body: { item?: unknown; skinId?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { return withSession(badRequest("bad json"), gate.session); }

  const db = adminClient();
  const item = String(body.item ?? "skin");

  if (item === "skin") {
    const skinId = String(body.skinId ?? "");
    const { data: skin } = await db
      .from("skins").select("id, name, tier").eq("id", skinId).eq("in_pool", true).maybeSingle();
    if (!skin) return withSession(badRequest("no such skin"), gate.session);

    const { data: already } = await db
      .from("inventory").select("item_id")
      .eq("user_id", gate.userId).eq("item_id", `skin_${skin.id}`).maybeSingle();
    if (already) return withSession(badRequest("already owned"), gate.session);

    const price = SHOP_SKIN_PRICE[skin.tier as Tier];

    /*
     * Spend first, then grant.
     *
     * `spend_tokens` re-reads the balance under a row lock and refuses to go
     * negative INSIDE the transaction — checking the balance here and
     * inserting after would be a race two taps wide. If the grant below then
     * failed, the player would be out the tokens with no case, which is why
     * the refund is not optional.
     */
    const { data: paid } = await db.rpc("spend_tokens", {
      p_user: gate.userId, p_amount: price, p_reason: `shop:skin_${skin.id}`,
    });
    if (!paid) {
      return withSession(
        NextResponse.json({ ok: false, error: "not enough tokens" }, { status: 402 }),
        gate.session,
      );
    }

    const { data: caseId, error } = await db.rpc("grant_briefcase", {
      p_user: gate.userId, p_tier: skin.tier, p_source: `shop:skin_${skin.id}`,
      p_preset: "short", p_path: [skin.tier],
    });
    if (error) {
      await db.rpc("spend_tokens", { p_user: gate.userId, p_amount: -price, p_reason: "shop:refund" });
      return withSession(badRequest(`purchase failed: ${error.message}`), gate.session);
    }

    return withSession(
      NextResponse.json({ ok: true, briefcaseId: caseId, spent: price }),
      gate.session,
    );
  }

  // Consumables — a re-roll or a streak shield. No case: these are not items
  // a player collects, they are a move they make, and the ceremony is for
  // things that join the wardrobe.
  const price = item === "reroll" ? SHOP_REROLL : item === "streak_shield" ? SHOP_STREAK_SHIELD : 0;
  if (!price) return withSession(badRequest("unknown item"), gate.session);

  const { data: paid } = await db.rpc("spend_tokens", {
    p_user: gate.userId, p_amount: price, p_reason: `shop:${item}`,
  });
  if (!paid) {
    return withSession(
      NextResponse.json({ ok: false, error: "not enough tokens" }, { status: 402 }),
      gate.session,
    );
  }
  await db.from("inventory").upsert(
    { user_id: gate.userId, item_id: item === "reroll" ? "daily_reroll" : "streak_shield", kind: "consumable" },
    { onConflict: "user_id,item_id" },
  );
  return withSession(NextResponse.json({ ok: true, spent: price }), gate.session);
}
