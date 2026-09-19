import { NextResponse, type NextRequest } from "next/server";
import { account, answer } from "@/lib/competitions/server";
import { adminClient } from "@/lib/supabase/admin";
import { parseTape, verifyTape } from "@/lib/leaderboard/verify";
import { moderateCompanyName } from "@/lib/leaderboard/moderation";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const session = await account(req);
  if (session instanceof NextResponse) return session;
  if (Number(req.headers.get("content-length") ?? 0) > 300000)
    return answer(session, { error: "Company history is too large." }, 413);
  let b;
  try {
    b = await req.json();
  } catch {
    return answer(session, { error: "Invalid request." }, 400);
  }
  const tape = parseTape(b?.tape);
  if (!tape)
    return answer(session, { error: "Company history is unavailable." }, 400);
  const db = adminClient();
  const runId = `run-${tape.seed.toString(36)}`;
  const { data: start, error } = await db
    .from("company_starts")
    .select("industry,tutorial,pro,started_at")
    .eq("profile_id", session.userId)
    .eq("run_id", runId)
    .maybeSingle();
  if (error)
    return answer(session, { error: "Could not check this company." }, 503);
  if (!start) return answer(session, { ok: true, count: 0 });
  const eligible = await db.rpc("company_competition_count", {
    p_profile: session.userId,
    p_run: runId,
  });
  if (eligible.error)
    return answer(
      session,
      { error: "Could not check competition eligibility." },
      503,
    );
  if (!eligible.data) return answer(session, { ok: true, count: 0 });
  if (
    tape.industry !== start.industry ||
    tape.tutorial !== start.tutorial ||
    tape.entries.some(
      (e) =>
        (e.t === "pro" && e.on && !start.pro) ||
        ("atISO" in e && e.atISO < start.started_at.slice(0, 10)),
    )
  )
    return answer(
      session,
      { error: "Company history does not match its registration." },
      422,
    );
  const { data: quota, error: qError } = await db.rpc("claim_auth_attempt", {
    p_bucket: "competition-score",
    p_key: session.userId,
    p_limit: 12,
    p_window: "1 minute",
  });
  if (qError)
    return answer(
      session,
      { error: "Score verification is temporarily unavailable." },
      503,
    );
  if (!quota)
    return answer(session, { error: "Please wait before syncing again." }, 429);
  if (moderateCompanyName(tape.companyName).verdict === "reject")
    return answer(
      session,
      { error: "Rename this company before entering the leaderboard." },
      422,
    );
  const verdict = verifyTape(
    tape,
    { peakValuation: Number(b.peak ?? 0), yearsSurvived: Number(b.years ?? 1) },
    new Date().toISOString().slice(0, 10),
  );
  if (verdict.status !== "verified" || verdict.peakValuation === null)
    return answer(
      session,
      { error: "This company’s score could not be verified." },
      422,
    );
  const { data, error: writeError } = await db.rpc("record_competition_score", {
    p_profile: session.userId,
    p_run: runId,
    p_name: tape.companyName,
    p_peak: Math.floor(verdict.peakValuation),
    p_hash: verdict.tapeHash,
  });
  return answer(
    session,
    writeError
      ? { error: "Could not save your competition score." }
      : {
          ok: true,
          count: data,
          peak: verdict.peakValuation,
          syncedAt: new Date().toISOString(),
        },
    writeError ? 503 : 200,
  );
}
