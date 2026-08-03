import { NextResponse, type NextRequest } from "next/server";

import {
  CREDENTIAL_MESSAGE,
  checkEmail,
  checkPassword,
  normaliseEmail,
} from "@/lib/auth/credentials";
import {
  MAX_BATCH,
  cleanSeatName,
  ownedChapter,
  seatMessage,
  type OwnedChapter,
} from "@/lib/chapter/admin";
import { adminClient } from "@/lib/supabase/admin";
import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";
import { configured } from "@/lib/supabase/config";
import { crossSite, sessionFromRequest, withSession, type Session } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST   /api/chapter/members — register seats directly, credentials typed by
 *                               the admin. Body: `{ rows: [{email, password, name?}] }`.
 * DELETE /api/chapter/members — free one seat. Body: `{ email }`.
 *
 * This is the "print the logins and hand them out" path: a teacher with a
 * class list and school-issued addresses makes every account in one paste,
 * and no student mailbox is involved at all. The other path — the emailed
 * set-password link — is app/api/chapter/invites.
 *
 * ── Why an existing account is refused here and welcomed there ─────────────
 *
 * Registering means the ADMIN chooses the password. For a fresh address that
 * is provisioning; for an address that already has a Novus account it would
 * be a password reset performed by whoever typed the list — an account
 * takeover with a benign name. So this route refuses those rows and points at
 * the invite path, which grants the seat without ever touching the password.
 *
 * ── Failure is per row ─────────────────────────────────────────────────────
 *
 * A 40-row paste with one typo lands 39 seats and reports one refusal, in the
 * same order the rows went in. The alternative — all-or-nothing — turns one
 * misspelt address into a class that cannot start today.
 */

interface RegisterRow {
  email?: unknown;
  password?: unknown;
  name?: unknown;
}

interface RowResult {
  email: string;
  ok: boolean;
  error?: string;
}

const refuse = (session: Session | null, error: string, status = 400) =>
  withSession(NextResponse.json({ error }, { status }), session);

/**
 * Session, ownership and configuration — the gauntlet both verbs share.
 * Returns a Response to send as-is, or the proven owner and chapter.
 */
async function authorise(
  req: NextRequest,
): Promise<{ session: Session; chapter: OwnedChapter } | NextResponse> {
  if (crossSite(req)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
  // Seat writes need the service role (accounts, entitlements, the cap). A
  // deploy without it has no chapters to administer — same all-or-nothing
  // stance as billing, for the same reason.
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
  if (!chapter) {
    return refuse(session, "no chapter on this account", 404);
  }
  return { session, chapter };
}

export async function POST(req: NextRequest) {
  const auth = await authorise(req);
  if (auth instanceof NextResponse) return auth;
  const { session, chapter } = auth;

  if (chapter.status !== "active") {
    // The roster survives a lapse; growing it does not. Same rule the seat
    // cap enforces for a shrunk licence: keep what you have, add nothing.
    return refuse(session, "this chapter's licence has lapsed — renew it before adding seats", 409);
  }

  let body: { rows?: unknown };
  try {
    body = (await req.json()) as { rows?: unknown };
  } catch {
    return refuse(session, "bad json");
  }
  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    return refuse(session, "rows is required — [{email, password, name?}]");
  }
  if (body.rows.length > MAX_BATCH) {
    return refuse(session, `at most ${MAX_BATCH} rows per request`);
  }

  const db = adminClient();
  const results: RowResult[] = [];
  const seen = new Set<string>();

  for (const raw of body.rows as RegisterRow[]) {
    const email = typeof raw.email === "string" ? normaliseEmail(raw.email) : "";
    const password = typeof raw.password === "string" ? raw.password : "";
    const name = cleanSeatName(raw.name);

    const emailProblem = email ? checkEmail(email) : "email-missing";
    if (emailProblem) {
      results.push({ email: email || "(blank)", ok: false, error: CREDENTIAL_MESSAGE[emailProblem] });
      continue;
    }
    const passwordProblem = checkPassword(password);
    if (passwordProblem) {
      results.push({ email, ok: false, error: CREDENTIAL_MESSAGE[passwordProblem] });
      continue;
    }
    if (seen.has(email)) {
      results.push({ email, ok: false, error: "listed twice in this paste" });
      continue;
    }
    seen.add(email);

    results.push(await registerSeat(db, chapter, email, password, name));
  }

  const granted = results.filter((r) => r.ok).length;
  return withSession(
    NextResponse.json({
      results,
      granted,
      seats: chapter.seats,
    }),
    session,
  );
}

/** One row: account → profile → seat → entitlement, unwound on failure. */
async function registerSeat(
  db: ReturnType<typeof adminClient>,
  chapter: OwnedChapter,
  email: string,
  password: string,
  name: string | null,
): Promise<RowResult> {
  const { data: created, error: createError } = await db.auth.admin.createUser({
    email,
    password,
    // The seat email came from the admin, not the student, and may point at a
    // mailbox that never confirms anything. The licence is the vouching.
    email_confirm: true,
  });

  if (createError || !created?.user) {
    const message = createError?.message ?? "could not create the account";
    const exists = /already|registered|exists/i.test(message);
    return {
      email,
      ok: false,
      error: exists
        ? "already has a Novus account — use INVITE, which grants the seat without changing their password"
        : message,
    };
  }
  const userId = created.user.id;

  // The unwind: a failure past this point deletes the account it just made,
  // so re-running the same paste is clean rather than colliding with debris.
  const undo = async () => {
    await db.auth.admin.deleteUser(userId).catch(() => {
      /* an orphaned auth user with no seat grants nothing; best effort */
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
    origin: "registered",
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

  return { email, ok: true };
}

export async function DELETE(req: NextRequest) {
  const auth = await authorise(req);
  if (auth instanceof NextResponse) return auth;
  const { session, chapter } = auth;

  let body: { email?: unknown };
  try {
    body = (await req.json()) as { email?: unknown };
  } catch {
    return refuse(session, "bad json");
  }
  if (typeof body.email !== "string") {
    return refuse(session, "email is required");
  }
  const email = normaliseEmail(body.email);

  const db = adminClient();
  const { data: seat } = await db
    .from("chapter_seats")
    .select("profile_id")
    .eq("chapter_id", chapter.id)
    .eq("email", email)
    .maybeSingle();
  if (!seat) {
    return refuse(session, "that address is not on the roster", 404);
  }

  // Entitlement first, row second. If the delete then fails, the member has
  // lost the seat's Pro but still shows on the roster — visible, harmless,
  // and fixed by pressing REMOVE again. The other order can leak a free seat.
  const { error: revokeError } = await db.rpc("revoke_chapter_seat", {
    p_profile: seat.profile_id,
  });
  if (revokeError) {
    return refuse(session, `revoke: ${revokeError.message}`, 500);
  }

  const { error: deleteError } = await db
    .from("chapter_seats")
    .delete()
    .eq("chapter_id", chapter.id)
    .eq("email", email);
  if (deleteError) {
    return refuse(session, `remove: ${deleteError.message}`, 500);
  }

  // The account itself survives. The seat was the chapter's; the account —
  // its saves, its handle, its history — is the player's, and free Novus is
  // still the whole game.
  return withSession(NextResponse.json({ ok: true, email }), session);
}
