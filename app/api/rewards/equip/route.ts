import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { badRequest, rewardGate } from "@/lib/rewards/gate";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Wear something.
 *
 * The unequip-the-old-one half runs inside `equip_item` rather than here, so a
 * client that only sends the second of two calls cannot end up wearing two
 * skins. The function also refuses items the player does not own, which is the
 * whole authorization check — there is no "equip any id" path.
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
