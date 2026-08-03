import { NextResponse, type NextRequest } from "next/server";

import { adminGate } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/users?q=&limit=&offset= — the account directory.
 *
 * One call to admin_list_users (0009), which joins auth.users to everything
 * this schema knows about each account. The function is service-role only and
 * `security definer`; the gate above is therefore the entire reason a browser
 * can reach this data, which is why the gate runs first and unconditionally.
 */

/** The row shape admin_list_users returns, in the database's own names. */
interface ListRow {
  id: string;
  email: string | null;
  display_name: string | null;
  role: string;
  is_anonymous: boolean;
  created_at: string;
  last_sign_in_at: string | null;
  pro: boolean;
  comp_pro: boolean;
  comp_until: string | null;
  comp_note: string | null;
  chapter: string | null;
  extra_run_slots: number;
  industry_packs: string[];
  intent: string | null;
  subscription_status: string | null;
  plan: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean;
  owns_chapter_id: string | null;
  owns_chapter_status: string | null;
  owns_chapter_source: string | null;
  owns_chapter_licence: string | null;
  seat_chapter_id: string | null;
  total: number;
}

export async function GET(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(200, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50));
  const offset = Math.max(0, Number(req.nextUrl.searchParams.get("offset") ?? 0) || 0);

  const { data, error } = await adminClient().rpc("admin_list_users", {
    p_query: q,
    p_limit: limit,
    p_offset: offset,
  });

  if (error) {
    return withSession(
      NextResponse.json({ ok: false, reason: "read-failed" }, { status: 503 }),
      gate.session,
    );
  }

  const rows = (data ?? []) as ListRow[];
  return withSession(
    NextResponse.json({
      ok: true,
      total: rows[0]?.total ?? 0,
      users: rows.map((r) => ({
        id: r.id,
        email: r.email,
        displayName: r.display_name,
        role: r.role,
        anonymous: r.is_anonymous,
        createdAt: r.created_at,
        lastSignInAt: r.last_sign_in_at,
        pro: r.pro,
        compPro: r.comp_pro,
        compUntil: r.comp_until,
        compNote: r.comp_note,
        chapter: r.chapter,
        extraRunSlots: r.extra_run_slots,
        industryPacks: r.industry_packs,
        intent: r.intent,
        subscriptionStatus: r.subscription_status,
        plan: r.plan,
        currentPeriodEnd: r.current_period_end,
        cancelAtPeriodEnd: r.cancel_at_period_end,
        ownsChapter: r.owns_chapter_id
          ? {
              id: r.owns_chapter_id,
              status: r.owns_chapter_status,
              source: r.owns_chapter_source,
              licence: r.owns_chapter_licence,
            }
          : null,
        seatChapterId: r.seat_chapter_id,
      })),
    }),
    gate.session,
  );
}
