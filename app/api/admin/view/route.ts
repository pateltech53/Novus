import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/view — switch what the admin's OWN account plays at.
 *
 * `{ view: "free" | "pro" | "all" }` → profiles.admin_view, written on the
 * service role because the guard trigger (0009) refuses the change from the
 * caller's own client on purpose — the column decides access, so it moves
 * only through this gate. The next entitlements read (the console triggers
 * one immediately) carries the new tier to the game.
 */

const VIEWS = ["free", "pro", "all"] as const;
type View = (typeof VIEWS)[number];

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { view?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  if (typeof body.view !== "string" || !VIEWS.includes(body.view as View)) {
    return withSession(bad(400, "view must be free, pro or all"), gate.session);
  }

  const { error } = await adminClient()
    .from("profiles")
    .update({ admin_view: body.view })
    .eq("id", gate.session.userId);
  if (error) {
    return withSession(bad(503, `view change failed: ${error.message}`), gate.session);
  }

  await audit(gate.session, "view_set", { detail: { view: body.view } });

  return withSession(NextResponse.json({ ok: true, view: body.view }), gate.session);
}
