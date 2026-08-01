import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { CREDENTIAL_MESSAGE, checkPassword } from "@/lib/auth/credentials";
import { SUPABASE_ANON_KEY, SUPABASE_URL, configured } from "@/lib/supabase/config";
import { crossSite, attachSession, type Session } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/auth/reset/confirm — finish a password reset.
 *
 * Body: `{ accessToken, refreshToken, password }`, where the two tokens came
 * out of the URL fragment on the reset link Supabase emailed.
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

  const { error: updateError } = await supabase.auth.updateUser({ password: body.password });
  if (updateError) {
    return NextResponse.json(
      {
        error:
          updateError.message.toLowerCase().includes("different")
            ? "Choose a password you have not used here before."
            : "Could not set that password. Try again.",
      },
      { status: 400 },
    );
  }

  // updateUser rotates the session, so re-read it rather than reusing the
  // token from the email — that one is spent.
  const { data: fresh } = await supabase.auth.getSession();
  const refreshToken = fresh.session?.refresh_token ?? adopted.session.refresh_token;

  const session: Session = {
    supabase,
    userId: adopted.user.id,
    refreshToken,
    anonymous: false,
    email: adopted.user.email ?? null,
  };

  return attachSession(
    NextResponse.json({ ok: true, signedIn: true, email: session.email }),
    session,
  );
}
