import "server-only";

import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Google's OAuth, spoken directly rather than through Supabase.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 *
 * Supabase's own redirect flow works, and this app used it first. What it
 * cannot do is stop Google from telling the player they are signing in to
 * `qeqvhwkprkiqyvuilzbv.supabase.co`. That line on the consent screen is the
 * host of the `redirect_uri`, not the app name in the branding panel, and
 * GoTrue's redirect_uri is fixed at `<project>/auth/v1/callback` — there is no
 * setting that changes it. A child being asked to hand their account to a
 * twenty-character hostname is not the impression this product wants to make,
 * and no amount of filling in the consent screen fixes it.
 *
 * So the browser talks to Google, and only to Google. We mint the authorisation
 * URL with our OWN `redirect_uri`, Google says "continue to novuspitch.com",
 * the code comes back to our own origin, and the exchange happens here,
 * server-side, with the client secret. What comes out is an `id_token` — which
 * is exactly what the shipped app already produces from the system sheet, and
 * goes to Supabase down the same `signInWithIdToken` path
 * (lib/supabase/route.ts).
 *
 * That is the pleasing part: this is not a second architecture, it is the
 * native one reused. And it holds the app's own line more tightly than the
 * flow it replaces — with this in place, `supabase.co` never appears in a URL
 * bar a player can see.
 *
 * ── It is optional ────────────────────────────────────────────────────────
 *
 * Both variables have to be present or `googleDirect()` is false and
 * /api/auth/oauth/start falls back to Supabase's redirect flow, which still
 * works. A half-configured deploy is therefore a deploy with an ugly consent
 * screen, not a broken one.
 */

const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";

/**
 * The same web client id the app's native path uses.
 *
 * Public by nature — it is in the first request the consent screen makes — and
 * sharing it with the native config is not a shortcut: Supabase verifies the
 * `id_token`'s audience against the client ids on its Google provider, so both
 * paths have to present an audience that project already trusts.
 */
const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "";

/** Server only, and it must stay that way. Never NEXT_PUBLIC_. */
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET ?? "";

export const googleDirect = (): boolean => CLIENT_ID.length > 0 && CLIENT_SECRET.length > 0;

const random = () => randomBytes(32).toString("base64url");

export interface GoogleStart {
  url: string;
  /** CSRF. Comes back on the URL; must equal the copy in our cookie. */
  state: string;
  /** Replay protection. Comes back INSIDE the token; checked here. */
  nonce: string;
}

export function startGoogle(redirectUri: string): GoogleStart {
  const state = random();
  const nonce = random();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: "code",
    // The three that produce an id_token carrying an email and a name, and
    // nothing else. Every extra scope is something a parent has to read.
    scope: "openid email profile",
    state,
    nonce,
    // Without this, a player already signed in to one Google account is given
    // no chance to choose another — which on a shared classroom machine means
    // signing in as whoever used it last, silently.
    prompt: "select_account",
  });

  return { url: `${AUTHORIZE}?${params}`, state, nonce };
}

/** Constant-time, because comparing a CSRF token with `!==` leaks its prefix
 *  to anyone patient enough to measure. Cheap enough not to think about. */
export function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export type GoogleExchange =
  | { ok: true; idToken: string }
  | { ok: false; reason: "network" | "refused" | "no-token" | "nonce" | "audience" };

/**
 * Turns Google's `?code=` into an id_token, and checks it is ours.
 *
 * ── On not verifying the signature ────────────────────────────────────────
 *
 * This decodes the token's claims without checking who signed them, which
 * looks alarming written down and is correct here for two independent reasons.
 * The token arrives in the body of a TLS response from Google's own token
 * endpoint, in reply to a request carrying our client secret — OpenID Connect
 * §3.1.3.7 says a client MAY skip signature validation in exactly that case.
 * And it is not the last word regardless: Supabase verifies the signature
 * against Google's published keys before it will mint a session, so a forged
 * token fails there even if it somehow reached here.
 *
 * What IS checked here is the pair a signature cannot speak to: the nonce, so
 * a token captured from another sign-in cannot be replayed into this one, and
 * the audience, so a token minted for a different client cannot be handed to us
 * by whoever holds it.
 */
export async function exchangeGoogleCode(
  code: string,
  redirectUri: string,
  expectedNonce: string,
): Promise<GoogleExchange> {
  let body: { id_token?: string };
  try {
    const res = await fetch(TOKEN, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        // Google requires this to byte-match the one sent to /authorize, which
        // is why the caller carries it in the cookie rather than deriving it a
        // second time from a request that might see a different Host.
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    });
    if (!res.ok) return { ok: false, reason: "refused" };
    body = (await res.json()) as { id_token?: string };
  } catch {
    return { ok: false, reason: "network" };
  }

  const idToken = body.id_token;
  if (!idToken) return { ok: false, reason: "no-token" };

  const payload = claims(idToken);
  if (!payload) return { ok: false, reason: "no-token" };

  if (typeof payload.nonce !== "string" || !sameState(payload.nonce, expectedNonce)) {
    return { ok: false, reason: "nonce" };
  }

  // `aud` is a string for Google, but the spec allows an array, and a client
  // that only handles the string form quietly accepts the array form
  // unchecked.
  const audience = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audience.includes(CLIENT_ID)) return { ok: false, reason: "audience" };

  return { ok: true, idToken };
}

/** The middle segment of a JWT, decoded. Null for anything that is not one. */
function claims(token: string): Record<string, unknown> | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const decoded = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    return decoded && typeof decoded === "object" ? (decoded as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
