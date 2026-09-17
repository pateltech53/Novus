import { NextResponse, type NextRequest } from "next/server";

import { configured } from "@/lib/supabase/config";
import { sessionFromRequest, withSession } from "@/lib/supabase/route";
import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The app's front door asks once, under one refreshed session, which workspaces
 * this account owns. The answer is navigation, never an authorization grant:
 * both consoles still enforce their existing server gates on every operation.
 * RLS and explicit own-account filters keep roster/contact data out of this
 * lightweight read. A failed read is retryable, not a cached player verdict.
 */
export async function GET(req: NextRequest) {
  const session = configured() ? await sessionFromRequest(req) : null;
  const reply = (body: Record<string, unknown>, status = 200) => withSession(
    NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } }), session,
  );
  if (!configured() || !session || session.anonymous) {
    return reply({ configured: configured(), signedIn: false, admin: false, chapter: null });
  }

  const [profile, chapters] = await Promise.all([
    session.supabase.from("profiles").select("role, display_name")
      .eq("id", session.userId).maybeSingle(),
    session.supabase.from("chapters").select("name, status")
      .eq("owner_profile_id", session.userId).is("deleted_at", null)
      .order("created_at", { ascending: false }),
  ]);
  if (profile.error || chapters.error) {
    return reply({ error: "Could not load your workspaces. Try again." }, 503);
  }
  const chapter = chapters.data?.find((row) => row.status === "active") ?? chapters.data?.[0];
  return reply({
    configured: true,
    signedIn: true,
    displayName: profile.data?.display_name ?? null,
    admin: profile.data?.role === "admin" && !!SUPABASE_SERVICE_ROLE_KEY,
    chapter: chapter ? { name: chapter.name, status: chapter.status } : null,
  });
}
