import { NextResponse, type NextRequest } from "next/server";

import { configured } from "@/lib/supabase/config";
import { attachSession, sessionFromRequest } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/me — who is signed in on this device.
 *
 * Three answers, and the screens care about all three:
 *
 *   { configured: false }                   no Supabase project; local play only
 *   { signedIn: true, anonymous: true }     playing, but nothing to sign back into
 *   { signedIn: true, anonymous: false }    a real account, with an email
 *
 * The middle one is the interesting case. An anonymous player is signed in as
 * far as the database is concerned — RLS sees a real user and their saves sync
 * — but they have no way back if the cookie goes. That is why `anonymous` is
 * reported separately from `signedIn` rather than collapsed into one boolean:
 * the front door needs to offer them an account, and checkout needs to refuse
 * them (app/api/billing/checkout/route.ts).
 */
export async function GET(req: NextRequest) {
  if (!configured()) {
    return NextResponse.json({ configured: false, signedIn: false, anonymous: false });
  }

  // Deliberately does NOT mint a session. This route answers a question; it
  // does not create the thing it is asked about.
  const session = await sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ configured: true, signedIn: false, anonymous: false });
  }

  const { data } = await session.supabase
    .from("profiles")
    .select("display_name")
    .eq("id", session.userId)
    .maybeSingle();

  return attachSession(
    NextResponse.json({
      configured: true,
      signedIn: true,
      anonymous: session.anonymous,
      email: session.email,
      displayName: data?.display_name ?? null,
    }),
    session,
  );
}
