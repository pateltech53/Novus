/**
 * Stripe wiring, in one place — the mirror of lib/supabase/config.ts.
 *
 * Two rules carried over from the Supabase side, for the same reasons:
 *
 * 1. **The browser never talks to Stripe's API.** Checkout is created by our
 *    own Route Handler and the player is redirected to Stripe's hosted page.
 *    That is why there is no publishable key and no NEXT_PUBLIC_ variable in
 *    this file: loading stripe.js would put a third-party script and a
 *    third-party identifier on a page shown to minors, which is the exact
 *    thing docs/LEADERBOARD.md §1.4 and §9.6 rule out. A redirect leaves no
 *    Stripe code on our origin at all.
 *
 * 2. **`configured()` is a supported answer, not an error.** With no keys set
 *    the game runs exactly as it does today — the Pro button falls back to the
 *    device-local grant in lib/monetization.ts. A missing processor must
 *    degrade to "billing not available", never to a broken front door.
 */

export const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY ?? "";
export const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET ?? "";

/**
 * Where Stripe sends the player back to.
 *
 * Checkout needs absolute URLs, and a Route Handler cannot infer its own
 * public origin reliably behind a proxy — `req.headers.host` is attacker-
 * controlled and would let someone redirect a successful purchase to their own
 * domain. So it is configuration, and an unset value disables billing rather
 * than guessing.
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");

/**
 * Billing needs the service role: the webhook writes `entitlements`, and 0001
 * gives that table a SELECT policy and nothing else on purpose. This is the
 * only feature in the app that needs it.
 */
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

/**
 * Which of the four required variables are unset.
 *
 * NAMES only, never values. The names are already public — they are listed in
 * .env.example in the repository — so this leaks nothing an attacker could not
 * read there, while turning "configured: false" from a dead end into an
 * instruction. Without it the only way to find the missing one is to guess,
 * which is exactly what happened the first time this was set up.
 */
export function missingBillingConfig(): string[] {
  const missing: string[] = [];
  if (!STRIPE_SECRET_KEY) missing.push("STRIPE_SECRET_KEY");
  if (!STRIPE_WEBHOOK_SECRET) missing.push("STRIPE_WEBHOOK_SECRET");
  if (!SUPABASE_SERVICE_ROLE_KEY) missing.push("SUPABASE_SERVICE_ROLE_KEY");
  if (!SITE_URL) missing.push("NEXT_PUBLIC_SITE_URL");
  return missing;
}

/**
 * Every piece has to be present. Half-configured billing is worse than none:
 * a checkout that completes against a webhook secret we do not hold takes the
 * player's money and never grants the thing they bought.
 */
export const billingConfigured = (): boolean => missingBillingConfig().length === 0;

/**
 * Test keys are `sk_test_…`, live keys are `sk_live_…`. Surfaced so the setup
 * doc and the checkout response can say which mode is answering — "why did my
 * card not get charged" is nearly always this.
 */
export const isLiveMode = (): boolean => STRIPE_SECRET_KEY.startsWith("sk_live_");
