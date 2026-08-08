import { NextResponse, type NextRequest } from "next/server";

import { maskEmail, mintHandoff, readHandoff } from "@/lib/billing/handoff";
import { adminClient } from "@/lib/supabase/admin";
import { configured } from "@/lib/supabase/config";
import { attachSession, crossSite, sessionFromRequest, withSession } from "@/lib/supabase/route";
import { billingConfigured } from "@/lib/stripe/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * /api/billing/handoff — the two halves of "is this the same account?".
 *
 * POST is called by the APP, with the app's cookie, on the way out to the
 * browser: it answers a signed claim about who the app is signed in as.
 * GET is called by the BROWSER that link landed in, with the claim as `?token`:
 * it answers whether the browser is that same account.
 *
 * One file because they are one question asked from two sides, and splitting
 * them across two routes would put the mint and the check far enough apart that
 * a change to one could miss the other.
 *
 * ── Neither half is a way in ────────────────────────────────────────────────
 *
 * POST refuses anyone `/api/billing/checkout` would refuse — no session, and
 * no anonymous identity — so a token exists only for an account that could
 * have bought something anyway. GET verifies a signature and reports a
 * comparison; it sets no cookie, grants nothing, and its most generous answer
 * is a masked address. See lib/billing/handoff.ts on why this is an assertion
 * rather than a credential.
 */

interface CheckBody {
  configured: boolean;
  /** Was the token ours, and still in date? */
  valid: boolean;
  /** Is this browser signed in to any account at all? */
  signedIn: boolean;
  /** Is that account the one the app named? Null when the token said nothing. */
  match: boolean | null;
  /** The app's account, masked. Null when there is nothing to say about it. */
  account: string | null;
}

/** POST — the app asks the server to state, signed, which account it is. */
export async function POST(req: NextRequest) {
  if (crossSite(req)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
  if (!configured() || !billingConfigured()) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  const session = await sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ configured: true, signedIn: false }, { status: 200 });
  }
  // The same refusal checkout makes, for the same reason: an identity that
  // lives only in a cookie cannot own a subscription, so there is nothing here
  // worth claiming on its behalf.
  if (session.anonymous) {
    return withSession(
      NextResponse.json({ configured: true, signedIn: true, needsAccount: true }, { status: 200 }),
      session,
    );
  }

  const token = mintHandoff(session.userId);
  if (!token) {
    return withSession(NextResponse.json({ configured: false }, { status: 200 }), session);
  }

  return attachSession(
    NextResponse.json({
      configured: true,
      signedIn: true,
      token,
      // Shown by the app beside its purchase link, so a player is told which
      // account they are about to buy for BEFORE the browser opens rather than
      // being corrected by it afterwards.
      account: maskEmail(session.email),
    }),
    session,
  );
}

/** GET — the browser asks whether it is standing in the same account. */
export async function GET(req: NextRequest) {
  const answer = (body: CheckBody, session: Parameters<typeof withSession>[1] = null) =>
    withSession(NextResponse.json(body), session);

  if (!configured() || !billingConfigured()) {
    return answer({ configured: false, valid: false, signedIn: false, match: null, account: null });
  }

  const claimed = readHandoff(req.nextUrl.searchParams.get("token"));
  const session = await sessionFromRequest(req);
  const signedIn = !!session && !session.anonymous;

  if (!claimed) {
    // No claim, or one too old to act on. Reported as "nothing was said" so the
    // page falls back to the behaviour it had before this existed.
    return answer(
      { configured: true, valid: false, signedIn, match: null, account: null },
      session,
    );
  }

  const match = signedIn ? session!.userId === claimed : false;

  return answer(
    {
      configured: true,
      valid: true,
      signedIn,
      match,
      // Only when they differ, and only masked. A browser standing in the right
      // account is told nothing it does not already know, and a browser
      // standing anywhere else is told enough to recognise the account it
      // should be in and no more.
      account: match ? null : maskEmail(await emailFor(claimed)),
    },
    session,
  );
}

/**
 * The address on an account, read with the service role.
 *
 * The caller is by definition not signed in as this account — that is the
 * branch this is on — so there is no session to read it through, and the
 * profiles table does not carry an email. `admin.getUserById` is the only
 * source. A failure is null and the page simply says less.
 */
async function emailFor(userId: string): Promise<string | null> {
  try {
    const { data, error } = await adminClient().auth.admin.getUserById(userId);
    if (error) return null;
    return data.user?.email ?? null;
  } catch {
    return null;
  }
}
