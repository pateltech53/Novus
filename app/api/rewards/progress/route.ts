import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { generateDaily } from "@/lib/rewards/daily";
import { badRequest, rewardGate } from "@/lib/rewards/gate";
import { advanceBy, capFor, isCumulative, type PlayEvent, type SaveFacts } from "@/lib/rewards/progress";
import { rewardDate } from "@/lib/rewards/tables";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/rewards/progress — play, turned into progress.
 *
 * The client posts the moments it just had; the server decides what they are
 * worth. Nothing here grants anything: the most this route can do is move a
 * number up to its target, and /claim is still the only path to a case.
 *
 * ── The two anti-abuse measures that matter ─────────────────────────────────
 *
 * 1. **Facts the save knows are read from the save.** Fiscal year, valuation,
 *    cash and net worth come out of `saves.state` on this server, not out of
 *    the request body. Claiming "I reached year 10" therefore requires a save
 *    that says so, and /api/sync already owns that write.
 * 2. **Everything else is rate-capped per day.** A pitch takes a minute, so
 *    forty scored pitches is a generous ceiling and four hundred is a script.
 *    The cap is per event TYPE per reward-day, counted in the same row the
 *    progress lands in.
 *
 * Neither makes cheating impossible — a determined player can edit their own
 * save. Both make it *more work than playing*, which for a cosmetic-only
 * reward loop is the right place to stop. Nothing here touches the
 * leaderboard, which is scored separately and server-side.
 */

const MAX_EVENTS = 40;

export async function POST(req: NextRequest) {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(NextResponse.json({ ok: false }, { status: 403 }), gate.session);
  }

  let body: { events?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { return withSession(badRequest("bad json"), gate.session); }

  const events = Array.isArray(body.events) ? (body.events as PlayEvent[]).slice(0, MAX_EVENTS) : null;
  if (!events?.length) return withSession(badRequest("events required"), gate.session);

  const db = adminClient();
  const date = rewardDate(new Date());
  const config = generateDaily(date);

  // The save is the source of truth for anything it can answer. One read,
  // reused across every event in the batch.
  const facts = await readFacts(db, gate.userId);

  const { data: existing } = await db
    .from("daily_progress")
    .select("slot, template_id, param, progress, target, claimed_at")
    .eq("user_id", gate.userId).eq("date", date);

  const rows = new Map((existing ?? []).map((r) => [r.slot as number, r]));

  // Per-type spend for the day, so a cap is enforced across batches rather
  // than only within one request.
  const { count: todaysEvents } = await db
    .from("reward_events")
    .select("id", { count: "exact", head: true })
    .eq("user_id", gate.userId).eq("date", date);
  let budget = Math.max(0, 600 - (todaysEvents ?? 0));

  const touched: number[] = [];
  const perType = new Map<string, number>();

  for (const event of events) {
    if (budget <= 0) break;
    if (typeof event?.type !== "string") continue;

    const spent = (perType.get(event.type) ?? 0) + 1;
    perType.set(event.type, spent);
    if (spent > capFor(event.type)) continue;
    budget--;

    for (const slot of config.slots) {
      const row = rows.get(slot.slot);
      if (row?.claimed_at) continue;                    // already paid out

      const gain = advanceBy(slot, event, facts);
      if (gain <= 0) continue;

      const target = Number(row?.target ?? slot.target);
      const current = Number(row?.progress ?? 0);
      const next = isCumulative(slot.id)
        ? Math.min(target, current + gain)
        : Math.max(current, Math.min(target, gain));
      if (next <= current) continue;

      rows.set(slot.slot, {
        slot: slot.slot, template_id: slot.id, param: slot.param,
        progress: next, target, claimed_at: null,
      });
      if (!touched.includes(slot.slot)) touched.push(slot.slot);
    }
  }

  if (touched.length) {
    await db.from("daily_progress").upsert(
      touched.map((slot) => {
        const row = rows.get(slot)!;
        return {
          user_id: gate.userId, date, slot,
          template_id: row.template_id, param: row.param,
          progress: row.progress, target: row.target,
        };
      }),
      { onConflict: "user_id,date,slot" },
    );
  }

  // The audit trail the cap counts against. Cheap, and it is also the only
  // record of what a player's day actually looked like when a number is
  // disputed.
  await db.from("reward_events").insert(
    events.slice(0, 40).map((e) => ({
      user_id: gate.userId, date, type: String(e.type).slice(0, 40),
    })),
  );

  return withSession(
    NextResponse.json({
      ok: true,
      advanced: touched,
      slots: config.slots.map((s) => {
        const row = rows.get(s.slot);
        return {
          slot: s.slot,
          progress: Number(row?.progress ?? 0),
          target: Number(row?.target ?? s.target),
          done: Number(row?.progress ?? 0) >= Number(row?.target ?? s.target),
        };
      }),
    }),
    gate.session,
  );
}

/**
 * The facts the save can answer, read from the save.
 *
 * A missing or unparseable save yields null rather than zeroes: "no save" must
 * fail every threshold, and zeroes would quietly pass a `>= 0` one.
 */
async function readFacts(
  db: ReturnType<typeof adminClient>,
  userId: string,
): Promise<SaveFacts | null> {
  const { data } = await db
    .from("saves")
    .select("state, year, valuation, cash")
    .eq("profile_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;

  const state = (data.state ?? {}) as Record<string, unknown>;
  const run = (state.run ?? {}) as Record<string, unknown>;
  const legacy = (state.legacy ?? {}) as Record<string, unknown>;
  const autopsies = Array.isArray(legacy.autopsies) ? legacy.autopsies : [];

  return {
    year: Number(data.year ?? run.year ?? 0),
    valuation: Number(data.valuation ?? run.valuation ?? 0),
    cash: Number(data.cash ?? run.cash ?? 0),
    netWorth: Number(run.netWorth ?? data.valuation ?? 0),
    industriesPlayed: autopsies
      .map((a) => String((a as Record<string, unknown>).industry ?? ""))
      .filter(Boolean),
    runsStarted: autopsies.length + 1,
    pitchesDelivered: Number(legacy.pitchesDelivered ?? 0),
  };
}
