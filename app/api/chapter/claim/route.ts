import { NextResponse, type NextRequest } from "next/server";

import { checkEmail, normaliseEmail } from "@/lib/auth/credentials";
import { cleanSeatName } from "@/lib/chapter/admin";
import { LIMITS, THROTTLED_MESSAGE, callerKey, throttle } from "@/lib/auth/throttle";
import { adminClient } from "@/lib/supabase/admin";
import { SITE_URL, SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";
import { configured } from "@/lib/supabase/config";
import { crossSite } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/chapter/claim — where the invite link lands.
 *
 * Body: `{ token, email, name }`. The /join page posts what the invitee
 * typed; the answer is `{ url }` — a one-time password-setup link the page
 * navigates straight into, which ends on /join/setup: the welcome screen where
 * the student chooses a password and lands signed in. Filling in an email and
 * a name is genuinely all a student does.
 *
 * ── What the token is, and what it is not ──────────────────────────────────
 *
 * The token was minted when the invite CREATED the account, travels only in
 * that invite email, and `created_by_invite` is checked here so a token can
 * never exist for — and this endpoint can never mint a link into — an
 * account somebody already owned before the invite. Within that boundary the
 * emailed link is the credential, exactly as it is for a password reset: the
 * account it opens has never had a password its owner chose, contains
 * nothing, and belongs to whoever the admin addressed the email to.
 *
 * The typed email must match the seat's. That is not extra authentication —
 * it is what stops a link pasted into a group chat from being claimed by
 * someone who does not even know which address it was for, and it is the
 * page's way of catching "the admin typed my address wrong" before a
 * password gets set on a mailbox that isn't theirs.
 *
 * One message for every refusal. "Wrong email for this token" and "no such
 * token" must be indistinguishable, or the endpoint is an oracle for pairing
 * leaked tokens with addresses.
 */

interface Body {
  token?: unknown;
  email?: unknown;
  name?: unknown;
}

const REFUSED =
  "That invite link and email do not match. Check the address the invite was sent to, or ask for the invite to be sent again.";

const CLAIMED =
  "This invite has already been used to set up the account. If you are locked out, use “Forgot password?” on the sign-in screen instead.";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How long after the FIRST claim the invite link keeps working.
 *
 * The token is minted once, into the invite email, and used to mint a sign-in
 * link. Without a limit it stayed a working credential for the life of the seat:
 * long after the student claimed the account and chose a password, anyone who
 * later saw that email — forwarded, a shared inbox, the teacher's Sent folder —
 * could re-post the token and be handed a fresh sign-in link into the account,
 * bypassing the password the student set. So the link keeps working only
 * briefly after the first claim, which is all the legitimate "clicked it twice /
 * the page refreshed" retry ever needs; after that the account is the student's
 * and the door is a password reset, not this.
 */
const CLAIM_GRACE_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  if (crossSite(req)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
  if (!configured() || !SUPABASE_SERVICE_ROLE_KEY) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (typeof body.token !== "string" || !UUID_SHAPE.test(body.token)) {
    return NextResponse.json({ error: REFUSED }, { status: 404 });
  }
  if (typeof body.email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  const email = normaliseEmail(body.email);
  if (checkEmail(email)) {
    return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
  }
  const name = cleanSeatName(body.name);

  // The token space is unguessable (122 random bits), so this throttle is not
  // what keeps accounts safe — it keeps a script from grinding the endpoint
  // into a link-minting service, and it reuses the auth machinery because a
  // claim is an auth action. signinPerIp's budget fits: a classroom claiming
  // behind one NAT is the same shape as a classroom signing in behind one.
  const limited = await throttle([
    { bucket: "claim:ip", key: callerKey(req), limit: LIMITS.signinPerIp },
  ]);
  if (!limited.allowed) {
    return NextResponse.json({ error: THROTTLED_MESSAGE, throttled: true }, { status: 429 });
  }

  const db = adminClient();

  const { data: seat } = await db
    .from("chapter_seats")
    .select("id, profile_id, email, seat_name, created_by_invite, claimed_at")
    .eq("invite_token", body.token)
    .maybeSingle();

  // One refusal for every miss: unknown token, a token for a pre-existing
  // account (never minted, but belt and braces), or the wrong address.
  if (!seat || seat.created_by_invite !== true || (seat.email as string) !== email) {
    return NextResponse.json({ error: REFUSED }, { status: 404 });
  }

  // Claimed, and past the retry window: the student has had the account long
  // enough to have set their own password, so this link stops being a way in.
  // A distinct message (the token+email already matched, so this discloses
  // nothing an unknown-token refusal would hide) points them at password reset.
  const claimedAt = seat.claimed_at as string | null;
  if (claimedAt && Date.now() - new Date(claimedAt).getTime() > CLAIM_GRACE_MS) {
    return NextResponse.json({ error: CLAIMED }, { status: 403 });
  }

  // The name they typed is the name on the account — this account was created
  // BY the invite, so until its owner claims it, "Founder" was a placeholder.
  // Re-claiming (link clicked twice, page refreshed) just updates it again.
  if (name) {
    const { error: nameError } = await db
      .from("profiles")
      .update({ display_name: name })
      .eq("id", seat.profile_id as string);
    if (nameError) {
      return NextResponse.json({ error: `name: ${nameError.message}` }, { status: 500 });
    }
  }

  const { error: seatError } = await db
    .from("chapter_seats")
    .update({
      seat_name: name ?? (seat.seat_name as string | null),
      // First claim wins the timestamp; a re-run of the same link is not a
      // second claim, it is the same student finishing what they started.
      claimed_at: (seat.claimed_at as string | null) ?? new Date().toISOString(),
    })
    .eq("id", seat.id as string);
  if (seatError) {
    return NextResponse.json({ error: `seat: ${seatError.message}` }, { status: 500 });
  }

  // The handover: a one-time recovery link, minted server-side and handed to
  // the page to navigate into. It lands on /join/setup — the welcome screen
  // written for exactly this moment — with the student signed in at the end
  // of it.
  //
  // NOT /reset. The mechanism is a recovery link because that is the only
  // one-time sign-in Supabase mints, but the sentence on the screen must not
  // be "choose a NEW password" to someone whose account is ninety seconds old
  // and has never had one. `/join/setup` must be on Supabase's redirect
  // allow-list (Authentication → URL Configuration) or GoTrue quietly sends
  // them to the Site URL instead; see docs/CHAPTERS.md.
  const { data: link, error: linkError } = await db.auth.admin.generateLink({
    type: "recovery",
    email,
    ...(SITE_URL ? { options: { redirectTo: `${SITE_URL}/join/setup` } } : {}),
  });
  const url = link?.properties?.action_link;
  if (linkError || !url) {
    return NextResponse.json(
      { error: linkError?.message ?? "could not create the password link — try the link again" },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, url });
}
