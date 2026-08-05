import { NextResponse, type NextRequest } from "next/server";

import { isOAuthProvider } from "@/lib/auth/providers";
import { LIMITS, callerKey, throttle } from "@/lib/auth/throttle";
import { OAUTH_COOKIE_OPTIONS, OAUTH_VERIFIER_COOKIE, configured } from "@/lib/supabase/config";
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
 * The PKCE verifier is the reason this cannot be a static link either. It is
 * minted per attempt, its hash goes to the provider, and the original stays in
 * an httpOnly cookie that the callback needs in order to finish. See
 * OAUTH_VERIFIER_COOKIE.
 *
 * ── Why a GET, and why no CSRF check ───────────────────────────────────────
 *
 * It has to be a top-level navigation — the player is leaving for
 * accounts.google.com and coming back — and `crossSite()` would refuse exactly
 * that. There is nothing here worth forging: the worst a hostile link can do is
 * send somebody to Google, where they sign in as themselves and come back as
 * themselves. The attack this flow actually has to stop is the opposite one —
 * an attacker's `?code=` landing in a player's browser — and that is stopped in
 * the callback, by a verifier this route put there and nobody else can write.
 */

/**
 * The origin to come back to.
 *
 * Derived from the request rather than an environment variable so localhost and
 * preview deploys talk to themselves, which is what makes this testable without
 * a second Supabase project. `x-forwarded-*` first because the app runs behind a
 * proxy in production and `req.nextUrl` there is an internal address.
 *
 * Whatever this resolves to must be on Supabase's redirect allow-list. A value
 * that is not on it does not fail loudly — GoTrue silently sends the player to
 * the project's Site URL instead. docs/OAUTH-SETUP.md §3 is the list.
 */
function siteOrigin(req: NextRequest): string {
  const override = process.env.OAUTH_REDIRECT_ORIGIN;
  if (override) return override.replace(/\/$/, "");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return req.nextUrl.origin;
}

/** Somewhere to land that can say what went wrong in a sentence. */
const refuse = (req: NextRequest, reason: string) =>
  NextResponse.redirect(new URL(`/auth/callback?error=${reason}`, req.url), { status: 303 });

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get("provider");
  if (!isOAuthProvider(provider)) return refuse(req, "provider");

  if (!configured()) return refuse(req, "not-configured");

  /*
   * Bounded, but on its own bucket — see LIMITS.oauthPerIp for why this is not
   * `signup:ip`. Spent before Supabase is called, so a flood costs one cheap
   * upsert per request rather than a round trip.
   */
  const limited = await throttle([
    { bucket: "oauth:ip", key: callerKey(req), limit: LIMITS.oauthPerIp },
  ]);
  if (!limited.allowed) return refuse(req, "throttled");

  const started = await startOAuth(provider, `${siteOrigin(req)}/api/auth/oauth/callback`);
  if (!started) return refuse(req, "unavailable");

  // 303 rather than 302: this is a GET already, but naming it means no
  // intermediary can decide to re-issue it as anything else.
  const res = NextResponse.redirect(started.url, { status: 303 });
  res.cookies.set(OAUTH_VERIFIER_COOKIE, started.verifier, OAUTH_COOKIE_OPTIONS);
  return res;
}
