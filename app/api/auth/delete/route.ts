import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";
import { adminClient } from "@/lib/supabase/admin";
import { configured } from "@/lib/supabase/config";
import { crossSite, clearSession, sessionFromRequest } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/delete — erase this account, for real.
 *
 * The privacy policy says "ask us to delete your account and we delete it —
 * the email, the progress, all of it — and the deletion is real, not a flag."
 * This is that sentence, in code. A policy promising deletion with no route
 * behind it is the kind of claim that is worse than saying nothing.
 *
 * ── One delete, everything goes ────────────────────────────────────────────
 *
 * Deleting the `auth.users` row is enough. Every table hangs off
 * `public.profiles(id)`, which itself references `auth.users(id) on delete
 * cascade`, and every child carries `on delete cascade` in turn — profiles,
 * preferences, saves, legacy, entitlements, run_ledger (0001),
 * billing_customers (0003). Postgres does the rest, in one transaction.
 *
 * ── What is NOT deleted, and why it is said out loud ───────────────────────
 *
 * The Stripe customer. Stripe holds payment records under its own retention
 * obligations — tax and chargeback rules mean a processor cannot simply forget
 * a transaction on request, and we could not make them if we wanted to. What
 * we can do is drop OUR link to it, which this does: billing_customers goes
 * with the cascade, so nothing here can associate that Stripe customer with a
 * person again.
 *
 * An ACTIVE subscription is deliberately refused rather than silently
 * cancelled. Deleting the account would leave a live subscription billing a
 * card every month with no account to unlock — the worst possible outcome of
 * a "delete me" request. The player is told to cancel in the portal first.
 */
export async function POST(req: NextRequest) {

  // Not from our own pages. See crossSite() — a cross-site form post is not
  // preflighted, and req.json() parses the body whatever type it claims.
  if (crossSite(req)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
  if (!configured()) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  const session = await sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ configured: true, signedIn: false }, { status: 200 });
  }

  if (!SUPABASE_SERVICE_ROLE_KEY) {
    // Deleting an auth user needs the admin API. Say so rather than half-doing
    // it — a partial delete against a policy promise is worse than a refusal.
    return NextResponse.json(
      { error: "Account deletion is not available on this deploy (no service role key)." },
      { status: 501 },
    );
  }

  const db = adminClient();

  const { data: billing } = await db
    .from("billing_customers")
    .select("subscription_status, cancel_at_period_end")
    .eq("profile_id", session.userId)
    .maybeSingle();

  const status = billing?.subscription_status as string | undefined;

  /*
   * Which statuses can still take money.
   *
   * `unpaid` and `paused` are in the list alongside the obvious three. Neither
   * is finished: Stripe can resume a paused subscription, and an `unpaid` one
   * still has an open invoice that a recovered card settles. Treating either as
   * safe would delete the account and leave the card billable with nothing to
   * unlock — the exact outcome this check exists to prevent.
   *
   * `canceled`, `incomplete` and `incomplete_expired` are genuinely finished
   * and do not block.
   */
  const BILLABLE = ["active", "trialing", "past_due", "unpaid", "paused"];

  /*
   * ...unless they have ALREADY cancelled.
   *
   * A player who cancelled keeps Pro until the period ends, so the status is
   * still `active` — with `cancel_at_period_end` set. Without this clause,
   * doing exactly what we asked ("cancel first") would leave them refused for
   * up to a year, told to cancel a subscription they already cancelled.
   */
  const stillBillable =
    !!status && BILLABLE.includes(status) && billing?.cancel_at_period_end !== true;

  if (stillBillable) {
    return NextResponse.json(
      {
        error:
          "Cancel your Pro subscription first — otherwise it keeps billing your card with no account to unlock.",
        activeSubscription: true,
      },
      { status: 409 },
    );
  }

  const { error } = await db.auth.admin.deleteUser(session.userId);
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // The cookie now points at a user that does not exist. Clear it so the next
  // request starts clean rather than failing a refresh on every page load.
  return clearSession(NextResponse.json({ deleted: true }));
}
