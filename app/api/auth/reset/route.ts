import { NextResponse, type NextRequest } from "next/server";

import { checkEmail, normaliseEmail } from "@/lib/auth/credentials";
import { SUPABASE_ANON_KEY, SUPABASE_URL, configured } from "@/lib/supabase/config";
import { SITE_URL } from "@/lib/stripe/config";
import { LIMITS, THROTTLED_MESSAGE, callerKey, emailKey, throttle } from "@/lib/auth/throttle";
import { createClient } from "@supabase/supabase-js";
import { crossSite } from "@/lib/supabase/route";

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

  // Not from our own pages. See crossSite() — a cross-site form post is not
  // preflighted, and req.json() parses the body whatever type it claims.
  if (crossSite(req)) {
    return NextResponse.json({ error: "cross-site request refused" }, { status: 403 });
  }
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

  // This route makes us send mail to an address a stranger typed. Unthrottled
  // it is a mail bomber pointed at anyone, and a way to burn the project's
  // email quota until real resets stop arriving.
  const limited = await throttle([
    { bucket: "reset:ip", key: callerKey(req), limit: LIMITS.resetPerIp },
    { bucket: "reset:email", key: emailKey(email), limit: LIMITS.resetPerEmail, windowMinutes: 60 },
  ]);
  if (!limited.allowed) {
    // Same shape as the success answer on purpose — see the note above about
    // never revealing whether an address has an account. A distinct 429 here
    // would say "this address is worth rate limiting", which is a tell.
    return NextResponse.json({
      sent: true,
      message: "If that email has an account, a reset link is on its way.",
    });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Configured origin first, request origin only as a fallback.
  //
  // `new URL(req.url).origin` is built from the Host header, which the caller
  // controls — the exact input lib/stripe/config.ts refuses to trust for
  // Stripe's return URLs. Supabase's redirect allow-list would reject a
  // spoofed host anyway, but "a second system happens to catch it" is not the
  // same as not sending it, and this link is the one that resets a password.
  const origin = SITE_URL || new URL(req.url).origin;

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
