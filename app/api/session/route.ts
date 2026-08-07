import { NextResponse, type NextRequest } from "next/server";

import { configured } from "@/lib/supabase/config";
import { attachSession, crossSite, sessionFromRequest } from "@/lib/supabase/route";

export const runtime = "nodejs";
// Sessions are per-player state; caching this would hand one player's identity
// to the next visitor.
export const dynamic = "force-dynamic";

/**
 * POST /api/session — refresh this device's session, if it has one.
 *
 * ── This route used to MINT an identity. It no longer does. ────────────────
 *
 * It called `sessionOrCreate`, so the first page load of every visitor created
 * an anonymous Supabase user and began syncing their saves — whether or not
 * they ever wanted an account, and whether or not they ever came back.
 *
 * That made sense when anonymous auth was the only identity there was. With
 * real accounts it stopped making sense in two directions at once:
 *
 *   · **It was worth almost nothing to the player.** An anonymous identity
 *     lives entirely in a cookie. Clearing browser data clears the cookie and
 *     localStorage together, so the "backup" died in exactly the case a backup
 *     is for. It could not be reached from another device, and there was no
 *     way to sign back into it.
 *   · **It cost a permanent row about a child.** One auth user, one profile,
 *     and every company they played, retained indefinitely, for every visitor
 *     who ever opened the page. 0001's header is explicit that the cheapest
 *     way to handle a child's personal information is not to have any.
 *
 * So a player with no account now sends nothing at all: no user is created, no
 * save leaves the device, and the game runs on localStorage exactly as it does
 * on a deploy with no Supabase configured. That path was always supported and
 * is now the default until someone chooses otherwise. The privacy policy says
 * this plainly, and can only say it because of this file.
 *
 * Signing up or signing in is what creates an identity — deliberately, by a
 * person, in exchange for something they can actually use.
 */
export async function POST(req: NextRequest) {
  // Not from our own pages. See crossSite() — a cross-site form post is not
  // preflighted, and req.json() parses the body whatever type it claims.
  if (crossSite(req)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }

  if (!configured()) {
    return NextResponse.json({ configured: false, signedIn: false });
  }

  const session = await sessionFromRequest(req);
  if (!session) {
    // No cookie, or an expired one. A completely normal state — it is what
    // every visitor without an account looks like.
    return NextResponse.json({ configured: true, signedIn: false });
  }

  // The profile row is the anchor for every other table's foreign key. It is
  // written at sign-up, but this repairs the case where that failed midway, or
  // where the account was made outside the app.
  const { error } = await session.supabase
    .from("profiles")
    .upsert(
      { id: session.userId, display_name: "Founder" },
      { onConflict: "id", ignoreDuplicates: true },
    );

  if (error) {
    // The profile write failed, but the session itself is valid — and
    // sessionFromRequest already SPENT the cookie's refresh token. Re-attach the
    // rotated one, or a transient DB error on this boot-time repair path would
    // silently sign the player out on their next request. The player IS signed
    // in; only the profile repair did not land.
    return attachSession(
      NextResponse.json(
        { configured: true, signedIn: true, anonymous: session.anonymous, reason: error.message },
        { status: 200 },
      ),
      session,
    );
  }

  return attachSession(
    NextResponse.json({ configured: true, signedIn: true, anonymous: session.anonymous }),
    session,
  );
}
