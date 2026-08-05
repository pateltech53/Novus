import { NextResponse, type NextRequest } from "next/server";

import { exchangeGoogleCode, sameState } from "@/lib/auth/google-oauth";
import { readHandoff, type Handoff } from "@/lib/auth/oauth-handoff";
import { ensureProfile } from "@/lib/auth/oauth-profile";
import { OAUTH_COOKIE_OPTIONS, OAUTH_HANDOFF_COOKIE, configured } from "@/lib/supabase/config";
import {
  PKCE_FLOW_ID_PARAM,
  attachSession,
  exchangeOAuthCode,
  signInWithProviderToken,
  type OAuthResult,
} from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/oauth/callback — where Google and Apple send the player back.
 *
 * ── Why the session is minted here and not in the page ─────────────────────
 *
 * Because this app's whole authentication story is that the token never touches
 * JavaScript. Both flows that land here return a short-lived `?code=` in the
 * QUERY string, which — unlike the `#fragment` the recovery links use — does
 * reach a server. So the exchange happens here, the refresh token goes straight
 * into the httpOnly cookie, and the page that renders next learns who it is by
 * asking /api/auth/me like every other screen. Nothing sensitive is ever in the
 * document.
 *
 * ── The two flows ─────────────────────────────────────────────────────────
 *
 * The cookie says which one ran, rather than this route guessing from which
 * parameters happen to be present:
 *
 * · **direct** — the code is Google's. We exchange it with Google ourselves and
 *   hand the resulting `id_token` to Supabase, which is the same call the
 *   shipped app makes from the system sheet. See lib/auth/google-oauth.ts for
 *   why this exists at all; the short version is the sentence Google prints on
 *   the consent screen.
 * · **supabase** — the code is Supabase's, and its PKCE store finishes it.
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

/** The handoff is single-use. Cleared on every path out of here, including the
 *  failures — a spent one left in place is a confusing second attempt. */
const clearHandoff = (res: NextResponse) => {
  res.cookies.set(OAUTH_HANDOFF_COOKIE, "", { ...OAUTH_COOKIE_OPTIONS, maxAge: 0 });
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
    return clearHandoff(
      back(req, { error: denied === "access_denied" ? "cancelled" : "provider" }),
    );
  }

  if (!configured()) return clearHandoff(back(req, { error: "not-configured" }));

  const code = params.get("code");
  if (!code) return clearHandoff(back(req, { error: "no-code" }));

  const handoff = readHandoff(req.cookies.get(OAUTH_HANDOFF_COOKIE)?.value);
  if (!handoff) {
    /*
     * No handoff means this browser did not start this sign-in.
     *
     * The innocent version is a player who cleared cookies, or took longer than
     * the ten-minute window, or opened the link in a different browser. The
     * other version is somebody handing a player a `?code=` of their own in the
     * hope of signing that player into an account the attacker controls — which
     * is the attack the cookie exists to stop, and this is where it stops.
     */
    return clearHandoff(back(req, { error: "expired" }));
  }

  const result =
    handoff.k === "direct"
      ? await finishDirect(handoff, code, params.get("state"))
      : await finishSupabase(handoff, code, params.get(PKCE_FLOW_ID_PARAM));

  if ("error" in result) return clearHandoff(back(req, { error: result.error }));

  const { session, failure, suggested } = result.auth;
  if (failure || !session) {
    return clearHandoff(
      back(req, { error: failure === "disabled" ? "not-configured" : "exchange" }),
    );
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
    return clearHandoff(back(req, { error: "profile" }));
  }

  return clearHandoff(
    attachSession(back(req, { state: profile.created ? "new" : "known" }), session),
  );
}

type Finished = { auth: OAuthResult } | { error: string };

/**
 * Google's code, exchanged by us.
 *
 * The `state` check is first and unconditional: everything after it costs a
 * round trip to Google, and a request that cannot prove it belongs to a
 * sign-in this browser started has no business spending one.
 */
async function finishDirect(
  handoff: Extract<Handoff, { k: "direct" }>,
  code: string,
  state: string | null,
): Promise<Finished> {
  if (!state || !sameState(state, handoff.s)) return { error: "state" };

  const exchanged = await exchangeGoogleCode(code, handoff.r, handoff.n);
  if (!exchanged.ok) {
    // A failed nonce or audience check is not a configuration problem, it is a
    // token that was not minted for this sign-in. Reported apart from the
    // ordinary failures so it is legible in a log rather than another
    // "exchange".
    return { error: exchanged.reason === "nonce" || exchanged.reason === "audience" ? "state" : "exchange" };
  }

  /*
   * Straight into the path the shipped app already uses.
   *
   * `nonce` is deliberately not passed on: it has been verified here, against
   * the value in our own cookie, and the conventions differ by provider in a
   * way that is easy to get subtly wrong (lib/cloud/native-oauth.ts has the
   * long version). Supabase still verifies the signature and the audience,
   * which is what decides whether the token is real.
   */
  return { auth: await signInWithProviderToken(handoff.p, exchanged.idToken) };
}

/** Supabase's code, finished with the PKCE store it wrote at the start. */
async function finishSupabase(
  handoff: Extract<Handoff, { k: "supabase" }>,
  code: string,
  flowId: string | null,
): Promise<Finished> {
  // Which flow this callback belongs to, when Supabase named one. A browser
  // client reads this off window.location by itself; a Route Handler has to
  // hand it over. See PKCE_FLOW_ID_PARAM.
  return { auth: await exchangeOAuthCode(code, handoff.v, flowId) };
}
