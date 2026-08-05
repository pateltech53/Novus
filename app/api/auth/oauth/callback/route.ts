import { NextResponse, type NextRequest } from "next/server";

import { ensureProfile } from "@/lib/auth/oauth-profile";
import { OAUTH_COOKIE_OPTIONS, OAUTH_VERIFIER_COOKIE, configured } from "@/lib/supabase/config";
import { PKCE_FLOW_ID_PARAM, attachSession, exchangeOAuthCode } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/oauth/callback — where Google and Apple send the player back.
 *
 * ── Why the session is minted here and not in the page ─────────────────────
 *
 * Because this app's whole authentication story is that the token never touches
 * JavaScript. With the PKCE flow the provider returns a short-lived `?code=` in
 * the QUERY string, which — unlike the `#fragment` the recovery links use — does
 * reach a server. So the exchange happens here, the refresh token goes straight
 * into the httpOnly cookie, and the page that renders next learns who it is by
 * asking /api/auth/me like every other screen. Nothing sensitive is ever in the
 * document.
 *
 * That is the one real advantage over the implicit flow, and it is the reason
 * this route exists rather than a second copy of components/AuthHashRelay.tsx.
 *
 * ── What this route deliberately does not do ───────────────────────────────
 *
 * It does not touch localStorage, because it cannot, and localStorage is where
 * the consequential half of a sign-in happens on the machines this app runs on
 * — a shared classroom device whose companies belong to whoever was here
 * before. So it hands off: `?state=new` or `?state=known` tells /auth/callback
 * which of the two documented behaviours to perform (see lib/auth/oauth-
 * profile.ts). The redirect carries no token, no email and no name; the page
 * asks for those under the cookie it now holds.
 */

/** Everything ends up on the same page, which knows how to say what happened. */
const back = (req: NextRequest, params: Record<string, string>) =>
  NextResponse.redirect(
    new URL(`/auth/callback?${new URLSearchParams(params)}`, req.url),
    { status: 303 },
  );

/** The verifier is single-use. Clear it on every path out of here, including
 *  the failures — a spent one left in place is a confusing second attempt. */
const clearVerifier = (res: NextResponse) => {
  res.cookies.set(OAUTH_VERIFIER_COOKIE, "", { ...OAUTH_COOKIE_OPTIONS, maxAge: 0 });
  return res;
};

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;

  /*
   * The provider's own refusals arrive here, not as an HTTP error.
   *
   * `access_denied` is the ordinary one — the player looked at the consent
   * screen and pressed cancel — and it is not a failure worth an alarming
   * message. Everything else is reported as it came, because a misconfigured
   * client id says so here and nowhere else, and a silent redirect home would
   * leave whoever is setting this up with nothing to go on.
   */
  const denied = params.get("error");
  if (denied) {
    return clearVerifier(
      back(req, { error: denied === "access_denied" ? "cancelled" : "provider" }),
    );
  }

  if (!configured()) return clearVerifier(back(req, { error: "not-configured" }));

  const code = params.get("code");
  if (!code) return clearVerifier(back(req, { error: "no-code" }));

  const verifier = req.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  if (!verifier) {
    /*
     * No verifier means this browser did not start this sign-in.
     *
     * The innocent version is a player who cleared cookies, or took longer than
     * the ten-minute window, or opened the link in a different browser. The
     * other version is somebody handing a player a `?code=` of their own in the
     * hope of signing that player into an account the attacker controls — which
     * is the attack the pair exists to stop, and this is where it stops.
     */
    return clearVerifier(back(req, { error: "expired" }));
  }

  // Which flow this callback belongs to, when Supabase named one. A browser
  // client reads this off window.location by itself; a Route Handler has to
  // hand it over. See PKCE_FLOW_ID_PARAM.
  const { session, failure, suggested } = await exchangeOAuthCode(
    code,
    verifier,
    params.get(PKCE_FLOW_ID_PARAM),
  );
  if (failure || !session) {
    return clearVerifier(back(req, { error: failure === "disabled" ? "not-configured" : "exchange" }));
  }

  const profile = await ensureProfile(session, suggested);
  if (profile.error) {
    /*
     * The auth user exists but has no profile row.
     *
     * Reported rather than swallowed, exactly as /api/auth/signup does for the
     * same case: the player would otherwise appear signed in while every save
     * from then on failed a foreign key. The session cookie is deliberately NOT
     * attached — being signed in to an account that cannot hold anything is the
     * worse of the two states.
     */
    return clearVerifier(back(req, { error: "profile" }));
  }

  return clearVerifier(
    attachSession(back(req, { state: profile.created ? "new" : "known" }), session),
  );
}
