import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { generateDaily } from "@/lib/rewards/daily";
import { rewardGate } from "@/lib/rewards/gate";
import { rewardDate, TIER_ODDS } from "@/lib/rewards/tables";
import { withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Today's five challenges, with this player's progress against them.
 *
 * The challenges themselves are not stored — `generateDaily` recomputes them
 * from the date, so this is a join between a pure function and whatever rows
 * the player's play has written. `?date=` is accepted so the client can ask
 * for the day it thinks it is on rather than racing the reset seam, but it is
 * clamped to today or yesterday: letting a client name any date would let it
 * farm a fresh set of five by asking for tomorrow.
 *
 * `beta` rides along because this is the first thing /rewards fetches: it is
 * how the screen knows whether to draw the BETA tab (the tester workbench,
 * components/rewards/BetaPanel.tsx) for this account. The flag is read by the
 * gate anyway, so telling the client costs nothing.
 */
export async function GET(req: NextRequest) {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate.res;

  const today = rewardDate(new Date());
  const yesterday = rewardDate(new Date(Date.now() - 86_400_000));
  const asked = req.nextUrl.searchParams.get("date");
  const date = asked === yesterday ? yesterday : today;

  const config = generateDaily(date);

  const { data: rows } = await adminClient()
    .from("daily_progress")
    .select("slot, progress, target, claimed_at")
    .eq("user_id", gate.userId)
    .eq("date", date);

  const bySlot = new Map((rows ?? []).map((r) => [r.slot as number, r]));

  const slots = config.slots.map((slot) => {
    const row = bySlot.get(slot.slot);
    const progress = Number(row?.progress ?? 0);
    const target = Number(row?.target ?? slot.target);
    return {
      slot: slot.slot,
      id: slot.id,
      band: slot.band,
      text: slot.text,
      progress,
      target,
      done: progress >= target,
      claimed: Boolean(row?.claimed_at),
      // The odds ride along with every card so the "i" popover never has to
      // fetch, and so what it shows is what this slot will actually roll.
      odds: TIER_ODDS[slot.band],
    };
  });

  return withSession(
    NextResponse.json({ ok: true, date, slots, beta: gate.beta }),
    gate.session,
  );
}
