import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { CREDENTIAL_MESSAGE, checkEmail, normaliseEmail } from "@/lib/auth/credentials";
import {
  MAX_BATCH,
  cleanSeatName,
  ownedChapter,
  randomPassword,
  seatMessage,
  type OwnedChapter,
} from "@/lib/chapter/admin";
import { passwordEmail } from "@/lib/chapter/emails";
import { resendConfigured, sendEmail } from "@/lib/email/resend";
import { sendSetupEmail } from "@/lib/chapter/setup-email";
import { adminClient } from "@/lib/supabase/admin";
import { SITE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";
import { SUPABASE_ANON_KEY, SUPABASE_URL, configured } from "@/lib/supabase/config";
import { crossSite, sessionFromRequest, withSession, type Session } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Hand out seats, reporting each row separately. New accounts receive a
 * mailbox-only, one-time setup link; an unfinished account receives another
 * even after its old seat was removed. Established accounts keep their
 * password and need no mail. Re-pasting a roster row resends setup while it
 * is pending, or a password reset after completion. Mail acceptance alone
 * stamps invite_sent_at; only password completion stamps claimed_at.
 *
 * The durable setup record is service-only and follows the profile rather
 * than the enterprise. A missing migration fails admission safely instead of
 * guessing that an account with a random password has finished registration.
 */

interface InviteRow {
  email?: unknown;
  name?: unknown;
}

interface RowResult {
  email: string;
  ok: boolean;
  action?: "invited" | "granted" | "resent";
  error?: string;
  /** Set when the seat landed but the email did not — RESEND fixes it. */
  warning?: string;
}

const refuse = (session: Session | null, error: string, status = 400) =>
  withSession(NextResponse.json({ error }, { status }), session);

/** One condition, asked in three places: can the branded invite go out at
 *  all? Resend needs its key AND the absolute URL the setup redirect is built on. */
const invitesViaResend = (): boolean => resendConfigured() && !!SITE_URL;

export async function POST(req: NextRequest) {
  if (crossSite(req)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
  if (!configured() || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  const session = await sessionFromRequest(req);
  if (!session) {
    return NextResponse.json({ configured: true, signedIn: false }, { status: 200 });
  }
  if (session.anonymous) {
    return refuse(session, "chapter admin needs the account that bought the licence", 403);
  }

  const chapter = await ownedChapter(session);
  if (!chapter) return refuse(session, "no chapter on this account", 404);
  if (chapter.status !== "active") {
    return refuse(session, "this chapter's licence has lapsed — renew it before adding seats", 409);
  }
  if (!chapter.profileComplete) {
    return refuse(session, "Complete your enterprise details before adding members.", 409);
  }

  let body: { invites?: unknown };
  try {
    body = (await req.json()) as { invites?: unknown };
  } catch {
    return refuse(session, "bad json");
  }
  if (!body || !Array.isArray(body.invites) || body.invites.length === 0) {
    return refuse(session, "invites is required — [{email, name?}]");
  }
  if (body.invites.length > MAX_BATCH) {
    return refuse(session, `at most ${MAX_BATCH} invites per request`);
  }

  const db = adminClient();
  const results: RowResult[] = [];
  const seen = new Set<string>();

  for (const raw of body.invites as InviteRow[]) {
    const email = typeof raw?.email === "string" ? normaliseEmail(raw.email) : "";
    const name = cleanSeatName(raw?.name);

    const problem = email ? checkEmail(email) : "email-missing";
    if (problem) {
      results.push({ email: email || "(blank)", ok: false, error: CREDENTIAL_MESSAGE[problem] });
      continue;
    }
    if (seen.has(email)) {
      results.push({ email, ok: false, error: "listed twice in this paste" });
      continue;
    }
    seen.add(email);

    results.push(await inviteSeat(db, chapter, email, name));
  }

  return withSession(
    NextResponse.json({
      results,
      granted: results.filter((r) => r.ok).length,
      seats: chapter.seats,
      // Which mailer carried the emails, so the console can say plainly that
      // the branded invite (and its claim page) are off on this deploy
      // rather than leaving the admin to hear it from a confused student.
      mailer: invitesViaResend() ? "resend" : "supabase",
    }),
    session,
  );
}

async function inviteSeat(
  db: ReturnType<typeof adminClient>,
  chapter: OwnedChapter,
  email: string,
  name: string | null,
): Promise<RowResult> {
  // Already seated here? Then this is a resend, not a second seat.
  const { data: existingSeat } = await db
    .from("chapter_seats")
    .select("id, created_by_invite, claimed_at")
    .eq("chapter_id", chapter.id)
    .eq("email", email)
    .maybeSingle();
  if (existingSeat) {
    const sendError = await resendForSeat(db, {
      id: existingSeat.id as string,
      email,
      createdByInvite: existingSeat.created_by_invite === true,
      claimedAt: (existingSeat.claimed_at as string | null) ?? null,
    });
    if (sendError) return { email, ok: false, error: sendError };
    return { email, ok: true, action: "resent" };
  }

  // An account may already exist — a player joining a classroom brings their
  // own history with them. The definer function is service-role-only (0007).
  const { data: existingId, error: lookupError } = await db.rpc("auth_user_id_for_email", {
    p_email: email,
  });
  if (lookupError) return { email, ok: false, error: `lookup: ${lookupError.message}` };

  if (existingId) {
    const userId = existingId as string;
    // The profile row should exist for any real account; repair quietly if a
    // half-finished signup left it missing, and never overwrite their name.
    const { error: profileError } = await db
      .from("profiles")
      .upsert({ id: userId, display_name: name ?? "Founder" }, { onConflict: "id", ignoreDuplicates: true });
    if (profileError) return { email, ok: false, error: `profile: ${profileError.message}` };

    // Setup belongs to the account, not its current seat. An unfinished
    // invite survives removal/re-enrolment and must receive setup mail again.
    const { data: setup, error: setupError } = await db.from("chapter_account_setup")
      .select("completed_at").eq("profile_id", userId).maybeSingle();
    if (setupError) return { email, ok: false, error: "Could not check account setup. Try again." };
    const pending = !!setup && !setup.completed_at;

    // Established accounts are already claimed. Pending accounts retain
    // first-setup semantics without minting a reusable claim token.
    const { error: seatError } = await db.from("chapter_seats").insert({
      chapter_id: chapter.id,
      profile_id: userId,
      email,
      seat_name: name,
      origin: "invited",
      created_by_invite: pending,
      claimed_at: pending ? null : new Date().toISOString(),
    });
    if (seatError) return { email, ok: false, error: seatMessage(seatError.message) };

    const { error: grantError } = await db.rpc("grant_chapter_seat", {
      p_profile: userId,
      p_licence: chapter.licence,
    });
    if (grantError) {
      // A plan-change webhook may have granted the new tier while this
      // request still held the old licence. Roll back both the seat and that
      // entitlement under the chapter lock, never by deleting the row alone.
      const { error: cleanupError } = await db.rpc("remove_chapter_seat", {
        p_chapter: chapter.id,
        p_profile: userId,
      });
      return { email, ok: false, error: `grant: ${grantError.message}${cleanupError ? `; cleanup: ${cleanupError.message}` : ""}` };
    }
    if (pending) {
      const sendError = await sendSetupEmail(db, email);
      if (sendError) return { email, ok: true, action: "invited", warning: `seat granted, but the email failed: ${sendError}` };
      const { error: sentError } = await db.from("chapter_seats")
        .update({ invite_sent_at: new Date().toISOString() }).eq("chapter_id", chapter.id).eq("email", email);
      return { email, ok: true, action: "invited", ...(sentError ? { warning: "email sent, but its send time could not be saved" } : {}) };
    }
    return { email, ok: true, action: "granted" };
  }

  // A fresh address: account with no usable password, then the seat, then the
  // invite that lets its owner claim it and choose the real one.
  //
  // Which call creates the account depends on the mailer. With Resend, the
  // account is created quietly here and OUR invite email goes out last, after
  // the seat and the entitlement are safely down. Without Resend, Supabase's
  // own invite email is the only mailer there is, and sending it is the same
  // call that creates the account — `inviteUserByEmail` — so the mail travels
  // first, and the rare failure after it (a full chapter, say) deletes the
  // account and leaves a link that reports itself invalid. That ordering
  // wrinkle is accepted on purpose: the alternative was creating the account
  // with `createUser` and then having no way to send anything but the
  // RECOVERY email — which is exactly the "reset your password?" surprise
  // this branch used to send and must not again.
  let userId: string;
  if (invitesViaResend()) {
    const { data: created, error: createError } = await db.auth.admin.createUser({
      email,
      password: randomPassword(),
      // The seat email came from the admin, not the student, and may point at
      // a mailbox that never confirms anything. The licence is the vouching.
      email_confirm: true,
    });
    if (createError || !created?.user) {
      return { email, ok: false, error: createError?.message ?? "could not create the account" };
    }
    userId = created.user.id;
  } else {
    const { data: created, error: createError } = await db.auth.admin.inviteUserByEmail(email, {
      // The invite link signs them in and lands on the welcome screen — the
      // same /join/setup every claim ends on. There is no claim step on this
      // path, so that page is where the name gets asked for too.
      ...(SITE_URL ? { redirectTo: `${SITE_URL}/join/setup` } : {}),
    });
    if (createError || !created?.user) {
      return { email, ok: false, error: createError?.message ?? "could not create the account" };
    }
    userId = created.user.id;
  }

  const undo = async () => {
    await db.auth.admin.deleteUser(userId).catch(() => {
      /* best effort — an orphaned auth user with no seat grants nothing */
    });
  };

  const { error: profileError } = await db
    .from("profiles")
    .insert({ id: userId, display_name: name ?? "Founder" });
  if (profileError) {
    await undo();
    return { email, ok: false, error: `profile: ${profileError.message}` };
  }

  const { error: setupError } = await db.from("chapter_account_setup").insert({ profile_id: userId });
  if (setupError) {
    await undo();
    return { email, ok: false, error: "Could not record account setup. Try again." };
  }

  const { error: seatError } = await db.from("chapter_seats").insert({
    chapter_id: chapter.id,
    profile_id: userId,
    email,
    seat_name: name,
    origin: "invited",
    created_by_invite: true,
    // Supabase already accepted its invite above; Resend has not been called
    // yet. A failed send must leave an honest, empty timestamp on the roster.
    invite_sent_at: invitesViaResend() ? null : new Date().toISOString(),
  });
  if (seatError) {
    await undo();
    return { email, ok: false, error: seatMessage(seatError.message) };
  }

  const { error: grantError } = await db.rpc("grant_chapter_seat", {
    p_profile: userId,
    p_licence: chapter.licence,
  });
  if (grantError) {
    const { error: cleanupError } = await db.rpc("remove_chapter_seat", {
      p_chapter: chapter.id,
      p_profile: userId,
    });
    await undo();
    return { email, ok: false, error: `grant: ${grantError.message}${cleanupError ? `; cleanup: ${cleanupError.message}` : ""}` };
  }

  // In fallback mode the invite email already went out with the account
  // creation above — sending again here would double it.
  if (invitesViaResend()) {
    const sendError = await sendSetupEmail(db, email);
    if (sendError) {
      // The seat is real and lit; only the mail is missing. Said plainly so
      // the admin resends rather than re-inviting into "already on this
      // roster".
      return { email, ok: true, action: "invited", warning: `seat granted, but the email failed: ${sendError}` };
    }
    const { error: sentError } = await db
      .from("chapter_seats")
      .update({ invite_sent_at: new Date().toISOString() })
      .eq("chapter_id", chapter.id)
      .eq("email", email);
    if (sentError) {
      return { email, ok: true, action: "invited", warning: "email sent, but its send time could not be saved — refresh the roster before retrying" };
    }
  }

  return { email, ok: true, action: "invited" };
}

/**
 * RESEND for a seat that already exists, choosing the email its state calls
 * for: setup mail while first-time setup is still pending, otherwise a
 * choose-your-password link — which is also what a REGISTERED seat gets,
 * and is safe for any seat because the link only ever travels to the
 * account's own address.
 */
async function resendForSeat(
  db: ReturnType<typeof adminClient>,
  seat: {
    id: string;
    email: string;
    createdByInvite: boolean;
    claimedAt: string | null;
  },
): Promise<string | null> {
  let sendError: string | null;

  if (seat.createdByInvite && !seat.claimedAt) {
    sendError = await sendSetupEmail(db, seat.email);
  } else {
    sendError = await sendPasswordLink(db, seat.email);
  }
  if (sendError) return sendError;

  const { error: sentError } = await db
    .from("chapter_seats")
    .update({ invite_sent_at: new Date().toISOString() })
    .eq("id", seat.id);
  return sentError ? "email sent, but its send time could not be saved" : null;
}

/**
 * A choose-your-password email. With Resend the link is minted server-side
 * (`admin.generateLink`) and delivered through our own mail — Supabase's
 * mailer never runs. Without it, Supabase sends its own recovery email.
 *
 * Either way the link lands on /reset, and /reset is the correct page here —
 * unlike an invite, this email only ever goes to a seat whose account has
 * already been claimed, so "choose a new password" is the true sentence.
 */
async function sendPasswordLink(
  db: ReturnType<typeof adminClient>,
  email: string,
): Promise<string | null> {
  if (resendConfigured()) {
    const { data, error } = await db.auth.admin.generateLink({
      type: "recovery",
      email,
      ...(SITE_URL ? { options: { redirectTo: `${SITE_URL}/reset` } } : {}),
    });
    const link = data?.properties?.action_link;
    if (error || !link) return error?.message ?? "could not create the password link";
    const message = passwordEmail(link);
    return sendEmail({ to: email, ...message });
  }
  return supabaseRecoveryEmail(email);
}

/** The pre-Resend fallback: Supabase's own recovery email, on the anon key —
 *  recovery mail needs no privilege, only the address. */
async function supabaseRecoveryEmail(email: string): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      ...(SITE_URL ? { redirectTo: `${SITE_URL}/reset` } : {}),
    });
    return error ? error.message : null;
  } catch (e) {
    return (e as Error).message;
  }
}
