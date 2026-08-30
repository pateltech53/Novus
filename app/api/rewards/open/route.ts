import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { badRequest, rewardGate } from "@/lib/rewards/gate";
import { assertNoPermanentPro, rollOpen, type RollableItem } from "@/lib/rewards/roll";
import { TIER_NAMES, TIER_RARITY, TIER_SLUGS, type Tier } from "@/lib/rewards/tables";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Open a case. The one place inventory is ever written.
 *
 * ── Idempotent, because the audience plays on school wifi ───────────────────
 *
 * The roll is seeded on the briefcase id, and `open_briefcase` stores the
 * payload it commits. A retry therefore agrees with the original twice over:
 * the SQL replays the stored reveal without re-rolling, and even if it did
 * re-roll, the same seed would produce the same items. A half-committed open —
 * skin granted, tokens not — is impossible; it is one transaction.
 *
 * ── What the client is trusted with ─────────────────────────────────────────
 *
 * Nothing. It sends an id. The tier comes from the row, the pools come from
 * the database, the rarities come from the server's tables, and the payload it
 * gets back is the payload already written down.
 */
export async function POST(req: NextRequest) {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(NextResponse.json({ ok: false, error: "cross-site refused" }, { status: 403 }), gate.session);
  }

  let body: { briefcaseId?: unknown };
  try { body = (await req.json()) as typeof body; }
  catch { return withSession(badRequest("bad json"), gate.session); }

  const briefcaseId = String(body.briefcaseId ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(briefcaseId)) {
    return withSession(badRequest("briefcaseId required"), gate.session);
  }

  const db = adminClient();

  const { data: briefcase } = await db
    .from("briefcases")
    .select("id, tier, preset, upgrade_path, reveal")
    .eq("id", briefcaseId).eq("user_id", gate.userId)
    .maybeSingle();

  if (!briefcase) {
    return withSession(NextResponse.json({ ok: false }, { status: 404 }), gate.session);
  }

  const tier = briefcase.tier as Tier;

  // Already open: replay. No roll, no write, byte-identical answer.
  if (briefcase.reveal) {
    return withSession(
      NextResponse.json({ ok: true, ...briefcase.reveal, replayed: true }),
      gate.session,
    );
  }

  const [{ data: skinRows }, { data: rewardRows }, { data: ownedRows }, { data: pityRow }] =
    await Promise.all([
      db.from("skins").select("id, name, tier").eq("in_pool", true),
      db.from("rewards").select("id, name, kind, rarity, payload"),
      db.from("inventory").select("item_id").eq("user_id", gate.userId),
      db.from("pity_counters").select("since_rare, since_legendary").eq("user_id", gate.userId).maybeSingle(),
    ]);

  const skins: RollableItem[] = (skinRows ?? []).map((s) => ({
    id: `skin_${s.id}`,
    kind: "skin",
    name: s.name as string,
    rarity: TIER_RARITY[s.tier as Tier],
  }));

  const rewards: RollableItem[] = (rewardRows ?? []).map((r) => {
    const payload = (r.payload ?? {}) as Record<string, unknown>;
    const item: RollableItem = {
      id: r.id as string,
      kind: r.kind as string,
      name: r.name as string,
      rarity: r.rarity as RollableItem["rarity"],
      durationH: typeof payload.duration_h === "number" ? payload.duration_h : undefined,
      tokens: typeof payload.tokens === "number" ? payload.tokens : undefined,
    };
    // Belt and braces with the SQL constraint: a seed that slipped a
    // permanent pro flag into the pool dies here, loudly, before it can be
    // granted to anyone.
    assertNoPermanentPro({ kind: item.kind, durationH: item.durationH, raw: payload });
    return item;
  });

  const result = rollOpen({
    briefcaseId,
    tier,
    skins,
    rewards,
    owned: new Set((ownedRows ?? []).map((r) => r.item_id as string)),
    pity: {
      sinceRare: pityRow?.since_rare ?? 0,
      sinceLegendary: pityRow?.since_legendary ?? 0,
    },
    uuid: randomUUID,
  });

  const payload = {
    briefcaseId,
    tier,
    tierName: TIER_NAMES[tier],
    tierSlug: TIER_SLUGS[tier],
    preset: briefcase.preset,
    upgradePath: briefcase.upgrade_path,
    items: result.items,
    best: result.best,
    pity: result.pity,
  };

  const { data: committed, error } = await db.rpc("open_briefcase", {
    p_case: briefcaseId,
    p_user: gate.userId,
    p_payload: payload,
  });

  if (error) {
    return withSession(
      NextResponse.json({ ok: false, error: `open failed: ${error.message}` }, { status: 503 }),
      gate.session,
    );
  }

  // `committed` is what the database has — which is this payload, unless a
  // racing tap got there first, in which case it is theirs and this one was
  // never written. Returning the database's answer rather than the local one
  // is what makes two simultaneous opens agree.
  return withSession(NextResponse.json({ ok: true, ...(committed ?? payload) }), gate.session);
}
