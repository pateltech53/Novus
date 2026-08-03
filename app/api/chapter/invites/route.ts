import { randomUUID } from "node:crypto";

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
import { inviteEmail, passwordEmail } from "@/lib/chapter/emails";
import { resendConfigured, sendEmail } from "@/lib/email/resend";
import { adminClient } from "@/lib/supabase/admin";
import { SITE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";
import { SUPABASE_ANON_KEY, SUPABASE_URL, configured } from "@/lib/supabase/config";
import { crossSite, sessionFromRequest, withSession, type Session } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chapter/invites — hand out seats by email.
 * Body: `{ invites: [{email, name?}] }` — one address or two hundred, same shape.
 *
 * The admin types nothing but an address (and, if they like, a name). What
 * happens per address depends on what already exists, and every outcome is
 * reported per row:
 *
 *   · **New address** → the account is created with no usable password, the
 *     seat and its entitlement are granted, and the address gets an invite
 *     email — through Resend, a link to `/join?code=<token>`, where the
 *     invitee confirms their email and name and is handed straight into the
 *     existing set-password flow (/reset); through the fallback, Supabase's
 *     own invite mail, whose link lands on /reset directly.
 *     → `action: "invited"`
 *
 *   · **Existing account** → the seat and entitlement are granted and NO
 *     email is sent — they have a password that works, and no invite token
 *     is minted for an account somebody already owns (the token is a
 *     credential, and it must never open a door into a pre-existing
 *     account). → `action: "granted"`
 *
 *   · **Already on this roster** → the right email goes out again: the
 *     invite link while the seat is unclaimed, a choose-your-password link
 *     once it has been. Re-pasting a list is therefore exactly the RESEND
 *     button, one address or the whole class at a time. → `action: "resent"`
 *
 * ── Why Resend, and what happens without it ────────────────────────────────
 *
 * Invites are the app's own mail — our subject line, our copy, classroom
 * volume — which is precisely what Supabase's built-in auth mailer is not
 * for (it throttles at a handful per hour). So invites go through Resend
 * (lib/email/resend.ts). With RESEND_API_KEY unset the route falls back to
 * Supabase's own INVITE email (`auth.admin.inviteUserByEmail`): no claim
 * page, smaller volume, zero extra setup. What the fallback must never send
 * a fresh invitee is the RECOVERY template — "we received a request to
 * reset your password" to someone who never asked reads as either a mistake
 * or a phish, and it is how this route's first fallback actually landed in
 * inboxes. Recovery remains only where it is the true sentence: a RESEND to
 * a seat whose account is already claimed (see resendForSeat).
 *
 * ── Why this may send mail at all ──────────────────────────────────────────
 *
 * /api/auth/reset throttles hard and never varies its answer because it is
 * reachable by ANYONE about ANY address. This route is neither: it sits
 * behind a session that provably owns a paid chapter, it can only mail
 * addresses that hold (or are being handed) a seat on that licence, and the
 * seat cap bounds the total.
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
 *  all? Resend needs its key AND the absolute URL the claim link is built on. */
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

  let body: { invites?: unknown };
  try {
    body = (await req.json()) as { invites?: unknown };
  } catch {
    return refuse(session, "bad json");
  }
  if (!Array.isArray(body.invites) || body.invites.length === 0) {
    return refuse(session, "invites is required — [{email, name?}]");
  }
  if (body.invites.length > MAX_BATCH) {
    return refuse(session, `at most ${MAX_BATCH} invites per request`);
  }

  const db = adminClient();
  const results: RowResult[] = [];
  const seen = new Set<string>();

  for (const raw of body.invites as InviteRow[]) {
    const email = typeof raw.email === "string" ? normaliseEmail(raw.email) : "";
    const name = cleanSeatName(raw.name);

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
    .select("id, invite_token, created_by_invite, claimed_at")
    .eq("chapter_id", chapter.id)
    .eq("email", email)
    .maybeSingle();
  if (existingSeat) {
    const sendError = await resendForSeat(db, {
      id: existingSeat.id as string,
      email,
      inviteToken: (existingSeat.invite_token as string | null) ?? null,
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

    // No invite token, claimed from birth: there is nothing for the claim
    // page to do for an account whose owner already holds its password —
    // and no credential is minted that could reach into it.
    const { error: seatError } = await db.from("chapter_seats").insert({
      chapter_id: chapter.id,
      profile_id: userId,
      email,
      seat_name: name,
      origin: "invited",
      created_by_invite: false,
      claimed_at: new Date().toISOString(),
    });
    if (seatError) return { email, ok: false, error: seatMessage(seatError.message) };

    const { error: grantError } = await db.rpc("grant_chapter_seat", {
      p_profile: userId,
      p_licence: chapter.licence,
    });
    if (grantError) {
      await db.from("chapter_seats").delete().eq("chapter_id", chapter.id).eq("email", email);
      return { email, ok: false, error: `grant: ${grantError.message}` };
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
      // The invite link signs them in and lands on the set-password page —
      // the same /reset every claim ends on.
      ...(SITE_URL ? { redirectTo: `${SITE_URL}/reset` } : {}),
    });
    if (createError || !created?.user) {
      return { email, ok: false, error: createError?.message ?? "could not create the account" };
    }
    userId = created.user.id;
  }
  const token = randomUUID();

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

  const { error: seatError } = await db.from("chapter_seats").insert({
    chapter_id: chapter.id,
    profile_id: userId,
    email,
    seat_name: name,
    origin: "invited",
    invite_token: token,
    created_by_invite: true,
    invite_sent_at: new Date().toISOString(),
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
    await db.from("chapter_seats").delete().eq("chapter_id", chapter.id).eq("email", email);
    await undo();
    return { email, ok: false, error: `grant: ${grantError.message}` };
  }

  // In fallback mode the invite email already went out with the account
  // creation above — sending again here would double it.
  if (invitesViaResend()) {
    const sendError = await sendInvite(db, email, token);
    if (sendError) {
      // The seat is real and lit; only the mail is missing. Said plainly so
      // the admin resends rather than re-inviting into "already on this
      // roster".
      return { email, ok: true, action: "invited", warning: `seat granted, but the email failed: ${sendError}` };
    }
  }

  return { email, ok: true, action: "invited" };
}

/**
 * RESEND for a seat that already exists, choosing the email its state calls
 * for: the claim link while there is still a claim to make, otherwise a
 * choose-your-password link — which is also what a REGISTERED seat gets,
 * and is safe for any seat because the link only ever travels to the
 * account's own address.
 */
async function resendForSeat(
  db: ReturnType<typeof adminClient>,
  seat: {
    id: string;
    email: string;
    inviteToken: string | null;
    createdByInvite: boolean;
    claimedAt: string | null;
  },
): Promise<string | null> {
  let sendError: string | null;

  if (seat.createdByInvite && !seat.claimedAt && seat.inviteToken) {
    sendError = await sendInvite(db, seat.email, seat.inviteToken);
  } else {
    sendError = await sendPasswordLink(db, seat.email);
  }
  if (sendError) return sendError;

  await db
    .from("chapter_seats")
    .update({ invite_sent_at: new Date().toISOString() })
    .eq("id", seat.id);
  return null;
}

/** The invite email, via Resend; Supabase's own invite mail when Resend (or
 *  the absolute join URL it needs) is not configured. */
async function sendInvite(
  db: ReturnType<typeof adminClient>,
  email: string,
  token: string,
): Promise<string | null> {
  if (invitesViaResend()) {
    const message = inviteEmail(`${SITE_URL}/join?code=${token}`);
    return sendEmail({ to: email, ...message });
  }
  return supabaseInviteEmail(db, email);
}

/**
 * The no-Resend invite: Supabase's "you have been invited" email — the
 * template written for exactly this moment — re-sent to an account that has
 * not yet accepted. GoTrue refuses to re-invite an account that is past
 * inviting (its owner confirmed the address by claiming it), and for that
 * account the recovery email takes over: "choose a new password" is the true
 * sentence to someone who holds the account, where to a fresh invitee it
 * read as a phish about a request they never made.
 */
async function supabaseInviteEmail(
  db: ReturnType<typeof adminClient>,
  email: string,
): Promise<string | null> {
  const { error } = await db.auth.admin.inviteUserByEmail(email, {
    ...(SITE_URL ? { redirectTo: `${SITE_URL}/reset` } : {}),
  });
  if (!error) return null;
  return supabaseRecoveryEmail(email);
}

/**
 * A choose-your-password email. With Resend the link is minted server-side
 * (`admin.generateLink`) and delivered through our own mail — Supabase's
 * mailer never runs. Without it, Supabase sends its own recovery email.
 * Either way the link lands on /reset, the page that already exists for it.
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
