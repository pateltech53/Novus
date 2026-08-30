import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { rewardGate } from "@/lib/rewards/gate";
import { withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * What the player owns, plus the token balance and the whole skin catalog.
 *
 * The catalog rides along because the closet shows what is NOT owned as much
 * as what is — the greyed-out silhouettes are the reason a collection feels
 * like a collection — and a second round trip to assemble that would leave the
 * grid popping in behind the owned rows.
 *
 * Expired trials are filtered here rather than deleted: a borrowed feature
 * that lapsed is a row worth keeping (it is what makes "you had this once"
 * true), but it must not read as owned.
 */
export async function GET(req: NextRequest) {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate.res;
  const db = adminClient();
  const now = new Date().toISOString();

  const [{ data: owned }, { data: catalog }, { data: balance }] = await Promise.all([
    db.from("inventory")
      .select("item_id, kind, equipped, acquired_at, expires_at")
      .eq("user_id", gate.userId),
    db.from("skins").select("id, name, tier, collection, in_pool").order("id"),
    db.rpc("token_balance", { p_user: gate.userId }),
  ]);

  const live = (owned ?? []).filter((row) => !row.expires_at || row.expires_at > now);

  return withSession(
    NextResponse.json({
      ok: true,
      tokens: typeof balance === "number" ? balance : 0,
      owned: live,
      lapsed: (owned ?? []).filter((row) => row.expires_at && row.expires_at <= now),
      catalog: catalog ?? [],
    }),
    gate.session,
  );
}
