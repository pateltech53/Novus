import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";

import {
  COOKIE_OPTIONS,
  SESSION_COOKIE,
  SUPABASE_ANON_KEY,
  SUPABASE_URL,
  configured,
} from "./config";

/**
 * Per-request Supabase clients for Route Handlers.
 *
 * Server-side only. Two things this file is careful about:
 *
 * 1. **A client per request, never a module-level singleton.** The client
 *    carries the caller's session, and a shared one would serve player B the
 *    session of whoever hit the route last.
 * 2. **The anon key, not the service role.** Everything here runs as the
 *    signed-in player, so RLS is what decides what they can touch. The service
 *    role bypasses RLS entirely and has no business on this path.
 */

const anonClient = (): SupabaseClient =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      // A Route Handler has no browser storage and no timers worth keeping —
      // the refresh token in the cookie is the whole session.
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });

export interface Session {
  supabase: SupabaseClient;
  userId: string;
  /** Rotated by Supabase on every refresh; hand it back to the browser. */
  refreshToken: string;
  /**
   * True for a throwaway identity that exists only as long as the cookie —
   * cleared browser, different device, and it is gone with everything attached
   * to it.
   *
   * This is the distinction billing turns on. A player may play the whole free
   * game anonymously, but nothing may be SOLD to an identity that cannot be
   * signed back into: they would pay, lose the cookie, and have no way on
   * earth to prove the purchase. `/api/billing/checkout` refuses anonymous
   * callers for exactly that reason.
   */
  anonymous: boolean;
  /** Present only on a real account. Never shown on any public surface. */
  email: string | null;
}

/**
 * Packs a Supabase auth result into our Session, or null if it is not one.
 *
 * Every path below funnels through here so `anonymous` is read from the token
 * Supabase actually issued, never inferred from which function was called. An
 * identity that lies about being permanent is one that gets sold a
 * subscription it cannot keep.
 */
const pack = (
  supabase: SupabaseClient,
  data: { session: { refresh_token: string } | null; user: { id: string; is_anonymous?: boolean; email?: string } | null },
): Session | null => {
  if (!data.session || !data.user) return null;
  return {
    supabase,
    userId: data.user.id,
    refreshToken: data.session.refresh_token,
    anonymous: data.user.is_anonymous === true,
    email: data.user.email ?? null,
  };
};

/*
 * There is deliberately no createAnonSession() here any more.
 *
 * It existed to mint a throwaway identity for every visitor so their saves
 * could sync before they committed to anything. Real accounts replaced the
 * reason for it: an anonymous identity lives only in a cookie, so it could not
 * be signed back into, could not reach another device, and died in exactly the
 * case a backup exists for — while costing a permanent row about a child, for
 * everyone who ever opened the page.
 *
 * A player without an account now sends nothing at all. If this ever needs to
 * come back, note that `Session.anonymous` and the checkout refusal that reads
 * it are still in place, because old anonymous cookies may still arrive.
 */

/**
 * What went wrong, in words a player can act on.
 *
 * Supabase's messages are written for developers ("User already registered",
 * "Invalid login credentials"). They are also the only signal we get, so they
 * are mapped rather than passed through — and the mapping is deliberately
 * coarse on the sign-in side: telling someone "no account with that email"
 * hands an attacker an account-existence oracle for a database of children.
 */
export type AuthFailure = "taken" | "invalid" | "weak-password" | "bad-email" | "disabled" | "unknown";

export function classifyAuthError(message: string): AuthFailure {
  const m = message.toLowerCase();
  if (m.includes("already registered") || m.includes("already been registered")) return "taken";
  if (m.includes("invalid login") || m.includes("invalid credentials")) return "invalid";
  if (m.includes("password") && (m.includes("least") || m.includes("weak") || m.includes("short"))) {
    return "weak-password";
  }
  if (m.includes("email") && (m.includes("invalid") || m.includes("valid"))) return "bad-email";
  // Signups disabled, or the email provider switched off, in the dashboard.
  // Supabase's actual wording is "Signups not allowed for this instance", so
  // matching only on "disabled" would classify it as unknown and tell the
  // player to try again forever against a project that will never accept one.
  if (m.includes("disabled") || m.includes("not enabled") || m.includes("not allowed")) {
    return "disabled";
  }
  return "unknown";
}

export interface AuthResult {
  session: Session | null;
  failure: AuthFailure | null;
}

/**
 * Creates a real account.
 *
 * Returns a session only when the project has email confirmation OFF, which is
 * how this app is meant to be configured (docs/ACCOUNTS-SETUP.md). With
 * confirmation ON, Supabase returns a user and a null session — the caller
 * gets `{session: null, failure: null}` and must tell the player to check
 * their email. That case is handled rather than assumed away, because it is
 * one dashboard toggle from being true.
 */
export async function signUpWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!configured()) return { session: null, failure: "disabled" };
  const supabase = anonClient();
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) return { session: null, failure: classifyAuthError(error.message) };
  return { session: pack(supabase, data), failure: null };
}

/** Signs an existing account in. */
export async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!configured()) return { session: null, failure: "disabled" };
  const supabase = anonClient();
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { session: null, failure: classifyAuthError(error.message) };
  return { session: pack(supabase, data), failure: null };
}

/**
 * Rehydrates the session from the request's cookie.
 *
 * Returns null when there is no cookie, when the token has expired, or when
 * Supabase is not configured — callers treat all three the same way, because
 * to a player they are the same thing: no cloud save this time.
 */
export async function sessionFromRequest(req: NextRequest): Promise<Session | null> {
  if (!configured()) return null;
  const refresh_token = req.cookies.get(SESSION_COOKIE)?.value;
  if (!refresh_token) return null;

  const supabase = anonClient();
  const { data, error } = await supabase.auth.refreshSession({ refresh_token });
  if (error) return null;

  // refreshSession stores the new access token on the client, so every
  // subsequent .from() call below carries it and RLS sees the real user.
  return pack(supabase, data);
}

export function attachSession(res: NextResponse, session: Session): NextResponse {
  res.cookies.set(SESSION_COOKIE, session.refreshToken, COOKIE_OPTIONS);
  return res;
}

/**
 * attachSession for a session that may not exist.
 *
 * Exists because of a bug class that is invisible until it bites: Supabase
 * ROTATES the refresh token on every `refreshSession`, so the moment
 * sessionFromRequest succeeds, the token in the player's cookie is spent. A
 * route that then returns an error without attaching the new one leaves the
 * browser holding a dead token — and the player is silently signed out by a
 * refusal that was supposed to be recoverable ("you already own TECH", "that
 * price is misconfigured").
 *
 * So every response on a path that resolved a session goes through here,
 * success or not.
 */
export function withSession(res: NextResponse, session: Session | null): NextResponse {
  return session ? attachSession(res, session) : res;
}

/**
 * Rejects state-changing requests that did not come from our own pages.
 *
 * Next.js Route Handlers have no CSRF protection of their own. A JSON fetch
 * from another origin is stopped by CORS preflight, but a cross-site FORM post
 * with `enctype="text/plain"` is not preflighted at all, and `req.json()`
 * parses the body regardless of its declared type — so a form on any website
 * can reach these routes with the player's cookies attached.
 *
 * That matters most on the reset-confirm route, which installs a session from
 * tokens in the request body: an attacker who posts THEIR tokens into a
 * player's browser signs that player into the attacker's account, and
 * everything the player does next — including a purchase — lands there.
 *
 * `Sec-Fetch-Site` is checked first because browsers set it and scripts cannot
 * forge it. `Origin` is the fallback for anything older. A request with
 * neither is allowed through: that is a non-browser caller (curl, a health
 * check), which has no ambient cookies to abuse in the first place.
 */
export function crossSite(req: NextRequest): boolean {
  /*
   * The shipped app is first-party, and it IS cross-site.
   *
   * capacitor.config.ts serves the bundle from `app.novuspitch.com` under
   * `capacitor://` on iOS and `https://` on Android, while the server routes
   * live at the real origin (lib/native/origin.ts). Every call the app makes
   * is therefore cross-site by the browser's reckoning, and `CapacitorHttp` is
   * disabled so these are ordinary fetches carrying ordinary headers.
   *
   * Checked before Sec-Fetch-Site precisely because that header will say
   * "cross-site" for the app and be right. An allow-list of origins we ship
   * ourselves is the distinction that matters: a website cannot forge Origin,
   * so this admits our app and nobody else's page.
   */
  const origin = req.headers.get("origin");
  if (origin && NATIVE_ORIGINS.has(origin)) return false;

  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite !== "same-origin" && fetchSite !== "none";

  if (!origin) return false;

  try {
    return new URL(origin).host !== new URL(req.url).host;
  } catch {
    return true;
  }
}

/**
 * The origins our own binaries run at — `server.hostname` in
 * capacitor.config.ts, under each platform's scheme. Kept in step with that
 * file by hand; there are two values and they change when the app is renamed.
 */
const NATIVE_ORIGINS = new Set([
  "capacitor://app.novuspitch.com",
  "https://app.novuspitch.com",
]);

/**
 * Signs out by destroying the cookie.
 *
 * Set to empty with maxAge 0 rather than `.delete()`, so the browser is handed
 * an explicit expiry for the same path and flags it was written with — a
 * delete that misses on one of those leaves the old cookie in place, and the
 * player stays signed in on a shared classroom machine after pressing sign
 * out. That is the failure this app can least afford.
 */
export function clearSession(res: NextResponse): NextResponse {
  res.cookies.set(SESSION_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return res;
}
