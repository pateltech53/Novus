import { NextResponse, type NextRequest } from "next/server";

import { checkEmail, normaliseEmail } from "@/lib/auth/credentials";
import { SUPABASE_ANON_KEY, SUPABASE_URL, configured } from "@/lib/supabase/config";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/reset — send a password reset email.
 *
 * Body: `{ email }`. Always answers 200 with the same body, whether or not
 * that email has an account.
 *
 * ── Why it always says the same thing ──────────────────────────────────────
 *
 * Anything else is an account-existence oracle: post an address, read the
 * response, learn whether that person plays Novus. The players are children,
 * and "does this child have an account here" is not a question a public
 * endpoint should answer. So the response is identical either way and the real
 * outcome is only visible to whoever can read that inbox.
 *
 * ── Why this matters more than usual here ──────────────────────────────────
 *
 * Email confirmation is off (docs/ACCOUNTS-SETUP.md), so nothing proves at
 * sign-up that the address is real. This email is therefore the FIRST and only
 * proof of control over it — and the only way back into an account that has a
 * subscription attached. If reset is broken, a forgotten password is a lost
 * purchase.
 */

interface Body {
  email?: unknown;
}

export async function POST(req: NextRequest) {
  if (!configured()) {
    return NextResponse.json({ configured: false }, { status: 200 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  if (typeof body.email !== "string") {
    return NextResponse.json({ error: "email is required" }, { status: 400 });
  }

  const email = normaliseEmail(body.email);

  // A malformed address is the one thing worth saying out loud: it is the
  // player's typo, not a fact about who has an account.
  if (checkEmail(email)) {
    return NextResponse.json({ error: "That does not look like an email address." }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // The origin is taken from the request rather than from configuration on
  // purpose: this only ever produces a link back to the page the player is
  // already on, and Supabase will refuse any redirect not on the project's
  // allow-list, so a spoofed Host cannot send the email somewhere else.
  const origin = new URL(req.url).origin;

  try {
    await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${origin}/reset`,
    });
  } catch {
    // Swallowed for the same reason the result is: the answer must not vary.
  }

  return NextResponse.json({
    sent: true,
    message: "If that email has an account, a reset link is on its way.",
  });
}
