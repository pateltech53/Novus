import "server-only";

import Stripe from "stripe";

import { STRIPE_SECRET_KEY } from "./config";

/**
 * The Stripe SDK instance.
 *
 * `import "server-only"` is the load-bearing line. The secret key is a
 * full-access credential for the Stripe account, and one `"use client"` at the
 * top of a file that imports this one would compile it into a bundle every
 * browser downloads. The package makes that a build error instead of a
 * disclosure.
 *
 * Lazy rather than module-level so importing this file on a deploy with no
 * keys set does not throw at import time — billingConfigured() is allowed to
 * be false, and a route that checks it must be able to load first.
 */
let cached: Stripe | null = null;

export function stripe(): Stripe {
  if (!STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is not set — check billingConfigured() first");
  }
  if (!cached) {
    cached = new Stripe(STRIPE_SECRET_KEY, {
      // Pinned, and pinned to the version THIS SDK's types describe — a
      // webhook that starts receiving a different shape because the account
      // default moved is a payment that silently stops granting anything.
      // Bumping it means re-reading lib/stripe/subscription.ts, which already
      // has one field that moved between versions.
      apiVersion: "2026-07-29.dahlia",
      appInfo: { name: "Novus", url: "https://github.com/pateltech53/novus" },
      // A hung Stripe call must not hold a Route Handler open until the
      // platform's own timeout kills it mid-purchase.
      timeout: 20_000,
      maxNetworkRetries: 2,
    });
  }
  return cached;
}
