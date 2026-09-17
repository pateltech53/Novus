import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { CREDENTIAL_MESSAGE, checkPassword } from "@/lib/auth/credentials";
import { MAX_NAME_LENGTH } from "@/lib/account";
import { adminClient } from "@/lib/supabase/admin";
import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";
import { SUPABASE_ANON_KEY, SUPABASE_URL, configured } from "@/lib/supabase/config";
import { crossSite, attachSession, type Session } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/reset/confirm — finish a password reset, or set up an
 * invited seat.
 *
 * Body: `{ accessToken, refreshToken, password, displayName? }`, where the two
 * tokens came out of the URL fragment on the link Supabase emailed.
 *
 * `displayName` is optional and exists for one caller: /join/setup, when the
 * invite arrived through Supabase's own "You have been invited" mail and there
 * was no claim screen to ask for a name. It is written as the account itself,
 * under the session the tokens just proved, so it can only ever name the
 * profile the link belongs to. /reset never sends it, and a reset must not
 * rename anybody.
 *
 * ── Why the tokens arrive from the client ──────────────────────────────────
 *
 * Supabase's recovery link puts them in the URL **fragment** (`#access_token=…`),
 * and a fragment is never sent to a server — the browser keeps it. So the
 * /reset page reads its own hash and posts the values here. It is the only
 * shape available without running a Supabase client in the browser, which this
 * app does not do.
 *
 * The token is the proof. Whoever holds it has demonstrated control of the
 * mailbox, which is exactly what a password reset is meant to establish. It is
 * short-lived and single-use on Supabase's side.
 *
 * On success the player is left SIGNED IN, with the session cookie set. Making
 * someone type the password they just chose, on the same device, thirty
 * seconds later, is a ritual rather than a control.
 */

interface Body {
  accessToken?: unknown;
  refreshToken?: unknown;
  password?: unknown;
  displayName?: unknown;
}

/** Bounded and trimmed, the same shape the rest of the app stores. Anything
 *  that is not a usable name is simply absent — a blank one never overwrites
 *  the name already on the profile. */
const cleanName = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().slice(0, MAX_NAME_LENGTH);
  return trimmed.length > 0 ? trimmed : null;
};

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

  if (
    typeof body.accessToken !== "string" ||
    typeof body.refreshToken !== "string" ||
    typeof body.password !== "string"
  ) {
    return NextResponse.json({ error: "missing token or password" }, { status: 400 });
  }

  const problem = checkPassword(body.password);
  if (problem) {
    return NextResponse.json({ error: CREDENTIAL_MESSAGE[problem] }, { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  // Adopt the recovery session, then change the password as that user. An
  // expired or already-used link fails here, which is the correct place for it
  // to fail — before anything is written.
  const { data: adopted, error: adoptError } = await supabase.auth.setSession({
    access_token: body.accessToken,
    refresh_token: body.refreshToken,
  });

  if (adoptError || !adopted.session || !adopted.user) {
    return NextResponse.json(
      { error: "That reset link has expired or has already been used. Ask for a new one." },
      { status: 401 },
    );
  }

  const linkSession = adopted.session;
  const session: Session = {
    supabase,
    userId: adopted.user.id,
    refreshToken: adopted.session.refresh_token,
    anonymous: false,
    email: adopted.user.email ?? null,
  };

  // This session came from the submitted link, NOT the browser's cookie.
  // On any failure that cookie must stay with the previous player: the
  // client only clears their local saves when setup succeeds. Installing the
  // invitee's cookie on an error would let those saves sync into that account.
  // setSession may refresh expired input tokens; return that replacement pair
  // to the caller already holding the credentials, without changing browser
  // identity. The setup page keeps its original bounded storage deadline.
  const incomplete = async (error: string, status: number) => {
    const { data } = await supabase.auth.getSession();
    const retry = data.session ?? linkSession;
    return NextResponse.json({
      error,
      retryTokens: { access: retry.access_token, refresh: retry.refresh_token },
    }, { status, headers: { "Cache-Control": "no-store" } });
  };

  // Both mailers finish here. Previously only /chapter/claim stamped the
  // seat, before any password existed, and Supabase's direct invite never
  // stamped it at all. Resolve only this authenticated user's invited seat;
  // an ordinary reset, or an existing account granted a seat, has no claim
  // to finish. The service role is never used without that identity filter.
  const db = SUPABASE_SERVICE_ROLE_KEY ? adminClient() : null;
  let invitation: { id: string; claimed_at: string | null; seat_name: string | null } | null = null;
  if (db) {
    const { data: seat, error: seatError } = await db
      .from("chapter_seats")
      .select("id, claimed_at, seat_name")
      .eq("profile_id", session.userId)
      .eq("created_by_invite", true)
      .maybeSingle();
    if (seatError) {
      return incomplete("Could not check your invitation. Your password has not changed; try again.", 503);
    }
    invitation = seat;
  }

  const { error: updateError } = await supabase.auth.updateUser({ password: body.password });
  const samePassword = updateError?.code === "same_password" ||
    updateError?.message.toLowerCase().includes("different") === true;
  // Password storage and the seat row belong to separate services. If the
  // password landed but the final seat write failed, the same password must
  // be accepted on retry for THAT pending invite. Other resets keep their
  // existing rule, and all other password errors remain failures.
  if (updateError && !(invitation && !invitation.claimed_at && samePassword)) {
    return incomplete(
      samePassword
        ? "Choose a password you have not used here before."
        : "Could not set that password. Try again.",
      400,
    );
  }

  // Supabase may refresh while adopting or using an expired session. Read
  // the current pair rather than assuming the emailed refresh token survived.
  const { data: fresh } = await supabase.auth.getSession();
  session.refreshToken = fresh.session?.refresh_token ?? adopted.session.refresh_token;

  const named = cleanName(body.displayName);
  if (db && invitation) {
    const { error: claimError } = await db
      .from("chapter_seats")
      .update({
        claimed_at: invitation.claimed_at ?? new Date().toISOString(),
        invite_token: null,
        seat_name: named ?? invitation.seat_name,
      })
      .eq("id", invitation.id)
      .eq("profile_id", session.userId)
      .eq("created_by_invite", true);
    if (claimError) {
      return incomplete("Your password was saved, but invitation setup could not finish. Press the button again with the same password.", 503);
    }
  }

  // A name, when the caller had one to give and nothing else asked for it.
  // Written under the adopted session, so "profiles: update own" (0001) is the
  // thing that decides it — no service role, no way to name another account.
  // A failure here is not worth losing a set password over: the account works,
  // and the name stays whatever it was.
  if (named) {
    await supabase.from("profiles").update({ display_name: named }).eq("id", session.userId);
  }

  // The account's own display name, so the device-local cache the front door
  // reads can be stamped with the real name rather than the "Founder"
  // placeholder — the page has no other source for it.
  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", session.userId)
    .maybeSingle();

  return attachSession(
    NextResponse.json({
      ok: true,
      signedIn: true,
      email: session.email,
      displayName: profile?.display_name ?? named ?? null,
    }),
    session,
  );
}
