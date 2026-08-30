import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { rewardGate } from "@/lib/rewards/gate";
import { withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unopened cases, oldest first.
 *
 * `tier` is deliberately NOT selected. A case's tier is the ceremony's first
 * jackpot moment, and a Vault endpoint that returned it would let anyone with
 * devtools read the answer off the network tab before the burst. The Vault
 * shows a silhouette and a source; the reveal belongs to /open.
 */
export async function GET(req: NextRequest) {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate.res;

  const { data } = await adminClient()
    .from("briefcases")
    .select("id, source, preset, granted_at")
    .eq("user_id", gate.userId)
    .is("opened_at", null)
    .order("granted_at", { ascending: true })
    .limit(100);

  return withSession(
    NextResponse.json({ ok: true, cases: data ?? [], count: data?.length ?? 0 }),
    gate.session,
  );
}
