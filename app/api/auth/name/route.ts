import { NextResponse, type NextRequest } from "next/server";

import { MAX_NAME_LENGTH } from "@/lib/account";
import { configured } from "@/lib/supabase/config";
import { crossSite, sessionFromRequest, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/name — name the account that has just been created.
 *
 * Body: `{ displayName, acceptedPrivacy? }`.
 *
 * ── Why a provider sign-in needs this and the email one does not ───────────
 *
 * The email form asks for a name before it asks for anything else, so
 * /api/auth/signup receives one and the account is named from the first
 * instant. Google and Apple have no such step: pressing "Continue with Google"
 * creates an account without a single field having been typed, and the name on
 * the row at that point is whatever the provider volunteered — or "Founder",
 * when it volunteered nothing, which is what Apple does for every sign-in after
 * the first.
 *
 * Neither is the player's answer. A Google account often carries a real name a
 * teenager did not choose to publish here, and this app's own convention is
 * that the name is the player's invention (components/landing/AccountGate.tsx:
 * "the name is still the player's own invention"). So a brand-new provider
 * account gets a screen, the provider's name is offered as a prefill it can
 * discard, and this route stores whatever they decide.
 *
 * ── The consent stamp ─────────────────────────────────────────────────────
 *
 * The privacy checkbox on the email form gates account CREATION, so consent is
 * given before anything exists. It cannot work that way here — the account is
 * made by the provider round trip, before we can put a checkbox in front of
 * anybody — so the checkbox moves to this screen, and its answer is recorded on
 * the row rather than only in localStorage (where lib/account.ts has always
 * kept it, and where it is one cleared browser from being no record at all).
 *
 * `accepted_privacy_at` is 0001's column for exactly this, and the admin console
 * already reads it (app/api/admin/users/[id]/route.ts). It is set once and never
 * moved: a consent record that silently re-dates itself is not a record.
 */

interface Body {
  displayName?: unknown;
  acceptedPrivacy?: unknown;
}

export async function POST(req: NextRequest) {
  if (crossSite(req)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
  if (!configured()) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const displayName =
    typeof body.displayName === "string" ? body.displayName.trim().slice(0, MAX_NAME_LENGTH) : "";

  if (!displayName) {
    return NextResponse.json({ error: "Enter a name." }, { status: 400 });
  }

  const session = await sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ configured: true, signedIn: false }, { status: 401 });
  }

  /*
   * Written under the player's own session, never the service role.
   *
   * "profiles: update own" (0001) is what decides this, which means the route
   * has no way to name somebody else's account even if it were asked to — the
   * same reasoning /api/auth/reset/confirm gives for writing the invited name
   * that way.
   */
  const { error } = await session.supabase
    .from("profiles")
    .update({ display_name: displayName })
    .eq("id", session.userId);

  if (error) {
    return withSession(
      NextResponse.json({ error: "Could not save that name. Try again." }, { status: 500 }),
      session,
    );
  }

  if (body.acceptedPrivacy === true) {
    /*
     * Only onto a row that has no stamp yet — `is null` in the filter rather
     * than a read-then-write, so two requests racing cannot both decide they
     * are the first. A failure here is not worth losing a saved name over: the
     * account works and the device-local stamp still exists.
     */
    await session.supabase
      .from("profiles")
      .update({ accepted_privacy_at: new Date().toISOString() })
      .eq("id", session.userId)
      .is("accepted_privacy_at", null);
  }

  return withSession(
    NextResponse.json({ configured: true, signedIn: true, displayName, email: session.email }),
    session,
  );
}
