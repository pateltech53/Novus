import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { rewardGate } from "@/lib/rewards/gate";
import { MILESTONES } from "@/lib/rewards/templates";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Career milestones — the cases you get for simply having played.
 *
 * ── Why these exist beside the dailies ──────────────────────────────────────
 *
 * The daily loop rewards showing up today. It has nothing to say to a player
 * who closed their first deal, survived five years, or delivered their
 * fiftieth pitch — moments that are worth more than a day's mission and
 * happen on their own schedule. Milestones are that: fixed, one-time, and
 * unmissable. They are also what a returning player who lost a week still has
 * waiting for them.
 *
 * ── Why the server decides, from the save ───────────────────────────────────
 *
 * Every milestone below is checked against the player's SYNCED SAVE, not
 * against anything the client asserts. "Survive 10 years" is true when
 * `saves.year >= 10` on this server. That makes the whole family
 * self-healing: a player who earned one before briefcases reached them, or
 * while offline, collects it the next time this route runs, and there is no
 * event to miss. It is also how every account that existed before the launch
 * gets its first case: the career it already has is checked on the first
 * visit to /rewards.
 *
 * Idempotency is the `milestones_claimed` row, not a timestamp comparison —
 * two taps race into one insert and the loser grants nothing.
 */
export async function POST(req: NextRequest) {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(NextResponse.json({ ok: false }, { status: 403 }), gate.session);
  }

  const db = adminClient();

  const [{ data: save }, { data: claimed }] = await Promise.all([
    db.from("saves").select("state, year, valuation, alive, ended_by")
      .eq("profile_id", gate.userId).order("updated_at", { ascending: false })
      .limit(1).maybeSingle(),
    db.from("milestones_claimed").select("milestone_id").eq("user_id", gate.userId),
  ]);

  const already = new Set((claimed ?? []).map((r) => r.milestone_id as string));

  const state = (save?.state ?? {}) as Record<string, unknown>;
  const legacy = (state.legacy ?? {}) as Record<string, unknown>;
  const autopsies = Array.isArray(legacy.autopsies) ? legacy.autopsies : [];

  const year = Number(save?.year ?? 0);
  const valuation = Number(save?.valuation ?? 0);
  const bestYear = Math.max(year, Number(legacy.bestYear ?? 0));
  const industries = new Set(
    autopsies.map((a) => String((a as Record<string, unknown>).industry ?? "")).filter(Boolean),
  );

  // The count of days on which this account claimed at least one daily — the
  // "25 / 100 / 365 dailies" family, counted from the ledger rather than a
  // running total nobody can audit.
  const { count: dailyDays } = await db
    .from("daily_progress")
    .select("date", { count: "exact", head: true })
    .eq("user_id", gate.userId)
    .not("claimed_at", "is", null);

  /** Whether the save says this milestone has been reached. */
  const reached: Record<string, boolean> = {
    M_YEARS_5: bestYear >= 5,
    M_YEARS_10: bestYear >= 10,
    M_YEARS_25: bestYear >= 25,
    M_VAL_1M: valuation >= 1_000_000,
    M_VAL_10M: valuation >= 10_000_000,
    M_VAL_100M: valuation >= 100_000_000,
    M_BANKRUPT: autopsies.some((a) => (a as Record<string, unknown>).endedBy === "chapter7"),
    M_SELL: autopsies.some((a) => (a as Record<string, unknown>).endedBy === "acquired"),
    M_IPO: autopsies.some((a) => (a as Record<string, unknown>).endedBy === "ipo"),
    M_INDUSTRIES: industries.size >= 12,
    M_DAILIES_25: (dailyDays ?? 0) >= 25,
    M_DAILIES_100: (dailyDays ?? 0) >= 100,
    M_DAILIES_365: (dailyDays ?? 0) >= 365,
  };

  const earned = MILESTONES.filter((m) => reached[m.id] && !already.has(m.id));
  const granted: { id: string; text: string; tier: number; briefcaseId: string }[] = [];

  for (const milestone of earned) {
    // Claim the milestone FIRST. If the grant then fails the player is owed a
    // case and can be given one by hand; if the order were reversed, a retry
    // would hand out a second one every time.
    const { error: claimErr } = await db
      .from("milestones_claimed")
      .insert({ user_id: gate.userId, milestone_id: milestone.id });
    if (claimErr) continue;                        // raced, or already there

    const { data: caseId } = await db.rpc("grant_briefcase", {
      p_user: gate.userId,
      p_tier: milestone.tier,
      p_source: `milestone:${milestone.id}`,
      // A milestone is a PRIZE, not a gamble — same beats, no odds framing,
      // and no three-tap upgrade on a tier that was promised.
      p_preset: "prize",
      p_path: [milestone.tier],
    });
    if (caseId) {
      granted.push({ id: milestone.id, text: milestone.text, tier: milestone.tier, briefcaseId: caseId });
    }
  }

  return withSession(
    NextResponse.json({ ok: true, granted, checked: Object.keys(reached).length }),
    gate.session,
  );
}
