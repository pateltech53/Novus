import { NextResponse, type NextRequest } from "next/server";

import type { LegacyState, RunState } from "@/lib/engine/types";
import { configured } from "@/lib/supabase/config";
import { attachSession, sessionFromRequest, type Session } from "@/lib/supabase/route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET  /api/sync — pull this player's cloud copy.
 * PUT  /api/sync — push it.
 *
 * The shape on the wire is the same one lib/engine/save.ts already speaks:
 * { run, legacy, prefs }. The database columns beside `saves.state` are a
 * listing cache derived here, on write — the client never sends them, because
 * a client-sent summary of a client-sent blob proves nothing.
 *
 * Everything runs as the signed-in player, so RLS is the access check. There
 * is no code path in this file that can touch another player's row.
 */

interface Prefs {
  rookieMode: boolean;
  onboarded: boolean;
  micCalibration: number | null;
  founderName: string;
}

const noSession = () =>
  NextResponse.json({ configured: configured(), signedIn: false }, { status: 200 });

export async function GET(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return noSession();

  const [saveRow, legacyRow, prefRow, profileRow] = await Promise.all([
    session.supabase
      .from("saves")
      .select("state, updated_at")
      .eq("profile_id", session.userId)
      .eq("slot", 0)
      .maybeSingle(),
    session.supabase
      .from("legacy")
      .select("best_year, runs_completed, shark_respect, badges, autopsies, updated_at")
      .eq("profile_id", session.userId)
      .maybeSingle(),
    session.supabase
      .from("preferences")
      .select("rookie_mode, onboarded, mic_calibration, updated_at")
      .eq("profile_id", session.userId)
      .maybeSingle(),
    session.supabase
      .from("profiles")
      .select("display_name")
      .eq("id", session.userId)
      .maybeSingle(),
  ]);

  const legacy: LegacyState | null = legacyRow.data
    ? {
        bestYear: legacyRow.data.best_year,
        runsCompleted: legacyRow.data.runs_completed,
        sharkRespect: legacyRow.data.shark_respect,
        badges: legacyRow.data.badges ?? [],
        autopsies: legacyRow.data.autopsies ?? [],
      }
    : null;

  const prefs: Prefs | null = prefRow.data
    ? {
        rookieMode: prefRow.data.rookie_mode,
        onboarded: prefRow.data.onboarded,
        micCalibration: prefRow.data.mic_calibration,
        founderName: profileRow.data?.display_name ?? "",
      }
    : null;

  return attachSession(
    NextResponse.json({
      configured: true,
      signedIn: true,
      run: (saveRow.data?.state as RunState | undefined) ?? null,
      legacy,
      prefs,
      // The client compares these against its own last-write stamp to decide
      // whether the cloud copy is worth adopting.
      updatedAt: {
        run: saveRow.data?.updated_at ?? null,
        legacy: legacyRow.data?.updated_at ?? null,
        prefs: prefRow.data?.updated_at ?? null,
      },
    }),
    session,
  );
}

export async function PUT(req: NextRequest) {
  const session = await sessionFromRequest(req);
  if (!session) return noSession();

  let body: { run?: RunState | null; legacy?: LegacyState; prefs?: Prefs };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }

  const errors: string[] = [];

  if (body.prefs) {
    errors.push(...(await writePrefs(session, body.prefs)));
  }
  if (body.legacy) {
    errors.push(...(await writeLegacy(session, body.legacy)));
  }
  // `run: null` is a real instruction — clearRun() on a buried company.
  if (body.run !== undefined) {
    errors.push(...(await writeRun(session, body.run)));
  }

  return attachSession(
    NextResponse.json(errors.length ? { ok: false, errors } : { ok: true }),
    session,
  );
}

async function writePrefs(session: Session, prefs: Prefs): Promise<string[]> {
  const out: string[] = [];

  // The founder name is the player's own; it lives on their private profile
  // row and never reaches a board (that is board_handle — 0002).
  // playerAge is deliberately NOT in Prefs and must never be added: it is
  // local age-gating, and sending it would convert a device preference into
  // stored data about a child (docs/LEADERBOARD.md §9.4).
  const name = prefs.founderName.trim().slice(0, 24);
  if (name) {
    const { error } = await session.supabase
      .from("profiles")
      .update({ display_name: name })
      .eq("id", session.userId);
    if (error) out.push(`profiles: ${error.message}`);
  }

  const { error } = await session.supabase.from("preferences").upsert(
    {
      profile_id: session.userId,
      rookie_mode: !!prefs.rookieMode,
      onboarded: !!prefs.onboarded,
      // The column is checked `between 0 and 1`. An out-of-range or NaN
      // calibration would fail the whole upsert, which would take rookie_mode
      // and onboarded down with it — a mic reading must never cost a player
      // their onboarding flag. Out-of-range reads as "never calibrated".
      mic_calibration: micOrNull(prefs.micCalibration),
    },
    { onConflict: "profile_id" },
  );
  if (error) out.push(`preferences: ${error.message}`);
  return out;
}

async function writeLegacy(session: Session, legacy: LegacyState): Promise<string[]> {
  const { error } = await session.supabase.from("legacy").upsert(
    {
      profile_id: session.userId,
      best_year: clamp(legacy.bestYear, 0, 60),
      runs_completed: Math.max(0, Math.trunc(legacy.runsCompleted)),
      shark_respect: clamp(legacy.sharkRespect, 0, 100),
      badges: legacy.badges ?? [],
      // The table caps this at 50; GameProvider already caps at 10. Trim here
      // too so a corrupt local blob cannot fail the whole sync.
      autopsies: (legacy.autopsies ?? []).slice(0, 50),
    },
    { onConflict: "profile_id" },
  );
  return error ? [`legacy: ${error.message}`] : [];
}

async function writeRun(session: Session, run: RunState | null): Promise<string[]> {
  if (run === null) {
    const { error } = await session.supabase
      .from("saves")
      .delete()
      .eq("profile_id", session.userId)
      .eq("slot", 0);
    return error ? [`saves: ${error.message}`] : [];
  }

  const { error } = await session.supabase.from("saves").upsert(
    {
      profile_id: session.userId,
      slot: 0,
      run_id: run.id,
      seed: run.seed,
      state: run,
      // Derived here, not trusted from the client.
      company_name: run.companyName,
      industry: run.industry,
      year: clamp(run.year, 1, 60),
      month: clamp(run.month, 1, 12),
      stage: clamp(run.stage, 1, 5),
      alive: run.alive,
      // The ended_by_iff_dead constraint means these two must agree, and a
      // live run with a stale cause of death would be rejected outright.
      ended_by: run.alive ? null : (run.endedBy ?? "chapter7"),
    },
    { onConflict: "profile_id,slot" },
  );
  return error ? [`saves: ${error.message}`] : [];
}

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.trunc(Number.isFinite(n) ? n : lo)));

/** 0..1 or nothing. Anything else is a broken reading, not a quieter room. */
const micOrNull = (n: number | null): number | null =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
