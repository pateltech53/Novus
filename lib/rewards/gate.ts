import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { configured } from "@/lib/supabase/config";
import { sessionFromRequest, withSession, type Session } from "@/lib/supabase/route";

/**
 * The door every /api/rewards route stands behind.
 *
 * ── What it was ─────────────────────────────────────────────────────────────
 *
 * Two questions, in order: is there a player, and is the reward system turned
 * on FOR THEM. The second was a per-account beta flag an operator set from the
 * admin console (`entitlements.rewards_beta`), the same shape as a comped Pro,
 * because "ship it to staff, then to 10%" needs a switch that is a cell in the
 * database rather than a redeploy. Every route 404'd without it.
 *
 * ── What it is ──────────────────────────────────────────────────────────────
 *
 * The briefcase loop is launched. The first question is the whole gate now:
 * any signed-in account earns, claims, opens and wears. The flag did not go
 * away — it changed jobs. `rewards_beta` now marks a TESTER, and the only door
 * it still opens is `/api/rewards/sim`, the workbench that grants a case at a
 * chosen tier, completes a mission on demand and unlocks any skin. That is
 * what `betaGate` below is for, and it is the only caller that should ever
 * want it. The console band that sets the flag says "tester tools" for the
 * same reason (app/admin/page.tsx).
 *
 * The flag is read in the same query as before and handed back on the gate
 * (`beta`), so a route that wants to tell the client "show the BETA tab" —
 * /api/rewards/daily does — pays no second round trip for it.
 *
 * ── Why 404 and not 403 ─────────────────────────────────────────────────────
 *
 * Inherited from lib/admin/guard.ts, for the same reason: a door that is shut
 * for this visitor should not advertise what is behind it. A signed-out
 * request learns nothing it could screenshot; a non-tester poking at /sim
 * learns nothing about a workbench it cannot use. The client side reads a 404
 * as "nothing here for you" (lib/rewards/report.ts stops posting on one), and
 * the screens decide between "sign in" and "not switched on for this server"
 * by asking /api/auth/me, not by decoding the status.
 *
 * ── The cookie still rotates on a refusal ───────────────────────────────────
 *
 * sessionFromRequest SPENDS the refresh token. A refusal that dropped the
 * rotated cookie would sign the player out of the game for the crime of
 * loading a screen they cannot see yet.
 */

export type RewardGate =
  | { ok: true; session: Session; userId: string; beta: boolean }
  | { ok: false; res: NextResponse };

const notFound = () => NextResponse.json({ ok: false }, { status: 404 });

/**
 * Any signed-in account passes. `beta` says whether this account also holds
 * the tester flag, for the one route and the one tab that care.
 */
export async function rewardGate(req: NextRequest): Promise<RewardGate> {
  if (!configured()) return { ok: false, res: notFound() };

  const session = await sessionFromRequest(req);
  const userId = session?.userId;
  if (!userId) return { ok: false, res: withSession(notFound(), session) };

  return { ok: true, session, userId, beta: await hasRewardsBeta(userId) };
}

/**
 * The tester's door: the account must be signed in AND flagged. Used by
 * /api/rewards/sim and nothing else — every earning path is `rewardGate`.
 */
export async function betaGate(req: NextRequest): Promise<RewardGate> {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate;
  if (!gate.beta) return { ok: false, res: withSession(notFound(), gate.session) };
  return gate;
}

/**
 * Whether the tester flag is on for an account, without building a refusal.
 *
 * A missing row, a missing column (a database that never had 0017 applied —
 * the earning routes will fail on their own tables a moment later, loudly and
 * in the logs) and a database error all read as "not a tester": the flag can
 * only ever open the workbench, never close the loop.
 */
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
