import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_SERVICE_ROLE_KEY, billingConfigured } from "@/lib/stripe/config";
import { stripe } from "@/lib/stripe/client";
import { windDownOwnedChapters } from "@/lib/stripe/chapter";
import { adminClient } from "@/lib/supabase/admin";
import { configured } from "@/lib/supabase/config";
import { crossSite, clearSession, sessionFromRequest, withSession } from "@/lib/supabase/route";

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
 * ── An active subscription is cancelled, not a reason to refuse ────────────
 *
 * This route used to answer 409 to anyone with a live subscription and tell
 * them to cancel in the portal first. The reasoning was sound — deleting the
 * account would leave a subscription billing a card every month with no
 * account to unlock, which is the worst possible outcome of a "delete me"
 * request — but the conclusion was wrong twice over.
 *
 * It is wrong for App Review: Guideline 5.1.1(v) requires that a player can
 * INITIATE deletion from inside the app and have it complete. "Go and cancel
 * something somewhere else first, then come back" is a deletion the app does
 * not offer, and in the shipped app there is no portal to send them to — a
 * store build sells nothing and opens no billing pages (lib/commerce.ts).
 *
 * And it is wrong for the player, who asked for one thing and got homework.
 *
 * So the subscription is cancelled HERE, immediately, as the first step of the
 * deletion, and only then does the account go. The refusal survives for the
 * one case that still deserves it: the cancellation itself failing. Better to
 * say "try again" than to delete the account and leave the card billable.
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

  // Checked BEFORE the session is resolved, on purpose. sessionFromRequest
  // SPENDS the cookie's refresh token (see withSession); a 501 that returned
  // without re-attaching it would both refuse the delete AND sign the player
  // out — and a Supabase deploy without the service key is a supported state
  // (docs), so this path is reachable in normal operation.
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    // Deleting an auth user needs the admin API. Say so rather than half-doing
    // it — a partial delete against a policy promise is worse than a refusal.
    return NextResponse.json(
      { error: "Account deletion is not available on this deploy (no service role key)." },
      { status: 501 },
    );
  }

  const session = await sessionFromRequest(req);
  if (!session) {
    // 401, not 200: a delete that could not run is not a delete that succeeded,
    // and the client treats any 2xx here as "the account is gone" and wipes the
    // device. No session was resolved, so there is no rotated token to re-attach.
    return NextResponse.json({ configured: true, signedIn: false }, { status: 401 });
  }

  const db = adminClient();

  const { data: billing } = await db
    .from("billing_customers")
    .select("subscription_id, subscription_status, cancel_at_period_end")
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
    const subscriptionId = billing?.subscription_id as string | undefined;

    // A billable status with no subscription id on the row is a broken record,
    // not a live subscription — there is nothing to cancel and nothing that
    // can bill. Deleting is the right answer and the cascade takes the row.
    if (subscriptionId && billingConfigured()) {
      try {
        // Immediately, not at period end: the account is about to stop
        // existing, so there is no one left to serve out the rest of the term.
        // The webhook writes `canceled` back to a row the cascade is about to
        // delete either way, and an out-of-order arrival is harmless.
        await stripe().subscriptions.cancel(subscriptionId, {
          invoice_now: false,
          prorate: false,
        });
      } catch (e) {
        // Do NOT delete now. An account deleted while Stripe still bills the
        // card is the outcome the whole check exists to prevent, and the
        // player can try again in a moment. withSession re-attaches the rotated
        // refresh token so "try again in a minute" is actually possible — a
        // bare response here would leave the browser holding a spent token and
        // silently sign the player out of a refusal meant to be recoverable.
        return withSession(
          NextResponse.json(
            {
              error:
                "Your Pro subscription could not be cancelled just now, so nothing was deleted — please try again in a minute.",
              activeSubscription: true,
              detail: (e as Error).message,
            },
            { status: 409 },
          ),
          session,
        );
      }
    }
  }

  /*
   * A chapter licence is not personal Pro, and the check above never sees it.
   * Its subscription lives on `chapters`, and its seated members' entitlements
   * live on their own profiles — both invisible to `billing_customers`. Wind
   * them down while the rows still exist: lapse every member seat and cancel
   * every live licence subscription. If a licence subscription cannot be
   * cancelled, refuse for the same reason personal Pro does — a deleted owner
   * with a still-billing school licence is the worst outcome of "delete me".
   */
  const { failedCancellations } = await windDownOwnedChapters(db, session.userId, {
    cancelSubscriptions: true,
  });
  if (failedCancellations.length > 0) {
    return withSession(
      NextResponse.json(
        {
          error:
            "A classroom licence on this account could not be cancelled just now, so nothing was deleted — please try again in a minute.",
          activeSubscription: true,
        },
        { status: 409 },
      ),
      session,
    );
  }

  const { error } = await db.auth.admin.deleteUser(session.userId);
  if (error) {
    // The rotated token is re-attached so a failed delete does not also sign
    // the player out of an account that still exists.
    return withSession(NextResponse.json({ error: error.message }, { status: 500 }), session);
  }

  // The cookie now points at a user that does not exist. Clear it so the next
  // request starts clean rather than failing a refresh on every page load.
  return clearSession(NextResponse.json({ deleted: true }));
}
