import { NextResponse, type NextRequest } from "next/server";

import { ensureProfile } from "@/lib/auth/oauth-profile";
import { PROVIDER_LABEL, isOAuthProvider } from "@/lib/auth/providers";
import { LIMITS, callerKey, throttle } from "@/lib/auth/throttle";
import { configured } from "@/lib/supabase/config";
import { attachSession, crossSite, signInWithProviderToken } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/oauth/native — the shipped app's door.
 *
 * Body: `{ provider, idToken, nonce? }`, where the token came out of the system
 * sign-in sheet on the device.
 *
 * ── Why the app cannot use the redirect flow ───────────────────────────────
 *
 * `/api/auth/oauth/start` ends by setting a cookie on whichever browser
 * finished the round trip, and in the app that browser is not the app.
 * `Browser.open` is a real Safari view with Safari's own cookie jar
 * (lib/commerce.ts says so about the purchase link, and it is the same fact
 * here) — so the session would land in Safari and the player would return to a
 * webview that is exactly as signed out as it was when they left.
 *
 * The native SDKs hand the app a signed `id_token` in its own process instead.
 * It posts that here like any other request, and the cookie comes back down the
 * same connection, which is the one thing that has to be true.
 *
 * ── The token is not taken on trust ────────────────────────────────────────
 *
 * It is a bearer of a claim, not proof of one, and the app is not a trusted
 * client — anything that can post to this route can post any string. Supabase
 * verifies the signature against Google's or Apple's published keys and the
 * `aud` against the client ids on the provider's settings, and refuses
 * everything else. Which is exactly why the app's bundle id has to be in
 * **Authorized Client IDs**: a native token's `aud` is the bundle id, not the
 * web client id, and without that entry every sign-in from the app fails
 * verification while the same code works perfectly in a browser.
 * docs/OAUTH-SETUP.md §4.
 */

interface Body {
  provider?: unknown;
  idToken?: unknown;
  nonce?: unknown;
  /**
   * Apple's name, which does not ride inside the token.
   *
   * Apple returns the name **beside** the credential, once, on the very first
   * authorisation of an app — it is not a claim in the `id_token`, so unlike
   * Google's `full_name` it cannot reach us through Supabase's user metadata.
   * If the app does not forward it here it is gone for that account forever.
   *
   * Client-supplied, and treated as exactly what it is: a PREFILL for a field
   * the player is about to edit on the very next screen. It names nothing the
   * player does not then confirm, and it is length-capped like every other
   * name that reaches `profiles`.
   */
  name?: unknown;
}

export async function POST(req: NextRequest) {
  // Not from our own pages. `crossSite` admits the two origins we ship
  // ourselves (lib/native/origins.ts), which is what the app calls from.
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

  if (!isOAuthProvider(body.provider) || typeof body.idToken !== "string" || !body.idToken) {
    return NextResponse.json({ error: "provider and idToken are required" }, { status: 400 });
  }

  // The same bucket the web start route spends from, so the app is not a way
  // around it. See LIMITS.oauthPerIp.
  const limited = await throttle([
    { bucket: "oauth:ip", key: callerKey(req), limit: LIMITS.oauthPerIp },
  ]);
  if (!limited.allowed) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly.", throttled: true }, { status: 429 });
  }

  const { session, failure, suggested } = await signInWithProviderToken(
    body.provider,
    body.idToken,
    typeof body.nonce === "string" && body.nonce ? body.nonce : undefined,
  );

  if (failure || !session) {
    return NextResponse.json(
      {
        configured: true,
        signedIn: false,
        error:
          failure === "disabled"
            ? `Signing in with ${PROVIDER_LABEL[body.provider]} is not switched on for this build.`
            : `That ${PROVIDER_LABEL[body.provider]} sign-in could not be completed. Try again.`,
        reason: failure ?? "invalid",
      },
      { status: failure === "disabled" ? 501 : 401 },
    );
  }

  // The provider's own metadata wins when there is any — it came through
  // Supabase's verification of the token. The forwarded name is the fallback
  // that exists solely for Apple's once-only handover.
  const forwarded = typeof body.name === "string" && body.name.trim() ? body.name.trim() : null;
  const suggestion = suggested ?? forwarded;

  const profile = await ensureProfile(session, suggestion);
  if (profile.error) {
    // No cookie attached: signed in to an account that cannot hold a save is
    // the worse of the two states. Same call /api/auth/signup makes.
    return NextResponse.json(
      { configured: true, signedIn: false, error: `profile: ${profile.error}` },
      { status: 500 },
    );
  }

  return attachSession(
    NextResponse.json({
      configured: true,
      signedIn: true,
      // "new" or "known" — which of the two device behaviours the caller owes
      // the player. lib/auth/oauth-profile.ts says why this cannot be inferred
      // any other way when one button is both doors.
      state: profile.created ? "new" : "known",
      email: session.email,
      displayName: profile.displayName,
      suggestedName: suggestion,
    }),
    session,
  );
}
