"use client";

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import type { RunState } from "@/lib/engine/types";
import {
  PITCH_FRAMEWORK,
  briefIsUsable,
  companyMetrics,
  type MetricRow,
} from "@/lib/engine/company-brief";
import { GLOSSARY } from "@/lib/engine/constants";
import { fmtMoney, fmtPct } from "@/lib/engine/format";
import {
  askBounds,
  getPlayerAsk,
  impliedValuation,
  onAskChange,
  setPlayerAsk,
  type PlayerAsk,
} from "@/lib/ai/ask";
import { RookieToggle } from "@/components/ui/RookieToggle";

/**
 * THE NOTES — what a founder would have brought into the room.
 *
 * ── The problem ────────────────────────────────────────────────────────────
 *
 * The Tank asked a teenager to pitch a company from memory. The books lived
 * behind a button on another screen; what the company actually SOLD lived
 * nowhere at all. So the pitch tested recall and improvisation, and a player
 * who blanked on their own churn rate had nothing to do but invent one — which
 * the content scorer then caught them lying about.
 *
 * No founder does this. They walk in with a deck, or cards, or a phone with
 * three numbers on it, and they glance at it. The glance is not cheating; the
 * glance is the job. So the notes are on screen for the whole performance and
 * for the whole panel, and they do not have to be opened.
 *
 * ── Three tabs, and why exactly three ──────────────────────────────────────
 *
 * THE COMPANY  — the founder's own words, from founding. What it is, what makes
 *                it different, why anyone chooses it.
 * THE NUMBERS  — derived live from the books (lib/engine/company-brief.ts), so
 *                nothing here can contradict what the sharks are reading.
 * THE ORDER    — the seven beats, shown so a first-timer knows what comes next.
 *
 * A fourth tab was cut. Anything more is a document, and a document is
 * something you read instead of pitching.
 *
 * ── What it must never become ──────────────────────────────────────────────
 *
 * A script. It holds facts and structure and no sentences to read aloud —
 * generating the player's dialogue is the one line this codebase does not
 * cross. The prompts under each beat are questions, never openers.
 */

type Tab = "company" | "numbers" | "order";

const TABS: { id: Tab; label: string }[] = [
  { id: "company", label: "THE COMPANY" },
  { id: "numbers", label: "THE NUMBERS" },
  { id: "order", label: "THE ORDER" },
];

export function PitchNotes({
  run,
  variant = "panel",
  defaultTab = "numbers",
  className = "",
  onTerm,
  askControl,
}: {
  run: RunState;
  /**
   * "camera" is the compact strip that sits under the live view mid-pitch:
   * dark, tight, readable in peripheral vision. "panel" is the normal surface
   * used in The Tank and anywhere with a light background.
   */
  variant?: "camera" | "panel";
  defaultTab?: Tab;
  className?: string;
  /** Tapping a term with a glossary entry asks the host to explain it. */
  onTerm?: (term: string) => void;
  /**
   * The ask block on THE NUMBERS, when this performance leads to The Tank.
   *
   * "edit" — sliders; the founder sets the amount and the equity, and the card
   *          does the valuation math in front of them. Pre-room only.
   * "locked" — the same numbers, read-only, once the room has heard them. A
   *          slider that still moved mid-questioning would be a lie: the
   *          session was built from the ask as it stood when the doors opened.
   * Absent — no ask block at all, which is every non-pitch performance.
   */
  askControl?: "edit" | "locked";
}) {
  const [tab, setTab] = useState<Tab>(defaultTab);
  // Derived from the books, so it is recomputed rather than remembered — a
  // stale deck is exactly the contradiction this is meant to prevent.
  const metrics = useMemo(() => companyMetrics(run), [run]);
  const brief = run.brief;
  /*
   * `onStage` is the performance screen's colour family, not "dark mode".
   *
   * The first cut of this used literal `text-white` / `bg-white/10`, which is
   * only correct in the dark theme: `.nv-stage` follows the `--n-*` scale, and
   * that scale INVERTS between themes — `--n-11` is near-white on dark and
   * near-black on light. White-on-white is what that produced. The `--n-*`
   * tokens are right on the stage in both themes, and the panel's own
   * `--surface-*` tokens are right everywhere else.
   */
  const onStage = variant === "camera";

  const surface = onStage
    ? "bg-[var(--n-3)] text-[var(--n-11)]"
    : "bg-[var(--surface-elevated)] text-[var(--text-primary)]";
  const muted = onStage ? "text-[var(--n-7)]" : "text-[var(--text-tertiary)]";
  const body = onStage ? "text-[var(--n-9)]" : "text-[var(--text-secondary)]";
  /*
   * Reading size on stage, dense in the room.
   *
   * The camera variant was 12px throughout — the floor, spent on the words a
   * founder is actively pitching from — because the live view once owned the
   * whole screen and these notes were a strip at the bottom of it. The camera
   * is a picture-in-picture now and the notes ARE the screen, so they read at
   * body size. The panel keeps its density: in The Tank the notes share the
   * room with the sharks, and there they really are the glanced-at card.
   */
  const bodySize = onStage ? "text-sm" : "text-2xs";

  return (
    <section
      className={`overflow-hidden rounded-[var(--radius-card)] ${surface} ${className}`}
      aria-label="Your notes"
    >
      <div className="flex gap-1 border-b border-[var(--hairline)] px-2 pt-2 pb-2">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            aria-pressed={tab === t.id}
            className={`nv-gc flex-1 rounded-[var(--radius-pill)] px-2 py-1.5 text-2xs font-extrabold tracking-[0.08em] ${
              tab === t.id
                ? onStage
                  ?"bg-[var(--n-5)]"
                  : "text-[var(--text-primary)]"
                : muted
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/*
        Sized in viewport units rather than fixed rem, so the card holds its
        share of a phone and stops wasting a laptop.

        The stage cap was a quarter of the screen when the live view owned the
        rest — every pixel here came off the founder's own face. The camera is
        a picture-in-picture now, so the trade has reversed: these notes are
        what the screen is FOR while pitching, and they take the reading share
        of it. The room keeps its third — there the sharks own the rest.
      */}
      <div
        className={`overflow-y-auto px-3 pb-3 pt-2.5 ${
          onStage ? "max-h-[42vh] min-h-[10rem]" : "max-h-[38vh] min-h-[14rem]"
        }`}
      >
        {tab === "company" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2.5">
            {briefIsUsable(brief) ? (
              <>
                {brief!.companyType && (
                  <p className={`text-2xs font-bold tracking-[0.12em] ${muted}`}>
                    {run.companyName.toUpperCase()} · {brief!.companyType.toUpperCase()}
                  </p>
                )}
                {brief!.whatItDoes && (
                  <NoteLine label="What it does" text={brief!.whatItDoes} muted={muted} body={body} size={bodySize} />
                )}
                {brief!.usp && (
                  <NoteLine label="What makes it different" text={brief!.usp} muted={muted} body={body} size={bodySize} />
                )}
                {brief!.whyCustomers && (
                  <NoteLine
                    label="Why they choose you"
                    text={brief!.whyCustomers}
                    muted={muted}
                    body={body}
                    size={bodySize}
                  />
                )}
                {brief!.mission && (
                  <NoteLine label="What it is for" text={brief!.mission} muted={muted} body={body} size={bodySize} />
                )}
              </>
            ) : (
              /*
               * A run founded before the brief existed, or one founded in a
               * hurry. Say what is missing and where it would have come from,
               * rather than showing an empty box that reads as broken.
               */
              <p className={`${bodySize} leading-snug ${body}`}>
                You didn&rsquo;t write a brief when you founded {run.companyName}, so
                there&rsquo;s nothing here but the numbers. Next company, fill in what
                it does and what makes it different — you get asked both, every time.
              </p>
            )}
          </motion.div>
        )}

        {tab === "numbers" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2.5">
            {askControl && (
              <AskBlock
                run={run}
                locked={askControl === "locked"}
                onStage={onStage}
                muted={muted}
                body={body}
              />
            )}
            <Rows rows={metrics.traction} onStage={onStage} onTerm={onTerm} rookie={run.rookieMode} />
            <div className="border-t border-[var(--hairline)] pt-2">
              <Rows rows={metrics.benchmarks} onStage={onStage} onTerm={onTerm} rookie={run.rookieMode} />
            </div>
            <div className="border-t border-[var(--hairline)] pt-2">
              <Rows rows={metrics.market} onStage={onStage} onTerm={onTerm} rookie={run.rookieMode} />
            </div>
            {/* The books themselves, so the deck and the P&L are one glance
                apart. Claiming a margin the accounts contradict is the single
                most expensive thing a player can do in this room. */}
            <div
              className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--hairline)] pt-2"
            >
              <Inline label="Cash" value={fmtMoney(run.stats.cash)} muted={muted} size={bodySize} />
              <Inline
                label="Burn/mo"
                value={
                  run.stats.burnMonthly <= 0
                    ? `+${fmtMoney(-run.stats.burnMonthly)}`
                    : fmtMoney(run.stats.burnMonthly)
                }
                muted={muted}
                size={bodySize}
              />
              <Inline label="Revenue/yr" value={fmtMoney(run.stats.revenueAnnual)} muted={muted} size={bodySize} />
              <Inline label="You own" value={fmtPct(run.founderEquityPct)} muted={muted} size={bodySize} />
            </div>
            {metrics.competitors.length > 0 && (
              <div className="border-t border-[var(--hairline)] pt-2">
                <p className={`text-2xs font-bold tracking-[0.12em] ${muted}`}>WHO ELSE DOES THIS</p>
                <ul className="mt-1 space-y-1">
                  {metrics.competitors.map((c) => (
                    <li key={c.name} className={`${bodySize} leading-snug ${body}`}>
                      <span className="font-bold">{c.name}</span> · {c.angle} · {c.scale}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/*
              Rookie Mode, right where it earns its keep. The switch also lives
              in Settings, but the moment a player realises they need the plain
              lines is the moment a number on THIS card stops making sense —
              sending them to another screen mid-pitch to find it is how the
              option goes unused.
            */}
            <div className="border-t border-[var(--hairline)] pt-2">
              <RookieToggle />
            </div>
          </motion.div>
        )}

        {tab === "order" && (
          <motion.ol initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-1.5">
            {PITCH_FRAMEWORK.map((beat) => (
              <li key={beat.n} className="flex gap-2.5">
                <span
                  className={`tnum mt-[0.1rem] shrink-0 text-2xs font-extrabold ${muted}`}
                >
                  {beat.n}
                </span>
                <span className="min-w-0">
                  <span className={`block font-bold leading-snug ${onStage ? "text-sm" : "text-xs"}`}>
                    {beat.title}
                  </span>
                  <span className={`block ${bodySize} leading-snug ${muted}`}>{beat.prompt}</span>
                </span>
              </li>
            ))}
          </motion.ol>
        )}
      </div>
    </section>
  );
}

/**
 * THE ASK — two sliders and the arithmetic they imply, done in the open.
 *
 * The amount and the equity are the founder's to set (`lib/ai/ask.ts`; the
 * panel reads the same store when the room convenes). The third line is the
 * whole reason this is on the numbers card rather than buried in a form:
 * amount ÷ equity is the price you just put on the company, and watching that
 * number move while you drag is how the relationship stops being abstract.
 */
function AskBlock({
  run,
  locked,
  onStage,
  muted,
  body,
}: {
  run: RunState;
  locked: boolean;
  onStage: boolean;
  muted: string;
  body: string;
}) {
  const bounds = useMemo(() => askBounds(run), [run]);
  const [ask, setAsk] = useState<PlayerAsk>(() => getPlayerAsk(run));
  // The store is the truth (the panel reads it directly); this state is just
  // React's view of it, refreshed on any write from any mount of this card.
  useEffect(() => {
    setAsk(getPlayerAsk(run));
    return onAskChange(() => setAsk(getPlayerAsk(run)));
  }, [run]);

  const implied = impliedValuation(ask);
  const value = onStage ? "text-[var(--n-11)]" : "text-[var(--text-primary)]";

  return (
    <div className="border-b border-[var(--hairline)] pb-2.5">
      <p className={`text-2xs font-bold tracking-[0.12em] ${muted}`}>
        {locked ? "YOUR ASK · ON THE TABLE" : "YOUR ASK · YOU DECIDE THIS"}
      </p>

      {locked ? (
        <p className={`tnum mt-1 text-sm font-bold ${value}`}>
          {fmtMoney(ask.amountUsd)} for {ask.equityPct}%
        </p>
      ) : (
        <>
          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <span className={`${onStage ? "text-sm" : "text-2xs"} ${body}`}>Raising</span>
            <span className={`tnum shrink-0 font-bold ${onStage ? "text-sm" : "text-xs"} ${value}`}>
              {fmtMoney(ask.amountUsd)}
            </span>
          </div>
          <input
            type="range"
            aria-label="How much you are asking for"
            min={bounds.minUsd}
            max={bounds.maxUsd}
            step={bounds.stepUsd}
            value={ask.amountUsd}
            onChange={(e) => setPlayerAsk(run, { ...ask, amountUsd: Number(e.target.value) })}
            className="mt-1 block h-6 w-full cursor-pointer accent-[var(--action)]"
          />

          <div className="mt-1.5 flex items-baseline justify-between gap-3">
            <span className={`${onStage ? "text-sm" : "text-2xs"} ${body}`}>
              For this slice of the company
            </span>
            <span className={`tnum shrink-0 font-bold ${onStage ? "text-sm" : "text-xs"} ${value}`}>
              {ask.equityPct}%
            </span>
          </div>
          <input
            type="range"
            aria-label="The equity percentage you are offering"
            min={bounds.minPct}
            max={bounds.maxPct}
            step={bounds.stepPct}
            value={ask.equityPct}
            onChange={(e) => setPlayerAsk(run, { ...ask, equityPct: Number(e.target.value) })}
            className="mt-1 block h-6 w-full cursor-pointer accent-[var(--action)]"
          />
        </>
      )}

      {/* The claim those two numbers make, with the division shown. The sharks
          are handed exactly this figure and will hold you to it. */}
      <p className={`tnum mt-1.5 text-2xs leading-snug ${body}`}>
        {fmtMoney(ask.amountUsd)} ÷ {ask.equityPct}% — you&rsquo;re saying {run.companyName} is
        worth <span className={`font-bold ${value}`}>{fmtMoney(implied)}</span>.
      </p>
      {!locked && (
        <p className={`mt-0.5 text-2xs leading-snug ${muted}`}>
          The panel sees this ask, and they&rsquo;ve read your books.
        </p>
      )}
    </div>
  );
}

function NoteLine({
  label,
  text,
  muted,
  body,
  size = "text-2xs",
}: {
  label: string;
  text: string;
  muted: string;
  body: string;
  /** The body line's type size — reading size on stage, dense in the room. */
  size?: string;
}) {
  return (
    <div>
      <p className={`text-2xs font-bold tracking-[0.12em] ${muted}`}>{label.toUpperCase()}</p>
      <p className={`mt-0.5 ${size} leading-snug ${body}`}>{text}</p>
    </div>
  );
}

function Rows({
  rows,
  onStage,
  onTerm,
  rookie = false,
}: {
  rows: MetricRow[];
  onStage: boolean;
  onTerm?: (term: string) => void;
  /** Rookie Mode: a plain-English line under every figure. The term stays. */
  rookie?: boolean;
}) {
  return (
    <dl className="space-y-1">
      {rows.map((row) => {
        // Only offer the explanation where one genuinely exists — a tappable
        // row that does nothing is worse than a plain one.
        const explainable = Boolean(row.term && GLOSSARY[row.term] && onTerm);
        const tone =
          row.tone === "good"
            ? "text-[var(--solvency)]"
            : row.tone === "bad"
              ? "text-[var(--alert)]"
              : onStage
                ? "text-[var(--n-11)]"
                : "text-[var(--text-primary)]";
        /*
         * The plain line, per the Rookie Mode contract everywhere else: the
         * glossary's rookie gloss where the row names a term, the row's own
         * note otherwise — that note is already written in plain English and
         * already about THIS company's figure, which beats a generic gloss.
         */
        const plain = rookie
          ? (row.term && GLOSSARY[row.term]?.rookie) || row.note
          : null;
        return (
          <div
            key={row.label}
            className="flex items-baseline justify-between gap-3"
            onClick={explainable ? () => onTerm!(row.term!) : undefined}
            role={explainable ? "button" : undefined}
            tabIndex={explainable ? 0 : undefined}
            onKeyDown={
              explainable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") onTerm!(row.term!);
                  }
                : undefined
            }
          >
            <dt
              className={`min-w-0 leading-snug ${onStage ? "text-sm" : "text-2xs"} ${
                onStage ? "text-[var(--n-8)]" : "text-[var(--text-secondary)]"
              }`}
            >
              {row.label}
              {explainable && (
                <span className={onStage ? "text-[var(--n-7)]" : "text-[var(--text-tertiary)]"}>
                  {" "}?
                </span>
              )}
              {plain && (
                <span
                  className={`block text-2xs leading-snug ${
                    onStage ? "text-[var(--n-7)]" : "text-[var(--text-tertiary)]"
                  }`}
                >
                  {capitalise(plain)}
                </span>
              )}
            </dt>
            <dd className={`tnum shrink-0 font-bold ${onStage ? "text-sm" : "text-xs"} ${tone}`}>
              {row.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

/** "money in the bank right now." → "Money in the bank right now." */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Inline({
  label,
  value,
  muted,
  size = "text-2xs",
}: {
  label: string;
  value: string;
  muted: string;
  size?: string;
}) {
  return (
    <span className={size}>
      <span className={`font-bold ${muted}`}>{label} </span>
      <span className="tnum font-bold">{value}</span>
    </span>
  );
}
