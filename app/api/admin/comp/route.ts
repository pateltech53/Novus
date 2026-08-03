import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit, isUuid } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/comp — gift Pro, or take a gift back.
 *
 * `{ profileId, active, until?, note? }` → admin_set_comp_pro (0009). The
 * gift lands in `comp_pro`, never in `pro`: the Stripe webhook owns `pro`
 * and overwrites it on every subscription event, so a gift written there
 * would evaporate on the giftee's next billing update. `until` is optional
 * ISO — absent means the gift does not expire.
 */

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { profileId?: unknown; active?: unknown; until?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  if (!isUuid(body.profileId) || typeof body.active !== "boolean") {
    return withSession(bad(400, "profileId and active are required"), gate.session);
  }

  let until: string | null = null;
  if (body.until != null && body.until !== "") {
    if (typeof body.until !== "string" || Number.isNaN(Date.parse(body.until))) {
      return withSession(bad(400, "until is not a date"), gate.session);
    }
    until = new Date(body.until).toISOString();
  }

  const note = typeof body.note === "string" ? body.note.slice(0, 280) : null;

  const db = adminClient();

  // The entitlements row hangs off profiles; a uuid with no profile behind it
  // should read as "no such account", not as a foreign-key stack trace.
  const [profile, account] = await Promise.all([
    db.from("profiles").select("id").eq("id", body.profileId).maybeSingle(),
    db.auth.admin.getUserById(body.profileId),
  ]);
  if (!profile.data) {
    return withSession(bad(404, "no such account"), gate.session);
  }

  const { error } = await db.rpc("admin_set_comp_pro", {
    p_profile: body.profileId,
    p_active: body.active,
    p_until: until,
    p_note: note,
  });
  if (error) {
    return withSession(bad(503, `grant failed: ${error.message}`), gate.session);
  }

  await audit(gate.session, body.active ? "comp_grant" : "comp_revoke", {
    target: body.profileId,
    targetEmail: account.data?.user?.email ?? null,
    detail: { until, note },
  });

  return withSession(NextResponse.json({ ok: true }), gate.session);
}
