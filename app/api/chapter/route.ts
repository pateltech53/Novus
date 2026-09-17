import { NextResponse, type NextRequest } from "next/server";

import { configured } from "@/lib/supabase/config";
import { crossSite, sessionFromRequest, withSession } from "@/lib/supabase/route";
import { ownedChapter, type SeatRow } from "@/lib/chapter/admin";
import { validateChapterProfile } from "@/lib/chapter/profile";
import { isUuid } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { cancelChapterSubscription } from "@/lib/stripe/chapter";
import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";

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

/**
 * Writes name the exact enterprise currently on screen, then prove ownership
 * through RLS again. A second tab cannot redirect a stale edit or deletion to
 * the owner's newer enterprise. Deletion keeps only a billing tombstone so a
 * delayed Stripe event cannot restore seats after the owner removed them.
 */
export async function PATCH(req: NextRequest) {
  return mutate(req, "profile");
}

export async function DELETE(req: NextRequest) {
  return mutate(req, "delete");
}

async function mutate(req: NextRequest, action: "profile" | "delete") {
  if (crossSite(req)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
  if (!configured()) return NextResponse.json({ error: "Not available." }, { status: 404 });
  const session = await sessionFromRequest(req);
  const reply = (body: Record<string, unknown>, status = 200) =>
    withSession(NextResponse.json(body, { status }), session);
  if (!session || session.anonymous) return reply({ error: "Not available." }, 404);
  if (!SUPABASE_SERVICE_ROLE_KEY) return reply({ error: "Enterprise management is not configured." }, 503);

  let body: { chapterId?: unknown; profile?: unknown; confirmation?: unknown };
  try {
    body = await req.json();
  } catch {
    return reply({ error: "Invalid request." }, 400);
  }
  if (!body || !isUuid(body.chapterId)) return reply({ error: "Choose an enterprise." }, 400);
  if (action === "delete" && body.confirmation !== "DELETE") {
    return reply({ error: "Type DELETE to confirm enterprise deletion." }, 400);
  }

  const { data: chapter, error: readError } = await session.supabase
    .from("chapters")
    .select("id, owner_profile_id, source, stripe_subscription_id, deleted_at")
    .eq("id", body.chapterId)
    .eq("owner_profile_id", session.userId)
    .maybeSingle();
  if (readError) return reply({ error: "Could not load the enterprise. Try again." }, 503);
  if (!chapter) return reply({ error: "Not available." }, 404);
  if (chapter.deleted_at) {
    return action === "delete" ? reply({ ok: true }) : reply({ error: "Not available." }, 404);
  }

  const db = adminClient();
  if (action === "profile") {
    const result = validateChapterProfile(body.profile);
    if (!result.ok) return reply({ error: result.error }, 400);
    const { profile } = result;
    const { data, error } = await db.from("chapters")
      .update({ name: profile.name, organization_type: profile.organizationType,
        contact_name: profile.contactName, contact_email: profile.contactEmail })
      .eq("id", chapter.id)
      .eq("owner_profile_id", session.userId)
      .is("deleted_at", null)
      .select("id")
      .maybeSingle();
    if (error) return reply({ error: "Could not save enterprise details. Try again." }, 503);
    return data ? reply({ ok: true }) : reply({ error: "Not available." }, 404);
  }

  // Cancel before revoking: a processor failure must leave a manageable
  // enterprise, not an invisible subscription that continues billing. A DB
  // failure after cancellation is safe to retry; cancelled subscriptions are
  // accepted and the deletion RPC is itself idempotent.
  try {
    await cancelChapterSubscription(chapter.stripe_subscription_id as string | null);
  } catch {
    return reply({ error: "Could not confirm cancellation of this enterprise subscription. Nothing was deleted. Try again or contact support." }, 502);
  }
  const { data: deleted, error: deleteError } = await db.rpc("delete_chapter", { p_chapter: chapter.id });
  if (deleteError || deleted !== true) {
    return reply({ error: "Billing has stopped, but enterprise deletion could not finish. Please retry." }, 503);
  }
  return reply({ ok: true });
}
