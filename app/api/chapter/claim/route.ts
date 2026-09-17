import { NextResponse, type NextRequest } from "next/server";

import { checkEmail, normaliseEmail } from "@/lib/auth/credentials";
import { sendSetupEmail } from "@/lib/chapter/setup-email";
import { LIMITS, THROTTLED_MESSAGE, callerKey, emailKey, throttle } from "@/lib/auth/throttle";
import { adminClient } from "@/lib/supabase/admin";
import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";
import { configured } from "@/lib/supabase/config";
import { crossSite } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Legacy /join tokens may request a setup email, never a credential-bearing
 * response. A stale concurrent request cannot reopen a completed account: the
 * only recovery link goes to the mailbox. New invitations link straight from
 * that mailbox to /join/setup. Names are written by the authenticated setup
 * endpoint, so a forwarded legacy token cannot rename somebody's account.
 */

interface Body {
  token?: unknown;
  email?: unknown;
}

const REFUSED =
  "That invite link and email do not match. Check the address the invite was sent to, or ask for the invite to be sent again.";

const CLAIMED =
  "This invite has already been used to set up the account. If you are locked out, use “Forgot password?” on the sign-in screen instead.";

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

  if (!body || typeof body.token !== "string" || !UUID_SHAPE.test(body.token)) {
    return NextResponse.json({ error: REFUSED }, { status: 404 });
  }
  if (typeof body.email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }
  const email = normaliseEmail(body.email);
  if (checkEmail(email)) {
    return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
  }

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

  // A claim now means a password was saved, not that this page was visited.
  // reset/confirm retires the token at that point on BOTH invitation paths.
  // Keep this check for old rows too: even a recently claimed account must
  // never be opened again by a forwarded copy of its original invite.
  if (seat.claimed_at) {
    return NextResponse.json({ error: CLAIMED }, { status: 403 });
  }

  const mailLimit = await throttle([
    { bucket: "claim:email", key: emailKey(email), limit: LIMITS.resetPerEmail, windowMinutes: 60 },
  ]);
  if (!mailLimit.allowed) return NextResponse.json({ error: THROTTLED_MESSAGE }, { status: 429 });

  const sendError = await sendSetupEmail(db, email);
  if (sendError) {
    return NextResponse.json({ error: "Could not send your setup email. Try again." }, { status: 503 });
  }
  return NextResponse.json({ ok: true, sent: true }, { headers: { "Cache-Control": "no-store" } });
}
