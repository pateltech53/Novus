import { NextResponse, type NextRequest } from "next/server";

import { hashString } from "@/lib/engine/rng";
import { handleShuffle, isPoolHandle } from "@/lib/leaderboard/handles";
import { configured } from "@/lib/supabase/config";
import { crossSite, sessionFromRequest, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The board handle — offered, then claimed.
 *
 * GET  → six options from the curated pool.
 * POST → claims one, if it is in the pool and nobody else holds it.
 *
 * The player never types this. `RunState.founderName` is what they typed when
 * they founded the company, and for a nine-year-old that is their first name,
 * often their full one — publishing it beside a company name that might
 * identify a school is the exact pattern COPPA exists to prevent (§9.2). So the
 * only name that reaches a public board is assembled from a word list, and this
 * route is the only way one is set.
 */

export async function GET(req: NextRequest) {
  if (!configured()) {
    return NextResponse.json({ ok: false, reason: "not-configured" }, { status: 503 });
  }
  const session = await sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, reason: "signed-out" }, { status: 401 });
  }

  const { data: profile } = await session.supabase
    .from("profiles")
    .select("board_handle")
    .eq("id", session.userId)
    .maybeSingle();

  /*
   * Seeded on the profile and the day.
   *
   * A player who reloads mid-choice gets the same six back rather than losing
   * the one they were about to take, and a player who comes back tomorrow gets
   * a fresh shuffle rather than the same six forever. Seeded rather than random
   * for the reason every draw in this codebase is: luck that cannot be retold
   * is luck that cannot be debugged.
   */
  const day = new Date().toISOString().slice(0, 10);
  const options = handleShuffle(hashString(`${session.userId}:${day}`), 6);

  return withSession(
    NextResponse.json({ ok: true, current: profile?.board_handle ?? null, options }),
    session,
  );
}

export async function POST(req: NextRequest) {
  if (crossSite(req)) {
    return NextResponse.json({ ok: false, reason: "cross-site" }, { status: 403 });
  }
  if (!configured()) {
    return NextResponse.json({ ok: false, reason: "not-configured" }, { status: 503 });
  }
  const session = await sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ ok: false, reason: "signed-out" }, { status: 401 });
  }

  let handle: unknown;
  try {
    handle = ((await req.json()) as { handle?: unknown }).handle;
  } catch {
    return withSession(
      NextResponse.json({ ok: false, reason: "bad-json" }, { status: 400 }),
      session,
    );
  }

  /*
   * Validated against the word LIST, not just the regex.
   *
   * `Zzzz Qqqq 0000` matches `^[A-Z][a-z]+ [A-Z][a-z]+ [0-9]{4}$` and so does
   * `Sarah Mitchell 1998`. A handle that only has to match the shape is free
   * text on a public board wearing a costume, which is the one thing this whole
   * mechanism exists to prevent — so membership in both pools is the check, and
   * the database constraint is the belt to this suspenders.
   */
  if (typeof handle !== "string" || !isPoolHandle(handle)) {
    return withSession(
      NextResponse.json({ ok: false, reason: "not-in-pool" }, { status: 422 }),
      session,
    );
  }

  /*
   * Written as the player, through RLS.
   *
   * `profiles: rename own` in 0001 restricts this to `id = auth.uid()`, so
   * there is no code path in this file that can rename somebody else — not
   * because it filters correctly, but because it could not succeed if it did
   * not. The service role is deliberately absent here for that reason.
   */
  const { error } = await session.supabase
    .from("profiles")
    .update({ board_handle: handle })
    .eq("id", session.userId);

  if (error) {
    // 23505 on `profiles_board_handle_key`: somebody already has it. Two
    // players shuffling at the same moment is a normal race over a space of
    // ~14 million, not a failure worth an apology.
    if (error.code === "23505") {
      return withSession(
        NextResponse.json({ ok: false, reason: "taken" }, { status: 409 }),
        session,
      );
    }
    return withSession(
      NextResponse.json({ ok: false, reason: "write-failed" }, { status: 500 }),
      session,
    );
  }

  return withSession(NextResponse.json({ ok: true, handle }), session);
}
