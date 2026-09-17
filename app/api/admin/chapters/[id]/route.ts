import { NextResponse, type NextRequest } from "next/server";
import { adminGate, isUuid } from "@/lib/admin/guard";
import { boundedInt } from "@/lib/admin/directory";
import { adminClient } from "@/lib/supabase/admin";
import { withSession } from "@/lib/supabase/route";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The operator roster deliberately excludes invite tokens and auth records.
 * The account-level setup ledger is authoritative even after re-invitation. */
export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  const { id } = await context.params;
  const reply = (body: unknown, status = 200) =>
    withSession(
      NextResponse.json(body, {
        status,
        headers: { "Cache-Control": "no-store" },
      }),
      gate.session,
    );
  if (!isUuid(id)) return reply({ error: "Invalid enterprise." }, 400);
  let offset: number;
  try {
    offset = boundedInt(req.nextUrl.searchParams.get("offset"), 0, 10000000);
  } catch {
    return reply({ error: "Invalid page." }, 400);
  }
  const db = adminClient();
  const chapter = await db
    .from("chapters")
    .select("id")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (chapter.error) return reply({ error: "Enterprise unavailable." }, 503);
  if (!chapter.data) return reply({ error: "No such enterprise." }, 404);
  const seats = await db
    .from("chapter_seats")
    .select(
      "id, profile_id, email, seat_name, origin, invite_sent_at, claimed_at, created_by_invite",
      { count: "exact" },
    )
    .eq("chapter_id", id)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .range(offset, offset + 49);
  if (seats.error) return reply({ error: "Roster unavailable." }, 503);
  const rows = seats.data ?? [];
  const setup = rows.length
    ? await db
        .from("chapter_account_setup")
        .select("profile_id, completed_at")
        .in(
          "profile_id",
          rows.map((s) => s.profile_id),
        )
    : { data: [], error: null };
  if (setup.error)
    return reply({ error: "Invitation status unavailable." }, 503);
  const states = new Map(
    (setup.data ?? []).map((s) => [s.profile_id, s.completed_at]),
  );
  return reply({
    total: seats.count ?? 0,
    rows: rows.map(({ created_by_invite, ...s }) => ({
      ...s,
      pending: states.has(s.profile_id)
        ? states.get(s.profile_id) === null
        : created_by_invite && !s.claimed_at,
    })),
  });
}
