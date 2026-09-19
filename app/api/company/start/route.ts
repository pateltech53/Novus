import { randomInt } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { account, answer } from "@/lib/competitions/server";
import { adminClient } from "@/lib/supabase/admin";
import { wireEntitlements } from "@/lib/admin/entitlements";
import { industryUnlocked, NO_ENTITLEMENTS, isPro } from "@/lib/monetization";
import { INDUSTRIES } from "@/lib/engine/constants";
import { isUuid } from "@/lib/admin/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const session = await account(req);
  if (session instanceof NextResponse) return session;
  let b;
  try {
    b = await req.json();
  } catch {
    return answer(session, { error: "Invalid request." }, 400);
  }
  if (
    !isUuid(b?.requestId) ||
    !INDUSTRIES.some((i) => i.code === b.industry) ||
    typeof b.tutorial !== "boolean" ||
    typeof b.day !== "string" ||
    !/^\d{4}-\d{2}-\d{2}$/.test(b.day) ||
    !Number.isInteger(b.started) ||
    b.started < 0 ||
    b.started > 10000
  )
    return answer(session, { error: "Invalid founding details." }, 400);
  const db = adminClient();
  const [e, p] = await Promise.all([
    db
      .from("entitlements")
      .select("*")
      .eq("profile_id", session.userId)
      .maybeSingle(),
    db
      .from("profiles")
      .select("role,admin_view")
      .eq("id", session.userId)
      .maybeSingle(),
  ]);
  if (e.error || p.error)
    return answer(session, { error: "Could not check your allowance." }, 503);
  const ent = wireEntitlements(e.data, p.data) ?? NO_ENTITLEMENTS;
  if (!industryUnlocked(b.industry, ent))
    return answer(session, { error: "This industry is not unlocked." }, 403);
  const seed = randomInt(0, 0x100000000);
  const { data, error } = await db.rpc("register_company_start", {
    p_profile: session.userId,
    p_request: b.requestId,
    p_seed: seed,
    p_run: `run-${seed.toString(36)}`,
    p_industry: b.industry,
    p_tutorial: b.tutorial,
    p_pro: isPro(ent) || ent.admin,
    p_day: b.day,
    p_local_started: b.started,
  });
  return answer(
    session,
    error ? { error: error.message } : { ok: true, start: data },
    error ? 409 : 200,
  );
}
