import { NextResponse, type NextRequest } from "next/server";

import { wireEntitlements, type EntitlementRow, type ProfileRoleRow } from "@/lib/admin/entitlements";
import { configured } from "@/lib/supabase/config";
import { attachSession, sessionFromRequest } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/billing/entitlements — just the entitlements, nothing else.
 *
 * `/api/sync` already returns these, and for the boot path that is the right
 * place: one request, everything the client needs. This route exists for the
 * one case that has to POLL — the moment a player lands back from Stripe, when
 * the webhook may be milliseconds behind them. Polling /api/sync would drag a
 * whole run blob across the wire several times to read six fields.
 *
 * Read-only, and running as the player: RLS (0001) is the access check, and
 * there is no write path to entitlements anywhere a client can reach.
 */
export async function GET(req: NextRequest) {
  if (!configured()) {
    return NextResponse.json({ configured: false, signedIn: false }, { status: 200 });
  }

  const session = await sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ configured: true, signedIn: false }, { status: 200 });
  }

  const [entRow, profileRow] = await Promise.all([
    session.supabase
      .from("entitlements")
      .select(
        "pro, extra_islands, industry_packs, cosmetic_bundles, chapter, intent, comp_pro, comp_until",
      )
      .eq("profile_id", session.userId)
      .maybeSingle(),
    // The overlay's inputs: a comped gift folds into `pro`, and an admin's
    // account is derived from `role`/`admin_view` rather than stored. Both
    // decisions live in lib/admin/entitlements.ts, shared with /api/sync.
    session.supabase
      .from("profiles")
      .select("role, admin_view")
      .eq("id", session.userId)
      .maybeSingle(),
  ]);

  // Null until a purchase is recorded — nothing else creates a row here.
  const entitlements = wireEntitlements(
    (entRow.data as EntitlementRow | null) ?? null,
    (profileRow.data as ProfileRoleRow | null) ?? null,
  );

  return attachSession(
    NextResponse.json({ configured: true, signedIn: true, entitlements }),
    session,
  );
}
