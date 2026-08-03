import { NextResponse, type NextRequest } from "next/server";

import { adminClient } from "@/lib/supabase/admin";
import { configured } from "@/lib/supabase/config";
import { crossSite, sessionFromRequest, withSession } from "@/lib/supabase/route";
import { isPoolHandle } from "@/lib/leaderboard/handles";
import { mayAutoList, moderateCompanyName } from "@/lib/leaderboard/moderation";
import {
  DAILY_SUBMISSION_LIMIT,
  ENGINE_VERSION,
  EVENTS_HASH,
  LISTING_POLICY,
  SEASON,
} from "@/lib/leaderboard/season";
import { canonicalJson } from "@/lib/leaderboard/tape";
import { parseTape, verifyTape } from "@/lib/leaderboard/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/leaderboard/submit — a tape in, a verdict out.
 *
 * ── The shape of the whole thing in one line ────────────────────────────────
 *
 * A player submits INPUTS, the server replays them against `lib/engine` and
 * writes the OUTPUTS. Nothing a client sends ever reaches a board query.
 *
 * ── The order below is the security model ───────────────────────────────────
 *
 *   1. Same-site, or a native origin we ship. A Next.js Route Handler has no
 *      CSRF protection of its own.
 *   2. A real session. Anonymous identities are refused — see the note there.
 *   3. The quota, claimed BEFORE the replay. The replay is the expensive part
 *      and an unmetered expensive part is a denial-of-service endpoint.
 *   4. Moderation of the company name. Cheap, and a rejection here saves a
 *      replay too.
 *   5. The replay. Bounds first, then the engine.
 *   6. The write, with the service role, of numbers the server computed.
 *
 * Every step before 5 exists so that step 5 is not free to trigger.
 */
export async function POST(req: NextRequest) {
  if (crossSite(req)) {
    return NextResponse.json({ ok: false, reason: "cross-site" }, { status: 403 });
  }
  if (!configured()) {
    return NextResponse.json({ ok: false, reason: "not-configured" }, { status: 503 });
  }

  const session = await sessionFromRequest(req);
  if (!session) {
    return withSession(
      NextResponse.json({ ok: false, reason: "signed-out" }, { status: 401 }),
      session,
    );
  }
  /*
   * An anonymous identity may play the whole game and may not hold a board
   * place. It lives entirely in a cookie: clear the browser and the identity is
   * gone, which would leave a row on a public board that nobody can reach,
   * rename, report or delete — including the child it belongs to. §9.7 makes
   * in-app deletion the only deletion path there is, and that path needs an
   * account to sign back into.
   */
  if (session.anonymous) {
    return withSession(
      NextResponse.json({ ok: false, reason: "needs-account" }, { status: 403 }),
      session,
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return withSession(
      NextResponse.json({ ok: false, reason: "bad-json" }, { status: 400 }),
      session,
    );
  }

  const payload = body as {
    tape?: unknown;
    claimedPeakValuation?: unknown;
    claimedYearsSurvived?: unknown;
    proAtSubmit?: unknown;
  };

  const tape = parseTape(payload.tape);
  if (!tape) {
    return withSession(
      NextResponse.json({ ok: false, reason: "bad-tape" }, { status: 400 }),
      session,
    );
  }

  const claimed = {
    peakValuation: Number(payload.claimedPeakValuation ?? 0),
    yearsSurvived: Number(payload.claimedYearsSurvived ?? 0),
  };

  const admin = adminClient();

  // ── The player's handle ───────────────────────────────────────────────────
  /*
   * Read from `profiles`, never from the request.
   *
   * `founder_display_name` is the only name that appears on a public board, and
   * the one thing that must never be able to carry a child's real one. The
   * client does not get to supply it: it is whatever the player already chose
   * from the curated shuffle, and it is re-validated against the word list here
   * because a row written before `isPoolHandle` existed could still match the
   * regex without being in the pool.
   */
  const { data: profile } = await admin
    .from("profiles")
    .select("board_handle")
    .eq("id", session.userId)
    .maybeSingle();

  const handle = profile?.board_handle ?? null;
  if (!handle || !isPoolHandle(handle)) {
    return withSession(
      NextResponse.json({ ok: false, reason: "needs-handle" }, { status: 409 }),
      session,
    );
  }

  // ── The quota, before the expensive part ─────────────────────────────────
  const { data: slot, error: slotError } = await admin.rpc("claim_submission_slot", {
    p_profile: session.userId,
    p_max: DAILY_SUBMISSION_LIMIT,
  });
  if (slotError) {
    return withSession(
      NextResponse.json({ ok: false, reason: "quota-unavailable" }, { status: 503 }),
      session,
    );
  }
  if (slot === false) {
    return withSession(
      NextResponse.json(
        { ok: false, reason: "rate-limited", limit: DAILY_SUBMISSION_LIMIT },
        { status: 429 },
      ),
      session,
    );
  }

  // ── Moderation, before the expensive part ────────────────────────────────
  const moderation = moderateCompanyName(tape.companyName);
  if (moderation.verdict === "reject") {
    return withSession(
      NextResponse.json(
        { ok: false, reason: "name-refused", message: moderation.message },
        { status: 422 },
      ),
      session,
    );
  }

  // ── The replay ───────────────────────────────────────────────────────────
  const todayISO = new Date().toISOString().slice(0, 10);
  const verdict = verifyTape(tape, claimed, todayISO);

  /*
   * The evidence row is written whatever the verdict.
   *
   * A rejected run is not a run that vanishes: the tape, the hash and the
   * reason are what turn "a spike in `valuation-above-ceiling`" into either an
   * exploit going around or a bug we shipped, and you want to know which within
   * the hour (§7.4). It is also the only way to measure how often a claim
   * differs from the truth, which is the entire purpose of the `claimed_*`
   * columns.
   */
  const { data: runRow, error: runError } = await admin
    .from("runs")
    .insert({
      profile_id: session.userId,
      seed: tape.seed,
      tape,
      tape_hash: verdict.tapeHash,
      engine_version: ENGINE_VERSION,
      events_hash: EVENTS_HASH,
      company_name: tape.companyName,
      industry: tape.industry,
      claimed_peak_valuation: claimed.peakValuation,
      claimed_years_survived: claimed.yearsSurvived,
      verified_peak_valuation: verdict.peakValuation,
      verified_years_survived: verdict.yearsSurvived,
      verified_ended_by: verdict.endedBy,
      status: verdict.status,
      reject_reason: verdict.rejectReason ?? verdict.notes.slice(0, 4).join(" · ") ?? null,
      // Audit only, and enforced never to reach a board: it lives on `runs`,
      // is in neither view, no index and no ORDER BY. It exists so §8.3's
      // standing audit can prove Brand Law 4 holds (0002's closing note).
      pro_at_submit: payload.proAtSubmit === true,
      verified_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (runError) {
    // 23505 on (profile_id, tape_hash): the same tape twice is the same run
    // twice. Not an error the player did anything wrong to cause — they tapped
    // submit again — so it reads as "already in" rather than as a failure.
    if (runError.code === "23505") {
      return withSession(
        NextResponse.json({ ok: true, status: "duplicate", listed: false }),
        session,
      );
    }
    return withSession(
      NextResponse.json({ ok: false, reason: "write-failed" }, { status: 500 }),
      session,
    );
  }

  if (verdict.status === "rejected") {
    return withSession(
      NextResponse.json(
        {
          ok: false,
          status: "rejected",
          reason: verdict.rejectReason,
          // Deliberately vague to the player and precise in the row above. A
          // rejection message that names the exact bound is a rejection message
          // that teaches somebody how to sit just underneath it.
          message: "That run could not be verified against the engine.",
        },
        { status: 422 },
      ),
      session,
    );
  }

  // ── Onto the boards ──────────────────────────────────────────────────────
  /*
   * A flagged run is stored and NOT published. It is a run that looked
   * extraordinary or replayed with too many desynchronised taps, and the
   * honest answer to both is a human, not a door in the face (§7.4).
   */
  const listed =
    verdict.status === "verified" && mayAutoList(moderation, LISTING_POLICY);

  const boards: { board: "survival" | "valuation"; wrote: boolean }[] = [];
  if (verdict.status === "verified") {
    for (const board of ["survival", "valuation"] as const) {
      const { data: wrote } = await admin.rpc("record_board_entry", {
        p_board: board,
        p_season: SEASON,
        p_run: runRow.id,
        p_profile: session.userId,
        p_handle: handle,
        p_company: tape.companyName,
        p_industry: tape.industry,
        p_peak: verdict.peakValuation,
        p_years: verdict.yearsSurvived,
        p_ended_by: verdict.endedBy,
        p_listed: listed,
      });
      boards.push({ board, wrote: wrote === true });
    }
  }

  return withSession(
    NextResponse.json({
      ok: true,
      status: verdict.status,
      season: SEASON,
      // The SERVER's numbers, handed straight back. The screen shows these and
      // not the ones it sent, so a player whose save was edited finds out here
      // rather than by wondering why the board disagrees with their statement.
      peakValuation: verdict.peakValuation,
      yearsSurvived: verdict.yearsSurvived,
      boards,
      listed,
      // Null when the name is clean and the policy lists it. Otherwise this is
      // the sentence that explains why the row is not visible yet.
      message:
        moderation.message ??
        (verdict.status === "flagged"
          ? "That run is exceptional enough that a human is going to look at it first."
          : listed
            ? null
            : "Your run is in. The name is waiting on a human before it shows publicly — that is how every name gets there."),
      // Bytes hashed, for the client's own duplicate check. Cheap, and it makes
      // "already submitted" answerable without a round trip.
      tapeHash: verdict.tapeHash,
      tapeBytes: canonicalJson(tape).length,
    }),
    session,
  );
}
