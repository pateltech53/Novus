import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit, isUuid } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/slots — set an account's extra run slots outright.
 *
 * `{ profileId, slots }` → admin_set_extra_run_slots (0009). SET rather than
 * increment, because an admin types the number they mean; the 0–20 clamp
 * matches the column's own check constraint.
 */

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { profileId?: unknown; slots?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  const slots = typeof body.slots === "number" ? Math.trunc(body.slots) : NaN;
  if (!isUuid(body.profileId) || Number.isNaN(slots) || slots < 0 || slots > 20) {
    return withSession(bad(400, "profileId and slots 0–20 are required"), gate.session);
  }

  const db = adminClient();
  const [profile, account] = await Promise.all([
    db.from("profiles").select("id").eq("id", body.profileId).maybeSingle(),
    db.auth.admin.getUserById(body.profileId),
  ]);
  if (!profile.data) {
    return withSession(bad(404, "no such account"), gate.session);
  }

  const { error } = await db.rpc("admin_set_extra_run_slots", {
    p_profile: body.profileId,
    p_slots: slots,
  });
  if (error) {
    return withSession(bad(503, `slot change failed: ${error.message}`), gate.session);
  }

  await audit(gate.session, "slots_set", {
    target: body.profileId,
    targetEmail: account.data?.user?.email ?? null,
    detail: { slots },
  });

  return withSession(NextResponse.json({ ok: true }), gate.session);
}
