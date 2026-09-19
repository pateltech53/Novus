import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { configured } from "@/lib/supabase/config";
import { SUPABASE_SERVICE_ROLE_KEY } from "@/lib/stripe/config";
import {
  crossSite,
  sessionFromRequest,
  withSession,
  type Session,
} from "@/lib/supabase/route";
import { managedChapter } from "@/lib/chapter/admin";
import { adminClient } from "@/lib/supabase/admin";
export const answer = (
  session: Session | null,
  body: Record<string, unknown>,
  status = 200,
) =>
  withSession(
    NextResponse.json(body, {
      status,
      headers: { "Cache-Control": "no-store" },
    }),
    session,
  );
export async function account(req: NextRequest) {
  if (req.method !== "GET" && crossSite(req))
    return answer(null, { error: "Cross-site request refused." }, 403);
  if (!configured() || !SUPABASE_SERVICE_ROLE_KEY)
    return answer(null, { error: "This service is not configured." }, 503);
  const session = await sessionFromRequest(req);
  return !session || session.anonymous
    ? answer(session, { error: "Sign in to continue." }, 401)
    : session;
}
export async function manager(req: NextRequest, existing?: Session) {
  const session = existing ?? (await account(req));
  if (session instanceof NextResponse) return session;
  let chapter;
  try {
    chapter = await managedChapter(
      session,
      req.nextUrl.searchParams.get("chapterId"),
    );
  } catch {
    return answer(
      session,
      { error: "Could not check enterprise access. Try again." },
      503,
    );
  }
  return chapter
    ? { session, chapter, db: adminClient() }
    : answer(session, { error: "Enterprise is unavailable." }, 404);
}
