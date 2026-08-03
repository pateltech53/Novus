import { NextResponse, type NextRequest } from "next/server";

import { configured } from "@/lib/supabase/config";
import { sessionFromRequest, withSession } from "@/lib/supabase/route";
import { ownedChapter, type SeatRow } from "@/lib/chapter/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/chapter — the admin console's one read.
 *
 * Answers "does this account run a chapter, and who is in it". Runs entirely
 * as the caller: 0007's owner-only SELECT policies are the access control, so
 * a player who owns nothing gets `chapter: null` from the same code path that
 * hands an owner their roster — there is no privileged read to protect here.
 *
 * The console polls this right after checkout lands (`?purchase=ok`), when
 * the webhook that creates the chapter may still be milliseconds behind the
 * redirect — the same race /api/billing/entitlements exists for.
 */
export async function GET(req: NextRequest) {
  if (!configured()) {
    return NextResponse.json({ configured: false, signedIn: false }, { status: 200 });
  }

  const session = await sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ configured: true, signedIn: false }, { status: 200 });
  }
  if (session.anonymous) {
    // An anonymous cookie cannot have bought a licence — checkout refuses it.
    return withSession(
      NextResponse.json({ configured: true, signedIn: true, chapter: null, members: [] }),
      session,
    );
  }

  const chapter = await ownedChapter(session);
  if (!chapter) {
    return withSession(
      NextResponse.json({ configured: true, signedIn: true, chapter: null, members: [] }),
      session,
    );
  }

  const { data: seatRows, error } = await session.supabase
    .from("chapter_seats")
    .select("email, seat_name, origin, invite_sent_at, claimed_at, created_at")
    .eq("chapter_id", chapter.id)
    .order("created_at", { ascending: true });
  if (error) {
    return withSession(
      NextResponse.json({ error: `roster: ${error.message}` }, { status: 500 }),
      session,
    );
  }

  const members: SeatRow[] = (seatRows ?? []).map((s) => ({
    email: s.email as string,
    name: (s.seat_name as string | null) ?? null,
    origin: s.origin as SeatRow["origin"],
    inviteSentAt: (s.invite_sent_at as string | null) ?? null,
    claimedAt: (s.claimed_at as string | null) ?? null,
    createdAt: s.created_at as string,
  }));

  return withSession(
    NextResponse.json({
      configured: true,
      signedIn: true,
      chapter: { ...chapter, seatsUsed: members.length },
      members,
    }),
    session,
  );
}
