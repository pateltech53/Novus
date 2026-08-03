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
  // "chapter" cuts the same public rows down to the caller's classroom and
  // re-ranks within it. Anything else — including no session to scope by —
  // is the global board.
  const scope = params.get("scope") === "chapter" ? "chapter" : "global";

  const session = await sessionFromRequest(req);

  if (scope === "chapter") {
    if (!session) {
      return NextResponse.json({ ok: false, reason: "signed-out" }, { status: 401 });
    }
    // The definer function resolves the caller's chapter itself — the request
    // names no chapter id, so there is nothing to tamper with. It returns
    // only rows that are already listed on the public board.
    const { data, error } = await session.supabase.rpc("chapter_board", {
      p_board: board,
      p_season: season,
    });
    if (error) {
      return withSession(
        NextResponse.json({ ok: false, reason: "read-failed" }, { status: 503 }),
        session,
      );
    }
    const rows = (data ?? []) as Array<Record<string, unknown> & { is_me?: boolean }>;
    const mineRow = rows.find((r) => r.is_me === true) ?? null;
    return withSession(
      NextResponse.json({
        configured: true,
        board,
        season,
        scope,
        rows: rows.map(({ is_me: _isMe, ...row }) => row),
        myHandle: (mineRow?.founder_display_name as string | undefined) ?? null,
        myRank: mineRow ? { rank: Number(mineRow.rank), total: rows.length } : null,
        myRow: mineRow ? (({ is_me: _m, ...row }) => row)(mineRow) : null,
        chapterAvailable: rows.length > 0 || (await inChapter(session)),
      }),
      session,
    );
  }

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
   *
   * `my_board_rank` (0008) is the other half: a player whose row is not in
   * the top 100 slice still learns "#147 of 2,431" — their own row, their own
   * rank, and nothing about anyone that the board does not already show.
   */
  let mine: string | null = null;
  let myRank: { rank: number; total: number } | null = null;
  let myRow: Record<string, unknown> | null = null;
  let chapterAvailable = false;
  if (session) {
    const { data: profile } = await session.supabase
      .from("profiles")
      .select("board_handle")
      .eq("id", session.userId)
      .maybeSingle();
    mine = profile?.board_handle ?? null;

    const { data: ranked } = await session.supabase.rpc("my_board_rank", {
      p_board: board,
      p_season: season,
    });
    const own = Array.isArray(ranked) && ranked.length > 0 ? (ranked[0] as Record<string, unknown>) : null;
    if (own) {
      myRank = { rank: Number(own.rank), total: Number(own.total) };
      const { rank: _r, total: _t, ...rest } = own;
      myRow = { rank: Number(own.rank), ...rest };
    }

    chapterAvailable = await inChapter(session);
  }

  return withSession(
    NextResponse.json({
      configured: true,
      board,
      season,
      scope,
      rows: data ?? [],
      myHandle: mine,
      myRank,
      myRow,
      chapterAvailable,
    }),
    session,
  );
}

/** Whether the caller belongs to (or owns) a chapter — decides if the board
 *  screen offers the MY CHAPTER scope at all. Swallows errors as "no": a
 *  project without 0007/0008 applied simply keeps the global-only screen. */
async function inChapter(session: NonNullable<Awaited<ReturnType<typeof sessionFromRequest>>>): Promise<boolean> {
  try {
    const { data } = await session.supabase.rpc("my_chapter_id");
    return typeof data === "string" && data.length > 0;
  } catch {
    return false;
  }
}
