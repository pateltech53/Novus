import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { configured } from "@/lib/supabase/config";
import { crossSite, sessionFromRequest, withSession } from "@/lib/supabase/route";
import { callerKey, throttle } from "@/lib/auth/throttle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leaderboard/report — one click, and the row comes down.
 *
 * docs/LEADERBOARD.md §9.3 asks for "a report control on every board row, and a
 * path that unlists in one click and asks questions after". This is that path,
 * and it means what it says: the entry is unlisted immediately, before anybody
 * has looked at it.
 *
 * ── Why it is deliberately easy to abuse ────────────────────────────────────
 *
 * Because the two failure modes are not symmetrical. A false report hides a
 * legitimate entry until a moderator reads `reports` and `unlisted_at` and
 * calls `set_entry_listed(id, true)` — an inconvenience, and a recoverable one.
 * A slow report leaves a child's phone number, or their school's name, on a
 * public page for as long as it takes somebody to notice.
 *
 * For a product for minors that is not a close call. Every mechanism in this
 * file errs toward the row coming down.
 *
 * ── What a reporter is not asked for ────────────────────────────────────────
 *
 * A reason, a category, or a description. Free text here would be a second
 * moderation queue, written by whoever is angriest, attached to somebody
 * else's row. The entry id is the whole report.
 */
export async function POST(req: NextRequest) {
  if (crossSite(req)) {
    return NextResponse.json({ ok: false, reason: "cross-site" }, { status: 403 });
  }
  if (!configured()) {
    return NextResponse.json({ ok: false, reason: "not-configured" }, { status: 503 });
  }

  /*
   * A session is required, and nothing about it is stored.
   *
   * Not to identify the reporter — the report carries no author and never will
   * — but because an unauthenticated endpoint that unlists a row by id is a
   * script that empties the board in one loop.
   */
  const session = await sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, reason: "signed-out" }, { status: 401 });
  }

  /*
   * A session is NOT a rate limit — one account can loop through every id the
   * board discloses and unlist the lot. So the report is actually metered, per
   * account and per address. A real reporter flags a handful of names; these
   * ceilings sit far above that and far below "blank the board", and every
   * report stays recoverable (a moderator relists) and logged for review.
   * Fails open when the throttle store is unconfigured — same contract the auth
   * routes keep.
   */
  const limited = await throttle([
    { bucket: "board_report:profile", key: session.userId, limit: 25, windowMinutes: 60 },
    { bucket: "board_report:ip", key: callerKey(req), limit: 50, windowMinutes: 60 },
  ]);
  if (!limited.allowed) {
    return withSession(
      NextResponse.json({ ok: false, reason: "rate-limited" }, { status: 429 }),
      session,
    );
  }

  let entryId: unknown;
  try {
    entryId = ((await req.json()) as { entryId?: unknown }).entryId;
  } catch {
    return withSession(
      NextResponse.json({ ok: false, reason: "bad-json" }, { status: 400 }),
      session,
    );
  }

  if (typeof entryId !== "string" || !/^[0-9a-f-]{36}$/i.test(entryId)) {
    return withSession(
      NextResponse.json({ ok: false, reason: "bad-id" }, { status: 400 }),
      session,
    );
  }

  const { data, error } = await adminClient().rpc("report_board_entry", {
    p_entry: entryId,
  });

  if (error) {
    return withSession(
      NextResponse.json({ ok: false, reason: "report-failed" }, { status: 503 }),
      session,
    );
  }

  /*
   * The same answer whether or not the row existed.
   *
   * A 404 here would turn this into an oracle for which entry ids are real,
   * which is a small thing on its own and a free enumeration primitive next to
   * a table about children. It also spares a reporter the experience of being
   * told their report did not count.
   */
  return withSession(
    NextResponse.json({
      ok: true,
      removed: data === true,
      message: "Thanks. That entry is off the board while a person looks at it.",
    }),
    session,
  );
}
