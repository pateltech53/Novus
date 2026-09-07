import type { Metadata } from "next";

import RewardsHome from "@/components/rewards/RewardsHome";

export const metadata: Metadata = {
  title: "Briefcases · Novus",
  // A signed-in screen: nothing on it renders for a crawler, and the odds it
  // publishes are already on /api/rewards/odds.
  robots: { index: false, follow: false },
};

/**
 * /rewards — the briefcase loop.
 *
 * A route rather than a panel inside /play, because the loop is checked
 * BETWEEN sessions as often as during one: a player opening the app to see
 * what today asks for has not started a run yet, and should not have to.
 *
 * Everything under it needs a signed-in account — the rolls happen on the
 * server and the inventory lives there (lib/rewards/gate.ts). A signed-out
 * visitor gets a sign-in prompt from RewardsHome rather than an error, and a
 * server that never had migration 0017 applied gets told so in words an
 * operator can act on (supabase/CHECK-SCHEMA.sql names the file to run).
 */
export default function RewardsPage() {
  return <RewardsHome />;
}
