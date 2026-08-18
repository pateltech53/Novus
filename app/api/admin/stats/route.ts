import { NextResponse, type NextRequest } from "next/server";

import { adminGate } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/stats — the console's overview, charts data, housekeeping.
 *
 * Housekeeping first, because this route is the lazy scheduler for two
 * things (0009/0010): admin_lapse_expired_comp_chapters flips overdue comped
 * licences, and admin_capture_daily writes today's row of counts — the
 * series the actives/runs chart builds itself from, one console visit at a
 * time. Then the reads: the stats blob, the per-day series (?days=, 14–180),
 * the weekly cohorts, the audit tail, and 0016's two lists — the billing
 * records that disagree with each other, and the companies worth looking at.
 *
 * The two 0016 reads are `error ? [] : data`, like the series and cohorts
 * already were: a console that shows nothing because one optional band's
 * function is not deployed yet is worse than a console with one empty band.
 * `stats` is the exception and stays fatal — it IS the page.
 */
export async function GET(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;

  const days = Math.min(180, Math.max(14, Number(req.nextUrl.searchParams.get("days") ?? 60) || 60));

  const db = adminClient();

  // Sequential on purpose: the snapshot must land before the series reads it,
  // or today's actives would be null on the console's very first load.
  const lapsed = await db.rpc("admin_lapse_expired_comp_chapters");
  await db.rpc("admin_capture_daily");

  const [stats, series, cohorts, mismatches, companies, log] = await Promise.all([
    db.rpc("admin_stats"),
    db.rpc("admin_timeseries", { p_days: days }),
    db.rpc("admin_cohorts", { p_weeks: 12 }),
    db.rpc("admin_billing_mismatches", { p_limit: 50 }),
    db.rpc("admin_top_companies", { p_limit: 12 }),
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
      series: series.error ? [] : (series.data ?? []),
      cohorts: cohorts.error ? [] : (cohorts.data ?? []),
      mismatches: mismatches.error ? [] : (mismatches.data ?? []),
      topCompanies: companies.error ? [] : (companies.data ?? []),
      lapsedChapters: lapsed.error ? 0 : (lapsed.data ?? 0),
      audit: log.data ?? [],
    }),
    gate.session,
  );
}
