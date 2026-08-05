/**
 * The identity providers, and nothing that depends on anything.
 *
 * Its own module with no imports, for the same reason lib/native/origins.ts is:
 * both halves of the flow need this list, and they live in different worlds.
 * The server half (lib/supabase/route.ts) pulls in the Supabase SDK and
 * `next/server`; the browser half (lib/cloud/auth.ts) runs in a page and must
 * not pull in either. A shared file with no dependencies is the only thing both
 * can have.
 *
 * A union rather than a string because the value arrives in a query parameter
 * and is handed to Supabase — an open string there is a request for whatever
 * provider an attacker can name, on a project where somebody may have left one
 * half-configured.
 */

export type OAuthProvider = "google" | "apple";

export const OAUTH_PROVIDERS: readonly OAuthProvider[] = ["google", "apple"] as const;

export const isOAuthProvider = (value: unknown): value is OAuthProvider =>
  value === "google" || value === "apple";

/** What the button says, and what the error messages call it. */
export const PROVIDER_LABEL: Record<OAuthProvider, string> = {
  google: "Google",
  apple: "Apple",
};

/**
 * Which providers this deploy has actually switched on.
 *
 * `NEXT_PUBLIC_OAUTH_PROVIDERS=google,apple` — unset means neither, and the
 * app is exactly what it was before: email and password, no third party
 * contacted from any page. That default is the point rather than an oversight.
 * Signing in with Google means the browser visits `accounts.google.com`, and
 * docs/LEADERBOARD.md §1.4 and §9.6 rule out third parties on pages shown to
 * minors — a rule the rest of this app holds to by routing Supabase and Stripe
 * through our own origin. Turning this on is a decision about that rule, taken
 * per deploy, by whoever is entitled to take it.
 *
 * Read from the environment rather than from Supabase, because "is the Google
 * provider enabled on the project" is not a question the anon key can ask. The
 * two must be kept in step by hand: a provider listed here and switched off in
 * the dashboard shows a button that fails, and one switched on but not listed
 * simply is not offered. docs/OAUTH-SETUP.md is the checklist.
 */
export function enabledProviders(): readonly OAuthProvider[] {
  const raw = process.env.NEXT_PUBLIC_OAUTH_PROVIDERS ?? "";
  if (!raw.trim()) return [];
  return raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(isOAuthProvider);
}

/**
 * Which of the two doors a provider sign-in turned out to be.
 *
 * "Continue with Google" is a sign-up the first time and a sign-in every time
 * after, and the two owe the player opposite treatment of this device — see
 * lib/auth/oauth-profile.ts, which is where the distinction is actually made.
 * The server sends the answer back; this is its name.
 */
export type OAuthState = "new" | "known";

export const isOAuthState = (value: unknown): value is OAuthState =>
  value === "new" || value === "known";
