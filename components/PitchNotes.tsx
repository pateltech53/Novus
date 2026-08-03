"use client";

import { useMemo, useState } from "react";
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
        Shorter over the camera than in the room, but no longer a letterbox.

        8rem on stage and 14rem in the room was about five rows and eight. The
        Numbers tab alone is longer than that, so the card cut off mid-figure
        and the answer to "what was my churn" was behind a scroll inside a box
        the size of a stamp — during a timed pitch, which is exactly when nobody
        can afford to go looking for it.

        The trade the old comment describes is real: every pixel here comes off
        the founder's own face on the camera screen. So it is sized in viewport
        units rather than fixed rem — a quarter of the screen while pitching, a
        third in the room — which holds that trade on a phone and stops wasting
        the space on a laptop, where the old fixed height was absurd.
      */}
      <div
        className={`overflow-y-auto px-3 pb-3 pt-2.5 ${
          onStage ? "max-h-[26vh] min-h-[8rem]" : "max-h-[38vh] min-h-[14rem]"
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
                  <NoteLine label="What it does" text={brief!.whatItDoes} muted={muted} body={body} />
                )}
                {brief!.usp && (
                  <NoteLine label="What makes it different" text={brief!.usp} muted={muted} body={body} />
                )}
                {brief!.whyCustomers && (
                  <NoteLine
                    label="Why they choose you"
                    text={brief!.whyCustomers}
                    muted={muted}
                    body={body}
                  />
                )}
                {brief!.mission && (
                  <NoteLine label="What it is for" text={brief!.mission} muted={muted} body={body} />
                )}
              </>
            ) : (
              /*
               * A run founded before the brief existed, or one founded in a
               * hurry. Say what is missing and where it would have come from,
               * rather than showing an empty box that reads as broken.
               */
              <p className={`text-2xs leading-snug ${body}`}>
                You didn&rsquo;t write a brief when you founded {run.companyName}, so
                there&rsquo;s nothing here but the numbers. Next company, fill in what
                it does and what makes it different — you get asked both, every time.
              </p>
            )}
          </motion.div>
        )}

        {tab === "numbers" && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-2.5">
            <Rows rows={metrics.traction} onStage={onStage} onTerm={onTerm} />
            <div className="border-t border-[var(--hairline)] pt-2">
              <Rows rows={metrics.benchmarks} onStage={onStage} onTerm={onTerm} />
            </div>
            <div className="border-t border-[var(--hairline)] pt-2">
              <Rows rows={metrics.market} onStage={onStage} onTerm={onTerm} />
            </div>
            {/* The books themselves, so the deck and the P&L are one glance
                apart. Claiming a margin the accounts contradict is the single
                most expensive thing a player can do in this room. */}
            <div
              className="flex flex-wrap gap-x-4 gap-y-1 border-t border-[var(--hairline)] pt-2"
            >
              <Inline label="Cash" value={fmtMoney(run.stats.cash)} muted={muted} />
              <Inline
                label="Burn/mo"
                value={
                  run.stats.burnMonthly <= 0
                    ? `+${fmtMoney(-run.stats.burnMonthly)}`
                    : fmtMoney(run.stats.burnMonthly)
                }
                muted={muted}
              />
              <Inline label="Revenue/yr" value={fmtMoney(run.stats.revenueAnnual)} muted={muted} />
              <Inline label="You own" value={fmtPct(run.founderEquityPct)} muted={muted} />
            </div>
            {metrics.competitors.length > 0 && (
              <div className="border-t border-[var(--hairline)] pt-2">
                <p className={`text-2xs font-bold tracking-[0.12em] ${muted}`}>WHO ELSE DOES THIS</p>
                <ul className="mt-1 space-y-1">
                  {metrics.competitors.map((c) => (
                    <li key={c.name} className={`text-2xs leading-snug ${body}`}>
                      <span className="font-bold">{c.name}</span> · {c.angle} · {c.scale}
                    </li>
                  ))}
                </ul>
              </div>
            )}
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
                  <span className="block text-xs font-bold leading-snug">{beat.title}</span>
                  <span className={`block text-2xs leading-snug ${muted}`}>{beat.prompt}</span>
                </span>
              </li>
            ))}
          </motion.ol>
        )}
      </div>
    </section>
  );
}

function NoteLine({
  label,
  text,
  muted,
  body,
}: {
  label: string;
  text: string;
  muted: string;
  body: string;
}) {
  return (
    <div>
      <p className={`text-2xs font-bold tracking-[0.12em] ${muted}`}>{label.toUpperCase()}</p>
      <p className={`mt-0.5 text-2xs leading-snug ${body}`}>{text}</p>
    </div>
  );
}

function Rows({
  rows,
  onStage,
  onTerm,
}: {
  rows: MetricRow[];
  onStage: boolean;
  onTerm?: (term: string) => void;
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
              className={`min-w-0 text-2xs leading-snug ${
                onStage ? "text-[var(--n-8)]" : "text-[var(--text-secondary)]"
              }`}
            >
              {row.label}
              {explainable && (
                <span className={onStage ? "text-[var(--n-7)]" : "text-[var(--text-tertiary)]"}>
                  {" "}?
                </span>
              )}
            </dt>
            <dd className={`tnum shrink-0 text-xs font-bold ${tone}`}>{row.value}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function Inline({ label, value, muted }: { label: string; value: string; muted: string }) {
  return (
    <span className="text-2xs">
      <span className={`font-bold ${muted}`}>{label} </span>
      <span className="tnum font-bold">{value}</span>
    </span>
  );
}
