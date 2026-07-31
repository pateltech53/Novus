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
}

/** Mints a brand-new anonymous identity. No email, no phone, no password. */
export async function createAnonSession(): Promise<Session | null> {
  if (!configured()) return null;
  const supabase = anonClient();
  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.session || !data.user) return null;
  return {
    supabase,
    userId: data.user.id,
    refreshToken: data.session.refresh_token,
  };
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
  if (error || !data.session || !data.user) return null;

  // refreshSession stores the new access token on the client, so every
  // subsequent .from() call below carries it and RLS sees the real user.
  return {
    supabase,
    userId: data.user.id,
    refreshToken: data.session.refresh_token,
  };
}

/** Session from the cookie, or a fresh anonymous one if there is no valid cookie. */
export async function sessionOrCreate(req: NextRequest): Promise<Session | null> {
  return (await sessionFromRequest(req)) ?? (await createAnonSession());
}

export function attachSession(res: NextResponse, session: Session): NextResponse {
  res.cookies.set(SESSION_COOKIE, session.refreshToken, COOKIE_OPTIONS);
  return res;
}
