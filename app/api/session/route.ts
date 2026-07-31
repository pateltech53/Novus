import { NextResponse, type NextRequest } from "next/server";

import { configured } from "@/lib/supabase/config";
import { attachSession, sessionOrCreate } from "@/lib/supabase/route";

export const runtime = "nodejs";
// Sessions are per-player state; caching this would hand one player's identity
// to the next visitor.
export const dynamic = "force-dynamic";

/**
 * POST /api/session — get (or mint) this device's anonymous identity.
 *
 * Called once on boot, before any sync. The refresh token goes back as an
 * httpOnly cookie; the browser never sees a Supabase token in JS.
 *
 * `configured: false` is a normal answer, not an error: with no Supabase
 * project wired up the app runs on localStorage alone, and the client is
 * written to expect exactly that.
 */
export async function POST(req: NextRequest) {
  if (!configured()) {
    return NextResponse.json({ configured: false, signedIn: false });
  }

  const session = await sessionOrCreate(req);
  if (!session) {
    // Anonymous sign-ins are probably disabled on the project, or the rate
    // limit caught us. Either way the player keeps playing locally.
    return NextResponse.json(
      { configured: true, signedIn: false, reason: "sign-in-failed" },
      { status: 200 },
    );
  }

  // The profile row is the anchor for every other table's foreign key, so it
  // has to exist before the first sync. display_name is a placeholder until
  // the player founds a company and the real founder name arrives.
  const { error } = await session.supabase
    .from("profiles")
    .upsert({ id: session.userId, display_name: "Founder" }, { onConflict: "id", ignoreDuplicates: true });

  if (error) {
    return NextResponse.json(
      { configured: true, signedIn: false, reason: error.message },
      { status: 200 },
    );
  }

  return attachSession(
    NextResponse.json({ configured: true, signedIn: true }),
    session,
  );
}
