import { NextResponse, type NextRequest } from "next/server";

import { hashString } from "@/lib/engine/rng";
import { handleShuffle, isPoolHandle } from "@/lib/leaderboard/handles";
import { configured } from "@/lib/supabase/config";
import { crossSite, sessionFromRequest, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The board handle — offered, then chosen, and changeable afterwards.
 *
 * GET  → eight options from the curated pool, plus whichever one is held now.
 * POST → claims one, if it is in the pool and nobody else holds it.
 *
 * The player never types this. `RunState.founderName` is what they typed when
 * they founded the company, and for a nine-year-old that is their first name,
 * often their full one — publishing it beside a company name that might
 * identify a school is the exact pattern COPPA exists to prevent (§9.2). So the
 * only name that reaches a public board is assembled from a word list, and this
 * route is the only way one is set.
 *
 * ── Choosing, rather than being assigned ────────────────────────────────────
 *
 * Picking from a word list is the constraint; picking ONE OF SIX AND ONLY ONCE
 * was not. The shuffle was seeded on the profile and the day, so a player who
 * disliked all six had no move but to wait until tomorrow, and the screen only
 * ever offered the picker when a submission was refused for want of a name —
 * which made the first six feel assigned rather than chosen.
 *
 * `?shuffle=n` is the fix and the whole of it: the nonce joins the seed, so
 * each press of SHUFFLE deals a fresh hand out of ~14 million while staying
 * seeded (a reload mid-choice still returns the hand they were looking at, and
 * luck that cannot be retold is luck that cannot be debugged). The pool itself
 * is unchanged, POST still validates against the word LISTS, and a rename
 * carries across the rows the player already holds — 0016's trigger, because
 * `leaderboard_entries.founder_display_name` is a copy.
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
   * Seeded on the profile, the day, and the shuffle nonce.
   *
   * A player who reloads mid-choice gets the same hand back rather than losing
   * the name they were about to take; a player who comes back tomorrow gets a
   * fresh one without asking; and a player who dislikes all eight presses
   * SHUFFLE and gets another eight now. Seeded rather than random for the
   * reason every draw in this codebase is: luck that cannot be retold is luck
   * that cannot be debugged.
   */
  const day = new Date().toISOString().slice(0, 10);
  /*
   * The shuffle nonce. Any string the client cares to send, clamped to
   * something that cannot become a denial-of-service by being a megabyte long;
   * it only ever joins a hash. Absent means the day's own hand, which is what
   * a first visit gets.
   */
  const nonce = (req.nextUrl.searchParams.get("shuffle") ?? "").slice(0, 32);
  const options = handleShuffle(hashString(`${session.userId}:${day}:${nonce}`), 8);

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
