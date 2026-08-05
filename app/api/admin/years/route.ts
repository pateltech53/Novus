import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit, isUuid } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/years — set an account's extra fiscal-year closes a day.
 *
 * `{ profileId, closes }` → admin_set_extra_year_closes (0012). SET rather
 * than increment, for /api/admin/slots' reason: an admin types the number they
 * mean, and typing 0 is how the grant is taken back. The 0–20 clamp matches
 * the column's own check constraint.
 *
 * The grant stacks on top of the tier's allowance — four a day on free, Pro's
 * ninety-nine — and is read at the year gate through the same entitlement sync
 * as everything else, so it lands on the giftee's next sync without a reload.
 * Pace is what Pro sells; a score, a survival and a place on Still Standing
 * remain ungiftable here as everywhere (docs/ADMIN.md §11).
 */

const MAX_EXTRA_YEAR_CLOSES = 20;

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { profileId?: unknown; closes?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  const closes = typeof body.closes === "number" ? Math.trunc(body.closes) : NaN;
  if (
    !isUuid(body.profileId) ||
    Number.isNaN(closes) ||
    closes < 0 ||
    closes > MAX_EXTRA_YEAR_CLOSES
  ) {
    return withSession(
      bad(400, `profileId and closes 0–${MAX_EXTRA_YEAR_CLOSES} are required`),
      gate.session,
    );
  }

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

  const { error } = await db.rpc("admin_set_extra_year_closes", {
    p_profile: body.profileId,
    p_closes: closes,
  });
  if (error) {
    return withSession(bad(503, `year grant failed: ${error.message}`), gate.session);
  }

  await audit(gate.session, "year_closes_set", {
    target: body.profileId,
    targetEmail: account.data?.user?.email ?? null,
    detail: { closes },
  });

  return withSession(NextResponse.json({ ok: true }), gate.session);
}
