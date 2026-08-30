import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { configured } from "@/lib/supabase/config";
import { sessionFromRequest, withSession, type Session } from "@/lib/supabase/route";

/**
 * The door every /api/rewards route stands behind.
 *
 * Two questions, in order: is there a player, and is the reward system turned
 * on FOR THEM. The second is a per-account beta flag an operator sets from the
 * admin console (`entitlements.rewards_beta`), the same shape as a comped Pro
 * — because "ship it to staff, then to 10%" needs a switch that is a cell in
 * the database, not a redeploy.
 *
 * ── Why 404 and not 403 ─────────────────────────────────────────────────────
 *
 * Inherited from lib/admin/guard.ts, for the same reason: a feature that is
 * off for this account should not advertise itself. A player poking at
 * /api/rewards/vault before the beta reaches them learns nothing they could
 * screenshot into a group chat, and the flag stops being a countdown.
 *
 * ── The cookie still rotates on a refusal ───────────────────────────────────
 *
 * sessionFromRequest SPENDS the refresh token. A refusal that dropped the
 * rotated cookie would sign the player out of the game for the crime of
 * loading a screen they cannot see yet.
 */

export type RewardGate =
  | { ok: true; session: Session; userId: string }
  | { ok: false; res: NextResponse };

const notFound = () => NextResponse.json({ ok: false }, { status: 404 });

export async function rewardGate(req: NextRequest): Promise<RewardGate> {
  if (!configured()) return { ok: false, res: notFound() };

  const session = await sessionFromRequest(req);
  const userId = session?.userId;
  if (!userId) return { ok: false, res: withSession(notFound(), session) };

  const { data } = await adminClient()
    .from("entitlements")
    .select("rewards_beta")
    .eq("profile_id", userId)
    .maybeSingle();

  if (!data?.rewards_beta) {
    return { ok: false, res: withSession(notFound(), session) };
  }
  return { ok: true, session, userId };
}

/** Whether the beta is on for an account, without building a refusal. */
export async function hasRewardsBeta(userId: string): Promise<boolean> {
  const { data } = await adminClient()
    .from("entitlements")
    .select("rewards_beta")
    .eq("profile_id", userId)
    .maybeSingle();
  return Boolean(data?.rewards_beta);
}

export const badRequest = (message: string) =>
  NextResponse.json({ ok: false, error: message }, { status: 400 });
