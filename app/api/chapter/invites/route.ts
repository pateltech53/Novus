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
 *   · **New address** → the account is created with a random password, the
 *     seat and its entitlement are granted, and the address receives the
 *     app's EXISTING password-reset email (`resetPasswordForEmail` → /reset).
 *     For an account that has never had a password chosen, "reset" IS "set":
 *     the student clicks, picks a password on the page that already exists
 *     for exactly this, and lands in the game with the seat lit. No new email
 *     template, no new delivery machinery, no invite-token table to expire.
 *     → `action: "invited"`
 *
 *   · **Existing account** → the seat and entitlement are granted and NO
 *     email is sent — they have a password that works, and an unprompted
 *     "reset your password" mail teaches people to click unprompted reset
 *     mails. → `action: "granted"`
 *
 *   · **Already on this roster** → the set-password email is sent again and
 *     `invite_sent_at` refreshed. Re-pasting a list is therefore exactly the
 *     RESEND button, one address or the whole class at a time.
 *     → `action: "resent"`
 *
 * ── Why the reset email is safe to repurpose ───────────────────────────────
 *
 * /api/auth/reset throttles it and refuses to vary its answer because it is
 * REACHABLE BY ANYONE about ANY address. This route is neither: it is behind
 * a session that provably owns a paid chapter, it can only send to addresses
 * that hold (or are being handed) a seat on that licence, and the seat cap
 * bounds the total. The account-existence answer it gives the caller —
 * "granted" vs "invited" — is one the roster's owner already has.
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
    .select("id")
    .eq("chapter_id", chapter.id)
    .eq("email", email)
    .maybeSingle();
  if (existingSeat) {
    const sendError = await sendSetPasswordEmail(email);
    if (sendError) return { email, ok: false, error: sendError };
    await db
      .from("chapter_seats")
      .update({ invite_sent_at: new Date().toISOString() })
      .eq("id", existingSeat.id);
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

    const { error: seatError } = await db.from("chapter_seats").insert({
      chapter_id: chapter.id,
      profile_id: userId,
      email,
      seat_name: name,
      origin: "invited",
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

  // A fresh address: account with a password nobody knows, then the seat,
  // then the email that lets its owner choose the real one.
  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password: randomPassword(),
    email_confirm: true,
  });
  if (createError || !created?.user) {
    return { email, ok: false, error: createError?.message ?? "could not create the account" };
  }
  const userId = created.user.id;

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

  const sendError = await sendSetPasswordEmail(email);
  if (sendError) {
    // The seat is real and lit; only the mail is missing. Said plainly so the
    // admin resends rather than re-inviting into "already on this roster".
    return { email, ok: true, action: "invited", warning: `seat granted, but the email failed: ${sendError}` };
  }

  return { email, ok: true, action: "invited" };
}

/**
 * The app's existing reset-password email, pointed at the address a seat was
 * just granted to. Same call, same redirect, same /reset landing page as
 * app/api/auth/reset — the whole point is that this machinery already works.
 * Sent on the anon key: recovery mail needs no privilege, only the address.
 */
async function sendSetPasswordEmail(email: string): Promise<string | null> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const origin = SITE_URL || "";
  try {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      ...(origin ? { redirectTo: `${origin}/reset` } : {}),
    });
    return error ? error.message : null;
  } catch (e) {
    return (e as Error).message;
  }
}
