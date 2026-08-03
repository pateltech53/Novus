import { NextResponse, type NextRequest } from "next/server";

import { createClient } from "@supabase/supabase-js";

import { SUPABASE_ANON_KEY, SUPABASE_URL, configured } from "@/lib/supabase/config";
import { sessionFromRequest, withSession } from "@/lib/supabase/route";
import { isBoard } from "@/lib/leaderboard/boards";
import { SEASON } from "@/lib/leaderboard/season";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE = 100;

/**
 * GET /api/leaderboard?board=survival&season=2026-Q3 — the top 100.
 *
 * ── Why this route uses the ANON key ────────────────────────────────────────
 *
 * Because reading a board is exactly what the anon key is allowed to do, and
 * nothing more. 0002 revokes everything on `leaderboard_entries` from `anon`
 * and grants back `select`, behind a policy of `using (listed = true)`. So an
 * unmoderated entry is invisible on this path even if this file forgot to
 * filter for it — which is the point of writing the policy before the UI.
 *
 * The service role is deliberately absent. It bypasses RLS entirely, and a
 * read route holding it would publish the moderation queue the first time
 * somebody added a column to a select.
 *
 * ── Why the browser never calls Supabase itself ─────────────────────────────
 *
 * Every call is browser → our own Route Handler → Supabase. No new network
 * origin, no third-party cookie, no Google-side identifier on a product for
 * minors, and no analytics SDK anywhere near the board screen
 * (docs/LEADERBOARD.md §1.4, §9.6).
 */
export async function GET(req: NextRequest) {
  if (!configured()) {
    return NextResponse.json({ configured: false, board: [], season: SEASON });
  }

  const params = req.nextUrl.searchParams;
  const board = params.get("board") ?? "survival";
  if (!isBoard(board)) {
    return NextResponse.json({ ok: false, reason: "unknown-board" }, { status: 400 });
  }
  const season = params.get("season") ?? SEASON;

  const anon = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  /*
   * The views, not the table.
   *
   * `board_survival` and `board_valuation` compute `rank` with `row_number()`
   * over the ordering the partial indexes are built on. There is no rank
   * column, so there is nothing to write, buy or boost — that is Brand Law 4
   * expressed as a schema rather than as a promise (§8.1).
   *
   * Both views are `security_invoker = on`. Without it a view runs as its owner
   * and silently bypasses the RLS underneath, which would turn the read policy
   * into decoration.
   */
  const view = board === "survival" ? "board_survival" : "board_valuation";
  const { data, error } = await anon
    .from(view)
    .select("*")
    .eq("season", season)
    .order("rank", { ascending: true })
    .limit(PAGE);

  if (error) {
    return NextResponse.json({ ok: false, reason: "read-failed" }, { status: 503 });
  }

  /*
   * "Which of these is mine?" — answered without publishing anything.
   *
   * A player wants to find their own row, and the board carries no identifier
   * they could match on: the handle is the only name, and two players can pick
   * the same words in different seasons. So the profile's own handle is looked
   * up from their session and returned separately, and the screen highlights
   * the row that matches. Nothing about anybody else is disclosed by that,
   * because the handle was already on the page.
   */
  const session = await sessionFromRequest(req);
  let mine: string | null = null;
  if (session) {
    const { data: profile } = await session.supabase
      .from("profiles")
      .select("board_handle")
      .eq("id", session.userId)
      .maybeSingle();
    mine = profile?.board_handle ?? null;
  }

  return withSession(
    NextResponse.json({
      configured: true,
      board,
      season,
      rows: data ?? [],
      myHandle: mine,
    }),
    session,
  );
}
