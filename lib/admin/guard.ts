import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { configured } from "@/lib/supabase/config";
import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";
import { sessionFromRequest, withSession, type Session } from "@/lib/supabase/route";
import type { AdminView } from "@/lib/admin/entitlements";

/**
 * The door every app/api/admin/* route stands behind.
 *
 * The division of labour mirrors lib/chapter/admin.ts:
 *
 *   1. WHO is asking is proved through the caller's own session client —
 *      `profiles` has an own-row SELECT policy (0001), so reading `role` off
 *      the caller's row is the caller proving it about themselves. No token,
 *      no shared secret: the role is a cell in the database, flipped in the
 *      Supabase dashboard and nowhere else (0009's guard trigger).
 *   2. WHAT the routes then do runs on the service role, because listing
 *      accounts, granting gifts and deleting users are exactly the operations
 *      no browser-reachable policy should permit.
 *
 * ── 404, not 401 ────────────────────────────────────────────────────────────
 *
 * The moderation route's rule, inherited: an endpoint that is off — or that
 * this caller has no business knowing exists — should not advertise itself.
 * Signed out, signed in as a player, anonymous cookie, unconfigured deploy:
 * all indistinguishable from "no such route".
 *
 * ── The cookie still rotates on a refusal ───────────────────────────────────
 *
 * sessionFromRequest SPENDS the caller's refresh token (see withSession in
 * lib/supabase/route.ts). A player who pokes /api/admin/* out of curiosity
 * must get their rotated cookie back with the 404, or the refusal signs them
 * out of the game — which would turn "not found" into an oracle.
 */

export type AdminGate =
  | { ok: true; session: Session; view: AdminView }
  | { ok: false; res: NextResponse };

const notFound = () => NextResponse.json({ ok: false }, { status: 404 });

export async function adminGate(req: NextRequest): Promise<AdminGate> {
  // No Supabase, or no service key to act with: the admin system does not
  // exist on this deploy, and neither does this route.
  if (!configured() || !SUPABASE_SERVICE_ROLE_KEY) {
    return { ok: false, res: notFound() };
  }

  const session = await sessionFromRequest(req);
  if (!session || session.anonymous) {
    return { ok: false, res: withSession(notFound(), session) };
  }

  const { data } = await session.supabase
    .from("profiles")
    .select("role, admin_view")
    .eq("id", session.userId)
    .maybeSingle();

  if (data?.role !== "admin") {
    return { ok: false, res: withSession(notFound(), session) };
  }

  const view: AdminView =
    data.admin_view === "free" || data.admin_view === "pro" ? data.admin_view : "all";

  return { ok: true, session, view };
}

/**
 * One audit row per admin action, written on the service role.
 *
 * Recorded AFTER the action succeeds, so the log never claims work that
 * failed. A write that itself fails is reported to the server log and
 * swallowed: the grant already happened, and unwinding a gift because its
 * paper trail hiccuped would leave the admin staring at an error for an
 * action that visibly worked. The log is a support tool, not a ledger of
 * record — the entitlement tables are those.
 */
export async function audit(
  session: Session,
  action: string,
  opts: {
    target?: string;
    targetEmail?: string | null;
    detail?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    const { error } = await adminClient().from("admin_audit").insert({
      actor: session.userId,
      actor_email: session.email,
      action,
      target: opts.target ?? null,
      target_email: opts.targetEmail ?? null,
      detail: opts.detail ?? {},
    });
    if (error) console.error(`admin_audit insert failed (${action}): ${error.message}`);
  } catch (e) {
    console.error(`admin_audit insert failed (${action}): ${(e as Error).message}`);
  }
}

/** The uuid shape every admin route validates before touching the database. */
export const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
