import type { RunState } from "./types";

/**
 * THE EQUITY TIMELINE — a real cap table has rounds; this run has a log.
 *
 * ── The gap this fills ──────────────────────────────────────────────────────
 *
 * `founderEquityPct` (types.ts) is the only equity state the engine keeps: one
 * number, starting at 100, that every `dilution_pct` effect multiplies down.
 * There is no cap table object anywhere — no per-round row, no option-pool or
 * investor bucket, nothing a `dilution_pct` effect could write INTO beyond that
 * single scalar. So a breakdown of "everyone else" cannot be reconstructed,
 * and this file does not pretend otherwise: `equityTimeline` never invents a
 * pool/investor split, only what actually happened and when.
 *
 * ── What "what actually happened" means here ────────────────────────────────
 *
 * `applyStat` (effects.ts) already returns a human line — `{label: "Dilution
 * 25%", tone: "down"}` — every time a `dilution_pct` effect fires, and that
 * line already rides in `state.log` as one of a `LogLine`'s `deltas`, because
 * that is how every other stat change gets narrated. Nothing new is recorded
 * for this file to work; it only reads what the log already keeps, the same
 * way `lib/engine/ledger.ts` reads the books without the sim knowing it
 * exists. Two shapes show up in practice, both handled below:
 *
 *   · An authored event's choice: `run.ts`'s `resolveChoice` pushes a
 *     "decision" line with no deltas (just the event title and the choice
 *     quoted), immediately followed by a "consequence" line that carries the
 *     deltas — the dilution label lands on the SECOND line, and its own text
 *     is either the outcome's specific narration or the generic "The Books
 *     move.", in which case the decision line right before it is the only
 *     real description available.
 *   · A Playbook activity: `activities.ts` pushes one "decision" line that
 *     carries both its own narration AND its deltas together — nothing to
 *     look backward for.
 *
 * Reading forward through the log and falling back to the previous line only
 * when the current one has no story of its own covers both without the two
 * callers needing to agree on a shared format they were never asked to share.
 */

export interface EquityEvent {
  id: string;
  year: number;
  month: number;
  /** Percentage points of founder equity given up. Always positive: dilution
   *  only ever runs one direction (Brand Law 2 — luck never flips a sign,
   *  and nothing in the effect vocabulary hands equity back). */
  amountPct: number;
  /** What the player's own log called it — an event title, an activity's
   *  narration, or an outcome's line. Never authored here. */
  description: string;
}

const DILUTION_LABEL = /^Dilution ([\d.]+)%$/;

/**
 * `resolveChoice` (run.ts) quotes the choice verbatim onto the event title —
 * `The Pool Shuffle — "Take the smaller fund's clean sheet"` — which is the
 * right amount of detail for the life log's full-width prose but too much
 * for a one-line row here (a `Row` truncates at a single line by design; the
 * full story is one tap away in the log itself). Cutting at the first dash
 * keeps the part that answers "which event did this," which is the part
 * this list exists to answer.
 */
function headline(text: string): string {
  const dash = text.indexOf(" — ");
  return dash === -1 ? text : text.slice(0, dash);
}

export function equityTimeline(state: RunState): EquityEvent[] {
  const log = state.log ?? [];
  const events: EquityEvent[] = [];

  for (let i = 0; i < log.length; i++) {
    const line = log[i];
    const delta = line.deltas?.find((d) => DILUTION_LABEL.test(d.label));
    if (!delta) continue;
    const match = delta.label.match(DILUTION_LABEL);
    const amountPct = match ? Number(match[1]) : 0;

    const hasOwnStory = Boolean(line.text) && line.text !== "The Books move.";
    const prev = log[i - 1];
    const description = headline(
      hasOwnStory || !prev || prev.kind !== "decision" ? line.text : prev.text,
    );

    events.push({ id: line.id, year: line.year, month: line.month, amountPct, description });
  }

  return events;
}
