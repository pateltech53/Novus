import { NextResponse, type NextRequest } from "next/server";

import { adminGate, audit, isUuid } from "@/lib/admin/guard";
import { adminClient } from "@/lib/supabase/admin";
import { crossSite, withSession } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/admin/role — make another account an admin, or take it back.
 *
 * `{ profileId, role: "admin" | "player" }` → profiles.role, written on the
 * service role, exactly as /api/admin/view writes profiles.admin_view.
 *
 * ── Why this exists now, when 0009 said the dashboard and nowhere else ──────
 *
 * The guard trigger's argument is unchanged and its code is untouched: `role`
 * is refused from `anon` and `authenticated` outright, because players can
 * update their own profiles row and a writable `role` there would be a
 * self-service promotion. What the trigger never refused is `service_role` —
 * the dashboard and these routes — and the reason the first admin had to be
 * made in the dashboard is that there was nobody to authorise the promotion
 * yet. Once an admin exists, "an admin promotes a colleague" is the same
 * shape as every other action on this console: proved by the caller's own
 * session, executed on the service role, written to the audit log.
 *
 * So the bootstrap is still the dashboard — the FIRST admin, and the way back
 * in if the last one is lost — and everything after it is one button here.
 *
 * ── What this route refuses ────────────────────────────────────────────────
 *
 *   · Your own row, in either direction. An admin demoting themselves would
 *     close the console door from the inside and need the dashboard to get
 *     back; refusing it also means a promotion always leaves at least one
 *     admin standing, since the only role nobody can take is the caller's.
 *   · An anonymous account. It signs in with a device cookie and no
 *     credential, so an admin made of one is an operator nobody can be —
 *     and, until it is swept, a console anyone holding that device can open.
 *   · An account with no email. The audit log denormalises emails so it still
 *     reads after the account is gone; an operator who cannot be named in it
 *     is not an operator this log can describe.
 *
 * Everything the promoted account then gets is derived, never stored
 * (lib/admin/entitlements.ts), so the demotion below is as total as the
 * dashboard's own — one cell back, nothing to chase down.
 */

const ROLES = ["player", "admin"] as const;
type Role = (typeof ROLES)[number];

const bad = (status: number, error: string) =>
  NextResponse.json({ ok: false, error }, { status });

export async function POST(req: NextRequest) {
  const gate = await adminGate(req);
  if (!gate.ok) return gate.res;
  if (crossSite(req)) {
    return withSession(bad(403, "cross-site request refused"), gate.session);
  }

  let body: { profileId?: unknown; role?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return withSession(bad(400, "bad json"), gate.session);
  }

  if (!isUuid(body.profileId) || !ROLES.includes(body.role as Role)) {
    return withSession(bad(400, "profileId and role (admin or player) are required"), gate.session);
  }
  const role = body.role as Role;

  if (body.profileId === gate.session.userId) {
    return withSession(
      bad(409, "not your own role from here — the Supabase dashboard owns that cell"),
      gate.session,
    );
  }

  const db = adminClient();
  const [account, profile] = await Promise.all([
    db.auth.admin.getUserById(body.profileId),
    db.from("profiles").select("role").eq("id", body.profileId).maybeSingle(),
  ]);

  const user = account.data?.user;
  if (!user || !profile.data) {
    return withSession(bad(404, "no such account"), gate.session);
  }

  const email = user.email ?? null;
  if (role === "admin") {
    if ((user as { is_anonymous?: boolean }).is_anonymous === true) {
      return withSession(
        bad(409, "an anonymous account cannot be an admin — it has no credential to sign back in with"),
        gate.session,
      );
    }
    if (!email) {
      return withSession(
        bad(409, "an account with no email cannot be an admin — the audit log would name nobody"),
        gate.session,
      );
    }
  }

  const was = profile.data.role ?? "player";
  if (was === role) {
    // Nothing to write, and nothing worth a line in the log: the console
    // refreshes and the operator sees the state they asked for.
    return withSession(NextResponse.json({ ok: true, role, changed: false }), gate.session);
  }

  // Demotion clears the testing view with the role. The column is harmless on
  // a player row (nothing reads it without `role = 'admin'`), but leaving a
  // stale `free` behind would silently narrow the account if it were ever
  // promoted again — and a demotion that leaves admin state around is exactly
  // what 0009's "demotion is total" is about.
  const { error } = await db
    .from("profiles")
    .update(role === "admin" ? { role } : { role, admin_view: null })
    .eq("id", body.profileId);
  if (error) {
    return withSession(bad(503, `role change failed: ${error.message}`), gate.session);
  }

  await audit(gate.session, "role_set", {
    target: body.profileId,
    targetEmail: email,
    detail: { role, was },
  });

  return withSession(NextResponse.json({ ok: true, role, changed: true }), gate.session);
}
