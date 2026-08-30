import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { generateDaily } from "@/lib/rewards/daily";
import { badRequest, rewardGate } from "@/lib/rewards/gate";
import { rollTier } from "@/lib/rewards/roll";
import { rewardDate } from "@/lib/rewards/tables";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Claim a finished daily. This is where the tier is rolled.
 *
 * The roll happens HERE and not at open, because the grant has to be committed
 * before the ceremony plays — if the app dies mid-animation the case is
 * already in the Vault. The ceremony is presentation over a decision already
 * made and stored.
 *
 * ── The three things this route refuses ─────────────────────────────────────
 *
 * 1. Claiming a slot the player has not finished. `progress >= target` is
 *    checked against the SERVER's row, not a flag in the request body.
 * 2. Claiming twice. `claimed_at` is the latch, and the update that sets it is
 *    conditional on it being null — so two taps race into one grant, and the
 *    loser is told the truth rather than handed a second case.
 * 3. Claiming a slot that is not in today's five. The slot number is checked
 *    against the recomputed day.
 */
export async function POST(req: NextRequest) {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(NextResponse.json({ ok: false, error: "cross-site refused" }, { status: 403 }), gate.session);
  }

  let body: { slot?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { return withSession(badRequest("bad json"), gate.session); }

  const slot = Number(body.slot);
  if (!Number.isInteger(slot) || slot < 1 || slot > 5) {
    return withSession(badRequest("slot must be 1–5"), gate.session);
  }

  const date = rewardDate(new Date());
  const config = generateDaily(date);
  const definition = config.slots.find((s) => s.slot === slot);
  if (!definition) return withSession(badRequest("no such slot today"), gate.session);

  const db = adminClient();

  const { data: row } = await db
    .from("daily_progress")
    .select("progress, target, claimed_at")
    .eq("user_id", gate.userId).eq("date", date).eq("slot", slot)
    .maybeSingle();

  if (!row || Number(row.progress) < Number(row.target)) {
    return withSession(
      NextResponse.json({ ok: false, error: "not finished yet" }, { status: 409 }),
      gate.session,
    );
  }
  if (row.claimed_at) {
    return withSession(
      NextResponse.json({ ok: false, error: "already claimed" }, { status: 409 }),
      gate.session,
    );
  }

  // The latch. `is("claimed_at", null)` makes this the whole of the
  // double-claim guard: whichever of two racing taps updates zero rows lost,
  // and no case is granted for it.
  const { data: latched } = await db
    .from("daily_progress")
    .update({ claimed_at: new Date().toISOString() })
    .eq("user_id", gate.userId).eq("date", date).eq("slot", slot)
    .is("claimed_at", null)
    .select("slot");

  if (!latched?.length) {
    return withSession(
      NextResponse.json({ ok: false, error: "already claimed" }, { status: 409 }),
      gate.session,
    );
  }

  // Seeded on the account, day and slot: the same claim always rolls the same
  // tier, so a retry that lost its response cannot re-roll into something
  // better, and a support ticket is reproducible from three known values.
  const { tier, path } = rollTier(definition.band, `${gate.userId}:${date}:${slot}`);

  const { data: caseId, error } = await db.rpc("grant_briefcase", {
    p_user: gate.userId,
    p_tier: tier,
    p_source: `daily:${date}:${slot}`,
    p_preset: "full",
    p_path: path,
  });

  if (error) {
    return withSession(
      NextResponse.json({ ok: false, error: `grant failed: ${error.message}` }, { status: 503 }),
      gate.session,
    );
  }

  // Note what is NOT returned: the tier. The player learns it from the
  // ceremony's burst, and an API that leaked it here would make the reveal a
  // formality for anyone with devtools open.
  return withSession(
    NextResponse.json({ ok: true, briefcaseId: caseId }),
    gate.session,
  );
}
