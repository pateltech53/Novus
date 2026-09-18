import { NextResponse, type NextRequest } from "next/server";
import { adminGate } from "@/lib/admin/guard";
import { boundedInt } from "@/lib/admin/directory";
import { adminClient } from "@/lib/supabase/admin";
import { withSession } from "@/lib/supabase/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read-only, paged audit search. Dates are UTC calendar days; the end day
 * is inclusive to the operator and exclusive in SQL. No audit row is edited. */
export async function GET(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  try {
    const p = req.nextUrl.searchParams;
    const offset = boundedInt(p.get("offset"), 0, 10000000);
    let q = adminClient()
      .from("admin_audit")
      .select("id, action, actor_email, target_email, detail, created_at", {
        count: "exact",
      });
    for (const [param, column] of [
      ["actor", "actor_email"],
      ["target", "target_email"],
      ["action", "action"],
    ]) {
      const value = p.get(param)?.trim().slice(0, 200);
      if (value) q = q.ilike(column, `%${value.replace(/[\\%_]/g, "\\$&")}%`);
    }
    for (const field of ["from", "to"]) {
      const value = p.get(field);
      if (!value) continue;
      if (
        !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value
      )
        throw new Error("Use a valid calendar date.");
      q =
        field === "from"
          ? q.gte("created_at", `${value}T00:00:00Z`)
          : q.lt(
              "created_at",
              new Date(Date.parse(value) + 86400000).toISOString(),
            );
    }
    if (p.get("from") && p.get("to") && p.get("from")! > p.get("to")!)
      throw new Error("Start date must be before end date.");
    const { data, count, error } = await q
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + 49);
    if (error)
      return withSession(
        NextResponse.json(
          { ok: false, error: "Audit log unavailable. Retry." },
          { status: 503 },
        ),
        gate.session,
      );
    return withSession(
      NextResponse.json(
        { rows: data ?? [], total: count ?? 0 },
        { headers: { "Cache-Control": "no-store" } },
      ),
      gate.session,
    );
  } catch (e) {
    return withSession(
      NextResponse.json(
        { ok: false, error: (e as Error).message },
        { status: 400 },
      ),
      gate.session,
    );
  }
}
