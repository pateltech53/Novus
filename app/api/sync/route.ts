import { NextResponse, type NextRequest } from "next/server";

import { wireEntitlements, type EntitlementRow, type ProfileRoleRow } from "@/lib/admin/entitlements";
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

  const [saveList, legacyRow, prefRow, profileRow, entRow] = await Promise.all([
    /*
     * Every island the account holds, low slot first.
     *
     * `.eq("slot", 0).maybeSingle()` was correct while the client only ever
     * wrote slot 0; 0001 built the table for ten and said so. `.order` rather
     * than relying on Postgres row order because the picker draws them in this
     * sequence and "which island is first" must not depend on which one was
     * last written.
     */
    session.supabase
      .from("saves")
      .select("slot, state, updated_at")
      .eq("profile_id", session.userId)
      .order("slot", { ascending: true }),
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
    // role/admin_view feed the entitlement overlay below — a comped gift
    // folds into `pro`, and an admin's account is derived at read time
    // (lib/admin/entitlements.ts), never written into the entitlements table.
    session.supabase
      .from("profiles")
      .select("display_name, role, admin_view")
      .eq("id", session.userId)
      .maybeSingle(),
    // Read-only to the player by RLS (0001), written only by the Stripe
    // webhook on the service role. There is deliberately no write path for
    // entitlements in the PUT below — a client that could push `pro: true`
    // would make Pro free, and this route runs as the player.
    session.supabase
      .from("entitlements")
      .select(
        "pro, extra_islands, industry_packs, cosmetic_bundles, chapter, intent, comp_pro, comp_until",
      )
      .eq("profile_id", session.userId)
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

  /*
   * An unreadable saves query is an EMPTY archipelago, not a broken one.
   *
   * The client treats "local always wins" per island, so a device that
   * receives no islands simply keeps its own — which is the safe direction. A
   * throw here would take legacy, prefs and entitlements down with it for a
   * player whose companies were fine.
   */
  const saveRows = (saveList.data ?? []) as { slot: number; state: unknown; updated_at: string }[];

  // Absent until the player buys something, because nothing else creates a
  // row here. That absence is meaningful to the client: it means "no purchase
  // on record", which is what lets a device-local pre-billing grant survive.
  // (Admins are the one exception — wireEntitlements derives theirs.)
  const entitlements = wireEntitlements(
    (entRow.data as EntitlementRow | null) ?? null,
    (profileRow.data as ProfileRoleRow | null) ?? null,
  );

  return attachSession(
    NextResponse.json({
      configured: true,
      signedIn: true,
      runs: saveRows.map((r) => ({ slot: r.slot, state: r.state as RunState })),
      legacy,
      prefs,
      entitlements,
      // The client compares these against its own last-write stamp to decide
      // whether the cloud copy is worth adopting.
      updatedAt: {
        // Per island, keyed by slot — one stamp for ten companies would say
        // nothing about any of them.
        runs: Object.fromEntries(saveRows.map((r) => [r.slot, r.updated_at])),
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

  let body: {
    /** Keyed by slot. `null` is a real instruction: delete that island. */
    runs?: Record<string, RunState | null>;
    legacy?: LegacyState;
    prefs?: Prefs;
  };
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
  /*
   * One entry per island. `null` is a real instruction — clearRun() on a
   * buried company — so the check is `!== undefined`, not truthiness.
   *
   * Sequential rather than Promise.all: ten upserts of up to a megabyte each,
   * fired at once, is a burst this route has no reason to send. The debounce
   * upstream means the common case is one or two entries anyway.
   */
  for (const [key, run] of Object.entries(body.runs ?? {})) {
    const slot = Number(key);
    // 0001 checks `slot between 0 and 9`. Refusing here rather than letting
    // the constraint do it keeps one bad key from failing a batch that also
    // carried nine good islands.
    if (!Number.isInteger(slot) || slot < 0 || slot > 9) {
      errors.push(`saves: slot ${key} is not 0-9`);
      continue;
    }
    if (run !== undefined) {
      errors.push(...(await writeRun(session, run, slot)));
    }
  }

  /*
   * A write that did not happen answers 500, not 200.
   *
   * This used to return `{ok: false, errors}` with a 200, on the reasoning
   * that the request itself was fine and the body said what went wrong. The
   * client read `res.ok`, saw true, and reported the save as landed. That is
   * the wrong end of a chain that finishes with lib/cloud/auth.ts wiping
   * localStorage on sign-out because the server "has a copy" — so a failed
   * upsert here could take the only remaining copy of a player's company with
   * it. The status code is the part of the answer callers actually check, so
   * it has to be the part that is true.
   *
   * `errors` still rides along, because "which table" is the difference
   * between a retry that works and a retry that loops.
   */
  return attachSession(
    errors.length
      ? NextResponse.json({ ok: false, errors }, { status: 500 })
      : NextResponse.json({ ok: true }),
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

async function writeRun(
  session: Session,
  run: RunState | null,
  slot: number,
): Promise<string[]> {
  if (run === null) {
    const { error } = await session.supabase
      .from("saves")
      .delete()
      .eq("profile_id", session.userId)
      .eq("slot", slot);
    return error ? [`saves[${slot}]: ${error.message}`] : [];
  }

  // playerAge is stripped again here, having already been stripped on the way
  // out (lib/cloud/sync.ts). Belt and braces on purpose: `state` is an opaque
  // blob written straight to jsonb, so anything the client puts in it is
  // stored verbatim — and this column is the one place a child's age could be
  // retained without any line of code appearing to ask for it. An older
  // client, a replayed request, or a hand-made call must not be able to put it
  // there. 0001's header: never transmitted, never stored.
  const { playerAge: _neverStored, ...storableRun } = run;

  const { error } = await session.supabase.from("saves").upsert(
    {
      profile_id: session.userId,
      slot,
      run_id: run.id,
      seed: run.seed,
      state: storableRun,
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
      /*
       * The listing cache the islands picker reads (0012). Derived here for
       * the same reason the six above are: the client sends `state` as an
       * opaque blob, and a card drawn from numbers the client chose is a card
       * that can lie. Truncated because the columns are bigint — the engine
       * deals in fractional dollars and Postgres will not.
       */
      valuation: money(run.stats?.valuation),
      peak_valuation: Math.max(money(run.peakValuation), money(run.stats?.valuation)),
      cash: money(run.stats?.cash),
      revenue_annual: money(run.stats?.revenueAnnual),
      employees: clamp(run.stats?.employees ?? 0, 0, 1_000_000),
      avatar: run.avatar ?? null,
    },
    { onConflict: "profile_id,slot" },
  );
  /*
   * The island cap raises 23514 from the BEFORE INSERT trigger in 0012. Say so
   * in words: this is the one error on this route a player can actually cause,
   * and "saves[3]: new row violates check constraint" tells them nothing.
   */
  if (error?.code === "23514" && /island allowance/i.test(error.message)) {
    return [`saves[${slot}]: island allowance exhausted`];
  }
  return error ? [`saves[${slot}]: ${error.message}`] : [];
}

/**
 * A dollar amount as the bigint columns want it.
 *
 * Signed on purpose — cash goes negative, and `redMonths` exists precisely to
 * count how long it stays there. Clamped well inside the 64-bit range so a
 * corrupted or hostile blob cannot fail the whole upsert on an overflow: the
 * cache is a nicety, the `state` column beside it is the company.
 */
const money = (n: unknown): number =>
  typeof n === "number" && Number.isFinite(n)
    ? Math.trunc(Math.min(1e15, Math.max(-1e15, n)))
    : 0;

const clamp = (n: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, Math.trunc(Number.isFinite(n) ? n : lo)));

/** 0..1 or nothing. Anything else is a broken reading, not a quieter room. */
const micOrNull = (n: number | null): number | null =>
  typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
