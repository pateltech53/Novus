import { NextResponse, type NextRequest } from "next/server";

import { crossSite, clearSession, sessionFromRequest } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/signout — end the session on this device.
 *
 * Two things happen, in this order, and the order is the point:
 *
 * 1. Supabase is asked to revoke the refresh token, so it cannot be replayed
 *    even if a copy was captured.
 * 2. The cookie is cleared regardless of whether step 1 worked.
 *
 * Step 2 is unconditional because of where this app is used. A classroom
 * machine passed to the next student must not stay signed in because Supabase
 * was briefly unreachable — a local sign-out that always succeeds is worth
 * more than a remote revocation that sometimes does. The failure mode of
 * clearing without revoking is a token that expires on its own; the failure
 * mode of the reverse is the next child inheriting an account.
 */
export async function POST(req: NextRequest) {

  // Not from our own pages. See crossSite() — a cross-site form post is not
  // preflighted, and req.json() parses the body whatever type it claims.
  if (crossSite(req)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
  const session = await sessionFromRequest(req);

  if (session) {
    try {
      // `local` scope: revoke just this refresh token, not every device the
      // player owns. Signing out of a school iPad should not sign them out of
      // their own phone.
      await session.supabase.auth.signOut({ scope: "local" });
    } catch {
      // Deliberately swallowed — see above. The cookie still goes.
    }
  }

  return clearSession(NextResponse.json({ signedOut: true }));
}
