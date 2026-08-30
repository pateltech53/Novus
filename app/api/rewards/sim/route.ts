import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { generateDaily } from "@/lib/rewards/daily";
import { badRequest, rewardGate } from "@/lib/rewards/gate";
import { rollTier } from "@/lib/rewards/roll";
import { rewardDate, type Tier } from "@/lib/rewards/tables";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The beta tester's workbench.
 *
 * Testing this system by playing it honestly is impractical: a Gold case is a
 * 2.5% roll on the hardest daily, so verifying the Legendary reveal would mean
 * grinding for a fortnight and getting lucky. These actions skip the earning
 * so the CEREMONY, the wardrobe and the economy can be exercised in minutes.
 *
 * ── Why this is not an admin route ──────────────────────────────────────────
 *
 * It acts on the CALLER'S OWN account and nobody else's — there is no
 * `profileId` parameter anywhere below. That is what makes it safe to hand to
 * a tester who is not an operator: the worst it can do is fill their own
 * wardrobe. Handing out someone else's inventory stays behind /api/admin/*.
 *
 * ── Why it is still gated ───────────────────────────────────────────────────
 *
 * `rewardGate` means only accounts an operator has switched into the beta can
 * reach it, and it 404s for everyone else. When the beta flag comes off at
 * full launch this route stops answering with it — which is the intended
 * lifecycle, not an oversight.
 */

type Action =
  | { action: "complete-daily"; slot: number }
  | { action: "grant-case"; tier: Tier }
  | { action: "unlock-skin"; skinId: string }
  | { action: "add-tokens"; amount: number }
  | { action: "reset-day" };

export async function POST(req: NextRequest) {
  const gate = await rewardGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(NextResponse.json({ ok: false }, { status: 403 }), gate.session);
  }

  let body: Partial<Action> & Record<string, unknown>;
  try { body = (await req.json()) as typeof body; }
  catch { return withSession(badRequest("bad json"), gate.session); }

  const db = adminClient();
  const date = rewardDate(new Date());
  const user = gate.userId;

  switch (body.action) {
    /*
     * Mark one of today's five finished, so the Claim button lights up and the
     * real claim path — tier roll, case grant, ceremony — runs for real. The
     * simulation stops at the boundary of the thing being tested rather than
     * fabricating a case directly.
     */
    case "complete-daily": {
      const slot = Number(body.slot);
      const config = generateDaily(date);
      const definition = config.slots.find((s) => s.slot === slot);
      if (!definition) return withSession(badRequest("no such slot today"), gate.session);

      const { error } = await db.from("daily_progress").upsert({
        user_id: user, date, slot,
        template_id: definition.id,
        param: definition.param,
        progress: definition.target,
        target: definition.target,
      }, { onConflict: "user_id,date,slot" });
      if (error) return withSession(badRequest(error.message), gate.session);
      return withSession(NextResponse.json({ ok: true, slot, text: definition.text }), gate.session);
    }

    /*
     * A case of a chosen tier, straight into the Vault. `sim:` in the source
     * column is deliberate: it keeps test cases distinguishable from earned
     * ones in the grants table forever, so beta noise never looks like real
     * economy data in an analytics query.
     */
    case "grant-case": {
      const tier = Number(body.tier) as Tier;
      if (![1, 2, 3, 4, 5].includes(tier)) return withSession(badRequest("tier must be 1–5"), gate.session);
      // A real upgrade path so the taps behave exactly as they would in play.
      const band = tier >= 3 ? "hard" : tier >= 2 ? "medium" : "easy";
      const { path } = rollTier(band, `sim:${user}:${Date.now()}`);
      const { data, error } = await db.rpc("grant_briefcase", {
        p_user: user, p_tier: tier, p_source: "sim:granted",
        p_preset: "full", p_path: path.map((t) => Math.min(t, tier)),
      });
      if (error) return withSession(badRequest(error.message), gate.session);
      return withSession(NextResponse.json({ ok: true, briefcaseId: data }), gate.session);
    }

    /*
     * Put a specific skin in the wardrobe without a case around it.
     *
     * This is the ONE place the universal-ceremony rule is bent, and only
     * because the thing being tested is often the wardrobe itself — checking
     * that 100 silhouettes fill in correctly should not require 100 ceremonies.
     */
    case "unlock-skin": {
      const skinId = String(body.skinId ?? "");
      const { data: skin } = await db.from("skins").select("id, name").eq("id", skinId).maybeSingle();
      if (!skin) return withSession(badRequest("no such skin"), gate.session);
      const { error } = await db.from("inventory").upsert({
        user_id: user, item_id: `skin_${skin.id}`, kind: "skin",
      }, { onConflict: "user_id,item_id" });
      if (error) return withSession(badRequest(error.message), gate.session);
      return withSession(NextResponse.json({ ok: true, skin: skin.name }), gate.session);
    }

    /* Tokens, so the shop can be exercised without opening forty cases. */
    case "add-tokens": {
      const amount = Math.max(-100_000, Math.min(100_000, Number(body.amount) || 0));
      const { error } = await db.from("token_ledger").insert({
        user_id: user, delta: amount, reason: "sim:granted",
      });
      if (error) return withSession(badRequest(error.message), gate.session);
      return withSession(NextResponse.json({ ok: true, amount }), gate.session);
    }

    /*
     * Wind today back so the same five can be completed and claimed again —
     * the loop under test is a DAILY one, and waiting until 09:00 UTC to try
     * the second lap is not a test cycle.
     */
    case "reset-day": {
      await db.from("daily_progress").delete().eq("user_id", user).eq("date", date);
      return withSession(NextResponse.json({ ok: true, date }), gate.session);
    }

    default:
      return withSession(badRequest("unknown action"), gate.session);
  }
}
