import { NextResponse, type NextRequest } from "next/server";

import { normaliseEmail } from "@/lib/auth/credentials";
import { LIMITS, THROTTLED_MESSAGE, callerKey, emailKey, throttle } from "@/lib/auth/throttle";
import { configured } from "@/lib/supabase/config";
import { crossSite, attachSession, signInWithPassword } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/signin — sign an existing account back in.
 *
 * Body: `{ email, password }`. The refresh token replaces whatever was in the
 * session cookie, including an anonymous one: signing in on a device that was
 * playing anonymously simply takes over, and the anonymous identity is
 * abandoned rather than merged. Merging two sets of saves would mean choosing
 * which company survives, and there is no answer to that a player would thank
 * us for.
 *
 * ── Deliberately vague failures ────────────────────────────────────────────
 *
 * Wrong password and no-such-account return the same message. The alternative
 * is an oracle that tells anyone who asks whether a given email belongs to a
 * player here, and the players here are children. The cost is a slightly less
 * helpful error, which is the right trade.
 *
 * There is NO credential validation beyond presence. An account made when the
 * rules were looser must still be able to get back in; the rules in
 * lib/auth/credentials.ts govern what may be CREATED, not what may sign in.
 */

interface Body {
  email?: unknown;
  password?: unknown;
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

  if (typeof body.email !== "string" || typeof body.password !== "string") {
    return NextResponse.json({ error: "email and password are required" }, { status: 400 });
  }
  if (!body.email.trim() || !body.password) {
    return NextResponse.json({ error: "Enter your email and password." }, { status: 400 });
  }

  // Two buckets. Per-address stops one machine grinding through a word list;
  // per-account stops a distributed attempt on ONE player, which is what
  // credential stuffing actually looks like and what an address limit misses.
  const target = normaliseEmail(body.email);
  const limited = await throttle([
    { bucket: "signin:ip", key: callerKey(req), limit: LIMITS.signinPerIp },
    { bucket: "signin:email", key: emailKey(target), limit: LIMITS.signinPerEmail },
  ]);
  if (!limited.allowed) {
    return NextResponse.json({ error: THROTTLED_MESSAGE, throttled: true }, { status: 429 });
  }

  const { session, failure } = await signInWithPassword(target, body.password);

  if (failure || !session) {
    return NextResponse.json(
      {
        configured: true,
        signedIn: false,
        error:
          failure === "disabled"
            ? "Accounts are not switched on for this build."
            : "That email and password do not match an account.",
        reason: failure ?? "invalid",
      },
      { status: failure === "disabled" ? 501 : 401 },
    );
  }

  // The profile row normally exists from sign-up. This is the repair for an
  // account created outside the app — a row added in the Supabase dashboard,
  // or a sign-up that died between creating the user and writing the profile.
  // Without it every subsequent save would fail a foreign key.
  const { data } = await session.supabase
    .from("profiles")
    .select("display_name")
    .eq("id", session.userId)
    .maybeSingle();

  if (!data) {
    const { error } = await session.supabase
      .from("profiles")
      .upsert({ id: session.userId, display_name: "Founder" }, { onConflict: "id" });
    if (error) {
      return NextResponse.json(
        { configured: true, signedIn: false, error: `profile: ${error.message}` },
        { status: 500 },
      );
    }
  }

  return attachSession(
    NextResponse.json({
      configured: true,
      signedIn: true,
      email: session.email,
      displayName: data?.display_name ?? "Founder",
    }),
    session,
  );
}
