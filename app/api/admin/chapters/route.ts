import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit, isUuid } from "@/lib/admin/guard";
import { CHAPTER_LICENCES } from "@/lib/monetization";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/admin/chapters — enterprise, without the card.
 *
 * POST   `{ ownerProfileId, licence, until? }` mints a comped chapter via
 *        admin_create_comp_chapter (0009): a real `chapters` row with no
 *        Stripe subscription behind it. The owner's /chapter page becomes a
 *        live console the moment this returns — seats, invites, the cap, all
 *        of 0007 unchanged.
 * DELETE `{ chapterId }` lapses a comp chapter: roster kept, seats dark —
 *        the webhook's own lapse shape. Paid chapters are refused; those
 *        lapse through Stripe or not at all, so the row and Stripe's next
 *        event can never disagree.
 */

const LICENCES: readonly string[] = CHAPTER_LICENCES.map((l) => l.id);

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { ownerProfileId?: unknown; licence?: unknown; until?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  if (
    !isUuid(body.ownerProfileId) ||
    typeof body.licence !== "string" ||
    !LICENCES.includes(body.licence)
  ) {
    return withSession(bad(400, "ownerProfileId and a real licence are required"), gate.session);
  }

  let until: string | null = null;
  if (body.until != null && body.until !== "") {
    if (typeof body.until !== "string" || Number.isNaN(Date.parse(body.until))) {
      return withSession(bad(400, "until is not a date"), gate.session);
    }
    until = new Date(body.until).toISOString();
  }

  const db = adminClient();
  const [profile, account] = await Promise.all([
    db.from("profiles").select("id").eq("id", body.ownerProfileId).maybeSingle(),
    db.auth.admin.getUserById(body.ownerProfileId),
  ]);
  if (!profile.data) {
    return withSession(bad(404, "no such account"), gate.session);
  }

  const { data, error } = await db.rpc("admin_create_comp_chapter", {
    p_owner: body.ownerProfileId,
    p_licence: body.licence,
    p_until: until,
  });
  if (error) {
    // The function's own refusals, translated to the console's vocabulary.
    if (error.message.includes("already owns an active chapter")) {
      return withSession(bad(409, "that account already owns an active chapter"), gate.session);
    }
    return withSession(bad(503, `chapter grant failed: ${error.message}`), gate.session);
  }

  await audit(gate.session, "chapter_comp_grant", {
    target: body.ownerProfileId,
    targetEmail: account.data?.user?.email ?? null,
    detail: { licence: body.licence, until, chapterId: data },
  });

  return withSession(NextResponse.json({ ok: true, chapterId: data }), gate.session);
}

export async function DELETE(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { chapterId?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  if (!isUuid(body.chapterId)) {
    return withSession(bad(400, "chapterId is required"), gate.session);
  }

  const db = adminClient();
  const { data, error } = await db.rpc("admin_revoke_comp_chapter", {
    p_chapter: body.chapterId,
  });
  if (error) {
    return withSession(bad(503, `chapter revoke failed: ${error.message}`), gate.session);
  }
  if (data !== true) {
    return withSession(
      bad(404, "no active comped chapter with that id — paid licences lapse through Stripe"),
      gate.session,
    );
  }

  await audit(gate.session, "chapter_comp_revoke", {
    detail: { chapterId: body.chapterId },
  });

  return withSession(NextResponse.json({ ok: true }), gate.session);
}
