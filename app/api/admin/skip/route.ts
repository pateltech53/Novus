import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit } from "@/lib/admin/guard";
import { INDUSTRIES } from "@/lib/engine/constants";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/skip — a checkout, minus the checkout.
 *
 * `{ sku, industry? }` in the catalogue's own vocabulary. Grants the item to
 * the CALLING ADMIN'S OWN account — never a third party's; the console's
 * gifting routes are for that — using the same functions the Stripe webhook
 * calls, so a skipped purchase and a paid one are indistinguishable rows:
 *
 *   pro_monthly / pro_yearly → admin_set_comp_pro (the comp column, because
 *                              the webhook owns `pro` and would overwrite it)
 *   industry_pack + industry → grant_industry_pack (0003, the webhook's own)
 *   extra_run_slot           → grant_extra_run_slot (0003, ditto)
 *   chapter_35 / chapter_100 → admin_create_comp_chapter (0009)
 *
 * Every skip writes an audit row, so "why does this account own that" is
 * always answerable.
 */

const PRO_SKUS = ["pro_monthly", "pro_yearly"] as const;
const CHAPTER_SKUS = ["chapter_35", "chapter_100"] as const;
const CODES: readonly string[] = INDUSTRIES.map((i) => i.code);

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { sku?: unknown; industry?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  const sku = typeof body.sku === "string" ? body.sku : "";
  const self = gate.session.userId;
  const db = adminClient();

  let error: { message: string } | null = null;

  if ((PRO_SKUS as readonly string[]).includes(sku)) {
    ({ error } = await db.rpc("admin_set_comp_pro", {
      p_profile: self,
      p_active: true,
      p_until: null,
      p_note: `checkout skipped — ${sku}`,
    }));
  } else if (sku === "industry_pack") {
    if (typeof body.industry !== "string" || !CODES.includes(body.industry)) {
      return withSession(bad(400, "a real industry code is required"), gate.session);
    }
    ({ error } = await db.rpc("grant_industry_pack", {
      p_profile: self,
      p_industry: body.industry,
    }));
  } else if (sku === "extra_run_slot") {
    ({ error } = await db.rpc("grant_extra_run_slot", { p_profile: self }));
  } else if ((CHAPTER_SKUS as readonly string[]).includes(sku)) {
    ({ error } = await db.rpc("admin_create_comp_chapter", {
      p_owner: self,
      p_licence: sku,
      p_until: null,
    }));
    if (error?.message.includes("already owns an active chapter")) {
      return withSession(
        bad(409, "this account already runs a chapter — its console is at /chapter"),
        gate.session,
      );
    }
  } else {
    return withSession(bad(400, "unknown sku"), gate.session);
  }

  if (error) {
    return withSession(bad(503, `grant failed: ${error.message}`), gate.session);
  }

  await audit(gate.session, "checkout_skip", {
    target: self,
    targetEmail: gate.session.email,
    detail: { sku, ...(typeof body.industry === "string" ? { industry: body.industry } : {}) },
  });

  return withSession(NextResponse.json({ ok: true }), gate.session);
}
