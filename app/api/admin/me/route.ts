import { NextResponse, type NextRequest } from "next/server";

import { adminGate } from "@/lib/admin/guard";
import { withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/me — who this session is, is it an admin, and at which view.
 *
 * The console's mount question. Everyone else gets the same 404 the rest of
 * app/api/admin/* answers with, so the route's existence proves nothing to a
 * player poking at paths.
 *
 * The id comes back so the console can recognise the operator's own row in
 * the directory and offer no role button on it — the refusal that matters
 * lives in /api/admin/role, this just stops the console asking for something
 * it will be told it cannot have.
 */
export async function GET(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;

  return withSession(
    NextResponse.json({
      ok: true,
      id: gate.session.userId,
      view: gate.view,
      email: gate.session.email,
    }),
    gate.session,
  );
}
