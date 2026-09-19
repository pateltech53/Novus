import { NextResponse, type NextRequest } from "next/server";
import { manager, answer } from "@/lib/competitions/server";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const auth = await manager(req);
  if (auth instanceof NextResponse) return auth;
  const offset = Math.max(
    0,
    Number(req.nextUrl.searchParams.get("offset")) || 0,
  );
  const [progress, admins] = await Promise.all([
    auth.db.rpc("chapter_student_progress", {
      p_chapter: auth.chapter.id,
      p_query: (req.nextUrl.searchParams.get("q") ?? "").slice(0, 100),
      p_limit: 50,
      p_offset: offset,
    }),
    auth.db
      .from("chapter_admins")
      .select("id,email,accepted_at,created_at")
      .eq("chapter_id", auth.chapter.id)
      .order("created_at"),
  ]);
  if (progress.error || admins.error)
    return answer(
      auth.session,
      { error: "Could not load enterprise progress. Try again." },
      503,
    );
  return answer(auth.session, {
    ...progress.data,
    admins: admins.data,
    role: auth.chapter.role,
  });
}
