import { NextResponse, type NextRequest } from "next/server";

import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";
import { windDownOwnedChapters } from "@/lib/stripe/chapter";
import { cancelActivePersonalPro } from "@/lib/stripe/subscription";
import { adminClient } from "@/lib/supabase/admin";
import { configured } from "@/lib/supabase/config";
import { purgeAccountRows } from "@/lib/supabase/purge";
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

  /*
   * Cancel the personal Pro subscription first. Deleting the account while
   * Stripe keeps billing the card is the worst outcome of a "delete me" request,
   * so a cancellation that fails REFUSES the deletion rather than proceeding —
   * better "try again in a minute" than a gone account with a live charge.
   * withSession re-attaches the rotated refresh token so the retry is actually
   * possible; a bare response would leave the browser holding a spent token and
   * sign the player out of a refusal meant to be recoverable. (An already-
   * cancelled or absent subscription is not billable and does not block — the
   * helper's own logic; see lib/stripe/subscription.ts.)
   */
  const pro = await cancelActivePersonalPro(db, session.userId);
  if (!pro.ok) {
    return withSession(
      NextResponse.json(
        {
          error:
            "Your Pro subscription could not be cancelled just now, so nothing was deleted — please try again in a minute.",
          activeSubscription: true,
        },
        { status: 409 },
      ),
      session,
    );
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

  // Belt and braces behind the cascade: clear every table by name, so the
  // policy's "the deletion is real" cannot be defeated by a production schema
  // that drifted from the migrations. On a healthy schema this deletes nothing
  // because the cascade already has.
  await purgeAccountRows(db, session.userId);

  // The cookie now points at a user that does not exist. Clear it so the next
  // request starts clean rather than failing a refresh on every page load.
  return clearSession(NextResponse.json({ deleted: true }));
}
