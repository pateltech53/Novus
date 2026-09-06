import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { badRequest, rewardGate } from "@/lib/rewards/gate";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wear something — or, with `itemId: null`, take it off.
 *
 * The unequip-the-old-one half runs inside `equip_item` rather than here, so a
 * client that only sends the second of two calls cannot end up wearing two
 * skins. The function also refuses items the player does not own, which is the
 * whole authorization check — there is no "equip any id" path.
 *
 * ── Taking it off ───────────────────────────────────────────────────────────
 *
 * `equip_item` has no "nothing" — it swaps one owned item for another. Once
 * reward skins are drawn on the founder (components/FounderAvatar.tsx, via
 * lib/rewards/wear.ts) a player needs a way back to the tier portrait, and a
 * device-local take-off alone would be undone by the next inventory sync,
 * which lets the server win. So a null `itemId` clears every `equipped` flag
 * the player holds, through the service role like every other inventory
 * write. It touches only `equipped`, only this player's rows, and grants
 * nothing — there is no roll anywhere near it.
 */
export async function POST(req: NextRequest) {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(NextResponse.json({ ok: false }, { status: 403 }), gate.session);
  }

  let body: { itemId?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { return withSession(badRequest("bad json"), gate.session); }

  if (body.itemId === null) {
    const { error } = await adminClient()
      .from("inventory")
      .update({ equipped: false })
      .eq("user_id", gate.userId)
      .eq("equipped", true);
    if (error) {
      return withSession(NextResponse.json({ ok: false, error: error.message }, { status: 503 }), gate.session);
    }
    return withSession(NextResponse.json({ ok: true, equipped: null }), gate.session);
  }

  const itemId = String(body.itemId ?? "");
  if (!itemId || itemId.length > 64) return withSession(badRequest("itemId required"), gate.session);

  const { data, error } = await adminClient().rpc("equip_item", {
    p_user: gate.userId, p_item: itemId,
  });
  if (error) {
    return withSession(NextResponse.json({ ok: false, error: error.message }, { status: 503 }), gate.session);
  }
  if (!data) {
    return withSession(NextResponse.json({ ok: false, error: "not owned" }, { status: 409 }), gate.session);
  }
  return withSession(NextResponse.json({ ok: true }), gate.session);
}
