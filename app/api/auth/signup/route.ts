import { NextResponse, type NextRequest } from "next/server";

import {
  CREDENTIAL_MESSAGE,
  checkCredentials,
  normaliseEmail,
} from "@/lib/auth/credentials";
import { configured } from "@/lib/supabase/config";
import { attachSession, signUpWithPassword } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/signup — create a real account.
 *
 * Body: `{ email, password, displayName }`. On success the refresh token comes
 * back as an httpOnly cookie, exactly like the anonymous session it replaces,
 * so every route that already reads that cookie keeps working unchanged.
 *
 * ── Why the password never touches the browser's Supabase client ───────────
 *
 * It does not touch the browser's anything: there is no Supabase client in the
 * browser. The credential is posted to our own origin and used server-side,
 * which keeps the token out of JavaScript's reach (the cookie is httpOnly) and
 * means no third-party auth endpoint is ever contacted from a page a minor is
 * looking at — the same rule the rest of this app follows.
 *
 * ── A new account is a NEW identity ────────────────────────────────────────
 *
 * Signing up does not convert the device's anonymous user; it mints a separate
 * one. Supabase can convert in place, but only with manual linking (beta)
 * enabled AND the email verified BEFORE a password may be set, which is
 * incompatible with signing straight in. So the anonymous user is left behind.
 *
 * That is survivable because of what each thing is:
 *   · Saves follow the player anyway — lib/cloud/sync.ts treats localStorage
 *     as the source of truth and pushes it to whatever account is signed in.
 *   · Purchases cannot be stranded, because /api/billing/checkout refuses to
 *     sell to an anonymous identity in the first place. You sign up, then you
 *     buy — never the other way round.
 */

interface Body {
  email?: unknown;
  password?: unknown;
  displayName?: unknown;
}

export async function POST(req: NextRequest) {
  if (!configured()) {
    // No Supabase project. The app is designed to run this way — the caller
    // keeps its device-local account and plays on localStorage alone.
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

  const email = normaliseEmail(body.email);
  const problem = checkCredentials(email, body.password);
  if (problem) {
    return NextResponse.json({ error: CREDENTIAL_MESSAGE[problem] }, { status: 400 });
  }

  const { session, failure } = await signUpWithPassword(email, body.password);

  if (failure) {
    return NextResponse.json(
      {
        configured: true,
        error:
          failure === "taken"
            ? "That email already has an account. Sign in instead."
            : failure === "weak-password"
              ? CREDENTIAL_MESSAGE["password-short"]
              : failure === "bad-email"
                ? CREDENTIAL_MESSAGE["email-shape"]
                : failure === "disabled"
                  ? "Accounts are not switched on for this build."
                  : "Could not create the account. Try again.",
        reason: failure,
      },
      // 409 for a taken email so the client can offer sign-in without parsing
      // prose; everything else is the request's fault or the project's.
      { status: failure === "taken" ? 409 : failure === "disabled" ? 501 : 400 },
    );
  }

  if (!session) {
    // Email confirmation is ON in the Supabase project. The account exists but
    // there is no session to hand back, so say so plainly rather than pretend
    // the player is signed in. docs/ACCOUNTS-SETUP.md says to turn it off.
    return NextResponse.json(
      { configured: true, signedIn: false, needsConfirmation: true },
      { status: 200 },
    );
  }

  // The profile row is the foreign key every other table hangs off, so it has
  // to exist before the first sync. Name is optional here: onboarding collects
  // the founder name properly and syncs it later.
  const displayName =
    typeof body.displayName === "string" && body.displayName.trim()
      ? body.displayName.trim().slice(0, 24)
      : "Founder";

  const { error } = await session.supabase
    .from("profiles")
    .upsert({ id: session.userId, display_name: displayName }, { onConflict: "id" });

  if (error) {
    // The auth user now exists but has no profile row. Reported rather than
    // swallowed: the player would otherwise appear signed in and every save
    // would fail a foreign key from then on.
    return NextResponse.json(
      { configured: true, signedIn: false, error: `profile: ${error.message}` },
      { status: 500 },
    );
  }

  return attachSession(
    NextResponse.json({ configured: true, signedIn: true, email: session.email }),
    session,
  );
}
