import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit, isUuid } from "@/lib/admin/guard";
import { INDUSTRIES } from "@/lib/engine/constants";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/packs — gift or revoke one industry pack.
 *
 * `{ profileId, industry, grant }`. The grant path is 0003's own
 * grant_industry_pack — the same function the webhook calls, so a gifted
 * pack and a bought one are indistinguishable rows. The revoke is 0009's
 * admin_revoke_industry_pack. Codes are validated against the industry
 * table here so a typo answers 400 instead of tripping the entitlements
 * check constraint.
 */

const CODES: readonly string[] = INDUSTRIES.map((i) => i.code);

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { profileId?: unknown; industry?: unknown; grant?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  if (
    !isUuid(body.profileId) ||
    typeof body.industry !== "string" ||
    !CODES.includes(body.industry) ||
    typeof body.grant !== "boolean"
  ) {
    return withSession(bad(400, "profileId, a real industry code and grant are required"), gate.session);
  }

  const db = adminClient();
  const [profile, account] = await Promise.all([
    db.from("profiles").select("id").eq("id", body.profileId).maybeSingle(),
    db.auth.admin.getUserById(body.profileId),
  ]);
  if (!profile.data) {
    return withSession(bad(404, "no such account"), gate.session);
  }

  const { error } = body.grant
    ? await db.rpc("grant_industry_pack", {
        p_profile: body.profileId,
        p_industry: body.industry,
      })
    : await db.rpc("admin_revoke_industry_pack", {
        p_profile: body.profileId,
        p_industry: body.industry,
      });
  if (error) {
    return withSession(bad(503, `pack change failed: ${error.message}`), gate.session);
  }

  await audit(gate.session, body.grant ? "pack_grant" : "pack_revoke", {
    target: body.profileId,
    targetEmail: account.data?.user?.email ?? null,
    detail: { industry: body.industry },
  });

  return withSession(NextResponse.json({ ok: true }), gate.session);
}
