import "server-only";

import type { NextRequest } from "next/server";

import type { OAuthProvider } from "@/lib/auth/providers";

/**
 * The two halves of a provider sign-in, and the note passed between them.
 *
 * `/api/auth/oauth/start` writes this into an httpOnly cookie and
 * `/api/auth/oauth/callback` reads it back. Which shape it takes says which of
 * the two flows ran, and the callback branches on that rather than guessing
 * from which query parameters happen to be present:
 *
 * · **direct** — we spoke to Google ourselves, so what has to survive is the
 *   CSRF `state`, the `nonce` that will be inside the returned token, and the
 *   exact `redirect` we sent (Google requires the token exchange to repeat it
 *   byte for byte, and deriving it a second time from a request that might see
 *   a different Host is a bug waiting for a proxy change).
 * · **supabase** — Supabase built the authorisation URL, so what has to
 *   survive is its PKCE store, opaque and whole (lib/supabase/route.ts says
 *   why it is not parsed).
 *
 * Keys are one letter because this is a cookie: the PKCE snapshot is already
 * four hundred bytes before encoding, and there is no reason to spend more on
 * field names nothing but this file reads.
 */
export type Handoff =
  | { k: "direct"; p: OAuthProvider; s: string; n: string; r: string }
  | { k: "supabase"; p: OAuthProvider; v: string };

export const packHandoff = (handoff: Handoff): string => JSON.stringify(handoff);

/**
 * Reads the cookie back, or null.
 *
 * Null covers a cleared cookie, an expired one, a browser that never started
 * this sign-in, and a hand-edited one — all of which the callback answers the
 * same way, because to a player they are the same thing: start again. The one
 * it must never do is trust a shape it did not write, so every field is
 * checked rather than cast.
 */
export function readHandoff(raw: string | undefined): Handoff | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const value = parsed as Record<string, unknown>;
  const provider = value.p;
  if (provider !== "google" && provider !== "apple") return null;

  if (value.k === "direct") {
    if (typeof value.s !== "string" || typeof value.n !== "string" || typeof value.r !== "string") {
      return null;
    }
    return { k: "direct", p: provider, s: value.s, n: value.n, r: value.r };
  }

  if (value.k === "supabase" && typeof value.v === "string") {
    return { k: "supabase", p: provider, v: value.v };
  }

  return null;
}

/**
 * The origin a provider should send the player back to.
 *
 * Derived from the request rather than an environment variable so localhost and
 * preview deployments talk to themselves, which is what makes this testable
 * without a second Supabase project or a second Google client. `x-forwarded-*`
 * comes first because the app runs behind a proxy in production and
 * `req.nextUrl` there is an internal address.
 *
 * Whatever this resolves to must be registered with whoever is being asked to
 * redirect to it — Google's own client for the direct flow, Supabase's list for
 * the other. A value that is not registered fails loudly on Google's side and
 * silently on Supabase's, which sends the player to the project's Site URL
 * instead. docs/OAUTH-SETUP.md has both lists.
 */
export function siteOrigin(req: NextRequest): string {
  const override = process.env.OAUTH_REDIRECT_ORIGIN;
  if (override) return override.replace(/\/$/, "");

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto =
      req.headers.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${proto}://${host}`;
  }
  return req.nextUrl.origin;
}

/** Both flows come back to the same place. Named once so start and callback
 *  cannot drift apart. */
export const callbackPath = "/api/auth/oauth/callback";
