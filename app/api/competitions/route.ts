import { NextResponse, type NextRequest } from "next/server";
import { account, manager, answer } from "@/lib/competitions/server";
import { adminClient } from "@/lib/supabase/admin";
import { parseCompetition } from "@/lib/competitions/rules";
import { isUuid } from "@/lib/admin/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const session = await account(req);
  if (session instanceof NextResponse) return session;
  const db = adminClient();
  const chapterId = req.nextUrl.searchParams.get("chapterId");
  let scope: string;
  let isManager = false;
  if (chapterId) {
    const { managedChapter } = await import("@/lib/chapter/admin");
    const ch = await managedChapter(session, chapterId);
    if (!ch)
      return answer(session, { error: "Enterprise is unavailable." }, 404);
    scope = ch.id;
    isManager = true;
  } else {
    const { data: seat, error } = await db
      .from("chapter_seats")
      .select("chapter_id, chapters!inner(deleted_at,status)")
      .eq("profile_id", session.userId)
      .is("chapters.deleted_at", null)
      .maybeSingle();
    if (error)
      return answer(session, { error: "Could not load competitions." }, 503);
    if (!seat)
      return answer(session, {
        competitions: [],
        serverNow: new Date().toISOString(),
      });
    scope = seat.chapter_id;
  }
  const id = req.nextUrl.searchParams.get("id");
  let query = db
    .from("chapter_competitions")
    .select("*, competition_prizes(place,kind,quantity,tier)")
    .eq("chapter_id", scope)
    .order("starts_at", { ascending: false })
    .limit(100);
  if (id) query = query.eq("id", id);
  const { data, error } = await query;
  if (error)
    return answer(session, { error: "Could not load competitions." }, 503);
  const ids = (data ?? []).map((c) => c.id);
  if (!ids.length)
    return answer(session, {
      competitions: [],
      serverNow: new Date().toISOString(),
    });
  const [audiences, joined] = await Promise.all([
    db
      .from("competition_audience")
      .select("competition_id")
      .eq("profile_id", session.userId)
      .in("competition_id", ids),
    db
      .from("competition_participants")
      .select("competition_id,joined_at")
      .eq("profile_id", session.userId)
      .in("competition_id", ids),
  ]);
  if (audiences.error || joined.error)
    return answer(session, { error: "Could not load eligibility." }, 503);
  const allowed = new Set((audiences.data ?? []).map((a) => a.competition_id));
  const competitions = (data ?? [])
    .filter((c) => isManager || c.audience === "all" || allowed.has(c.id))
    .map((c) => ({
      ...c,
      joinedAt:
        joined.data?.find((j) => j.competition_id === c.id)?.joined_at ?? null,
    }));
  if (id && competitions.length) {
    const { data: board, error: boardError } = await db.rpc(
      "competition_leaderboard",
      { p_competition: id, p_viewer: session.userId },
    );
    if (boardError)
      return answer(session, { error: "Could not load leaderboard." }, 503);
    return answer(session, {
      competitions,
      board,
      serverNow: new Date().toISOString(),
    });
  }
  return answer(session, { competitions, serverNow: new Date().toISOString() });
}
export async function POST(req: NextRequest) {
  const session = await account(req);
  if (session instanceof NextResponse) return session;
  let body;
  try {
    body = await req.json();
  } catch {
    return answer(session, { error: "Invalid request." }, 400);
  }
  if (body?.action === "join" && isUuid(body.id)) {
    const { error } = await adminClient().rpc("join_chapter_competition", {
      p_profile: session.userId,
      p_competition: body.id,
    });
    return answer(
      session,
      error ? { error: error.message } : { ok: true },
      error ? 409 : 200,
    );
  }
  const auth = await manager(req, session);
  if (auth instanceof NextResponse) return auth;
  let spec;
  try {
    spec = parseCompetition(body);
  } catch (e) {
    return answer(session, { error: (e as Error).message }, 400);
  }
  const { data, error } = await auth.db.rpc("create_chapter_competition", {
    p_chapter: auth.chapter.id,
    p_actor: session.userId,
    p_spec: spec,
  });
  return answer(
    session,
    error ? { error: error.message } : { ok: true, id: data },
    error ? 409 : 200,
  );
}
