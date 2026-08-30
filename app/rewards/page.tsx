import type { Metadata } from "next";

import RewardsHome from "@/components/rewards/RewardsHome";

export const metadata: Metadata = {
  title: "Briefcases · Novus",
  // Reached by URL while the beta is on, and linked from nowhere public.
  robots: { index: false, follow: false },
};

/**
 * /rewards — the briefcase loop.
 *
 * A route rather than a panel inside /play, because the loop is checked
 * BETWEEN sessions as often as during one: a player opening the app to see
 * what today asks for has not started a run yet, and should not have to.
 *
 * Everything under it is gated per account. An account outside the beta gets
 * empty lists rather than an error, because every /api/rewards route answers
 * 404 for them — a feature that is off should not advertise itself.
 */
export default function RewardsPage() {
  return <RewardsHome />;
}
