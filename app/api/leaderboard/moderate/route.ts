import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { configured } from "@/lib/supabase/config";
import { MODERATOR_TOKEN } from "@/lib/leaderboard/season";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The moderation queue.
 *
 * GET  → the oldest unlisted entries, with what the blocklist thought of them.
 * POST → `{ entryId, listed, note }`, which is the only way a row goes public.
 *
 * ── Off by default, not open by default ─────────────────────────────────────
 *
 * With no `NOVUS_MODERATOR_TOKEN` set, both verbs return 404. A moderation
 * endpoint that defaults to reachable is worse than no endpoint at all: it can
 * unlist a rival's entry and — far worse — list an unreviewed one, which is the
 * single write this whole subsystem exists to put a human in front of.
 *
 * ── Why a shared token and not a role ───────────────────────────────────────
 *
 * Because the alternative is an admin account, and an admin account is a
 * password, a recovery flow and a session on a database of children. A token in
 * an environment variable is a smaller thing to hold correctly. It is also
 * plainly a stopgap: when there is more than one moderator, this becomes a role
 * on `profiles` and a policy, and the shape of the two functions below does not
 * change.
 */

/** Constant-time, and length-safe. `timingSafeEqual` throws on a length mismatch. */
function authorised(req: NextRequest): boolean {
  if (!MODERATOR_TOKEN) return false;
  const header = req.headers.get("x-novus-moderator") ?? "";
  const a = Buffer.from(header);
  const b = Buffer.from(MODERATOR_TOKEN);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** 404, not 401. An endpoint that is off should not advertise that it exists. */
const notFound = () => NextResponse.json({ ok: false }, { status: 404 });

export async function GET(req: NextRequest) {
  if (!configured() || !authorised(req)) return notFound();

  const limit = Math.min(100, Math.max(1, Number(req.nextUrl.searchParams.get("limit") ?? 50)));

  /*
   * The service role, because that is the point of this route: `board: public
   * read` restricts every other reader to `listed = true`, so the queue is
   * precisely the set of rows nobody else can see.
   */
  const { data, error } = await adminClient()
    .from("leaderboard_entries")
    .select(
      "id, board, season, company_name, founder_display_name, industry, peak_valuation, years_survived, achieved_on, reports, unlisted_at, created_at",
    )
    .eq("listed", false)
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) {
    return NextResponse.json({ ok: false, reason: "read-failed" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, queue: data ?? [] });
}

export async function POST(req: NextRequest) {
  if (!configured() || !authorised(req)) return notFound();

  let body: { entryId?: unknown; listed?: unknown; note?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad-json" }, { status: 400 });
  }

  if (typeof body.entryId !== "string" || typeof body.listed !== "boolean") {
    return NextResponse.json({ ok: false, reason: "bad-request" }, { status: 400 });
  }

  const { data, error } = await adminClient().rpc("set_entry_listed", {
    p_entry: body.entryId,
    p_listed: body.listed,
    // Why, in a moderator's words. Never shown to a player — it is a note to
    // the next moderator, and a row that was relisted once with no reason is a
    // row the next person has to make the same decision about from scratch.
    p_note: typeof body.note === "string" ? body.note.slice(0, 280) : null,
  });

  if (error) {
    return NextResponse.json({ ok: false, reason: "write-failed" }, { status: 503 });
  }

  return NextResponse.json({ ok: true, changed: data === true });
}
