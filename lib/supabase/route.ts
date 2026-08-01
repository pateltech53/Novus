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

/** Mints a brand-new anonymous identity. No email, no phone, no password. */
export async function createAnonSession(): Promise<Session | null> {
  if (!configured()) return null;
  const supabase = anonClient();
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) return null;
  return pack(supabase, data);
}

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
  // Signups disabled, or email provider off, in the Supabase dashboard.
  if (m.includes("disabled") || m.includes("not enabled")) return "disabled";
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

/** Session from the cookie, or a fresh anonymous one if there is no valid cookie. */
export async function sessionOrCreate(req: NextRequest): Promise<Session | null> {
  return (await sessionFromRequest(req)) ?? (await createAnonSession());
}

export function attachSession(res: NextResponse, session: Session): NextResponse {
  res.cookies.set(SESSION_COOKIE, session.refreshToken, COOKIE_OPTIONS);
  return res;
}

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
