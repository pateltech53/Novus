"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import eventsData from "@/data/events.json";
import type {
  GameEvent,
  Industry,
  PerformResult,
  RunState,
} from "@/lib/engine/types";
import {
  advanceMonth,
  applyAllocation,
  closeYear,
  createRun,
  resolveAuto,
  resolveChoice,
  resolvePerformOnly,
  visibleChoices,
  type Allocation,
  type YearEndSummary,
} from "@/lib/engine/run";
import { buildAutopsy, type AutopsyReport } from "@/lib/engine/autopsy";
import { activityById, isAvailable } from "@/lib/engine/activities";
import { callerById, consumeCall, type CallOutcome } from "@/lib/ai/callers";
import { specFor, specForRun } from "@/lib/engine/industries/index";
import { freezeEvent } from "@/lib/engine/interpolate";
import { positioningYearTick, syncPositioning } from "@/lib/engine/positioning";
import {
  isPro,
  loadEntitlements,
  onEntitlementsChange,
  recordRunStart,
  runsRemainingToday,
} from "@/lib/monetization";
import {
  ensurePortfolio,
  launchItem,
  liveItems,
  portfolioCap,
  portfolioDrag,
  retireItem,
  refreshItem,
  tickPortfolioYear,
  type LaunchInput,
  type LineItem,
  type PortfolioYearResult,
} from "@/lib/engine/portfolio";
import { candidatePool, fire as fireEmployee, hire as hireCandidate } from "@/lib/engine/people";
import { assetById, buyAsset, sellAsset } from "@/lib/engine/holdings";
import { minuteOf, priceAt, tickerBySymbol } from "@/lib/engine/market";
import {
  DEFAULT_AVATAR,
  normalizeAvatar,
  unlockedTier,
  type AvatarConfig,
  type Gender,
  type Tier,
} from "@/lib/engine/avatar";
import { refreshBooks } from "@/lib/engine/sim";
import { applyOutcome } from "@/lib/engine/effects";
import { hashString, runRng } from "@/lib/engine/rng";
import { makeLine } from "@/lib/engine/log";
import { fmtMoney } from "@/lib/engine/format";
import {
  clearRun,
  loadLegacy,
  loadProfile,
  loadRun,
  loadTable,
  saveLegacy,
  saveProfile,
  saveRun,
  saveTable,
  type Profile,
} from "@/lib/engine/save";

const EVENTS = eventsData as unknown as GameEvent[];

/**
 * The run flag that records that next year's money has been allocated.
 *
 * Read by the year-end statement, written by chooseAllocation. Keyed by the
 * year the money is being spent IN — the one the run has already rolled over
 * to by the time the statement is on screen — which is also the year
 * `applyAllocation` seeds its RNG with.
 */
export const allocationFlag = (year: number) => `alloc-y${year}`;

/** Which visible stats moved, phrased the way the life log phrases them. */
function diffStats(
  before: RunState["stats"],
  after: RunState["stats"],
): { label: string; tone: "up" | "down" | "flat" }[] {
  const out: { label: string; tone: "up" | "down" | "flat" }[] = [];
  const money = (n: number) =>
    Math.abs(n) >= 1000 ? `$${(Math.abs(n) / 1000).toFixed(1)}K` : `$${Math.round(Math.abs(n))}`;
  const push = (label: string, delta: number, goodWhenUp = true) => {
    if (Math.abs(delta) < 0.5) return;
    const up = delta > 0;
    out.push({
      label: `${label} ${up ? "+" : "−"}${Math.abs(Math.round(delta))}`,
      tone: (up === goodWhenUp ? "up" : "down") as "up" | "down",
    });
  };
  if (Math.abs(after.cash - before.cash) >= 1) {
    out.push({
      label: `Cash ${after.cash > before.cash ? "+" : "−"}${money(after.cash - before.cash)}`,
      tone: after.cash > before.cash ? "up" : "down",
    });
  }
  push("Brand", after.brand - before.brand);
  push("Quality", after.qual - before.qual);
  push("Morale", after.morale - before.morale);
  push("CSAT", after.csat - before.csat);
  push("Energy", after.energy - before.energy);
  push("Gross margin", after.grossMarginPt - before.grossMarginPt);
  push("Churn", after.churnPt - before.churnPt, false);
  push("Team", after.employees - before.employees);
  return out;
}

/** The pending camera moment: which event/choice is waiting on a score. */
export interface PerformRequest {
  kind: "choice" | "eventOnly" | "yearEnd";
  performType: string;
  event?: GameEvent;
  choiceIndex?: number;
}

interface GameContextValue {
  run: RunState | null;
  profile: Profile | null;
  events: GameEvent[];
  /** Queue of decision cards surfaced by the last advance. */
  queue: GameEvent[];
  current: GameEvent | null;
  /** True when the front card is today's shared market case. */
  currentIsMarket: boolean;
  yearEnd: YearEndSummary | null;
  autopsy: AutopsyReport | null;
  perform: PerformRequest | null;
  atGate: boolean;
  busy: boolean;
  /** Set when a stage promotion opened a new wardrobe tier. */
  tierUnlock: Tier | null;
  dismissTierUnlock(): void;

  startRun(opts: {
    founderName: string;
    playerAge: number | null;
    companyName: string;
    industry: Industry;
    rookieMode: boolean;
    tutorial: boolean;
    /** Chosen once at founding. Everything else about the avatar is earned. */
    gender?: Gender;
  }): void;
  advance(): void;
  choose(index: number): void;
  dismissCard(): void;
  openYearGate(): void;
  submitPerform(score: number, dealCashS?: number, dealEquityPct?: number): void;
  chooseAllocation(pick: Allocation): void;
  closeYearEnd(): void;
  setRookieMode(on: boolean): void;
  markTermSeen(term: string): void;
  advanceTutorial(step: number): void;
  abandonRun(): void;
  saveProfileFields(fields: Partial<Profile>): void;
  choicesFor(ev: GameEvent): ReturnType<typeof visibleChoices>;
  /** Activity-bar actions. These spend resources and never advance time. */
  runActivity(id: string): void;

  // ── Team ────────────────────────────────────────────────────────────────
  hire(candidateId: string): void;
  fire(employeeId: string): void;
  // ── Assets ──────────────────────────────────────────────────────────────
  buyHolding(defId: string): void;
  sellHolding(holdingId: string): void;
  // ── RobinGhood ──────────────────────────────────────────────────────────
  buyStock(symbol: string, shares: number): void;
  sellStock(symbol: string, shares: number): void;
  transferToBrokerage(amountUsd: number): void;
  // ── Closet ──────────────────────────────────────────────────────────────
  setAvatar(next: AvatarConfig): void;
  /** Settings: rename yourself. Cosmetic — nothing downstream keys off it. */
  setFounderName(name: string): void;
  /** Settings: rename the company. Cosmetic. */
  setCompanyName(name: string): void;
  /** Settings: close this company for good and free the slot for a new run. */
  endRun(): void;
  // ── BeeMail ─────────────────────────────────────────────────────────────
  markMailRead(id: string): void;
  /**
   * Bank a cold-call result. Consumes one of the three daily calls whatever the
   * answer was — you used the person's time either way.
   */
  applyColdCall(callerId: string, outcome: CallOutcome): void;
  /** Consume a one-shot UI flag set by an activity (e.g. open_the_room). */
  clearFlag(flag: string): void;

  // ── The portfolio ─────────────────────────────────────────────────────────
  /** Name it, price it, confirm. Returns the item, or null if it could not launch. */
  launchLineItem(input: LaunchInput): LineItem | null;
  retireLineItem(id: string): void;
  refreshLineItem(id: string, costS: number): void;
  /** Last year's closed portfolio numbers, for the year-end report. */
  portfolioYear: PortfolioYearResult | null;
  /** Simulated Pro. Content only — never outcomes. */
  setPro(on: boolean): void;
  /** Deltas from the most recent resolution, for the impact animation. */
  lastDeltas: { label: string; tone: "up" | "down" | "flat" }[];
}

const GameContext = createContext<GameContextValue | null>(null);

export function GameProvider({ children }: { children: React.ReactNode }) {
  const [run, setRun] = useState<RunState | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [queue, setQueue] = useState<GameEvent[]>([]);
  const [marketId, setMarketId] = useState<string | null>(null);
  const [yearEnd, setYearEnd] = useState<YearEndSummary | null>(null);
  const [portfolioYear, setPortfolioYear] = useState<PortfolioYearResult | null>(null);
  const [autopsy, setAutopsy] = useState<AutopsyReport | null>(null);
  const [perform, setPerform] = useState<PerformRequest | null>(null);
  const [atGate, setAtGate] = useState(false);
  const [tierUnlock, setTierUnlock] = useState<Tier | null>(null);
  const [busy, setBusy] = useState(false);
  const [lastDeltas, setLastDeltas] = useState<
    { label: string; tone: "up" | "down" | "flat" }[]
  >([]);
  const [hydrated, setHydrated] = useState(false);
  const runRef = useRef<RunState | null>(null);
  /** Id of the card currently being resolved — guards against double-apply. */
  const resolvingRef = useRef<string | null>(null);

  // Mutations happen on a working copy; commit() re-renders and persists.
  /**
   * Every write to the run passes through here, which makes it the one honest
   * place to notice that the company just promoted a stage and the founder's
   * wardrobe opened with it. Detecting it at the call sites instead would mean
   * remembering to check in closeYear, in submitPerform, in the autopsy path —
   * and missing one silently drops a tier unlock on the floor.
   */
  const commit = useCallback((next: RunState) => {
    const prev = runRef.current;
    const earned = unlockedTier(next.stage);
    if (prev && earned > unlockedTier(prev.stage)) {
      setTierUnlock(earned);
      // The new fit goes on automatically. You earned it; you should not have
      // to go to a menu to put it on.
      next = { ...next, avatar: { ...next.avatar, tier: earned } };
    }
    runRef.current = next;
    setRun({ ...next });
    saveRun(next);
  }, []);

  useEffect(() => {
    const saved = loadRun();
    if (saved) {
      // Saves written against the old skin/suit/shirt/accessory avatar have no
      // gender or tier; normalize rather than letting a portrait lookup 404.
      saved.avatar = normalizeAvatar(saved.avatar);
      runRef.current = saved;
      setRun(saved);
      if (!saved.alive) setAutopsy(buildAutopsy(saved));
      if (saved.month >= 12) setAtGate(true);
      /*
       * The cards the last advance put on the table come back with the run.
       * Time was already banked when they were drawn, so without this the
       * player pays a month for a decision they never get to make — and the
       * followup or market case behind it is spent (lib/engine/save.ts).
       *
       * loadTable refuses anything written at a different run/year/month, so a
       * stale table cannot replay a decision the engine has already settled.
       */
      const table = loadTable(saved);
      if (table) {
        setQueue(table.cards);
        setMarketId(table.marketId);
        setYearEnd(table.yearEnd);
      }
    }
    setProfile(loadProfile());
    setHydrated(true);
  }, []);

  /**
   * …and every change to the table goes straight back to disk.
   *
   * One effect rather than a save call in advance/choose/dismiss/submit: those
   * are five places to remember, and forgetting one is exactly the bug this
   * fixes. The key below is what actually identifies a table — which run, when,
   * which cards, which statement — so a re-render that changes none of them
   * (every commit produces a fresh `run` object) does not write.
   */
  const tableKey = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const open = !!run && (queue.length > 0 || !!yearEnd);
    const key = open
      ? `${run.id}:${run.year}:${run.month}:${marketId ?? ""}:${yearEnd?.year ?? ""}:${queue
          .map((e) => e.id)
          .join(",")}`
      : null;
    if (key === tableKey.current) return;
    tableKey.current = key;
    saveTable(
      open
        ? {
            runId: run.id,
            year: run.year,
            month: run.month,
            cards: queue,
            marketId,
            yearEnd,
          }
        : null,
    );
  }, [hydrated, run, queue, marketId, yearEnd]);

  const startRun: GameContextValue["startRun"] = useCallback(
    (opts) => {
      /*
       * The run-a-day gate. Free is one life per day and it cannot be redone;
       * Pro and purchased slots lift the count (lib/monetization.ts). Checked
       * here rather than in the UI so no screen can start a run the pricing
       * page says you do not have.
       */
      if (runsRemainingToday() <= 0) return;
      recordRunStart();
      const legacy = loadLegacy();
      const { gender, ...runOpts } = opts;
      const next = createRun({
        ...runOpts,
        carriedRespect: legacy.sharkRespect,
        // CreateRunOpts already carries an avatar, so the founder's gender
        // rides in on that rather than adding a field to the protected run.ts.
        avatar: { ...DEFAULT_AVATAR, gender: gender ?? "male", name: opts.founderName },
      });
      // Device-level Pro (chosen on the plans screen) reaches the run itself,
      // so The Room and the Pro industries do not read as broken after buying.
      if (loadEntitlements().pro) next.pro = true;
      setQueue([]);
      setYearEnd(null);
      setAutopsy(null);
      setPerform(null);
      setAtGate(false);
      commit(next);
      saveProfile({
        founderName: opts.founderName,
        playerAge: opts.playerAge,
        rookieMode: opts.rookieMode,
        onboarded: true,
        micCalibration: loadProfile()?.micCalibration ?? null,
      });
      setProfile(loadProfile());
    },
    [commit],
  );

  const advance = useCallback(() => {
    const state = runRef.current;
    if (!state || busy || queue.length > 0) return;
    const working: RunState = structuredClone(state);
    const result = advanceMonth(working, EVENTS);

    if (result.gate) {
      setAtGate(true);
      return;
    }
    /*
     * Narration-only beats resolve inline; the rest become cards — FROZEN.
     *
     * `freezeEvent` resolves interpolation tokens ({topItem}, {company}, {rival},
     * {y}…) against run state at DRAW time and bakes the strings in, per
     * Addendum B §3.3: a mid-card retirement must not change the text of a card
     * already on the table. Addendum B nominated run.ts for this map, but run.ts
     * is protected — this is the same seam one call later, before anything
     * renders, which satisfies the freeze rule without opening that file.
     */
    const cards: GameEvent[] = [];
    for (const ev of result.surfaced) {
      if (ev.auto) resolveAuto(working, ev);
      else cards.push(freezeEvent(ev, working));
    }
    syncPositioning(working);
    commit(working);
    resolvingRef.current = null;
    setQueue(cards);
    setMarketId(result.marketEventId ?? null);
    if (working.month >= 12) setAtGate(true);
    if (result.died || !working.alive) setAutopsy(buildAutopsy(working));
  }, [busy, queue.length, commit]);

  const choose = useCallback(
    (index: number) => {
      const state = runRef.current;
      const ev = queue[0];
      if (!state || !ev) return;
      // A card resolves exactly once. Without this, a double-tap (or a sheet
      // still on screen through its exit animation) re-applies the effects.
      if (resolvingRef.current === ev.id) return;
      resolvingRef.current = ev.id;
      const working: RunState = structuredClone(state);
      const result = resolveChoice(working, ev, index);
      // Clarity reads the flags the choice just set — a stance-aligned pick
      // strengthens the claim, a contradiction weakens it. Qualitative only;
      // nothing here surfaces as a number (Addendum B §9.5).
      syncPositioning(working);

      if (result.perform) {
        // The camera is not optional — hold the card, open Perform.
        resolvingRef.current = null; // the camera resolves it, not this tap
        setPerform({
          kind: "choice",
          performType: result.perform.type,
          event: ev,
          choiceIndex: index,
        });
        return;
      }
      commit(working);
      setLastDeltas(result.lines.flatMap((l) => l.deltas ?? []));
      setQueue((q) => q.slice(1));
      resolvingRef.current = null;
    },
    [queue, commit],
  );

  const dismissCard = useCallback(() => {
    const state = runRef.current;
    const ev = queue[0];
    if (!state || !ev) return;
    // performOnly events cannot be dismissed — some moments you must speak.
    if (ev.performOnly && !ev.performOnly.optional) {
      setPerform({ kind: "eventOnly", performType: ev.performOnly.type, event: ev });
      return;
    }
    setQueue((q) => q.slice(1));
  }, [queue]);

  const openYearGate = useCallback(() => {
    setPerform({ kind: "yearEnd", performType: "pitch" });
  }, []);

  const submitPerform = useCallback(
    (score: number, dealCashS = 0, dealEquityPct = 0) => {
      const state = runRef.current;
      const request = perform;
      if (!state || !request) return;
      const working: RunState = structuredClone(state);

      if (request.kind === "choice" && request.event && request.choiceIndex !== undefined) {
        resolveChoice(working, request.event, request.choiceIndex, score);
        syncPositioning(working);
        commit(working);
        setQueue((q) => q.slice(1));
      } else if (request.kind === "eventOnly" && request.event) {
        resolvePerformOnly(working, request.event, score);
        commit(working);
        setQueue((q) => q.slice(1));
      } else if (request.kind === "yearEnd") {
        const result: PerformResult = {
          type: "pitch",
          score,
          multiplier: 0.4 + 0.12 * score,
          year: working.year,
        };
        /*
         * The portfolio closes its own books just before the fiscal year does, so
         * the year-end report has real history to render and this year's verdicts
         * are assigned before the player sees the screen.
         *
         * It is deliberately NOT writing straight into stats.revenueAnnual. That
         * number is computed inside run.ts/sim.ts, which are protected, so the
         * portfolio reaches the books the sanctioned way — through the effect
         * vocabulary below. Wiring portfolio revenue in as THE revenue model is a
         * bigger change to protected files and is called out in the handover
         * rather than smuggled in here.
         */
        const pYear = tickPortfolioYear(working, specFor);
        setPortfolioYear(pYear.rows.length > 0 ? pYear : null);

        if (pYear.rows.length > 0) {
          // Hits pull revenue up, flops and slot-hogs push it down. Modest on
          // purpose: this is the portfolio earning its place in the books, not a
          // second economy bolted on beside the first.
          const hits = pYear.newVerdicts.filter((v) => v.verdict === "hit").length;
          const flops = pYear.newVerdicts.filter((v) => v.verdict === "flop").length;
          const drag = portfolioDrag(working);
          const revPct = hits * 6 - flops * 5;
          const effects = [];
          if (revPct !== 0) effects.push({ stat: "rev_pct" as const, amount: revPct, durationQ: 4 });
          if (drag.qualPenalty > 0)
            effects.push({ stat: "qual" as const, amount: -Math.round(drag.qualPenalty) });
          if (effects.length > 0) {
            applyOutcome(
              working,
              { effects },
              "portfolio-year",
              runRng(working.seed, working.year, 12, hashString("portfolio")),
            );
          }
          if (drag.over > 0) {
            working.log.push(
              makeLine(
                working,
                "decision",
                `You are carrying ${drag.over} more ${drag.over === 1 ? "thing" : "things"} than the team can support well.`,
              ),
            );
          }
        }

        // Positioning settles with the fiscal year: clarity drifts (balance
        // decays toward the middle), the low/high-clarity flags refresh, and the
        // stuck-in-the-middle event class becomes drawable when earned.
        positioningYearTick(working);
        const summary = closeYear(working, result, dealCashS, dealEquityPct);
        // Shark Respect persists across runs (legacy).
        const legacy = loadLegacy();
        legacy.sharkRespect = working.stats.respect;
        legacy.bestYear = Math.max(legacy.bestYear, summary.year);
        if (!legacy.badges.includes(summary.badge)) legacy.badges.push(summary.badge);
        saveLegacy(legacy);
        commit(working);
        setYearEnd(summary);
        setAtGate(false);
      }
      setPerform(null);
    },
    [perform, commit],
  );

  const chooseAllocation = useCallback(
    (pick: Allocation) => {
      const state = runRef.current;
      if (!state) return;
      // Once a year, and the run itself is what remembers it. The year-end
      // statement survives a reload now (lib/engine/save.ts), so without a
      // record on the run "quit and come back" would be a way to spend next
      // year's money twice.
      if (state.flags[allocationFlag(state.year)]) return;
      const working: RunState = structuredClone(state);
      applyAllocation(working, pick);
      working.flags[allocationFlag(working.year)] = true;
      commit(working);
    },
    [commit],
  );

  const closeYearEnd = useCallback(() => setYearEnd(null), []);

  const setRookieMode = useCallback(
    (on: boolean) => {
      const state = runRef.current;
      if (state) {
        const working = structuredClone(state);
        working.rookieMode = on;
        commit(working);
      }
      const p = loadProfile();
      if (p) {
        const next = { ...p, rookieMode: on };
        saveProfile(next);
        setProfile(next);
      }
    },
    [commit],
  );

  const markTermSeen = useCallback(
    (term: string) => {
      const state = runRef.current;
      if (!state || state.seenTerms.includes(term)) return;
      const working = structuredClone(state);
      working.seenTerms.push(term);
      commit(working);
    },
    [commit],
  );

  const advanceTutorial = useCallback(
    (step: number) => {
      const state = runRef.current;
      if (!state) return;
      const working = structuredClone(state);
      working.tutorialStep = step;
      commit(working);
    },
    [commit],
  );

  const abandonRun = useCallback(() => {
    const state = runRef.current;
    if (state && !state.alive) {
      const legacy = loadLegacy();
      legacy.runsCompleted += 1;
      const report = buildAutopsy(state);
      legacy.autopsies.unshift({
        companyName: report.companyName,
        years: report.yearsSurvived,
        causes: report.fatalDecisions.map((d) => d.choiceLabel),
      });
      legacy.autopsies = legacy.autopsies.slice(0, 10);
      saveLegacy(legacy);
    }
    clearRun();
    runRef.current = null;
    setRun(null);
    setQueue([]);
    setYearEnd(null);
    setAutopsy(null);
    setPerform(null);
    setAtGate(false);
  }, []);

  const saveProfileFields = useCallback((fields: Partial<Profile>) => {
    const current = loadProfile() ?? {
      founderName: "",
      playerAge: null,
      rookieMode: true,
      onboarded: false,
      micCalibration: null,
    };
    const next = { ...current, ...fields };
    saveProfile(next);
    setProfile(next);
  }, []);


  /** Every non-time action shares this shape: clone, mutate, refresh, commit. */
  const mutate = useCallback(
    (fn: (draft: RunState) => string | void) => {
      const state = runRef.current;
      if (!state || !state.alive) return;
      const working: RunState = structuredClone(state);
      const before = { ...working.stats };
      const line = fn(working);
      refreshBooks(working);
      setLastDeltas(diffStats(before, working.stats));
      if (typeof line === "string" && line) {
        working.log.push(makeLine(working, "decision", line));
      }
      commit(working);
    },
    [commit],
  );

  const hire = useCallback(
    (candidateId: string) => {
      mutate((draft) => {
        const cand = candidatePool(draft, 6).find((c) => c.id === candidateId);
        if (!cand) return;
        if (cand.pro && !draft.pro) return; // Pro gates content, never outcomes
        hireCandidate(draft, cand);
        return `${cand.name} joins as ${cand.role}. Payroll is a promise you make every month.`;
      });
    },
    [mutate],
  );

  const fire = useCallback(
    (employeeId: string) => {
      mutate((draft) => {
        const gone = fireEmployee(draft, employeeId);
        if (!gone) return;
        return `You let ${gone.name} go. You did it yourself, which is the least and the most you could do.`;
      });
    },
    [mutate],
  );

  const buyHolding = useCallback(
    (defId: string) => {
      mutate((draft) => {
        const def = assetById(defId);
        if (!def) return;
        if (def.pro && !draft.pro) return;
        if (!buyAsset(draft, def)) return;
        return `You buy ${def.name}.`;
      });
    },
    [mutate],
  );

  const sellHolding = useCallback(
    (holdingId: string) => {
      mutate((draft) => {
        const held = draft.holdings.find((h) => h.id === holdingId);
        const def = held ? assetById(held.defId) : null;
        const proceeds = sellAsset(draft, holdingId);
        if (!proceeds || !def) return;
        return `You sell ${def.name}. The money comes back; the thing does not.`;
      });
    },
    [mutate],
  );

  const transferToBrokerage = useCallback(
    (amountUsd: number) => {
      mutate((draft) => {
        const amount = Math.max(0, Math.min(amountUsd, draft.stats.cash));
        if (amount <= 0) return;
        draft.stats.cash -= amount;
        draft.brokerageCash += amount;
      });
    },
    [mutate],
  );

  const buyStock = useCallback(
    (symbol: string, shares: number) => {
      mutate((draft) => {
        const ticker = tickerBySymbol(symbol);
        if (!ticker || shares <= 0) return;
        const price = priceAt(ticker, minuteOf());
        const cost = price * shares;
        if (cost > draft.brokerageCash) return; // never spend money you don't have
        draft.brokerageCash -= cost;
        const held = draft.positions.find((p) => p.symbol === symbol);
        if (held) {
          const total = held.shares + shares;
          held.avgCost = (held.avgCost * held.shares + cost) / total;
          held.shares = total;
        } else {
          draft.positions.push({ symbol, shares, avgCost: price });
        }
      });
    },
    [mutate],
  );

  const sellStock = useCallback(
    (symbol: string, shares: number) => {
      mutate((draft) => {
        const ticker = tickerBySymbol(symbol);
        const held = draft.positions.find((p) => p.symbol === symbol);
        if (!ticker || !held || shares <= 0) return;
        const sold = Math.min(shares, held.shares);
        draft.brokerageCash += priceAt(ticker, minuteOf()) * sold;
        held.shares -= sold;
        if (held.shares <= 0.0001) {
          draft.positions = draft.positions.filter((p) => p.symbol !== symbol);
        }
      });
    },
    [mutate],
  );

  const setFounderName = useCallback((name: string) => {
    const state = runRef.current;
    const existing = loadProfile();
    saveProfile({
      founderName: name,
      playerAge: existing?.playerAge ?? null,
      rookieMode: existing?.rookieMode ?? true,
      onboarded: true,
      micCalibration: existing?.micCalibration ?? null,
    });
    setProfile(loadProfile());
    if (state) {
      const working = structuredClone(state);
      working.founderName = name;
      working.avatar = { ...working.avatar, name };
      commit(working);
    }
  }, [commit]);

  const setCompanyName = useCallback(
    (name: string) => {
      const state = runRef.current;
      if (!state || !name.trim()) return;
      const working = structuredClone(state);
      working.companyName = name.trim();
      commit(working);
    },
    [commit],
  );

  /**
   * Ending a live company from Settings still writes legacy.
   *
   * abandonRun only recorded it for a run that had already died, so a player
   * who chose to close a healthy company lost the record of it — which is the
   * opposite of "legacy persists". Closing on purpose is a real outcome and
   * belongs in the history.
   */
  const endRun = useCallback(() => {
    const state = runRef.current;
    if (state) {
      const legacy = loadLegacy();
      legacy.runsCompleted += 1;
      const report = buildAutopsy(state);
      legacy.autopsies.unshift({
        companyName: report.companyName,
        years: report.yearsSurvived,
        causes: state.alive ? ["Closed by the founder."] : report.fatalDecisions.map((d) => d.choiceLabel),
      });
      legacy.autopsies = legacy.autopsies.slice(0, 10);
      saveLegacy(legacy);
    }
    clearRun();
    runRef.current = null;
    setRun(null);
    setQueue([]);
    setYearEnd(null);
    setAutopsy(null);
    setPerform(null);
    setAtGate(false);
    setTierUnlock(null);
  }, []);

  const dismissTierUnlock = useCallback(() => setTierUnlock(null), []);

  const setAvatar = useCallback(
    (next: AvatarConfig) => {
      const state = runRef.current;
      if (!state) return;
      const working: RunState = structuredClone(state);
      working.avatar = next;
      commit(working);
    },
    [commit],
  );

  const launchLineItem = useCallback(
    (input: LaunchInput) => {
      const state = runRef.current;
      if (!state || !state.alive) return null;
      const working: RunState = structuredClone(state);
      /*
       * `launch_seasonal` is set by FOOD's "Run a seasonal special" activity and
       * used to be deleted a few lines below without ever being read, which made
       * that activity's entire limited-time-offer mechanic a no-op. It now tags
       * the item, which is what FOOD's spoilage function actually reads.
       */
      const seasonal = !!working.flags.launch_seasonal;
      const item = launchItem(working, specForRun(working), {
        ...input,
        tags: seasonal && !input.tags.includes("seasonal")
          ? [...input.tags, "seasonal"].slice(0, 2)
          : input.tags,
      });
      if (!item) return null;
      // The launch sheet is one-shot: the flag that opened it is consumed here so
      // reopening the product tab does not drop the player back into the flow.
      delete working.flags.launch_sheet_open;
      delete working.flags.launch_seasonal;
      refreshBooks(working);
      working.log.push(
        makeLine(
          working,
          "decision",
          `You put ${item.name} out at ${fmtMoney(item.price)}. Now you find out what it was worth.`,
        ),
      );
      commit(working);
      return item;
    },
    [commit],
  );

  const retireLineItem = useCallback(
    (id: string) => {
      const state = runRef.current;
      if (!state || !state.alive) return;
      const working: RunState = structuredClone(state);
      const gone = retireItem(working, id);
      if (!gone) return;
      refreshBooks(working);
      working.log.push(
        makeLine(working, "decision", `You discontinued ${gone.name}. It stays in the archive.`),
      );
      commit(working);
    },
    [commit],
  );

  const refreshLineItem = useCallback(
    (id: string, costS: number) => {
      const state = runRef.current;
      if (!state || !state.alive) return;
      const working: RunState = structuredClone(state);
      const p = ensurePortfolio(working);
      const item = p.items.find((i) => i.id === id);
      if (!item || !refreshItem(working, id, costS)) return;
      delete working.flags.refresh_sheet_open;
      refreshBooks(working);
      working.log.push(
        makeLine(
          working,
          "decision",
          `You reworked ${item.name}. Same name on the list, different thing behind it.`,
        ),
      );
      commit(working);
    },
    [commit],
  );

  const clearFlag = useCallback(
    (flag: string) => {
      const state = runRef.current;
      if (!state || !state.flags[flag]) return;
      const working: RunState = structuredClone(state);
      delete working.flags[flag];
      commit(working);
    },
    [commit],
  );

  const applyColdCall = useCallback(
    (callerId: string, outcome: CallOutcome) => {
      const state = runRef.current;
      if (!state || !state.alive) return;
      const working: RunState = structuredClone(state);

      // Consumed regardless of the answer. A cold call you fumbled is still a
      // cold call you made, and the scarcity is the mechanic.
      consumeCall(working);

      if (outcome.accepted) {
        working.coldCallsClosed = [...(working.coldCallsClosed ?? []), callerId];
        applyOutcome(
          working,
          {
            effects: [
              { stat: "cash_S", amount: outcome.cashS },
              { stat: "dilution_pct", amount: outcome.dilutionPct },
              { stat: "respect", amount: outcome.respect },
              { stat: "invsent", amount: outcome.invsent },
            ],
            narration: `${callerById(callerId)?.name ?? "An investor"} took the call and wrote a cheque.`,
          },
          `coldcall:${callerId}`,
          runRng(working.seed, working.year, working.month, hashString(callerId)),
        );
        refreshBooks(working);
        working.log.push(
          makeLine(
            working,
            "decision",
            `You cold called ${callerById(callerId)?.name ?? "an investor"}. They said yes.`,
          ),
        );
      } else {
        // A decline costs nothing but the call. No stat punishment for trying —
        // that would teach players not to pitch, which is the opposite lesson.
        working.log.push(
          makeLine(
            working,
            "decision",
            `You cold called ${callerById(callerId)?.name ?? "an investor"}. They passed.`,
          ),
        );
      }
      commit(working);
    },
    [commit],
  );

  const markMailRead = useCallback(
    (id: string) => {
      const state = runRef.current;
      if (!state || state.readMail.includes(id)) return;
      const working: RunState = structuredClone(state);
      working.readMail.push(id);
      commit(working);
    },
    [commit],
  );

  const setPro = useCallback(
    (on: boolean) => {
      const state = runRef.current;
      if (!state) return;
      const working: RunState = structuredClone(state);
      working.pro = on;
      commit(working);
    },
    [commit],
  );

  /*
   * A purchase reaches the company that is already running.
   *
   * `startRun` copies device Pro into the run, which covers founding AFTER a
   * purchase and nothing else. Buying Pro from a gate in month seven left The
   * Room shut, the Pro industries locked and the paid asset classes greyed out
   * until the next company — a purchase that visibly did nothing, which is the
   * one failure mode worse than not selling at all.
   *
   * Runs on mount as well as on the event, so resuming a saved company on a new
   * device picks up the entitlements that arrived while it was closed. The
   * mount pass is safe because hydrate's effect is declared above this one and
   * effects run in order, so `runRef.current` is already the restored run.
   *
   * Upward only. ProSheet's simulated switch turns `run.pro` off without
   * touching entitlements, and syncing both directions would turn it straight
   * back on the moment anything else wrote to the store.
   */
  useEffect(() => {
    const sync = () => {
      const state = runRef.current;
      if (!state || state.pro) return;
      if (!isPro(loadEntitlements())) return;
      setPro(true);
    };
    sync();
    return onEntitlementsChange(sync);
  }, [setPro]);

  const choicesFor = useCallback(
    (ev: GameEvent) => (run ? visibleChoices(run, ev) : []),
    [run],
  );

  const runActivity = useCallback(
    (id: string) => {
      const state = runRef.current;
      if (!state || !state.alive) return;
      // Looks in the industry lens as well as the shared registry, so a FOOD
      // player can actually fire "Add a menu item".
      const activity = activityById(id, state);
      if (!activity) return;
      // The sheet already hides what is unavailable. Check again here anyway:
      // going public is irreversible and once-only, and a stale sheet held open
      // across a commit must not be able to fire it twice.
      if (!isAvailable(activity, state)) return;
      const working: RunState = structuredClone(state);
      activity.apply(working);
      commit(working);
    },
    [commit],
  );

  const value = useMemo<GameContextValue>(
    () => ({
      run: hydrated ? run : null,
      profile,
      events: EVENTS,
      queue,
      current: queue[0] ?? null,
      currentIsMarket: !!marketId && queue[0]?.id === marketId,
      yearEnd,
      autopsy,
      perform,
      atGate,
      busy,
      startRun,
      advance,
      choose,
      dismissCard,
      openYearGate,
      submitPerform,
      chooseAllocation,
      closeYearEnd,
      setRookieMode,
      markTermSeen,
      advanceTutorial,
      abandonRun,
      saveProfileFields,
      choicesFor,
      runActivity,
      lastDeltas,
      hire,
      fire,
      buyHolding,
      sellHolding,
      buyStock,
      sellStock,
      transferToBrokerage,
      setAvatar,
      setFounderName,
      setCompanyName,
      endRun,
      tierUnlock,
      dismissTierUnlock,
      markMailRead,
      applyColdCall,
      clearFlag,
      launchLineItem,
      retireLineItem,
      refreshLineItem,
      portfolioYear,
      setPro,
    }),
    [
      hydrated, run, profile, queue, marketId, yearEnd, autopsy, perform, atGate, busy,
      startRun, advance, choose, dismissCard, openYearGate, submitPerform,
      chooseAllocation, closeYearEnd, setRookieMode, markTermSeen,
      advanceTutorial, abandonRun, saveProfileFields, choicesFor, runActivity,
      hire, fire, buyHolding, sellHolding, buyStock, sellStock,
      transferToBrokerage, setAvatar, setFounderName, setCompanyName, endRun, markMailRead, setPro, lastDeltas, tierUnlock, dismissTierUnlock,
    ],
  );

  useEffect(() => {
    setBusy(false);
  }, [run]);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside <GameProvider>");
  return ctx;
}
