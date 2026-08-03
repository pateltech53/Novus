import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/moderation — the board queue, inside the console.
 *
 * The same two operations as /api/leaderboard/moderate — the oldest unlisted
 * entries, and the one write that makes a row public — authorised by the
 * admin role instead of the env-var token. That route stays for curl and CI;
 * this one exists so moderation is a screen rather than a header. Both end
 * at set_entry_listed (0006), so there is exactly one way a row goes live no
 * matter which door was used.
 */

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function GET(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50) || 50));

  const { data, error } = await adminClient()
    .from("leaderboard_entries")
    .select(
      "id, board, season, company_name, founder_display_name, industry, peak_valuation, years_survived, achieved_on, reports, unlisted_at, created_at",
    )
    .eq("listed", false)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return withSession(bad(503, "read failed"), gate.session);
  }

  return withSession(NextResponse.json({ ok: true, queue: data ?? [] }), gate.session);
}

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { entryId?: unknown; listed?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  if (typeof body.entryId !== "string" || typeof body.listed !== "boolean") {
    return withSession(bad(400, "entryId and listed are required"), gate.session);
  }

  const { data, error } = await adminClient().rpc("set_entry_listed", {
    p_entry: body.entryId,
    p_listed: body.listed,
    p_note: typeof body.note === "string" ? body.note.slice(0, 280) : null,
  });

  if (error) {
    return withSession(bad(503, "write failed"), gate.session);
  }

  await audit(gate.session, body.listed ? "board_list" : "board_unlist", {
    detail: { entryId: body.entryId, note: typeof body.note === "string" ? body.note.slice(0, 280) : null },
  });

  return withSession(NextResponse.json({ ok: true, changed: data === true }), gate.session);
}
