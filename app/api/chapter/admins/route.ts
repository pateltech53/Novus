import { NextResponse, type NextRequest } from "next/server";
import { account, manager, answer } from "@/lib/competitions/server";
import { adminClient } from "@/lib/supabase/admin";
import { checkEmail, normaliseEmail } from "@/lib/auth/credentials";
import { isUuid } from "@/lib/admin/guard";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const session = await account(req);
  if (session instanceof NextResponse) return session;
  const db = adminClient();
  const { data, error } = await db
    .from("chapter_admins")
    .select("id, email, chapter_id, chapters!inner(name, deleted_at)")
    .eq("email", normaliseEmail(session.email ?? ""))
    .is("profile_id", null)
    .is("chapters.deleted_at", null);
  return error
    ? answer(session, { error: "Could not load invitations." }, 503)
    : answer(session, { invitations: data ?? [] });
}
export async function POST(req: NextRequest) {
  const session = await account(req);
  if (session instanceof NextResponse) return session;
  let body;
  try {
    body = await req.json();
  } catch {
    return answer(session, { error: "Invalid request." }, 400);
  }
  if (body?.action === "accept" && isUuid(body.invitationId)) {
    const { data, error } = await session.supabase.rpc("accept_chapter_admin", {
      p_invitation: body.invitationId,
    });
    return error
      ? answer(session, { error: error.message }, 409)
      : answer(session, { ok: true, chapterId: data });
  }
  const auth = await manager(req, session);
  if (auth instanceof NextResponse) return auth;
  if (auth.chapter.role !== "owner" || auth.chapter.status !== "active")
    return answer(
      auth.session,
      {
        error:
          "Only the owner of an active enterprise can invite administrators.",
      },
      403,
    );
  const email =
    typeof body?.email === "string" ? normaliseEmail(body.email) : "";
  if (checkEmail(email) || email === normaliseEmail(auth.session.email ?? ""))
    return answer(
      auth.session,
      { error: "Enter another administrator’s email address." },
      400,
    );
  const { data, error } = await auth.db
    .from("chapter_admins")
    .insert({
      chapter_id: auth.chapter.id,
      email,
      invited_by: auth.session.userId,
    })
    .select("id")
    .single();
  return error
    ? answer(
        auth.session,
        {
          error:
            error.code === "23505"
              ? "This administrator is already invited."
              : "Could not create invitation.",
        },
        409,
      )
    : answer(auth.session, { ok: true, invitationId: data.id });
}
export async function DELETE(req: NextRequest) {
  const auth = await manager(req);
  if (auth instanceof NextResponse) return auth;
  if (auth.chapter.role !== "owner")
    return answer(
      auth.session,
      { error: "Only the owner can remove administrators." },
      403,
    );
  let body;
  try {
    body = await req.json();
  } catch {
    return answer(auth.session, { error: "Invalid request." }, 400);
  }
  if (!isUuid(body?.id))
    return answer(auth.session, { error: "Choose an administrator." }, 400);
  const { error } = await auth.db
    .from("chapter_admins")
    .delete()
    .eq("id", body.id)
    .eq("chapter_id", auth.chapter.id);
  return answer(
    auth.session,
    error ? { error: "Could not remove administrator." } : { ok: true },
    error ? 503 : 200,
  );
}
