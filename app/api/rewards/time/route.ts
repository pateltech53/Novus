import { NextResponse } from "next/server";

import { nextResetAt, rewardDate } from "@/lib/rewards/tables";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The one clock.
 *
 * Every countdown in the app renders from the OFFSET between this answer and
 * the device's own clock, never from the device clock itself. Teen phones
 * drift, and a few are set wrong deliberately — a client-side "midnight" would
 * hand those accounts a second daily set, or hide the first.
 *
 * Fetched once a session; the client ticks locally from the offset.
 */
export function GET() {
  const now = new Date();
  return NextResponse.json({
    ok: true,
    serverNow: now.toISOString(),
    nextResetAt: nextResetAt(now).toISOString(),
    rewardDate: rewardDate(now),
  });
}
