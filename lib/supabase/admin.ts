import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_URL } from "./config";
import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";

/**
 * The service-role client. **Bypasses RLS entirely.**
 *
 * lib/supabase/route.ts exists so that ordinary requests run as the player and
 * RLS decides what they may touch. This file is the deliberate exception, and
 * it has exactly one caller: the Stripe webhook, which must write
 * `public.entitlements` — a table 0001 gives a SELECT policy and nothing else,
 * precisely so that the browser cannot grant itself Pro.
 *
 * Three guards, because the cost of getting this wrong is every player's save:
 *
 * · `import "server-only"` — a build error, not a runtime one, if a Client
 *   Component ever reaches this module. The key would otherwise ship to
 *   browsers, and a service-role key in a bundle is a full database breach.
 * · The key is read from a non-NEXT_PUBLIC_ variable. Next.js only inlines the
 *   prefixed ones, so there is no way for this value to reach the client
 *   bundle even by accident.
 * · No session, no refresh, no storage. This client is never a player.
 *
 * Every call made through it must filter by profile_id explicitly. There is no
 * RLS backstop here — a missing `.eq("profile_id", …)` is a query across every
 * account in the database, and it will succeed.
 */
export function adminClient(): SupabaseClient {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_URL not set — check billingConfigured() first",
    );
  }
  // Built per call rather than cached. This runs on the webhook path only,
  // where the cost is irrelevant next to the round trip to Stripe, and a
  // module-level singleton holding the service role is the kind of object that
  // gets imported somewhere it should not be because it was convenient.
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
