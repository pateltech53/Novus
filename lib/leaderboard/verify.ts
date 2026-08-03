import "server-only";

import { checkBounds, type BoundsResult, type ClaimedNumbers } from "./bounds";
import { replayTape } from "./replay";
import { canonicalJson, type RunTape } from "./tape";
import { sha256 } from "./season";

/**
 * The verifier. Bounds, then replay, then a verdict.
 *
 * ── What can be trusted: nothing from the client ────────────────────────────
 *
 * Every number a submission carries is a CLAIM. It is stored in the `claimed_*`
 * columns purely so the difference between the claim and the truth can be
 * measured — no board query reads them (docs/LEADERBOARD.md §7.1).
 *
 * ── What can be recomputed: everything that matters ─────────────────────────
 *
 * The engine is deterministic and position-seeded, so the run is a pure
 * function of the seed and the taps. `replayTape` produces the two numbers a
 * board orders by, and both are the server's own.
 *
 * ── The line ────────────────────────────────────────────────────────────────
 *
 * Reject impossible states, not skilled ones. A player who scripts an optimal
 * run against the real engine is playing the game well, and the tape they
 * submit is genuine. Deterministic replay draws exactly the right line: it
 * catches states the engine could not have produced, and nothing else (§7.7).
 */

export type VerifyStatus = "verified" | "flagged" | "rejected";

export interface VerifiedRun {
  status: VerifyStatus;
  /** Set on `rejected`. One machine-readable reason, for the logs. */
  rejectReason: string | null;
  /** Everything worth knowing about why, whatever the verdict. */
  notes: string[];

  /** The canonical bytes and their hash — the duplicate key. */
  tapeHash: string;

  /** What the SERVER computed. Null when the run was rejected before replay. */
  peakValuation: number | null;
  yearsSurvived: number | null;
  endedBy: "chapter7" | "acquired" | "ipo" | null;

  /** How far the claim was from the truth, for the honesty telemetry. */
  drift: { valuationRatio: number | null; yearsDelta: number | null };
}

/**
 * How far a claim may miss the replay before it stops being floating point.
 *
 * Generous on purpose. The claim is not load-bearing — the board publishes the
 * replay's number regardless — so this threshold only decides whether a run is
 * FLAGGED for a human, never what it scores. A player whose save was edited
 * still gets the run their taps actually produced.
 */
const VALUATION_DRIFT_TOLERANCE = 0.02;

export function verifyTape(
  tape: RunTape,
  claimed: ClaimedNumbers,
  todayISO: string,
): VerifiedRun {
  const canonical = canonicalJson(tape);
  const tapeHash = sha256(canonical);

  const bounds: BoundsResult = checkBounds(tape, claimed, todayISO);
  if (bounds.verdict === "reject") {
    return {
      status: "rejected",
      rejectReason: bounds.reasons[0] ?? "bounds",
      notes: bounds.reasons,
      tapeHash,
      peakValuation: null,
      yearsSurvived: null,
      endedBy: null,
      drift: { valuationRatio: null, yearsDelta: null },
    };
  }

  const notes = [...bounds.reasons];

  let replay: ReturnType<typeof replayTape>;
  try {
    replay = replayTape(tape);
  } catch (err) {
    /*
     * A replay that throws is a bug in this app before it is a cheat by a
     * player, and the honest response is to say so rather than to accuse
     * somebody. It is rejected — an unverified run cannot be published — but
     * with a reason that reads as "we could not check this", and the message
     * goes to the logs so the next deploy can fix it.
     */
    return {
      status: "rejected",
      rejectReason: "replay-threw",
      notes: [...notes, err instanceof Error ? err.message : String(err)],
      tapeHash,
      peakValuation: null,
      yearsSurvived: null,
      endedBy: null,
      drift: { valuationRatio: null, yearsDelta: null },
    };
  }

  /*
   * Entries the replay could not apply.
   *
   * A handful is ordinary: a save restored mid-month, a double tap the UI
   * absorbed, a card dismissed by a reload. A tape that is mostly unapplicable
   * is describing a run the engine would not have allowed, and that is worth a
   * human — the run is not rejected, because the numbers it produced are still
   * the numbers its applicable taps produced.
   */
  const skipRatio = tape.entries.length > 0 ? replay.skipped.length / tape.entries.length : 0;
  if (skipRatio > 0.1) {
    notes.push(`desync:${replay.skipped.length}/${tape.entries.length}`);
    for (const s of replay.skipped.slice(0, 5)) notes.push(`skip:${s.kind}:${s.reason}`);
  }

  const valuationRatio =
    claimed.peakValuation > 0 && replay.peakValuation > 0
      ? claimed.peakValuation / replay.peakValuation
      : null;
  const yearsDelta = claimed.yearsSurvived - replay.yearsSurvived;

  if (valuationRatio !== null && Math.abs(valuationRatio - 1) > VALUATION_DRIFT_TOLERANCE) {
    notes.push(`claim-drift:valuation:${valuationRatio.toFixed(3)}`);
  }
  if (yearsDelta !== 0) notes.push(`claim-drift:years:${yearsDelta}`);

  /*
   * The server's own numbers are re-checked against the same ceilings.
   *
   * The bounds pass above read the CLAIM. This one reads the replay, which is
   * the number that will actually be published — and an engine bug that mints a
   * trillion dollars is exactly the case where the claim looks reasonable and
   * the truth does not.
   */
  const computed = checkBounds(
    tape,
    { peakValuation: replay.peakValuation, yearsSurvived: replay.yearsSurvived },
    todayISO,
  );
  if (computed.verdict === "reject") {
    return {
      status: "rejected",
      rejectReason: `computed:${computed.reasons[0] ?? "bounds"}`,
      notes: [...notes, ...computed.reasons],
      tapeHash,
      peakValuation: replay.peakValuation,
      yearsSurvived: replay.yearsSurvived,
      endedBy: replay.endedBy ?? null,
      drift: { valuationRatio, yearsDelta },
    };
  }
  notes.push(...computed.reasons);

  const flagged =
    bounds.verdict === "flag" || computed.verdict === "flag" || skipRatio > 0.1;

  return {
    status: flagged ? "flagged" : "verified",
    rejectReason: null,
    notes,
    tapeHash,
    peakValuation: replay.peakValuation,
    yearsSurvived: replay.yearsSurvived,
    endedBy: replay.endedBy ?? null,
    drift: { valuationRatio, yearsDelta },
  };
}

/**
 * Is this shape a tape at all?
 *
 * Runs before anything else touches the body, because everything downstream —
 * the bounds, the replay, the hash — assumes the fields exist. A route that
 * hands `undefined` to the replay gets a 500 where it wanted a 400.
 */
export function parseTape(body: unknown): RunTape | null {
  if (!body || typeof body !== "object") return null;
  const raw = body as Record<string, unknown>;
  if (typeof raw.seed !== "number" || !Number.isFinite(raw.seed)) return null;
  if (raw.founderName !== "") return null;
  if (typeof raw.companyName !== "string") return null;
  if (typeof raw.industry !== "string") return null;
  if (!Array.isArray(raw.entries)) return null;
  for (const entry of raw.entries) {
    if (!entry || typeof entry !== "object") return null;
    if (typeof (entry as { t?: unknown }).t !== "string") return null;
  }
  return {
    seed: raw.seed,
    founderName: "",
    companyName: raw.companyName,
    industry: raw.industry as RunTape["industry"],
    tutorial: raw.tutorial === true,
    entries: raw.entries as RunTape["entries"],
  };
}
