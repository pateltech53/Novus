import eventsData from "@/data/events.json";
import { activityById, isAvailable } from "@/lib/engine/activities";
import { applyOutcome } from "@/lib/engine/effects";
import { assetById, buyAsset, sellAsset } from "@/lib/engine/holdings";
import { specFor, specForRun } from "@/lib/engine/industries/index";
import { freezeEvent } from "@/lib/engine/interpolate";
import { makeLine } from "@/lib/engine/log";
import { minuteOf, priceAt, tickerBySymbol } from "@/lib/engine/market";
import { candidatePool, fire as fireEmployee, hire as hireCandidate } from "@/lib/engine/people";
import {
  ensurePortfolio,
  launchItem,
  liveItems,
  portfolioDrag,
  refreshItem,
  retireItem,
  tickPortfolioYear,
  type LaunchInput,
  type LineItem,
  type PortfolioYearResult,
} from "@/lib/engine/portfolio";
import { positioningYearTick, syncPositioning } from "@/lib/engine/positioning";
import { hashString, runRng } from "@/lib/engine/rng";
import {
  advanceMonth,
  applyAllocation,
  closeYear,
  createRun,
  resolveAuto,
  resolveChoice,
  resolvePerformOnly,
  visibleChoices,
  type YearEndSummary,
} from "@/lib/engine/run";
import { deriveValuation, refreshBooks } from "@/lib/engine/sim";
import { KNOBS, S_UNIT, TANK_REQUIRED_THROUGH_YEAR } from "@/lib/engine/constants";
import type { GameEvent, PerformResult, RunState } from "@/lib/engine/types";
import { scorePitchContent } from "@/lib/ai/pitch-content";
import { callerById, consumeCall, resolveCallLocally } from "@/lib/ai/callers";

import type { RunTape, TapeEntry } from "./tape";

/**
 * The replay — one description of what a tap does, used by both sides.
 *
 * ── Why this file is not "the verifier's copy of the game" ──────────────────
 *
 * docs/LEADERBOARD.md §1.1 chose Supabase over Firebase on one argument: the
 * verifier and the game must run the SAME engine, because the moment they
 * disagree every honest player gets rejected. That argument is only true if
 * the *orchestration* is shared too. `advanceMonth()` is one call out of five
 * that a single tap on ADVANCE MONTH actually makes — the others freeze the
 * card, resolve the narration-only beats and settle positioning — and a
 * verifier that made four of them would reject real runs for a living.
 *
 * So `lib/state/GameProvider.tsx` calls the functions below, and so does
 * `lib/leaderboard/verify.ts`. Neither owns a second copy. `lib/engine/*`
 * gains nothing: the engine stays pure and simulatable, which is the point
 * of it (docs/DO-NOT-TOUCH.md).
 *
 * ── The clock ───────────────────────────────────────────────────────────────
 *
 * `advanceMonth()` reads the wall clock twice: Today's Market is seeded by the
 * UTC date, and the coasting rule compares it against `lastPlayedISO`. Both
 * change the run. `scripts/simulate.mjs` hit this the hard way — an untouched
 * tree returned 53% survival one day and 50% the next — and pinned it by
 * freezing the global `Date` before importing the engine. A replay has the same
 * problem one tap at a time, so `withFrozenClock` does the same thing for the
 * duration of one synchronous step. See the note on that function; the
 * synchronous part is load-bearing, not incidental.
 */

const EVENTS = eventsData as unknown as GameEvent[];

// ── The clock ───────────────────────────────────────────────────────────────

const RealDate = Date;

/**
 * Runs `fn` with `new Date()` and `Date.now()` pinned to noon UTC on `iso`.
 *
 * **`fn` must be synchronous.** Node runs one piece of JavaScript at a time, so
 * a synchronous block cannot interleave with another request and the global
 * swap below is invisible to everything else. The instant an `await` appears
 * inside `fn`, that stops being true and this becomes a race that hands another
 * player's request a frozen clock. The `instanceof Promise` check turns that
 * from a heisenbug into an exception on the first call.
 *
 * Only the no-argument forms are pinned. `new Date(x)` and date arithmetic keep
 * working normally, so nothing that parses or formats a supplied date changes
 * behaviour — the same contract `scripts/simulate.mjs` documents.
 */
export function withFrozenClock<T>(iso: string, fn: () => T): T {
  const frozenMs = RealDate.parse(`${iso}T12:00:00.000Z`);
  if (Number.isNaN(frozenMs)) throw new Error(`replay: "${iso}" is not a YYYY-MM-DD date`);

  class FrozenDate extends RealDate {
    // `unknown[]`, not `ConstructorParameters<typeof Date>`: that type resolves
    // to the one-argument overload, so TypeScript decides `args.length === 0`
    // can never be true and the no-argument form — the only one being pinned —
    // stops compiling.
    constructor(...args: unknown[]) {
      if (args.length === 0) super(frozenMs);
      else super(...(args as [string]));
    }
    static now() {
      return frozenMs;
    }
  }

  const previous = globalThis.Date;
  globalThis.Date = FrozenDate as DateConstructor;
  try {
    const out = fn();
    if (out instanceof Promise) {
      throw new Error("replay: withFrozenClock was handed an async function");
    }
    return out;
  } finally {
    globalThis.Date = previous;
  }
}

// ── A run, from a seed ──────────────────────────────────────────────────────

/**
 * Rebuilds the run a tape describes, without inventing a `createRun` parameter.
 *
 * `createRun()` derives its seed from `Date.now()`, so a replay cannot ask for
 * one. It is also protected (docs/DO-NOT-TOUCH.md), and the house rule is to
 * prefer a change contained at the call site over a new argument on a protected
 * signature — which is the move `scripts/simulate.mjs` already makes one line
 * after its own `createRun`.
 *
 * `id` is overwritten alongside `seed` because `createRun` derives it as
 * `run-<seed base36>` and `candidatePool()` seeds off `state.id`. Setting one
 * without the other would hand the replay a different hiring pool than the
 * player saw, which is the subtlest possible way to reject honest runs.
 */
export function runFromTape(tape: RunTape): RunState {
  const state = createRun({
    // Never the player's. §9.2 — the tape does not carry one, and the replay
    // has no use for one: the founder's name reaches no mechanic.
    founderName: "",
    playerAge: null,
    companyName: tape.companyName,
    industry: tape.industry,
    // Rookie Mode adds a plain-English gloss beside the real term and changes
    // no mechanic (Brand Law 6), so the replay does not need to know.
    rookieMode: false,
    // The tutorial does: the guided first year cannot be failed, which puts a
    // floor under year 1's camera score. See RunTape.tutorial.
    tutorial: tape.tutorial === true,
  });
  state.seed = tape.seed;
  state.id = `run-${(tape.seed >>> 0).toString(36)}`;
  // The opening lines were written against the seed createRun invented. They
  // reach no mechanic — the log is prose — but a replay that carries two
  // company's worth of narration is one that is harder to read when it fails.
  state.log = [];
  refreshBooks(state);
  return state;
}

// ── The shared orchestration ────────────────────────────────────────────────

export interface AdvanceTurn {
  /** Frozen decision cards, in the order the engine surfaced them. */
  cards: GameEvent[];
  gate: boolean;
  died: boolean;
  marketEventId: string | null;
}

/**
 * One tap on ADVANCE MONTH, whole.
 *
 * Narration-only beats resolve inline; the rest become cards, FROZEN.
 * `freezeEvent` resolves interpolation tokens ({topItem}, {company}, {rival})
 * against run state at DRAW time and bakes the strings in, per Addendum B §3.3:
 * a mid-card retirement must not change the text of a card already on the
 * table.
 */
export function advanceTurn(state: RunState, events: GameEvent[] = EVENTS): AdvanceTurn {
  const result = advanceMonth(state, events);
  if (result.gate) return { cards: [], gate: true, died: false, marketEventId: null };

  const cards: GameEvent[] = [];
  for (const ev of result.surfaced) {
    if (ev.auto) resolveAuto(state, ev);
    else cards.push(freezeEvent(ev, state));
  }
  syncPositioning(state);
  return {
    cards,
    gate: false,
    died: result.died || !state.alive,
    marketEventId: result.marketEventId ?? null,
  };
}

export interface YearClose {
  summary: YearEndSummary;
  portfolioYear: PortfolioYearResult | null;
}

/**
 * The fiscal year closing, whole — every step, in the order they must happen.
 *
 * Extracted from `GameProvider.submitPerform` so the verifier runs the same
 * sequence rather than an approximation of it. The order matters and is not
 * arbitrary:
 *
 *   1. The portfolio closes its own books FIRST, so the year-end report has
 *      real history and this year's verdicts are assigned before anything
 *      reads them.
 *   2. Its result reaches the company's books through the effect vocabulary,
 *      not by writing `stats.revenueAnnual` — that number is computed inside
 *      the protected `sim.ts`, and the portfolio reaches it the sanctioned way.
 *   3. Positioning settles: clarity drifts, the flags refresh.
 *   4. `closeYear()` applies the deal and ages the company up. It is the only
 *      path to the next fiscal year (Brand Law 1).
 */
export function closeFiscalYear(
  state: RunState,
  perform: PerformResult,
  dealCashS = 0,
  dealEquityPct = 0,
): YearClose {
  const pYear = tickPortfolioYear(state, specFor);

  if (pYear.rows.length > 0) {
    const hits = pYear.newVerdicts.filter((v) => v.verdict === "hit").length;
    const flops = pYear.newVerdicts.filter((v) => v.verdict === "flop").length;
    const drag = portfolioDrag(state);
    const revPct = hits * 6 - flops * 5;
    const effects = [];
    if (revPct !== 0) effects.push({ stat: "rev_pct" as const, amount: revPct, durationQ: 4 });
    if (drag.qualPenalty > 0) {
      effects.push({ stat: "qual" as const, amount: -Math.round(drag.qualPenalty) });
    }
    if (effects.length > 0) {
      applyOutcome(
        state,
        { effects },
        "portfolio-year",
        runRng(state.seed, state.year, 12, hashString("portfolio")),
      );
    }
    if (drag.over > 0) {
      state.log.push(
        makeLine(
          state,
          "decision",
          `You are carrying ${drag.over} more ${drag.over === 1 ? "thing" : "things"} than the team can support well.`,
        ),
      );
    }
  }

  positioningYearTick(state);
  const summary = closeYear(state, perform, dealCashS, dealEquityPct);
  return { summary, portfolioYear: pYear.rows.length > 0 ? pYear : null };
}

/**
 * The year-end deal, derived rather than negotiated.
 *
 * `components/SharkPanel.tsx` asks a model for the offer and falls back to a
 * local ladder. The model's answer cannot be replayed — it is a different
 * sentence every time — so a board that trusted it would rank a player with a
 * deployed AI key above a player without one, on money the model chose to be
 * generous with. That is Brand Law 4 broken by an environment variable.
 *
 * The board therefore replays the DETERMINISTIC deal, which is the same ladder
 * `scripts/simulate.mjs` balances the whole game against: the ask buys a year
 * of runway rather than matching a valuation, a weak pitch gets a fraction of
 * it, and every deal costs ownership.
 *
 * The consequence is worth stating plainly, because it is a design choice and
 * not an accident: the board's valuation is the valuation this run would have
 * reached under the rules everybody plays by. It is not a replay of one
 * player's luckiest conversation.
 */
export function dealFor(state: RunState, score: number): { cashS: number; equityPct: number } {
  const S = S_UNIT[state.stage];
  const askS =
    Math.max(state.stats.valuation * 0.2, Math.max(0, state.stats.burnMonthly) * 12, 4 * S) / S;
  const cashS = score >= 8 ? askS : score >= 5 ? askS * 0.7 : askS * 0.35;
  return { cashS, equityPct: score >= 8 ? 12 : 18 };
}

/**
 * A market order at an explicit minute.
 *
 * The minute is a parameter rather than `minuteOf()` so the replay can fill an
 * order at the minute the player actually placed it. `priceAt()` is a pure
 * function of ticker and minute, so passing the recorded one recomputes the
 * exact fill — and means the tape never has to carry a price a client chose.
 */
export function buyStockAt(
  state: RunState,
  symbol: string,
  shares: number,
  minute: number = minuteOf(),
): boolean {
  const ticker = tickerBySymbol(symbol);
  if (!ticker || !(shares > 0)) return false;
  const price = priceAt(ticker, minute);
  const cost = price * shares;
  if (cost > state.brokerageCash) return false; // never spend money you don't have
  state.brokerageCash -= cost;
  const held = state.positions.find((p) => p.symbol === symbol);
  if (held) {
    const total = held.shares + shares;
    held.avgCost = (held.avgCost * held.shares + cost) / total;
    held.shares = total;
  } else {
    state.positions.push({ symbol, shares, avgCost: price });
  }
  return true;
}

export function sellStockAt(
  state: RunState,
  symbol: string,
  shares: number,
  minute: number = minuteOf(),
): boolean {
  const ticker = tickerBySymbol(symbol);
  const held = state.positions.find((p) => p.symbol === symbol);
  if (!ticker || !held || !(shares > 0)) return false;
  const sold = Math.min(shares, held.shares);
  state.brokerageCash += priceAt(ticker, minute) * sold;
  held.shares -= sold;
  if (held.shares <= 0.0001) {
    state.positions = state.positions.filter((p) => p.symbol !== symbol);
  }
  return true;
}

/** Money out of the company and into the brokerage. Clamped to what exists. */
export function transferToBrokerageAmount(state: RunState, amountUsd: number): number {
  const amount = Math.max(0, Math.min(amountUsd, state.stats.cash));
  if (amount <= 0) return 0;
  state.stats.cash -= amount;
  state.brokerageCash += amount;
  return amount;
}

/** A product launch, with the seasonal flag consumed the way the game does. */
export function launchLineItemFrom(state: RunState, input: LaunchInput): LineItem | null {
  const seasonal = !!state.flags.launch_seasonal;
  const item = launchItem(state, specForRun(state), {
    ...input,
    tags:
      seasonal && !input.tags.includes("seasonal")
        ? [...input.tags, "seasonal"].slice(0, 2)
        : input.tags,
  });
  if (!item) return null;
  delete state.flags.launch_sheet_open;
  delete state.flags.launch_seasonal;
  refreshBooks(state);
  return item;
}

// ── Replaying a tape ────────────────────────────────────────────────────────

export interface ReplayCursor {
  /** Cards the last advance put on the table and that nobody has answered. */
  table: GameEvent[];
  /** The date the last `advance` claimed. Cold calls are rationed against it. */
  clockISO: string;
  /** Highest valuation seen at any point. The number a board orders by. */
  peakValuation: number;
  /** Fiscal years closed, counted by the replay rather than by the client. */
  yearsClosed: number;
  /** Every entry the replay could not apply, with why. */
  skipped: { index: number; kind: string; reason: string }[];
}

export function newCursor(clockISO: string): ReplayCursor {
  return { table: [], clockISO, peakValuation: 0, yearsClosed: 0, skipped: [] };
}

const trackPeak = (state: RunState, cursor: ReplayCursor) => {
  const now = deriveValuation(state);
  if (now > cursor.peakValuation) cursor.peakValuation = now;
};

/**
 * Applies one tape entry, and tracks the peak on the way out.
 *
 * `peakValuation` exists nowhere in `RunState`: `stats.valuation` is the
 * CURRENT number, recomputed by `deriveValuation()` on every `refreshBooks()`,
 * so a company that peaked at $40M and died at $200K stores 200000. Sampling it
 * after every single entry — not once a year, not at death — is what makes the
 * peak a number no client ever touched (docs/LEADERBOARD.md §2).
 *
 * An entry the replay cannot apply is RECORDED AND SKIPPED, never fatal. A tape
 * whose 300th entry names a candidate index that no longer exists is a tape
 * that describes a run the engine would not have allowed, and the honest answer
 * is to keep replaying and let the numbers come out lower — not to reject the
 * whole submission on one desynchronised tap.
 */
export function applyTapeEntry(
  state: RunState,
  entry: TapeEntry,
  cursor: ReplayCursor,
  index: number,
  events: GameEvent[] = EVENTS,
): void {
  // Returns void so every call site can `return skip(...)` — the alternative
  // is `Array.push`'s length leaking out of a function that promises nothing.
  const skip = (reason: string): void => {
    cursor.skipped.push({ index, kind: entry.t, reason });
  };
  if (!state.alive && entry.t !== "pro") return skip("the company is already dead");

  switch (entry.t) {
    case "advance": {
      cursor.clockISO = entry.atISO;
      const turn = withFrozenClock(entry.atISO, () => advanceTurn(state, events));
      if (turn.gate) skip("the year gate refuses to advance");
      else cursor.table = turn.cards;
      break;
    }

    case "dismiss": {
      cursor.table = cursor.table.filter((e) => e.id !== entry.eventId);
      break;
    }

    case "choice": {
      const ev = cursor.table.find((e) => e.id === entry.eventId);
      if (!ev) return skip("no such card on the table");
      const choices = visibleChoices(state, ev);
      const choice = choices[entry.choice];
      if (!choice) return skip("choice index out of range");
      if (choice.perform) return skip("that choice needs the camera, not a tap");
      withFrozenClock(cursor.clockISO, () => resolveChoice(state, ev, entry.choice));
      syncPositioning(state);
      cursor.table = cursor.table.filter((e) => e.id !== entry.eventId);
      break;
    }

    case "perform": {
      /*
       * §7.3 — rescore, do not accept.
       *
       * `PerformResult.score` gates the fiscal year with a multiplier of
       * 0.4 + 0.12 × score, and it is computed on the client. The transcript is
       * the input; `scorePitchContent` is a pure function of it and the run's
       * own books, so the server calls it and uses ITS output.
       *
       * This works cleanly because of Brand Law 5: the scorer reads content —
       * coverage, whether there is a figure, whether "we're profitable"
       * survives a check against the books — and nothing about audio. A text
       * transcript is the complete input, which is also the right privacy
       * answer: there is no recording to upload (§9.1).
       */
      const content = scorePitchContent(entry.transcript ?? "", state);
      // The guided first year cannot be failed — the shark can be unimpressed
      // only. `PerformScreen` applies the same floor, so the replay has to, or
      // every new player's first year verifies below what they were shown.
      const score =
        state.tutorial && state.year === 1
          ? Math.max(KNOBS.tutorialScoreFloor, content.empty ? 0 : content.score)
          : content.empty
            ? 0
            : content.score;

      if (entry.kind === "yearEnd") {
        /*
         * A skipped Tank. Legal only once the pitch is optional (year 4 on) —
         * a tape that skips an early gate is refused, because the first three
         * years REQUIRE the room and a client that says otherwise is edited.
         * Neutral close: 1.0×, no deal, no score for the flag to smuggle.
         */
        if (entry.skipped) {
          if (state.year <= TANK_REQUIRED_THROUGH_YEAR) {
            return skip("the first three years cannot skip the Tank");
          }
          const result: PerformResult = {
            type: "pitch",
            score: 5,
            multiplier: 1,
            year: state.year,
          };
          withFrozenClock(cursor.clockISO, () => closeFiscalYear(state, result, 0, 0));
          cursor.yearsClosed += 1;
          cursor.table = [];
          break;
        }
        const deal = dealFor(state, score);
        const result: PerformResult = {
          type: "pitch",
          score,
          multiplier: 0.4 + 0.12 * score,
          year: state.year,
        };
        withFrozenClock(cursor.clockISO, () =>
          closeFiscalYear(state, result, deal.cashS, deal.equityPct),
        );
        cursor.yearsClosed += 1;
        cursor.table = [];
        break;
      }

      const ev = cursor.table.find((e) => e.id === entry.eventId);
      if (!ev) return skip("no such card on the table");
      if (entry.kind === "eventOnly") {
        if (!ev.performOnly) return skip("that event has no camera moment");
        withFrozenClock(cursor.clockISO, () => resolvePerformOnly(state, ev, score));
      } else {
        if (entry.choiceIndex === undefined) return skip("a camera choice with no choice");
        const choice = visibleChoices(state, ev)[entry.choiceIndex];
        if (!choice?.perform) return skip("that choice does not open the camera");
        withFrozenClock(cursor.clockISO, () =>
          resolveChoice(state, ev, entry.choiceIndex as number, score),
        );
        syncPositioning(state);
      }
      cursor.table = cursor.table.filter((e) => e.id !== ev.id);
      break;
    }

    case "allocation": {
      // Once a year, and the run itself is what remembers it — otherwise "quit
      // and come back" would be a way to spend next year's money twice.
      const flag = `alloc-y${state.year}`;
      if (state.flags[flag]) return skip("this year's money is already allocated");
      withFrozenClock(cursor.clockISO, () => applyAllocation(state, entry.pick));
      state.flags[flag] = true;
      break;
    }

    case "hire": {
      // Six, not five: GameProvider draws `candidatePool(draft, 6)` and the
      // pool's length changes every candidate after the first.
      const pool = candidatePool(state, 6);
      const cand = pool[entry.index];
      if (!cand) return skip("no such candidate in this month's pool");
      // Pro gates content, never outcomes. Every candidate rolls on the same
      // 48–96 curve; Pro buys a wider slice of the same market.
      if (cand.pro && !state.pro) return skip("that candidate was not visible to this player");
      hireCandidate(state, cand);
      refreshBooks(state);
      break;
    }

    case "fire": {
      const employee = state.roster[entry.index];
      if (!employee) return skip("no such employee");
      fireEmployee(state, employee.id);
      refreshBooks(state);
      break;
    }

    case "buy-asset": {
      const def = assetById(entry.defId);
      if (!def) return skip("no such asset");
      if (def.pro && !state.pro) return skip("that asset was not visible to this player");
      if (!buyAsset(state, def)) return skip("could not afford it");
      refreshBooks(state);
      break;
    }

    case "sell-asset": {
      const held = state.holdings[entry.index];
      if (!held) return skip("no such holding");
      sellAsset(state, held.id);
      refreshBooks(state);
      break;
    }

    case "product": {
      const item = launchLineItemFrom(state, {
        name: entry.name,
        price: entry.priceCents / 100,
        investTier: entry.investTier,
        tags: entry.tags,
      });
      if (!item) return skip("the launch was refused");
      break;
    }

    case "retire": {
      const item = liveItems(ensurePortfolio(state))[entry.index];
      if (!item) return skip("no such live item");
      retireItem(state, item.id);
      refreshBooks(state);
      break;
    }

    case "refresh": {
      const item = liveItems(ensurePortfolio(state))[entry.index];
      if (!item) return skip("no such live item");
      if (!refreshItem(state, item.id, entry.costS)) return skip("the rework was refused");
      delete state.flags.refresh_sheet_open;
      refreshBooks(state);
      break;
    }

    case "trade": {
      const ok =
        entry.side === "buy"
          ? buyStockAt(state, entry.symbol, entry.qty, entry.minute)
          : sellStockAt(state, entry.symbol, entry.qty, entry.minute);
      if (!ok) return skip("the order could not be filled");
      refreshBooks(state);
      break;
    }

    case "transfer": {
      if (transferToBrokerageAmount(state, entry.amountUsd) <= 0) {
        return skip("nothing to transfer");
      }
      refreshBooks(state);
      break;
    }

    case "coldcall": {
      const caller = callerById(entry.investorId);
      if (!caller) return skip("no such investor");
      if ((state.coldCallsClosed ?? []).includes(entry.investorId)) {
        return skip("that investor already wrote a cheque");
      }
      /*
       * Re-resolved locally, for the same reason the year-end deal is.
       *
       * `judgePitch()` asks a model and falls back to `resolveCallLocally()`.
       * The model's answer is unreproducible, so a board that accepted it would
       * rank a run by whether an API key was deployed on the day it was played.
       * The local resolver is seeded on
       * `coldcall:<seed>:<caller>:<year>:<month>` and reads the transcript
       * through the same `scorePitchContent` the camera uses — deterministic,
       * and identical for every player.
       */
      withFrozenClock(entry.atISO, () => {
        consumeCall(state);
        const outcome = resolveCallLocally(
          { callerId: caller.id, transcript: entry.transcript, spoken: false, seconds: 0 },
          caller,
          state,
        );
        if (!outcome.accepted) return;
        state.coldCallsClosed = [...(state.coldCallsClosed ?? []), caller.id];
        applyOutcome(
          state,
          {
            effects: [
              { stat: "cash_S", amount: outcome.cashS },
              { stat: "dilution_pct", amount: outcome.dilutionPct },
              { stat: "respect", amount: outcome.respect },
              { stat: "invsent", amount: outcome.invsent },
            ],
          },
          `coldcall:${caller.id}`,
          runRng(state.seed, state.year, state.month, hashString(caller.id)),
        );
        refreshBooks(state);
      });
      break;
    }

    case "activity": {
      const activity = activityById(entry.id, state);
      if (!activity) return skip("no such activity");
      if (!isAvailable(activity, state)) return skip("that activity was not available");
      withFrozenClock(cursor.clockISO, () => activity.apply(state));
      refreshBooks(state);
      break;
    }

    case "pro": {
      state.pro = entry.on;
      break;
    }
  }

  trackPeak(state, cursor);
}

export interface ReplayResult {
  state: RunState;
  peakValuation: number;
  yearsSurvived: number;
  endedBy: RunState["endedBy"];
  alive: boolean;
  skipped: ReplayCursor["skipped"];
}

/**
 * Replays a whole tape and reports what the SERVER computed.
 *
 * Nothing in here reads a number the client sent. The two board keys —
 * `peakValuation` and `yearsSurvived` — come out of the engine, which is what
 * makes them unpurchasable: there is no code path where money reaches a rank,
 * because there is no code path where a client does (§8.1).
 */
export function replayTape(tape: RunTape, events: GameEvent[] = EVENTS): ReplayResult {
  const state = runFromTape(tape);
  const firstAdvance = tape.entries.find((e) => e.t === "advance");
  const cursor = newCursor(
    firstAdvance && firstAdvance.t === "advance"
      ? firstAdvance.atISO
      : new Date().toISOString().slice(0, 10),
  );
  // A brand-new company is worth something the moment it exists; sample before
  // the first tap so a run that died in month two still reports a real peak.
  cursor.peakValuation = deriveValuation(state);

  tape.entries.forEach((entry, i) => applyTapeEntry(state, entry, cursor, i, events));

  return {
    state,
    peakValuation: cursor.peakValuation,
    // `state.year` is 1-based and increments on close, so a run that closed
    // three years stands at year 4. Years SURVIVED is the count of closes, and
    // a company that never reached a gate survived its first year.
    yearsSurvived: Math.max(1, cursor.yearsClosed),
    endedBy: state.endedBy,
    alive: state.alive,
    skipped: cursor.skipped,
  };
}
