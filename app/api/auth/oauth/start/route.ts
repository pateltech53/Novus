import { NextResponse, type NextRequest } from "next/server";

import { googleDirect, startGoogle } from "@/lib/auth/google-oauth";
import { callbackPath, packHandoff, siteOrigin } from "@/lib/auth/oauth-handoff";
import { isOAuthProvider } from "@/lib/auth/providers";
import { LIMITS, callerKey, throttle } from "@/lib/auth/throttle";
import { OAUTH_COOKIE_OPTIONS, OAUTH_HANDOFF_COOKIE, configured } from "@/lib/supabase/config";
import { startOAuth } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/auth/oauth/start?provider=google — leave for the provider.
 *
 * ── Why this is a route and not a link ─────────────────────────────────────
 *
 * The obvious version of Google sign-in puts a Supabase client in the page and
 * lets it build the URL. This app does not do that, for the reason stated at
 * the top of lib/supabase/config.ts: the browser never talks to Supabase, and
 * no page a minor is looking at loads a third party's script. So the URL is
 * built here, on our own origin, and the browser's only instruction is a 302.
 *
 * ── Two ways to build that URL ─────────────────────────────────────────────
 *
 * **Google, when a client secret is configured:** we talk to Google directly
 * (lib/auth/google-oauth.ts). The point is one line of copy — Google's consent
 * screen names the host of the `redirect_uri`, so this is the difference
 * between "continue to novuspitch.com" and "continue to
 * qeqvhwkprkiqyvuilzbv.supabase.co", and no branding setting changes it.
 *
 * **Everything else:** Supabase builds it and owns the PKCE exchange. Apple
 * stays here because it does not have the problem — its sign-in page shows the
 * Services ID's description, which is a name we choose — and because one flow
 * we do not maintain is one flow that cannot be wrong.
 *
 * Google falls back to this path too when `GOOGLE_CLIENT_SECRET` is unset. A
 * half-configured deploy gets an ugly consent screen, not a broken sign-in.
 *
 * ── Why a GET, and why no CSRF check ───────────────────────────────────────
 *
 * It has to be a top-level navigation — the player is leaving for
 * accounts.google.com and coming back — and `crossSite()` would refuse exactly
 * that. There is nothing here worth forging: the worst a hostile link can do is
 * send somebody to Google, where they sign in as themselves and come back as
 * themselves. The attack this flow actually has to stop is the opposite one —
 * an attacker's `?code=` landing in a player's browser — and that is stopped in
 * the callback, against a value this route put in a cookie nobody else can
 * write.
 */

/** Somewhere to land that can say what went wrong in a sentence. */
const refuse = (req: NextRequest, reason: string) =>
  NextResponse.redirect(new URL(`/auth/callback?error=${reason}`, req.url), { status: 303 });

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider");
  if (!isOAuthProvider(provider)) return refuse(req, "provider");

  if (!configured()) return refuse(req, "not-configured");

  /*
   * Bounded, but on its own bucket — see LIMITS.oauthPerIp for why this is not
   * `signup:ip`. Spent before any provider is called, so a flood costs one
   * cheap upsert per request rather than a round trip.
   */
  const limited = await throttle([
    { bucket: "oauth:ip", key: callerKey(req), limit: LIMITS.oauthPerIp },
  ]);
  if (!limited.allowed) return refuse(req, "throttled");

  const redirectUri = `${siteOrigin(req)}${callbackPath}`;

  if (provider === "google" && googleDirect()) {
    const { url, state, nonce } = startGoogle(redirectUri);
    return handoff(url, packHandoff({ k: "direct", p: provider, s: state, n: nonce, r: redirectUri }));
  }

  const started = await startOAuth(provider, redirectUri);
  if (!started) return refuse(req, "unavailable");

  return handoff(started.url, packHandoff({ k: "supabase", p: provider, v: started.verifier }));
}

/** 303 rather than 302: this is a GET already, but naming it means no
 *  intermediary can decide to re-issue it as anything else. */
function handoff(url: string, cookie: string): NextResponse {
  const res = NextResponse.redirect(url, { status: 303 });
  res.cookies.set(OAUTH_HANDOFF_COOKIE, cookie, OAUTH_COOKIE_OPTIONS);
  return res;
}
