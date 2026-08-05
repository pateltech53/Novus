import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NextRequest, NextResponse } from "next/server";

import type { OAuthProvider } from "@/lib/auth/providers";
import { isNativeOrigin } from "@/lib/native/origins";

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

// ── Google and Apple ────────────────────────────────────────────────────────

/**
 * Storage for a Supabase client that has none.
 *
 * ── Why this is needed at all ──────────────────────────────────────────────
 *
 * The rest of this file runs `persistSession: false`, because a Route Handler
 * has no browser storage and the refresh token in the cookie is the whole
 * session. The PKCE flow is the one thing that does not fit that: `getUrlFor
 * Provider` writes the code verifier into the client's storage, and
 * `exchangeCodeForSession` reads it back out — and with `persistSession: false`
 * gotrue-js ignores any storage you pass and installs its own private one, so
 * the verifier is written somewhere we cannot reach and the exchange, one
 * request later, has nothing to read.
 *
 * So these two calls (and only these two) run with `persistSession: true` and a
 * Map. It is still per-request and still in memory — the durable half of the
 * round trip is the httpOnly cookie the routes set.
 *
 * ── Why the WHOLE store travels, and not just the verifier ────────────────
 *
 * The obvious version of this reaches in for one known key. It would work
 * today and break on an upgrade, silently, in the one flow nobody tests by
 * accident. The installed auth-js does not keep a single verifier: it keeps a
 * slot per concurrent flow (`<key>-flow-<id>-code-verifier`), an index listing
 * them, and a fixed legacy key mirroring the most recent — three entries whose
 * names and JSON encoding are the library's business, not ours, and which have
 * already changed shape once.
 *
 * So nothing here is parsed. The map is serialised whole on the way out and
 * restored whole on the way back, and whatever the library wrote it finds
 * again byte for byte. It is a few hundred bytes of cookie and it cannot be
 * wrong about a format it never reads.
 */
const VERIFIER_STORAGE_KEY = "novus-oauth";

const pkceClient = (
  seed?: string,
): { supabase: SupabaseClient; snapshot: () => string } => {
  const store = new Map<string, string>();

  if (seed) {
    try {
      for (const [key, value] of JSON.parse(seed) as [string, string][]) {
        if (typeof key === "string" && typeof value === "string") store.set(key, value);
      }
    } catch {
      // A cookie that is not our JSON is a cookie from another build, or a
      // tampered one. Left empty: the exchange then fails on a missing
      // verifier, which is the correct answer to both.
    }
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "pkce",
      // Not a preference: with persistSession false, gotrue-js ignores the
      // storage passed here and installs its own, so the verifier would be
      // written somewhere this function cannot read.
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: VERIFIER_STORAGE_KEY,
      storage: {
        getItem: (key) => store.get(key) ?? null,
        setItem: (key, value) => {
          store.set(key, value);
        },
        removeItem: (key) => {
          store.delete(key);
        },
      },
    },
  });

  return { supabase, snapshot: () => JSON.stringify([...store.entries()]) };
};

export interface OAuthStart {
  /** Where to send the browser. */
  url: string;
  /** The PKCE storage, serialised. Park it in the cookie; the callback cannot
   *  finish without it. Opaque on purpose — see pkceClient. */
  verifier: string;
}

/**
 * Builds the provider's authorisation URL and hands back the secret half.
 *
 * `skipBrowserRedirect` is belt and braces — gotrue-js only redirects when it
 * thinks it is in a browser, and this is Node — but stating it means the
 * function cannot start behaving differently if that check ever changes.
 *
 * Returns null rather than throwing when Supabase declines. The caller turns
 * that into "sign-in with Google is not available", which is the truth from the
 * player's side whether the provider is switched off in the dashboard or the
 * project is unreachable.
 */
export async function startOAuth(
  provider: OAuthProvider,
  redirectTo: string,
): Promise<OAuthStart | null> {
  if (!configured()) return null;

  const { supabase, snapshot } = pkceClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      /*
       * Apple hands over the name ONCE, on the very first authorisation, and
       * never again — so it has to be asked for here or the account is called
       * "Founder" forever. Asking for it is not the same as relying on it:
       * /auth/callback puts a name field in front of every new account anyway,
       * because a player is entitled to be called what they choose rather than
       * what their Apple ID says.
       */
      ...(provider === "apple" ? { scopes: "name email" } : {}),
    },
  });

  if (error || !data?.url) return null;

  const verifier = snapshot();
  // "[]" — nothing was written, so there is no verifier to come back to and
  // the exchange would fail ten minutes from now with nothing to point at.
  if (verifier.length < 3) return null;

  return { url: data.url, verifier };
}

/**
 * An OAuth result carries one thing a password result never can: a name the
 * provider offered. It is a suggestion, not an answer — see suggestedName().
 */
export interface OAuthResult extends AuthResult {
  suggested: string | null;
}

/**
 * The reserved parameter auth-js uses to name which flow a callback belongs to.
 *
 * It appends this to `redirectTo` when several PKCE sign-ins may be in flight
 * at once, and in a browser it reads it back off `window.location` by itself.
 * There is no `window` in a Route Handler, so the callback route has to lift it
 * off the request and pass it in — the library's own documented server recipe.
 * Absent is normal and fine: the exchange then uses the most recently stored
 * verifier, which on a per-request store is the only one there is.
 */
export const PKCE_FLOW_ID_PARAM = "sb_flow_id";

/**
 * Turns the `?code=` the provider sent back into a session.
 *
 * The verifier comes from our own cookie, so a code that was minted for a
 * different browser fails here — which is the whole point of the pair.
 */
export async function exchangeOAuthCode(
  code: string,
  verifier: string,
  flowId?: string | null,
): Promise<OAuthResult> {
  if (!configured()) return { session: null, failure: "disabled", suggested: null };

  const { supabase } = pkceClient(verifier);
  const { data, error } = await supabase.auth.exchangeCodeForSession(
    code,
    flowId ? { flowId } : undefined,
  );
  if (error) {
    return { session: null, failure: classifyAuthError(error.message), suggested: null };
  }
  return { session: pack(supabase, data), failure: null, suggested: suggestedName(data.user) };
}

/**
 * The app's half: a token the phone already holds, verified server-side.
 *
 * ── Why the shipped app cannot use the redirect flow above ─────────────────
 *
 * It can start it. It cannot finish it. `Browser.open` is a real Safari view
 * (lib/commerce.ts), and it has Safari's cookie jar, not the webview's — so the
 * session cookie the callback sets lands in a browser the app cannot read, and
 * the player comes back to the app exactly as signed out as they left.
 *
 * The native SDKs sidestep the whole problem: the system sheet returns a signed
 * `id_token` in the app's own process, the app posts it to us like any other
 * request, and the cookie comes back down the same connection. It is also the
 * better flow on its own merits — a system sheet rather than a browser, and the
 * token still never leaves the server side of this app.
 *
 * `nonce` is Apple's replay protection and must be the RAW value the app
 * generated; Apple carries only its hash inside the token. Absent for Google,
 * which does not use one here.
 */
export async function signInWithProviderToken(
  provider: OAuthProvider,
  idToken: string,
  nonce?: string,
): Promise<OAuthResult> {
  if (!configured()) return { session: null, failure: "disabled", suggested: null };

  const supabase = anonClient();
  const { data, error } = await supabase.auth.signInWithIdToken({
    provider,
    token: idToken,
    ...(nonce ? { nonce } : {}),
  });

  if (error) {
    return { session: null, failure: classifyAuthError(error.message), suggested: null };
  }
  return { session: pack(supabase, data), failure: null, suggested: suggestedName(data.user) };
}

/**
 * The name the provider volunteered, if it volunteered one.
 *
 * Google always sends `full_name`. Apple sends a name only on the first
 * authorisation, and only when `name` was in the scopes — after that the field
 * is simply absent, for that account, forever. Neither is trusted as the final
 * answer: this is the PREFILL for the name field on /auth/callback, which is
 * where the player decides what they are actually called.
 *
 * Trimmed to MAX_NAME_LENGTH (24, lib/account.ts) because `profiles.
 * display_name` carries that as a check constraint, and a 40-character Google
 * name would otherwise fail the insert and take the whole sign-in with it.
 */
export function suggestedName(user: { user_metadata?: Record<string, unknown> } | null): string | null {
  const meta = user?.user_metadata;
  if (!meta) return null;
  for (const key of ["full_name", "name", "preferred_username"]) {
    const value = meta[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 24);
  }
  return null;
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
  if (isNativeOrigin(origin)) return false;

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
