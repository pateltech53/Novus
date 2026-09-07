import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit, isUuid } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/beta — flag one account as a briefcase TESTER.
 *
 * `{ profileId, active }` → admin_set_rewards_beta (0017). Deliberately the
 * same shape as /api/admin/comp: the console's grant band treats a tester flag
 * and a gifted Pro as the same kind of operator decision, and an operator who
 * knows one knows the other.
 *
 * The flag used to switch the whole reward loop on for an account — "ship to
 * staff, then to 10%", a cell in the database rather than a redeploy. The loop
 * has launched to every signed-in account since (lib/rewards/gate.ts), and the
 * cell now opens only the workbench: /api/rewards/sim and the BETA tab on
 * /rewards. Still revocable in one tap. The route name and the RPC keep their
 * old names so the console, the audit log and 0017 stay in agreement.
 */

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { profileId?: unknown; active?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  if (!isUuid(body.profileId) || typeof body.active !== "boolean") {
    return withSession(bad(400, "profileId and active are required"), gate.session);
  }

  const db = adminClient();

  // A uuid with no profile behind it should read as "no such account", not as
  // a foreign-key stack trace.
  const { data: profile } = await db
    .from("profiles").select("id").eq("id", body.profileId).maybeSingle();
  if (!profile) return withSession(bad(404, "no such account"), gate.session);

  const { error } = await db.rpc("admin_set_rewards_beta", {
    p_profile: body.profileId,
    p_active: body.active,
  });
  if (error) {
    return withSession(bad(503, `beta toggle failed: ${error.message}`), gate.session);
  }

  await audit(gate.session, body.active ? "beta.grant" : "beta.revoke", {
    target: String(body.profileId),
  });

  return withSession(NextResponse.json({ ok: true }), gate.session);
}
