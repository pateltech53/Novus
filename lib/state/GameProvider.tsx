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
  applyAllocation,
  createRun,
  resolveChoice,
  resolvePerformOnly,
  visibleChoices,
  type Allocation,
  type YearEndSummary,
} from "@/lib/engine/run";
import { buildAutopsy, type AutopsyReport } from "@/lib/engine/autopsy";
import type { CompanyBrief } from "@/lib/engine/company-brief";
import { activityById, isLocked, isOfferable } from "@/lib/engine/activities";
import { callerById, consumeCall, type CallOutcome } from "@/lib/ai/callers";
import { syncPositioning } from "@/lib/engine/positioning";
import { TANK_REQUIRED_THROUGH_YEAR } from "@/lib/engine/constants";
import {
  industryUnlocked,
  islandCapFor,
  isPro,
  loadEntitlements,
  onEntitlementsChange,
  recordRunStart,
  recordYearClose,
  runsRemainingToday,
  yearClosesRemainingToday,
} from "@/lib/monetization";
import {
  ensurePortfolio,
  liveItems,
  retireItem,
  refreshItem,
  type LaunchInput,
  type LineItem,
  type PortfolioYearResult,
} from "@/lib/engine/portfolio";
import { candidatePool, fire as fireEmployee, hire as hireCandidate } from "@/lib/engine/people";
import { assetById, buyAsset, sellAsset } from "@/lib/engine/holdings";
import { minuteOf } from "@/lib/engine/market";
/*
 * The leaderboard's half of every tap.
 *
 * Two things arrive from `lib/leaderboard/` and they are different in kind.
 *
 * `record` APPENDS to the tape. It is called inside the mutation, before
 * `commit()`, at every site that changes the run — a recorder that runs on a
 * timer or in an effect eventually records a tap the run did not take, and a
 * tape that disagrees with the save by one entry replays into a different
 * company.
 *
 * `advanceTurn`, `closeFiscalYear`, `buyStockAt` and friends are the shared
 * ORCHESTRATION. They used to be written out here; the verifier now runs the
 * same functions, which is the whole argument docs/LEADERBOARD.md §1.1 makes
 * for keeping the engine and the verifier in one deploy. If the year-end
 * sequence changes, it changes for both, or it does not change.
 */
import {
  advanceTurn,
  buyStockAt,
  closeFiscalYear,
  launchLineItemFrom,
  sellStockAt,
  transferToBrokerageAmount,
} from "@/lib/leaderboard/replay";
import {
  clearTape,
  record as recordTap,
  startTape,
  todayISO as tapeToday,
} from "@/lib/leaderboard/recorder";
import { autoSubmitRun } from "@/lib/leaderboard/auto";
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
import { fmtMoney, fmtPrice } from "@/lib/engine/format";
import {
  activeIsland,
  clearRun,
  flushRun,
  islandOccupied,
  listIslands,
  liveIslandCount,
  loadLegacy,
  loadProfile,
  loadRun,
  loadTable,
  onIslandsChange,
  saveLegacy,
  saveProfile,
  saveRun,
  saveTable,
  setActiveIsland,
  slotForNewCompany,
  type IslandSummary,
  type Profile,
} from "@/lib/engine/save";
import { useOutside } from "@/components/native/useOutside";

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

/**
 * Is `stored` the same company as `open`, further through the calendar?
 *
 * The one condition under which a run already on screen may be replaced by one
 * that arrived from the cloud. Same run id, because a different company in that
 * slot is one this device founded and a restore never undoes a founding; and
 * strictly later, because time only moves forward — `advanceMonth` is the only
 * thing that moves it — so "ahead" is a fact about the run rather than a race
 * between two devices' clocks. Level pegging keeps what is on screen.
 */
const isLaterCopy = (open: RunState, stored: RunState): boolean =>
  stored.id === open.id &&
  (stored.year > open.year || (stored.year === open.year && stored.month > open.month));

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

/**
 * How many of the Tank's questions a run remembers between years.
 *
 * Two years' worth at three questions a year, with room to spare. Enough that
 * the room does not open on last year's sentence; small enough that a
 * ten-year run does not carry a page of dialogue into a localStorage save
 * shared with nine other islands.
 */
const PANEL_MEMORY = 12;

interface GameContextValue {
  run: RunState | null;
  /**
   * Which island `run` is. 0..ISLAND_CAP-1.
   *
   * Every write in this provider goes to this slot, so it is not decoration:
   * it is the answer to "which company am I playing", and before islands the
   * answer was assumed rather than held.
   */
  island: number;
  /** Every company on this device, for the picker. Refreshed on every change. */
  islands: IslandSummary[];
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
    /**
     * Which island to found on. Omitted means the lowest free one — which is
     * what /found wants, and what keeps burying island 0 and founding again
     * reuse island 0 rather than marching rightwards.
     */
    slot?: number;
    founderName: string;
    playerAge: number | null;
    companyName: string;
    industry: Industry;
    rookieMode: boolean;
    tutorial: boolean;
    /** Chosen once at founding. Everything else about the avatar is earned. */
    gender?: Gender;
    /**
     * What the company IS, in the founder's own words. Optional — a run without
     * one plays identically, it just has less on the notes card in The Tank.
     */
    brief?: CompanyBrief;
  }): void;
  advance(): void;
  choose(index: number): void;
  dismissCard(): void;
  openYearGate(): void;
  /**
   * Close the year WITHOUT pitching — the Tank is optional from year 4 on.
   * Neutral 1.0× close, no deal. A no-op in years 1–3, where the pitch is the
   * gate; the replay verifier refuses early skips by the same rule.
   */
  skipYearGate(): void;
  /**
   * Leave a perform brief without recording anything. Nothing resolves: a
   * year gate stays open, a held card stays held. Exists so a screen that
   * REFUSES the perform (the free tier's daily year ration) has a way back
   * that is not the camera.
   */
  cancelPerform(): void;
  /**
   * `transcript` is the player's own words, and it is what the leaderboard
   * verifies against — the server rescores it rather than believing `score`
   * (docs/LEADERBOARD.md §7.3). Optional so a caller that has no words to hand
   * still closes the year; the run is simply not verifiable at that gate.
   */
  submitPerform(
    score: number,
    dealCashS?: number,
    dealEquityPct?: number,
    transcript?: string,
  ): void;
  chooseAllocation(pick: Allocation): void;
  closeYearEnd(): void;
  setRookieMode(on: boolean): void;
  markTermSeen(term: string): void;
  advanceTutorial(step: number): void;
  /**
   * The company is finished and stays on the map as a headstone. What Chapter
   * Seven offers; `abandonRun` is the separate, explicit act of clearing the
   * island.
   */
  retireRun(): void;
  abandonRun(): void;
  /**
   * Open a different company.
   *
   * Flushes the one being left before touching anything — the held write in
   * lib/engine/save.ts is coalesced over 120 ms, and a switch inside that
   * window would otherwise drop the last decision of the island being left.
   * Every piece of transient state is reset with the same call, because a
   * decision card, a year-end statement or an autopsy belongs to the company
   * that produced it and to no other.
   */
  switchIsland(slot: number): void;
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
  applyColdCall(callerId: string, outcome: CallOutcome, transcript?: string): void;
  /**
   * Remember what the Tank asked this year, so next year's room does not open
   * with the same sentence. Never scores anything — it only orders questions.
   */
  rememberPanelQuestions(questions: string[]): void;
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
  /*
   * Which island is open, and what is on the others.
   *
   * `island` is mirrored into a ref for the same reason `run` is: the ~25
   * mutation callbacks below read it out of a closure that was captured when
   * the callback was created, and a stale slot number would write one
   * company's state over another's. The ref is always the truth; the state is
   * what renders.
   */
  const [island, setIsland] = useState(0);
  const islandRef = useRef(0);
  const [islands, setIslands] = useState<IslandSummary[]>([]);
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
    saveRun(next, islandRef.current);
    // The picker's cards are derived from the save, so they move when it does.
    // Cheap: listIslands() reads an index and parses nothing unless it drifted.
    setIslands(listIslands());
  }, []);

  useEffect(() => {
    const at = activeIsland();
    islandRef.current = at;
    setIsland(at);
    setIslands(listIslands());
    const saved = loadRun(at);
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
      const table = loadTable(saved, at);
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
   * …and the companies that arrive from the cloud a second later.
   *
   * The boot restore is a network round trip, so it lands after the effect
   * above has already read localStorage and decided what this device has. Its
   * answer to that was a reload, and the reload is now skipped the moment the
   * player has touched anything (lib/cloud/sync.ts, `markAndReload`) — which
   * left the islands adopted and nothing on screen showing them. On a second
   * device that reads as "my companies are not here", which is precisely what
   * the cloud copy exists to prevent.
   *
   * Two things can have landed, and the second one is the sharp one:
   *
   *  · **An island this device had none of.** Draw it. If nothing is open,
   *    open it — this is the new phone, and the alternative is a player staring
   *    at a screen that says they have no companies while their companies sit
   *    in storage.
   *
   *  · **A later copy of the company that is OPEN.** The restore only writes
   *    one when it is the same run, strictly further through the calendar
   *    (lib/cloud/sync.ts) — the tablet last played in year 1 catching up with
   *    the phone that reached year 3. Memory has to follow it, because memory
   *    is what `commit()` writes: leaving the older run in state means the next
   *    tap saves year 1 back over year 3 and pushes that up as the account's
   *    only copy. Which is the bug, one layer down from where it was fixed.
   *
   * Anything else is refused. A different company in that slot is never
   * replaced, and a local copy that is level or ahead keeps the screen — the
   * in-month work of this session lives there.
   */
  useEffect(() => {
    if (!hydrated) return;
    return onIslandsChange(() => {
      setIslands(listIslands());
      const open = runRef.current;
      const at = open ? islandRef.current : activeIsland();
      const stored = loadRun(at);
      if (!stored) return;
      if (open && !isLaterCopy(open, stored)) return;

      stored.avatar = normalizeAvatar(stored.avatar);
      islandRef.current = at;
      setIsland(at);
      runRef.current = stored;
      setRun(stored);
      // The transient state belongs to the copy being replaced: a card, a
      // statement or an autopsy drawn against year 1 means nothing to year 3.
      setQueue([]);
      setMarketId(null);
      setYearEnd(null);
      setPortfolioYear(null);
      setPerform(null);
      setAutopsy(stored.alive ? null : buildAutopsy(stored));
      setAtGate(stored.month >= 12);
      // loadTable refuses a table written at a different run/year/month, so
      // this restores the cards only when nothing actually moved.
      const table = loadTable(stored, at);
      if (table) {
        setQueue(table.cards);
        setMarketId(table.marketId);
        setYearEnd(table.yearEnd);
      }
    });
  }, [hydrated]);

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
    // The island is part of the identity: two companies can be at the same
    // year and month with the same cards drawn, and a key that could not tell
    // them apart would skip the write for the second one.
    const key = open
      ? `${island}:${run.id}:${run.year}:${run.month}:${marketId ?? ""}:${yearEnd?.year ?? ""}:${queue
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
      island,
    );
  }, [hydrated, run, queue, marketId, yearEnd, island]);

  const startRun: GameContextValue["startRun"] = useCallback(
    (opts) => {
      /*
       * The run-a-day gate. Free is one life per day and it cannot be redone;
       * Pro and purchased slots lift the count (lib/monetization.ts). Checked
       * here rather than in the UI so no screen can start a run the pricing
       * page says you do not have.
       */
      if (runsRemainingToday() <= 0) return;
      /*
       * The industry gate, for exactly the reason stated above it.
       *
       * The founding screen's grid used to be the only thing keeping a free
       * account out of the eight Pro industries — it dimmed the card and
       * refused the tap. That grid is now deliberately open (a player picking
       * a paid industry is telling us something worth hearing, and the answer
       * belongs at FOUND IT), which would leave the whole gate in one
       * `onClick` if this line were not here.
       *
       * `industryUnlocked` rather than `isPro`, because there are three ways
       * to own an industry and a one-time pack is one of them.
       */
      if (!industryUnlocked(opts.industry, loadEntitlements())) return;
      /*
       * Which island this company goes on, decided BEFORE anything is written.
       *
       * ── A named slot is a request, not an instruction ──────────────────────
       *
       * `opts.slot` arrives from a query string (`/found?island=N`), which is to
       * say from a bookmark, a back button, or a picker that drew its empty card
       * some seconds ago. It used to be taken at its word and written to, and
       * founding is the one action in this app that overwrites a company without
       * ever having asked: `saveRun` does not care what was in the slot, so the
       * old run went with no autopsy, no legacy entry and no question — and the
       * debounced push carried the loss to every other device.
       *
       * So the request is honoured only while it is true: the island is empty
       * (held writes included — see `islandOccupied`) and the allowance has room
       * for another living company. Anything else falls through to
       * `slotForNewCompany`, which is the same rule the picker drew the card
       * with, and which answers null when there is genuinely nowhere to put it.
       * Burying a company stays an explicit act (endRun / abandonRun); it is not
       * something founding does on the player's behalf.
       *
       * `startTape` below is handed this slot rather than reading the open
       * island for itself. The pointer moves first regardless, but the tape must
       * not depend on that ordering: writing it against the island being LEFT
       * erases the previous company's record of every tap it took.
       */
      const cap = islandCapFor(loadEntitlements());
      const target =
        opts.slot !== undefined && !islandOccupied(opts.slot) && liveIslandCount() < cap
          ? opts.slot
          : slotForNewCompany(cap);
      if (target === null) return;
      recordRunStart();
      islandRef.current = target;
      setIsland(target);
      setActiveIsland(target);
      const legacy = loadLegacy();
      const { gender, brief, slot: _slot, ...runOpts } = opts;
      const next = createRun({
        ...runOpts,
        carriedRespect: legacy.sharkRespect,
        // CreateRunOpts already carries an avatar, so the founder's gender
        // rides in on that rather than adding a field to the protected run.ts.
        avatar: { ...DEFAULT_AVATAR, gender: gender ?? "male", name: opts.founderName },
      });
      /*
       * The brief is attached HERE rather than in `createRun`, because run.ts is
       * a protected file (docs/DO-NOT-TOUCH.md) and this needs no change to it:
       * `brief` is an optional field on RunState, so writing it after
       * construction is the additive path the rules ask for. Nothing in the
       * engine reads it, so a run without one behaves identically.
       */
      if (brief && (brief.whatItDoes || brief.usp || brief.companyType)) {
        next.brief = brief;
      }
      // Device-level Pro (chosen on the plans screen) reaches the run itself,
      // so The Room and the Pro industries do not read as broken after buying.
      if (loadEntitlements().pro) next.pro = true;
      // A fresh company gets a fresh tape. Before any state is set, so a throw
      // in the storage layer cannot leave a run running against another run's
      // tape — `record` refuses a mismatched runId, so the failure mode is a
      // company that cannot be submitted rather than one that submits a lie.
      //
      // Keyed by `target` explicitly: nothing has been written to that island
      // yet at this line, so a tape that asked which island was open would be
      // answered with the one being left and would overwrite ITS tape.
      startTape(next, target);
      if (next.pro) recordTap(next, { t: "pro", on: true });
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
    /*
     * One tap, one shared function.
     *
     * `advanceTurn` is `advanceMonth` plus the four things a tap actually does
     * around it: resolve the narration-only beats inline, freeze the rest into
     * cards (Addendum B §3.3 — a mid-card retirement must not change the text
     * of a card already on the table), and settle positioning. It lives in
     * lib/leaderboard/replay.ts so the verifier runs the same sequence rather
     * than an approximation of it.
     */
    const turn = advanceTurn(working, EVENTS);

    if (turn.gate) {
      setAtGate(true);
      return;
    }
    /*
     * The date the ENGINE used, not the date this line asks for.
     *
     * `advanceMonth` stamps `lastPlayedISO` with the day it read off the wall
     * clock, and seeds Today's Market from the same one. Calling `new Date()`
     * again here would almost always agree — and would disagree exactly once,
     * for the player who taps ADVANCE at midnight UTC, whose tape would then
     * replay a different day's shared event than the one they answered.
     */
    recordTap(working, { t: "advance", atISO: working.lastPlayedISO ?? tapeToday() });
    commit(working);
    resolvingRef.current = null;
    setQueue(turn.cards);
    setMarketId(turn.marketEventId);
    if (working.month >= 12) setAtGate(true);
    if (turn.died) {
      setAutopsy(buildAutopsy(working));
      /*
       * The board finds out here, not when somebody remembers to tell it.
       *
       * A company that goes under at 11pm used to reach Still Standing only if
       * the player opened the screen and pressed a button, which most never
       * did — so the boards were missing most of the game. `autoSubmitRun` is
       * fire-and-forget and reads the tape before its first await, so the
       * verdict arrives while the autopsy is being read. It sends nothing the
       * board has already been told (lib/leaderboard/auto.ts).
       */
      void autoSubmitRun(working);
    }
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
      recordTap(working, { t: "choice", eventId: ev.id, choice: index });
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
    // Recorded even though it changes nothing about the books. The replay draws
    // the same cards the player was dealt, so it has to be told which ones were
    // walked away from — otherwise a later `choice` naming the second card
    // arrives at a table where the first one is still face-up.
    recordTap(state, { t: "dismiss", eventId: ev.id });
    setQueue((q) => q.slice(1));
  }, [queue]);

  const openYearGate = useCallback(() => {
    setPerform({ kind: "yearEnd", performType: "pitch" });
  }, []);

  /*
   * Close the year with no pitch at all — the veteran's exit from the annual
   * Tank. Years 1–3 still require the room (the loop is the lesson), so this
   * is a hard no-op there; from year 4 it closes the books at a neutral 1.0×
   * with no deal. The tape records the skip so the leaderboard verifier can
   * replay the same close — and refuse a tape that skipped an early year.
   */
  const skipYearGate = useCallback(() => {
    const state = runRef.current;
    if (!state || state.year <= TANK_REQUIRED_THROUGH_YEAR) return;
    // The daily ration gates skipped closes exactly like pitched ones — a
    // skip is still a year of progress, and it must not be the way around
    // the free tier's pace limit.
    //
    // `isPro(loadEntitlements())` rather than `state.pro`: the run carries a
    // COPY of the tier taken when it was founded (see `startRun`), and it is
    // also what `setPro` writes without touching the entitlement store — so a
    // run flagged pro in memory would spend nothing. The store is the receipt;
    // it is also the only one of the two that knows about a chapter seat.
    if (!isPro(loadEntitlements()) && yearClosesRemainingToday() <= 0) return;
    const working: RunState = structuredClone(state);
    recordTap(working, {
      t: "perform",
      kind: "yearEnd",
      performType: "pitch",
      transcript: "",
      skipped: true,
    });
    const result: PerformResult = { type: "pitch", score: 5, multiplier: 1, year: working.year };
    const { summary, portfolioYear: pYear } = closeFiscalYear(working, result, 0, 0);
    setPortfolioYear(pYear);
    // The same legacy bookkeeping a pitched close does — a skipped year is
    // still a year survived, and the badge is still earned.
    const legacy = loadLegacy();
    legacy.sharkRespect = working.stats.respect;
    legacy.bestYear = Math.max(legacy.bestYear, summary.year);
    if (!legacy.badges.includes(summary.badge)) legacy.badges.push(summary.badge);
    saveLegacy(legacy);
    recordYearClose();
    commit(working);
    setYearEnd(summary);
    setAtGate(false);
    setPerform(null);
  }, [commit]);

  const cancelPerform = useCallback(() => setPerform(null), []);

  const submitPerform = useCallback(
    (score: number, dealCashS = 0, dealEquityPct = 0, transcript = "") => {
      const state = runRef.current;
      const request = perform;
      if (!state || !request) return;
      const working: RunState = structuredClone(state);

      /*
       * The WORDS go on the tape, never the score.
       *
       * `score` reached this function from the client, and the year gate turns
       * it into a multiplier of 0.4 + 0.12 × score. The server rescores the
       * transcript with the same `scorePitchContent` this screen used
       * (docs/LEADERBOARD.md §7.3), so what a board sees is the pitch, not a
       * number a devtools console could have typed.
       *
       * There is no audio here and there must never be. The scorer reads
       * content and nothing about how a voice sounded (Brand Law 5), which is
       * what makes a text transcript the complete input — and the right privacy
       * answer, because there is then no recording to upload (§9.1).
       */
      recordTap(working, {
        t: "perform",
        kind: request.kind,
        performType: request.performType as PerformResult["type"],
        eventId: request.event?.id,
        choiceIndex: request.choiceIndex,
        transcript,
      });

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
        /*
         * The same ration `skipYearGate` spends, checked on the path that
         * actually closes most years.
         *
         * It was missing here. The only thing standing between a free player
         * and an unlimited number of closes was a render branch in
         * PerformScreen that hides OPEN THE CAMERA once the ration is spent —
         * and a screen is not a gate: the button is one route to this
         * function, not the definition of it. `startRun` states the rule for
         * this file ("checked here rather than in the UI so no screen can
         * start a run the pricing page says you do not have"); this is the
         * same rule, applied to the other ration.
         *
         * It returns without closing rather than throwing: the caller is a
         * submit handler on a screen the player is looking at, and the
         * refusal it should see is PerformScreen's, which explains the limit
         * and offers the other islands. Clearing `perform` on the way out is
         * what puts them back on it.
         */
        if (!isPro(loadEntitlements()) && yearClosesRemainingToday() <= 0) {
          setPerform(null);
          return;
        }
        const result: PerformResult = {
          type: "pitch",
          score,
          multiplier: 0.4 + 0.12 * score,
          year: working.year,
        };
        /*
         * The whole closing, in one shared call.
         *
         * The portfolio closes its own books first so the year-end report has
         * real history and this year's verdicts are assigned before the player
         * sees the screen; its result reaches the company's books through the
         * effect vocabulary rather than by writing `stats.revenueAnnual`, which
         * is computed inside the protected sim.ts; positioning settles; and
         * only then does `closeYear` apply the deal and age the company up.
         *
         * That order is load-bearing, which is exactly why it is not written
         * out twice. `lib/leaderboard/replay.ts` owns it and the verifier runs
         * the same function — see the note beside the import.
         */
        const { summary, portfolioYear: pYear } = closeFiscalYear(
          working,
          result,
          dealCashS,
          dealEquityPct,
        );
        setPortfolioYear(pYear);
        // Shark Respect persists across runs (legacy).
        const legacy = loadLegacy();
        legacy.sharkRespect = working.stats.respect;
        legacy.bestYear = Math.max(legacy.bestYear, summary.year);
        if (!legacy.badges.includes(summary.badge)) legacy.badges.push(summary.badge);
        saveLegacy(legacy);
        // One of today's ration, spent at the moment the year actually closes.
        recordYearClose();
        commit(working);
        setYearEnd(summary);
        setAtGate(false);
        // Another year survived is a different result for the same run, and
        // `record_board_entry` (0006) upserts on the run — so this replaces
        // the row rather than adding one, and Still Standing is right about
        // this company from the moment the year closes.
        void autoSubmitRun(working);
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
      recordTap(working, { t: "allocation", pick });
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

  /**
   * Write a company into legacy, exactly once, whatever route it took there.
   *
   * ── Why this needs a guard at all ─────────────────────────────────────────
   *
   * Recording and burying used to be one act, because burying was the only
   * exit a finished company had. With islands they are two: a company can be
   * finished and still on the map — that is what a headstone IS — and it may
   * be buried an hour later or never. Both moments would otherwise write the
   * same autopsy, and `runsCompleted` would climb by two for one company.
   *
   * Keyed by run id rather than by name, because two companies may be called
   * the same thing and a player who founds "GlorpCo" twice has run twice.
   */
  const recordLegacyOnce = useCallback((state: RunState, closedOnPurpose: boolean) => {
    const legacy = loadLegacy();
    if (legacy.autopsies.some((a) => a.runId && a.runId === state.id)) return;
    const report = buildAutopsy(state);
    legacy.runsCompleted += 1;
    legacy.autopsies.unshift({
      runId: state.id,
      companyName: report.companyName,
      years: report.yearsSurvived,
      causes: closedOnPurpose
        ? ["Closed by the founder."]
        : report.fatalDecisions.map((d) => d.choiceLabel),
    });
    legacy.autopsies = legacy.autopsies.slice(0, 10);
    saveLegacy(legacy);
  }, []);

  /**
   * The company is finished, and stays on the map.
   *
   * What Chapter Seven's "found another one" does now. It used to call
   * `abandonRun`, which DELETED the company — so the headstone the islands
   * screen is built to draw could never appear, and a player who lost their
   * only company arrived at a picker with two empty places on it and no
   * record that anything had ever been there.
   *
   * Everything that makes a grave legible is already written and was simply
   * unreachable: `IslandSummary.endedBy`, the CHAPTER SEVEN plate, READ THE
   * BOOKS, PEAK VALUATION beside AT THE END, and the note in lib/entry.ts
   * saying a finished company's books stay readable.
   */
  const retireRun = useCallback(() => {
    const state = runRef.current;
    if (state) recordLegacyOnce(state, state.alive);
    // Deliberately no `clearRun`: the save IS the headstone. The in-memory
    // session is left alone too — the caller navigates away, and a player who
    // comes back to this island through READ THE BOOKS should find the report
    // where they left it.
    setIslands(listIslands());
  }, [recordLegacyOnce]);

  const abandonRun = useCallback(() => {
    const state = runRef.current;
    if (state) recordLegacyOnce(state, false);
    // The tape goes with the company. A player who buries this one and founds
    // another must not carry the old taps into the new tape — `record` refuses
    // a mismatched runId anyway, and this makes the intent explicit rather than
    // leaving a spent tape in storage until something overwrites it.
    //
    // Named rather than inferred, and BEFORE clearRun: the island being buried
    // is the one this provider has open, which is the only island whose tape
    // this is — and clearRun frees the slot out from under anything that tried
    // to work it out afterwards.
    clearTape(islandRef.current);
    clearRun(islandRef.current);
    setIslands(listIslands());
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

  /*
   * ── Why these record an INDEX and not the thing ──────────────────────────
   *
   * A tape carries inputs, never outcomes, and the strongest version of that
   * rule is to name a thing the server already holds rather than to describe
   * one it would have to trust. `candidatePool()` is seeded on
   * `${id}:hire:${year}:${month}`, so an index regenerates the same person; a
   * serialised candidate would let a client invent one with performance 100.
   * The same argument covers the roster, the holdings and the portfolio.
   */
  const hire = useCallback(
    (candidateId: string) => {
      mutate((draft) => {
        const pool = candidatePool(draft, 6);
        const index = pool.findIndex((c) => c.id === candidateId);
        const cand = pool[index];
        if (!cand) return;
        if (cand.pro && !draft.pro) return; // Pro gates content, never outcomes
        hireCandidate(draft, cand);
        recordTap(draft, { t: "hire", index });
        return `${cand.name} joins as ${cand.role}. Payroll is a promise you make every month.`;
      });
    },
    [mutate],
  );

  const fire = useCallback(
    (employeeId: string) => {
      mutate((draft) => {
        const index = draft.roster.findIndex((e) => e.id === employeeId);
        const gone = fireEmployee(draft, employeeId);
        if (!gone) return;
        recordTap(draft, { t: "fire", index });
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
        recordTap(draft, { t: "buy-asset", defId });
        return `You buy ${def.name}.`;
      });
    },
    [mutate],
  );

  const sellHolding = useCallback(
    (holdingId: string) => {
      mutate((draft) => {
        const index = draft.holdings.findIndex((h) => h.id === holdingId);
        const held = draft.holdings[index];
        const def = held ? assetById(held.defId) : null;
        const proceeds = sellAsset(draft, holdingId);
        if (!proceeds || !def) return;
        recordTap(draft, { t: "sell-asset", index });
        return `You sell ${def.name}. The money comes back; the thing does not.`;
      });
    },
    [mutate],
  );

  const transferToBrokerage = useCallback(
    (amountUsd: number) => {
      mutate((draft) => {
        const moved = transferToBrokerageAmount(draft, amountUsd);
        if (moved <= 0) return;
        // The amount ASKED for, not the amount that fitted. The replay clamps
        // the same way against its own cash, so recording the clamped figure
        // would clamp it twice on any run the replay disagreed with by a cent.
        recordTap(draft, { t: "transfer", amountUsd });
      });
    },
    [mutate],
  );

  /*
   * ── Why a trade records a MINUTE ─────────────────────────────────────────
   *
   * `priceAt(ticker, minute)` is a pure function of ticker and minute since
   * epoch — that is the whole design of RobinGhood, and it means the fill can
   * be recomputed from the clock rather than believed from the client. A tape
   * that carried a price would let anyone claim they bought FINN at $0.01.
   */
  const buyStock = useCallback(
    (symbol: string, shares: number) => {
      mutate((draft) => {
        const minute = minuteOf();
        if (!buyStockAt(draft, symbol, shares, minute)) return;
        recordTap(draft, { t: "trade", side: "buy", symbol, qty: shares, minute });
      });
    },
    [mutate],
  );

  const sellStock = useCallback(
    (symbol: string, shares: number) => {
      mutate((draft) => {
        const minute = minuteOf();
        if (!sellStockAt(draft, symbol, shares, minute)) return;
        recordTap(draft, { t: "trade", side: "sell", symbol, qty: shares, minute });
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
    if (state) recordLegacyOnce(state, state.alive);
    // Tape before clearRun, and named, for the reason abandonRun states.
    clearTape(islandRef.current);
    clearRun(islandRef.current);
    setIslands(listIslands());
    runRef.current = null;
    setRun(null);
    setQueue([]);
    setYearEnd(null);
    setAutopsy(null);
    setPerform(null);
    setAtGate(false);
    setTierUnlock(null);
  }, []);

  /**
   * Open a different company.
   *
   * The order here is the whole function, and each step is load-bearing:
   *
   *  1. `flushRun` FIRST. `saveRun` coalesces its localStorage write over
   *     120 ms (lib/engine/save.ts), so a switch inside that window would
   *     leave the last decision of the island being left held in a buffer that
   *     the next `saveRun` — for a different company — is about to reuse.
   *  2. Move the pointer BEFORE reading anything. The tape recorder keys off
   *     the open island, and `loadRun`/`loadTable` default to it.
   *  3. Reset every piece of transient state, unconditionally. A decision card,
   *     a year-end statement, an autopsy or a pending pitch belongs to the
   *     company that produced it. Carrying one across would let a player answer
   *     island 0's card with island 2's company.
   */
  const switchIsland = useCallback((slot: number) => {
    if (slot === islandRef.current && runRef.current) return;
    flushRun();

    islandRef.current = slot;
    setIsland(slot);
    setActiveIsland(slot);

    setQueue([]);
    setMarketId(null);
    setYearEnd(null);
    setPortfolioYear(null);
    setAutopsy(null);
    setPerform(null);
    setAtGate(false);
    setTierUnlock(null);
    setLastDeltas([]);

    const saved = loadRun(slot);
    if (!saved) {
      runRef.current = null;
      setRun(null);
      setIslands(listIslands());
      return;
    }

    // Same normalisation the boot hydration does, and for the same reason: a
    // save written against the old avatar shape has no gender or tier, and a
    // portrait lookup must not 404 because of which door the run came in by.
    saved.avatar = normalizeAvatar(saved.avatar);
    runRef.current = saved;
    setRun(saved);
    if (!saved.alive) setAutopsy(buildAutopsy(saved));
    if (saved.month >= 12) setAtGate(true);
    const table = loadTable(saved, slot);
    if (table) {
      setQueue(table.cards);
      setMarketId(table.marketId);
      setYearEnd(table.yearEnd);
    }
    setIslands(listIslands());
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
       * used to be deleted without ever being read, which made that activity's
       * entire limited-time-offer mechanic a no-op. It now tags the item, which
       * is what FOOD's spoilage function actually reads. That tagging — and the
       * one-shot consumption of the flag that opened the sheet — is inside
       * `launchLineItemFrom`, shared with the replay.
       */
      const item = launchLineItemFrom(working, input);
      if (!item) return null;
      // Price in cents. A float that round-trips through JSON at a different
      // last digit is a product priced one cent differently in the replay, and
      // a portfolio's revenue is a function of its price.
      recordTap(working, {
        t: "product",
        name: input.name,
        priceCents: Math.round(input.price * 100),
        investTier: input.investTier,
        tags: input.tags,
      });
      working.log.push(
        makeLine(
          working,
          "decision",
          `You put ${item.name} out at ${fmtPrice(item.price)}. Now you find out what it was worth.`,
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
      const index = liveItems(ensurePortfolio(working)).findIndex((i) => i.id === id);
      const gone = retireItem(working, id);
      if (!gone) return;
      recordTap(working, { t: "retire", index });
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
      const index = liveItems(p).findIndex((i) => i.id === id);
      if (!item || !refreshItem(working, id, costS)) return;
      recordTap(working, { t: "refresh", index, costS });
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

  /**
   * The Tank's questions, kept on the run.
   *
   * ── Why this exists ────────────────────────────────────────────────────────
   *
   * The room's no-repeat rule lived entirely in one session's React state, so
   * it was reborn empty at every year gate. A company weak in the same ways two
   * years running therefore got the same questions in the same order, word for
   * word — reported as "year 2 was the exact same flow and questions", and
   * accurately.
   *
   * ── Why the list is capped ────────────────────────────────────────────────
   *
   * A run can survive ten years and every one of these is a whole sentence.
   * Uncapped, a save that has to fit in localStorage beside nine other islands
   * would grow by a paragraph a year for no benefit: the offline shark reads
   * this to sink questions it has used recently, and "recently" past a couple
   * of years is not a distinction anybody can hear. Newest kept.
   *
   * ── Why it is not part of the tape ────────────────────────────────────────
   *
   * It changes which question is asked and nothing about what anything is
   * worth — no score, no cash, no survival. `recordTap` is for things the
   * verifier has to replay; this is not one of them, and adding it would make
   * every tape carry the room's dialogue for no verification value.
   */
  const rememberPanelQuestions = useCallback(
    (questions: string[]) => {
      const state = runRef.current;
      if (!state || !state.alive) return;
      const fresh = questions.map((q) => q.trim()).filter((q) => q.length > 0);
      if (fresh.length === 0) return;
      const working: RunState = structuredClone(state);
      const merged = [...(working.askedPanelQuestions ?? []), ...fresh];
      working.askedPanelQuestions = merged.slice(-PANEL_MEMORY);
      commit(working);
    },
    [commit],
  );

  const applyColdCall = useCallback(
    (callerId: string, outcome: CallOutcome, transcript = "") => {
      const state = runRef.current;
      if (!state || !state.alive) return;
      const working: RunState = structuredClone(state);

      /*
       * The words, and the day.
       *
       * `judgePitch` prefers a model and falls back to a deterministic local
       * resolver. The model's answer cannot be replayed, so the server
       * re-resolves every cold call locally from this transcript — otherwise a
       * board would rank a run by whether an AI key happened to be deployed on
       * the day it was played, which is Brand Law 4 broken by an environment
       * variable. `lib/leaderboard/replay.ts` explains the trade in full.
       *
       * The date is here because the ration is per REAL day, not per fiscal
       * month: more than three entries sharing one date is a forged tape, and
       * `lib/leaderboard/bounds.ts` checks exactly that.
       */
      recordTap(working, {
        t: "coldcall",
        investorId: callerId,
        transcript,
        atISO: tapeToday(),
      });

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
      // Audit only. Pro decides which candidates and asset classes a player can
      // SEE, so the replay has to apply the same content gates — and it must
      // never decide what any of them are worth. `pro_at_submit` lives on
      // `runs` and reaches no board query, which is what makes §8.3's standing
      // audit a test rather than a hope.
      recordTap(working, { t: "pro", on });
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
   * Both directions, and each for its own reason. Up: a purchase mid-run must
   * open The Room without waiting for the next company. Down: a revoked Pro —
   * an expired gift, an admin revoke, a lapsed subscription — must CLOSE it on
   * the run that is already open; the heartbeat re-adopts entitlements while
   * the tab is up, and this is where that answer reaches the live run. The
   * down leg does not break ProSheet's simulated free switch: that switch
   * flips `run.pro` without writing the entitlement store, so no event fires
   * and nothing here runs until a real entitlement change arrives.
   */
  useEffect(() => {
    const sync = () => {
      const state = runRef.current;
      if (!state) return;
      const entitled = isPro(loadEntitlements());
      if (entitled === state.pro) return;
      setPro(entitled);
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
      if (!isOfferable(activity, state)) return;
      /*
       * A Pro-locked activity is LISTED for a free player — that is the whole
       * point of `pro` as against `available` — so the refusal has to live
       * here as well as on the row. The screen sends a locked press to the
       * paywall and never gets this far; this line is what makes that a
       * choice the screen makes rather than the only thing standing in the
       * way. Without it a locked tap would set `open_the_room` and write an
       * `{ t: "activity" }` entry onto a tape the verifier would then reject.
       */
      if (isLocked(activity, state)) return;
      const working: RunState = structuredClone(state);
      activity.apply(working);
      // Activities spend resources and never advance time, but they absolutely
      // reach the books — `apply` runs effects through the same seeded RNG the
      // events do. A tape without them replays a different company.
      recordTap(working, { t: "activity", id });
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
      island,
      islands,
      switchIsland,
      startRun,
      advance,
      choose,
      dismissCard,
      openYearGate,
      skipYearGate,
      cancelPerform,
      submitPerform,
      chooseAllocation,
      closeYearEnd,
      setRookieMode,
      markTermSeen,
      advanceTutorial,
      retireRun,
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
      rememberPanelQuestions,
      clearFlag,
      launchLineItem,
      retireLineItem,
      refreshLineItem,
      portfolioYear,
      setPro,
    }),
    [
      hydrated, run, profile, queue, marketId, yearEnd, autopsy, perform, atGate, busy,
      island, islands, switchIsland,
      startRun, advance, choose, dismissCard, openYearGate, skipYearGate, cancelPerform, submitPerform,
      chooseAllocation, closeYearEnd, setRookieMode, markTermSeen,
      advanceTutorial, retireRun, abandonRun, saveProfileFields, choicesFor, runActivity,
      hire, fire, buyHolding, sellHolding, buyStock, sellStock,
      transferToBrokerage, setAvatar, setFounderName, setCompanyName, endRun, markMailRead, setPro, lastDeltas, tierUnlock, dismissTierUnlock,
    ],
  );

  useEffect(() => {
    setBusy(false);
  }, [run]);

  /*
   * The company, as the phone shows it when this app is shut.
   *
   * Here rather than on the play screen because this provider is the only
   * place that holds both the open run and the archipelago, and because a
   * company founded on `/found` would otherwise be invisible on the lock
   * screen until its first tap. One publish per change, coalesced and
   * de-duplicated in lib/outside/publish.ts; a no-op everywhere but iOS.
   */
  useOutside(run, island, islands);

  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error("useGame must be used inside <GameProvider>");
  return ctx;
}
