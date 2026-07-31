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
