import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit, isUuid } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/islands — set an account's bought islands outright.
 *
 * `{ profileId, islands }` → admin_set_extra_islands (0013, re-bounded by
 * 0015). SET rather than increment, because an admin types the number they
 * mean; the 0–48 clamp matches the column's own check constraint.
 *
 * Forty-eight is not ISLAND_CAP and is not meant to be. It is what a FREE
 * account has to be able to accumulate to reach the ceiling — 2 + 48 = 50 —
 * which makes it the largest value that can ever mean anything. A Pro account
 * needs only 40 to reach the same place and clamps there, so setting 48 on one
 * is not an error; it is a grant bigger than the account can currently spend,
 * and it becomes spendable the day the subscription lapses.
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
  if (!isUuid(body.profileId) || Number.isNaN(islands) || islands < 0 || islands > 48) {
    return withSession(bad(400, "profileId and islands 0–48 are required"), gate.session);
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
