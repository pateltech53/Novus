"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

import { Boat } from "@/components/Boat";
import { IslandGlyph } from "@/components/IslandGlyph";
import { SEA_POSITIONS, Sea } from "@/components/Sea";
import { ENTER, SETTLE_SPRING, STAGGER, SWAP } from "@/components/ui/Motion";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";
import { INDUSTRIES, STAGE_NAME } from "@/lib/engine/constants";
import { fmtMoney } from "@/lib/engine/format";
import type { IslandSummary } from "@/lib/engine/save";
import type { StageNum } from "@/lib/engine/types";
import {
  ISLAND_CAP,
  islandCapFor,
  isPro,
  loadEntitlements,
  onEntitlementsChange,
  runsRemainingToday,
} from "@/lib/monetization";
import { useNavigating } from "@/lib/navigating";
import { usePrefetch } from "@/lib/prefetch";
import { play } from "@/lib/sound";
import { GameProvider, useGame } from "@/lib/state/GameProvider";

export default function IslandsPageWrapper() {
  return (
    <GameProvider>
      <IslandsPage />
    </GameProvider>
  );
}

/**
 * The archipelago — every company this player has, on one screen.
 *
 * ── Why this screen exists ─────────────────────────────────────────────────
 *
 * Until islands, "which company am I playing" was not a question the app could
 * ask, because the answer could only ever be "the one". `/found` carried the
 * whole burden instead: it was the new-company form, the resume card, the
 * replace confirmation AND the paywall, and founding a second company meant
 * destroying the first one behind a two-tap confirm.
 *
 * So this is the front door now, and `/found` goes back to being one thing.
 *
 * ── Two views, and why it is not one ───────────────────────────────────────
 *
 * **The sea** answers "what have I got?" — every island on the water at once,
 * where their number, their size and their state are the whole message and no
 * figure is worth the space it would take.
 *
 * **The gallery** answers "how is this one doing?" — one island, large, its
 * books beside it, and ‹ › to walk the row.
 *
 * A single view has to choose, and every version that chose lost something. A
 * grid of full cards buries the archipelago in numbers by the fourth company;
 * a map with the numbers on it IS that grid. So: two views, one tap apart,
 * with the sea as the door — because "what have I got" is the question a
 * player arrives with.
 *
 * ── The four states of an island ───────────────────────────────────────────
 *
 *   · **Open** — a company still going. Tap it and play.
 *   · **Headstone** — Chapter 7, acquired, or listed. It keeps its island and
 *     its books stay readable, and it does NOT spend the allowance. A free
 *     tier whose two islands fill with two graves is a game that politely
 *     stops, which is a limit designed to sell something rather than to mean
 *     something. `slotForNewCompany` and 0012's `enforce_island_cap` both
 *     count the living only.
 *   · **Empty** — room under the allowance. Founds a company.
 *   · **Locked** — beyond the allowance. Says what would open it, once.
 *
 * Every figure is read from `IslandSummary`, which mirrors what `saves`'
 * listing cache holds server-side — so ten companies cost an index read rather
 * than ten RunState parses.
 */
function IslandsPage() {
  const router = useRouter();
  const game = useGame();
  const upgrade = useUpgrade();

  /* Entitlements are read after mount and re-read on every write. Buying an
     island happens without leaving this screen, and reading once would leave
     the player staring at the locked island they just paid to open. */
  const [cap, setCap] = useState(2);
  const [pro, setPro] = useState(false);
  const [foundingsLeft, setFoundingsLeft] = useState<number | null>(null);
  useEffect(() => {
    const sync = () => {
      const e = loadEntitlements();
      setCap(islandCapFor(e));
      setPro(isPro(e));
      setFoundingsLeft(runsRemainingToday(e));
    };
    sync();
    return onEntitlementsChange(sync);
  }, []);

  const [opening, open] = useNavigating();
  usePrefetch("/play");
  usePrefetch("/found");

  /** null = the sea. A slot number = that island, alone, in the gallery. */
  const [focus, setFocus] = useState<number | null>(null);
  /** Which way the last ‹ › went, so the gallery slides the right way. */
  const [dir, setDir] = useState(1);

  const islands = game.islands;
  const living = islands.filter((i) => i.alive);
  const canFound = living.length < cap;

  /*
   * How many places to draw, and the three things that decide it.
   *
   * Places are POSITIONAL — place N is island N, at SEA_POSITIONS[N] — so this
   * cannot be a count of what exists. An island in slot 5 with 0–4 empty still
   * needs six places, or it simply is not on the water.
   *
   *  1. Every occupied slot, headstones included. The allowance counts only
   *     the living, so graves are extra rather than instead — and a grave that
   *     pushed a running company off the map would be the worst version of
   *     this screen.
   *  2. At least two places while there is room, so the sea reads as an
   *     archipelago on the first visit rather than as one shape and a title.
   *  3. Exactly one more — an empty place to found on, or a locked one to say
   *     where the water ends. One: a Pro player with two companies wants their
   *     two companies, not eight dotted circles floating behind them.
   */
  const bySlot = new Map(islands.map((i) => [i.slot, i]));
  const occupiedThrough = islands.reduce((n, i) => Math.max(n, i.slot + 1), 0);
  const base = Math.max(occupiedThrough, canFound ? 2 : 0);
  const extra = canFound ? (base === occupiedThrough ? 1 : 0) : pro ? 0 : 1;
  const places = Math.min(ISLAND_CAP, base + extra);

  const enter = useCallback(
    (slot: number) => {
      play("click");
      open(() => {
        game.switchIsland(slot);
        router.push("/play");
      });
    },
    [game, open, router],
  );

  const found = (slot: number) => {
    play("click");
    // /found reads the slot back out of the query, so a player who tapped a
    // specific empty place founds THERE rather than wherever the default lands.
    open(() => router.push(`/found?island=${slot}`));
  };

  /* ‹ › walk the islands that exist, in slot order, and wrap. Wrapping because
     the row is short and a disabled arrow at each end is two dead controls on
     a screen that only has four live ones. */
  const step = useCallback(
    (by: number) => {
      setFocus((at) => {
        if (at === null || islands.length < 2) return at;
        const i = islands.findIndex((is) => is.slot === at);
        if (i < 0) return at;
        play("click");
        setDir(by);
        return islands[(i + by + islands.length) % islands.length].slot;
      });
    },
    [islands],
  );

  /* The gallery is a view, not a route, so it answers the keyboard the way
     every other overlay in this app does. */
  useEffect(() => {
    if (focus === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setFocus(null);
      else if (e.key === "ArrowLeft") step(-1);
      else if (e.key === "ArrowRight") step(1);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, step]);

  const focused = focus === null ? null : (bySlot.get(focus) ?? null);

  return (
    /*
     * The water is the page, edge to edge — no column, no panel, no corners.
     * `overflow-hidden` because an island near the margin hangs its label past
     * the safe area on a narrow phone, and a horizontal scrollbar on the front
     * door is the least forgivable place to have one.
     */
    <main className="relative min-h-dvh w-full overflow-hidden">
      <Sea className="pointer-events-none absolute inset-0 h-full w-full" />

      <AnimatePresence mode="wait" initial={false}>
        {focused ? (
          <Gallery
            key="gallery"
            island={focused}
            dir={dir}
            index={islands.findIndex((i) => i.slot === focused.slot)}
            total={islands.length}
            busy={opening}
            onStep={step}
            onBack={() => setFocus(null)}
            onEnter={() => enter(focused.slot)}
          />
        ) : (
          <motion.div
            key="sea"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={SWAP}
            className="absolute inset-0"
          >
            {/*
              The title, ON the water rather than above it. `pointer-events-
              none` so it never swallows a tap meant for an island drifting
              underneath it — nothing here is tappable.
            */}
            <header className="pointer-events-none absolute inset-x-0 top-0 z-10 px-6 pt-[max(1.5rem,env(safe-area-inset-top))]">
              <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
                YOUR ISLANDS
              </p>
              <h1 className="mt-1 max-w-[15ch] text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em] sm:max-w-none">
                {living.length === 0
                  ? "Nothing running yet."
                  : living.length === 1
                    ? "One company on the water."
                    : `${living.length} companies, all yours.`}
              </h1>
            </header>

            {/*
              ── The islands ─────────────────────────────────────────────────
              Positioned in PERCENTAGES of the whole screen, inside a column
              that is capped on a desktop. Uncapped, ten islands on a 2560px
              monitor would be ten specks against a mile of empty water; capped,
              the archipelago stays an archipelago and the extra width is the
              ocean it is in, which is the point.
            */}
            <div className="absolute inset-0">
              <div className="relative mx-auto h-full w-full max-w-3xl">
              {Array.from({ length: places }, (_, slot) => {
                const spot = SEA_POSITIONS[slot];
                const island = bySlot.get(slot);
                return (
                  <motion.div
                    key={slot}
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ ...ENTER, delay: slot * STAGGER }}
                    className="absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center"
                    style={{ left: `${spot.x}%`, top: `${spot.y}%` }}
                  >
                    {island ? (
                      <SeaIsland
                        island={island}
                        depth={spot.depth}
                        current={slot === game.island}
                        onOpen={() => {
                          play("click");
                          setDir(1);
                          setFocus(slot);
                        }}
                      />
                    ) : canFound ? (
                      <SeaEmpty
                        slot={slot}
                        depth={spot.depth}
                        busy={opening}
                        onFound={() => found(slot)}
                      />
                    ) : (
                      <SeaLocked depth={spot.depth} onAsk={() => upgrade.open("islands")} />
                    )}
                  </motion.div>
                );
              })}
              </div>
            </div>

            {/*
              ── The small print, in a boat ──────────────────────────────────
              Everything on this screen that is not an island lives here. Two
              sentences at most, and the second only when a limit is actually
              in the way: the island cap and the daily founding ration are
              DIFFERENT limits answered by different things — Pro or burying
              one, versus tomorrow — and a screen that says "you have hit the
              limit" without saying which is how a player buys the wrong fix.
            */}
            <div className="pointer-events-none absolute inset-x-0 bottom-[max(1.75rem,env(safe-area-inset-bottom))] z-10 flex justify-center px-6">
              <Boat className="nv-bob pointer-events-auto max-w-[22rem]">
                <p className="text-2xs leading-relaxed text-[var(--text-secondary)]">
                  {pro ? `Up to ${ISLAND_CAP} at once.` : `${cap} at once on free.`} Each
                  island keeps its own year and its own books.
                </p>
                {canFound && foundingsLeft === 0 && (
                  <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
                    Room for another, but that is one founding a day on free and
                    today&rsquo;s is spent.
                  </p>
                )}
                {!canFound && !pro && (
                  <button
                    type="button"
                    onClick={() => upgrade.open("islands")}
                    className="mt-1 block w-full text-2xs leading-snug"
                  >
                    <span className="whitespace-nowrap font-bold text-[var(--color-prestige)] underline underline-offset-4">
                      See what Pro adds
                    </span>
                  </button>
                )}
              </Boat>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </main>
  );
}

// ── On the water ─────────────────────────────────────────────────────────────

/**
 * The label under an island.
 *
 * Absolutely positioned and centred, so a long company name grows in both
 * directions from the island rather than shoving it sideways — every island on
 * this scene is placed by its centre and the name must not move it.
 */
function Label({
  title,
  sub,
  muted,
  dot,
}: {
  title: string;
  sub: string;
  muted?: boolean;
  dot?: boolean;
}) {
  return (
    <span className="absolute top-full left-1/2 flex w-[13ch] -translate-x-1/2 flex-col items-center pt-0.5">
      <span
        className={`max-w-full truncate text-xs font-extrabold leading-tight tracking-[-0.01em] ${
          muted ? "text-[var(--text-secondary)]" : ""
        }`}
      >
        {title}
      </span>
      <span className="flex items-center gap-1 text-[0.5rem] font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
        {dot && (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-[var(--radius-pill)] bg-[var(--action)]"
          />
        )}
        {sub}
      </span>
    </span>
  );
}

const BASE_SIZE = 116;

function SeaIsland({
  island,
  depth,
  current,
  onOpen,
}: {
  island: IslandSummary;
  depth: number;
  current: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="nv-press relative flex flex-col items-center"
      /* The whole island is the target and it is bigger than 44px at every
         depth on this scene, so no minimum is forced — forcing one would put an
         invisible rectangle over the water beside the small far islands. */
    >
      {/*
        The bob lives on a WRAPPER, never on the glyph and never on the
        positioned parent: Framer owns the transform on the entrance, CSS owns
        it here, and an element with both loses whichever wrote it first.

        Phase and period are derived from the island itself. Ten islands on one
        4.5s cycle is a raft, and a raft is the one thing an archipelago must
        not look like. The far ones ride shallower for the same reason they are
        drawn smaller.
      */}
      <span
        className="nv-bob block"
        style={
          {
            "--nv-bob-rise": `${(2.5 * depth).toFixed(2)}px`,
            "--nv-bob-dur": `${(4.2 + (island.slot % 4) * 0.55).toFixed(2)}s`,
            "--nv-bob-delay": `${(island.slot % 5) * 320}ms`,
          } as CSSProperties
        }
      >
        <IslandGlyph
          stage={clampStage(island.stage)}
          alive={island.alive}
          seed={island.seed}
          size={Math.round(BASE_SIZE * depth)}
        />
      </span>
      <Label
        title={island.companyName}
        muted={!island.alive}
        sub={island.alive ? (current ? "OPEN NOW" : `YEAR ${island.year}`) : "ENDED"}
        /* The one spot of colour on the whole scene, and it marks exactly one
           thing: where you left off. A bar under the island read as a
           highlighter pen; a dot beside the word it qualifies reads as a
           status light, which is what it is. */
        dot={current && island.alive}
      />
    </button>
  );
}

function SeaEmpty({
  slot,
  depth,
  busy,
  onFound,
}: {
  slot: number;
  depth: number;
  busy: boolean;
  onFound: () => void;
}) {
  const size = Math.round(BASE_SIZE * depth);
  return (
    <button
      type="button"
      onClick={onFound}
      disabled={busy}
      className="nv-press relative flex flex-col items-center disabled:opacity-60"
    >
      {/* The same footprint an island would take, so founding one does not
          shuffle the scene — the shape changes, the composition does not. */}
      <span
        aria-hidden
        className="flex items-end justify-center pb-[14%]"
        style={{ width: size, height: size * 0.72 }}
      >
        <span
          className="flex items-center justify-center rounded-[var(--radius-pill)] border border-dashed border-[var(--n-6)] leading-none text-[var(--text-tertiary)]"
          style={{ width: size * 0.36, height: size * 0.36, fontSize: size * 0.18 }}
        >
          +
        </span>
      </span>
      <Label title="Found one" sub={`ISLAND ${slot + 1}`} />
    </button>
  );
}

function SeaLocked({ depth, onAsk }: { depth: number; onAsk: () => void }) {
  const size = Math.round(BASE_SIZE * depth);
  return (
    <button
      type="button"
      onClick={onAsk}
      className="nv-press relative flex flex-col items-center opacity-70"
    >
      <span
        aria-hidden
        className="flex items-end justify-center pb-[14%]"
        style={{ width: size, height: size * 0.72 }}
      >
        <span
          className="flex items-center justify-center rounded-[var(--radius-pill)] border border-[var(--n-6)] text-[var(--text-tertiary)]"
          style={{ width: size * 0.36, height: size * 0.36 }}
        >
          <LockGlyph />
        </span>
      </span>
      <Label title="Another island" sub={`PRO RUNS ${ISLAND_CAP}`} />
    </button>
  );
}

// ── The gallery ──────────────────────────────────────────────────────────────

function Gallery({
  island,
  dir,
  index,
  total,
  busy,
  onStep,
  onBack,
  onEnter,
}: {
  island: IslandSummary;
  dir: number;
  index: number;
  total: number;
  busy: boolean;
  onStep: (by: number) => void;
  onBack: () => void;
  onEnter: () => void;
}) {
  const ending = island.alive ? null : (ENDING[island.endedBy ?? "chapter7"] ?? ENDING.chapter7);
  const many = total > 1;

  return (
    /*
     * Same water as the map — the sea behind this is the page's, not the
     * gallery's, so moving between the two views never swaps the ocean out.
     * A column here rather than edge to edge because this view is reading
     * matter: a books panel the width of a desktop is a spreadsheet.
     */
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={SWAP}
      className="relative mx-auto flex min-h-dvh w-full max-w-lg flex-col px-5 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
    >
      <button
        type="button"
        onClick={onBack}
        className="-ml-1 flex min-h-11 items-center gap-1.5 self-start text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)]"
      >
        <span aria-hidden>◂</span> ALL ISLANDS
      </button>

      {/* ── The island, arrows either side ──────────────────────────────── */}
      <div className="relative mt-1 h-56 w-full sm:h-64">
        <div className="absolute inset-0 flex items-center justify-between gap-1">
          {many ? <Arrow dir={-1} onClick={() => onStep(-1)} /> : <span className="w-11" />}

          {/*
            No `mode="wait"`: the island is the thing being looked at, and
            blanking it for the length of an exit before the next one arrives
            reads as a reload. They cross past each other, which is what a
            gallery does.
          */}
          <div className="relative h-full flex-1 overflow-hidden">
            <AnimatePresence initial={false}>
              {/*
                It drifts in rather than cutting across. A spring rather than a
                duration because an island arriving on water should overshoot a
                little and settle, and `x` alone reads as a slide — the small
                `y` is what turns it into something floating.
              */}
              <motion.div
                key={island.slot}
                initial={{ opacity: 0, x: dir * 110, y: 10 }}
                animate={{ opacity: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, x: dir * -110, y: 10 }}
                transition={SETTLE_SPRING}
                className="absolute inset-0 flex items-center justify-center"
              >
                <span
                  className="nv-bob block"
                  style={
                    {
                      "--nv-bob-rise": "5px",
                      "--nv-bob-dur": "5s",
                    } as CSSProperties
                  }
                >
                  <IslandGlyph
                    stage={clampStage(island.stage)}
                    alive={island.alive}
                    seed={island.seed}
                    size={188}
                  />
                </span>
              </motion.div>
            </AnimatePresence>
          </div>

          {many ? <Arrow dir={1} onClick={() => onStep(1)} /> : <span className="w-11" />}
        </div>
      </div>

      {/* Which of them this is. Dots rather than "3 of 5": at ten islands the
          count is the same size as the words, and dots also say WHERE. */}
      {many && (
        <div className="mt-3 flex items-center justify-center gap-1.5">
          {Array.from({ length: total }, (_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-[var(--radius-pill)] ${
                i === index ? "w-4 bg-[var(--text-primary)]" : "w-1.5 bg-[var(--n-6)]"
              }`}
            />
          ))}
        </div>
      )}

      <div className="mt-5 text-center">
        <p
          className="text-2xs font-bold tracking-[0.14em]"
          style={{ color: ending ? ending.tone : "var(--text-tertiary)" }}
        >
          {ending ? ending.label : "RUNNING"}
        </p>
        <h1 className="mt-1 truncate text-[1.625rem] font-extrabold leading-tight tracking-[-0.02em]">
          {island.companyName}
        </h1>
        <p className="mt-1 text-xs text-[var(--text-tertiary)]">
          {industryName(island.industry)} · {STAGE_NAME[clampStage(island.stage)]} ·{" "}
          {island.alive
            ? `Year ${island.year}, ${MONTHS[clampMonth(island.month) - 1]}`
            : `${island.year} ${island.year === 1 ? "year" : "years"} survived`}
        </p>
      </div>

      {/*
        The books. Content, so an opaque shadowed panel and never glass, and
        every figure at full ink — design.md's "money is read at full strength"
        is a legibility floor rather than a taste setting.
        
        Deliberately NOT a boat. The small print on the map is one line and can
        afford to be scenery; this is six figures a player is reading, and a
        curved hull under a number column would cost legibility to make a joke.
        It floats by sitting HIGHER instead: `--e3` rather than `--e1`, which
        is the shadow the app gives a sheet, so the panel reads as an object
        resting above the water rather than a section painted onto it. Still,
        while the island above it bobs — a table of numbers that moves is a
        table you read twice.
      */}
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-4 rounded-[var(--radius-sheet)] bg-[var(--surface)] p-5 shadow-[var(--e3)]">
        <Figure
          label={island.alive ? "VALUATION" : "PEAK VALUATION"}
          value={fmtMoney(island.alive ? island.valuation : island.peakValuation)}
          strong
        />
        <Figure
          label={island.alive ? "PEAK" : "AT THE END"}
          value={fmtMoney(island.alive ? island.peakValuation : island.valuation)}
          strong
        />
        <Figure label="CASH" value={fmtMoney(island.cash)} />
        <Figure label="REVENUE / YEAR" value={fmtMoney(island.revenueAnnual)} />
        <Figure label="TEAM" value={`${island.employees}`} />
        <Figure label="LAST PLAYED" value={lastPlayed(island.savedAt) || "—"} />
      </dl>

      <div className="mt-auto w-full pt-6">
        <button
          type="button"
          onClick={onEnter}
          disabled={busy}
          className="nv-gc w-full truncate rounded-[var(--radius-card)] nv-t-action px-5 py-4 text-base font-extrabold tracking-[0.06em] disabled:cursor-not-allowed disabled:opacity-35"
        >
          {busy ? "OPENING…" : island.alive ? "CONTINUE ▸" : "READ THE BOOKS ▸"}
        </button>
      </div>
    </motion.div>
  );
}

function Arrow({ dir, onClick }: { dir: number; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={dir < 0 ? "Previous island" : "Next island"}
      /* A control, so it IS the material — design.md's controls row. 44px,
         which is the tap target the rest of the app holds to. */
      className="nv-gc nv-press z-10 flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-pill)] text-lg font-bold text-[var(--text-primary)]"
    >
      <span aria-hidden className="-mt-0.5">
        {dir < 0 ? "‹" : "›"}
      </span>
    </button>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-[0.5625rem] font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
        {label}
      </dt>
      <dd
        className={`tnum truncate text-[var(--text-primary)] ${
          strong ? "text-[1.0625rem] font-extrabold" : "text-sm font-bold"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function LockGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <rect
        x="3.25"
        y="7"
        width="9.5"
        height="6.75"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.4"
      />
      <path d="M5.5 7V5.25a2.5 2.5 0 0 1 5 0V7" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}

const industryName = (code: IslandSummary["industry"]): string =>
  INDUSTRIES.find((i) => i.code === code)?.name ?? code;

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

/** What ended it, in the words the rest of the app uses for each. */
const ENDING: Record<string, { label: string; tone: string }> = {
  chapter7: { label: "CHAPTER SEVEN", tone: "var(--color-alert)" },
  acquired: { label: "ACQUIRED", tone: "var(--color-prestige)" },
  ipo: { label: "WENT PUBLIC", tone: "var(--color-prestige)" },
};

const clampStage = (n: number): StageNum =>
  (Math.min(5, Math.max(1, Math.trunc(n) || 1)) as StageNum);

const clampMonth = (n: number): number => Math.min(12, Math.max(1, Math.trunc(n) || 1));

/**
 * "Last played", from the device clock.
 *
 * Deliberately coarse. `savedAt` comes from the run's own `lastPlayedISO`
 * where it has one — whatever the machine that wrote it thought the day was,
 * and two devices disagree — so this says "yesterday" rather than a timestamp
 * anybody could hold it to. It is never used to decide which copy of a company
 * wins; that is what the per-island rule in lib/cloud/sync.ts is for.
 */
function lastPlayed(savedAt: number): string {
  if (!Number.isFinite(savedAt) || savedAt <= 0) return "";
  const days = Math.floor((Date.now() - savedAt) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return "A while ago";
}
