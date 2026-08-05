/**
 * Supabase wiring, in one place.
 *
 * The browser never talks to Supabase directly. Every call goes
 * browser → our own Route Handler → Supabase, which is why the anon key lives
 * here rather than in a Client Component: no new network origin, no
 * third-party cookie, no Google-side identifier on a product for minors
 * (docs/LEADERBOARD.md §1.4, §9.6).
 *
 * `configured()` exists because the app has to keep working with no Supabase
 * project at all. Without it, every save would throw on a machine where
 * .env.local was never filled in — and a missing cloud backup must degrade to
 * "localStorage only", never to a broken game.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export const configured = (): boolean =>
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/**
 * The anonymous session's refresh token.
 *
 * httpOnly so no script on the page — ours or an injected one — can read it.
 * SameSite=Lax because the only thing that ever needs it is a same-site fetch
 * from our own pages.
 */
export const SESSION_COOKIE = "novus_sb";

export const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
  // A player who comes back after the summer should still be the same player.
  maxAge: 60 * 60 * 24 * 365,
} as const;

/**
 * What one provider sign-in has to remember while the player is away.
 *
 * A sign-in with Google or Apple is two requests to us with a trip to somebody
 * else's site in between, and the second one has to prove it belongs to the
 * first. This cookie is that proof. What is in it depends on which flow ran —
 * a PKCE verifier for Supabase's redirect, or our own state and nonce for the
 * direct Google exchange (lib/auth/oauth-handoff.ts) — but the reason is the
 * same either way: without it, anyone could paste their own `?code=` into a
 * player's URL bar and sign that player into an account the attacker controls.
 *
 * Three of the four options below are load-bearing:
 *
 * · **httpOnly** — it is a credential for the length of one round trip, and no
 *   script on the page has any business reading it.
 * · **sameSite: lax** — it MUST survive a top-level GET navigation arriving
 *   from `accounts.google.com`, which is exactly what lax permits and strict
 *   forbids. Strict here would break every sign-in with a cookie the browser
 *   held on to and never sent.
 * · **path** — scoped to the two routes that use it, so it does not ride along
 *   on every request for the rest of its short life.
 *
 * Ten minutes is generous for "choose an account and press allow" and short
 * enough that an abandoned attempt leaves nothing behind worth having.
 */
export const OAUTH_HANDOFF_COOKIE = "novus_oauth";

export const OAUTH_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/api/auth/oauth",
  maxAge: 60 * 10,
} as const;
