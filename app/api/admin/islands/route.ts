import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit, isUuid } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/islands — set an account's bought islands outright.
 *
 * `{ profileId, islands }` → admin_set_extra_islands (0013). SET rather than
 * increment, because an admin types the number they mean; the 0–20 clamp
 * matches the column's own check constraint.
 *
 * Note the two ceilings do not agree, and that is deliberate: the column
 * accepts 0–20 while `islandCapFor()` and `island_allowance()` both stop at
 * ISLAND_CAP (10), because `saves.slot` has nowhere to put an eleventh
 * company. Setting 20 here is not an error, it just stops buying anything
 * above 10 — the same shape as gifting a player more of something than they
 * can spend.
 */

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { profileId?: unknown; islands?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  const islands = typeof body.islands === "number" ? Math.trunc(body.islands) : NaN;
  if (!isUuid(body.profileId) || Number.isNaN(islands) || islands < 0 || islands > 20) {
    return withSession(bad(400, "profileId and islands 0–20 are required"), gate.session);
  }

  const db = adminClient();
  const [profile, account] = await Promise.all([
    db.from("profiles").select("id").eq("id", body.profileId).maybeSingle(),
    db.auth.admin.getUserById(body.profileId),
  ]);
  if (!profile.data) {
    return withSession(bad(404, "no such account"), gate.session);
  }

  const { error } = await db.rpc("admin_set_extra_islands", {
    p_profile: body.profileId,
    p_islands: islands,
  });
  if (error) {
    return withSession(bad(503, `island change failed: ${error.message}`), gate.session);
  }

  await audit(gate.session, "islands_set", {
    target: body.profileId,
    targetEmail: account.data?.user?.email ?? null,
    detail: { islands },
  });

  return withSession(NextResponse.json({ ok: true }), gate.session);
}
