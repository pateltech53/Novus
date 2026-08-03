import { NextResponse, type NextRequest } from "next/server";

import { adminGate } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/stats — the console's overview numbers, plus housekeeping.
 *
 * Two RPCs. admin_lapse_expired_comp_chapters runs first because this route
 * is the lazy scheduler for comped-chapter expiry (0009): no pg_cron, just
 * "the console was opened", which is timely enough for licences measured in
 * school years. Then admin_stats, one jsonb of counts. The recent audit tail
 * rides along so the overview shows what the admins last did.
 */
export async function GET(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;

  const db = adminClient();

  const lapsed = await db.rpc("admin_lapse_expired_comp_chapters");
  const [stats, log] = await Promise.all([
    db.rpc("admin_stats"),
    db
      .from("admin_audit")
      .select("action, actor_email, target_email, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (stats.error) {
    return withSession(
      NextResponse.json({ ok: false, reason: "read-failed" }, { status: 503 }),
      gate.session,
    );
  }

  return withSession(
    NextResponse.json({
      ok: true,
      stats: stats.data ?? {},
      lapsedChapters: lapsed.error ? 0 : (lapsed.data ?? 0),
      audit: log.data ?? [],
    }),
    gate.session,
  );
}
