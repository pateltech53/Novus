"use client";

import { SoundToggle } from "@/components/ui/SoundToggle";

import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import { activitiesFor, canAfford } from "@/lib/engine/activities";
import {
  GLOSSARY,
  industryByCode,
  STAGE_NAME,
  S_UNIT,
} from "@/lib/engine/constants";
import { fmtMoney, fmtMonths, fmtPct, MONTH_NAMES } from "@/lib/engine/format";
import { deriveRunwayMonths } from "@/lib/engine/sim";
import type { RunState } from "@/lib/engine/types";

/**
 * The company's full detail sheet — the thing a founder would actually pull up
 * before making a decision. It reads state and spends resources; it never
 * advances time. That separation is the whole loop.
 */

// Brand colors darkened for legibility on white surfaces (Brand Identity v2).
// These are the only literal hexes allowed here.
const GOOD = "var(--solvency)"; // solvency green — financial upside only, never a CTA
const BAD = "var(--alert)"; // alert red — damage

type Tone = "good" | "bad" | "neutral";

const TONE_TEXT: Record<Tone, string> = {
  good: GOOD,
  bad: BAD,
  neutral: "var(--text)",
};

const BAR_FILL: Record<Tone, string> = {
  good: GOOD,
  bad: BAD,
  neutral: "var(--text-primary)",
};

interface StatRow {
  key: string;
  /** The real finance term. Rookie Mode never replaces it (Brand Law 6). */
  label: string;
  value: string;
  /** 0–100 scalar. Omitted for money and counts, which have no ceiling. */
  bar?: number;
  tone?: Tone;
  /** GLOSSARY key, when the GDD already wrote the plain-English line. */
  term?: string;
  /** Fallback plain-English line for stats the glossary doesn't cover. */
  plain: string;
}

/** Rookie Mode copy: the GDD glossary first, authored line second. */
function plainLine(row: StatRow): string {
  return (row.term && GLOSSARY[row.term]?.rookie) || row.plain;
}

export function CompanyScreen({ onClose }: { onClose: () => void }) {
  const { run, setRookieMode, runActivity } = useGame();
  // Activities are one-per-visit here for the same reason as the activity
  // sheet: without it a player can drain the same lever ten times in one month.
  const [spent, setSpent] = useState<string[]>([]);

  const rows = useMemo(() => (run ? buildRows(run) : []), [run]);

  if (!run) return null;

  const industry = industryByCode(run.industry);
  const runway = deriveRunwayMonths(run);
  const burn = run.stats.burnMonthly;
  const profitable = burn <= 0;
  const actions = activitiesFor("company", run);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      <button
        type="button"
        aria-label="Close the company sheet"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--scrim)]"
      />

      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={`${run.companyName} — company detail`}
        className="relative flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[1.75rem] bg-[var(--sheet)] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--e3)]"
        initial={{ y: "8%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* ── 1 · Header ────────────────────────────────────────────── */}
        <header className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              {industry.name.toUpperCase()} · {STAGE_NAME[run.stage].toUpperCase()}
            </p>
            <h2 className="mt-1 truncate text-xl font-extrabold tracking-[-0.01em]">
              {run.companyName}
            </h2>
            <p className="tnum mt-1 text-sm text-[var(--text-secondary)]">
              Fiscal year {run.year} · {MONTH_NAMES[Math.min(11, Math.max(0, run.month - 1))]} · you
              own{" "}
              <span className="font-bold text-[var(--text)]">
                {fmtPct(run.founderEquityPct)}
              </span>
            </p>
            {run.rookieMode && (
              // The real term stays above; this only ADDS a translation.
              <p className="mt-1 text-xs leading-snug text-[var(--text-tertiary)]">
                Equity — {GLOSSARY["equity"].rookie}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full bg-[var(--chip)] px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)] transition-transform duration-150 active:scale-[0.97]"
          >
            CLOSE
          </button>
        </header>

        {/* ── 2 · The Books ─────────────────────────────────────────── */}
        <SectionLabel>THE BOOKS</SectionLabel>
        <div className="px-3">
          <div
            className={`nv-card px-4 py-3 ${
              run.stats.cash < 0 ? "ring-1 ring-[var(--alert)]/40" : ""
            }`}
          >
            <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
              CASH
            </p>
            <p
              className="tnum mt-0.5 truncate text-2xl font-extrabold leading-none"
              style={{ color: run.stats.cash < 0 ? BAD : "var(--text)" }}
            >
              {fmtMoney(run.stats.cash)}
            </p>
            {run.rookieMode && (
              <p className="mt-1 text-xs text-[var(--text-tertiary)]">
                {GLOSSARY["cash"].rookie}
              </p>
            )}
          </div>

          <div className="mt-2 grid grid-cols-2 gap-2">
            <BookTile
              label="BURN / MO"
              term="burn rate"
              value={profitable ? `+${fmtMoney(-burn)}` : fmtMoney(burn)}
              tone={profitable ? "good" : "neutral"}
              rookie={run.rookieMode}
            />
            <BookTile
              label="RUNWAY"
              term="runway"
              value={fmtMonths(runway)}
              tone={runway < 4 ? "bad" : "neutral"}
              rookie={run.rookieMode}
            />
            <BookTile
              label="VALUATION"
              term="valuation"
              value={fmtMoney(run.stats.valuation)}
              tone="neutral"
              rookie={run.rookieMode}
            />
            <BookTile
              label="NET MARGIN"
              term="net margin"
              value={fmtPct(run.stats.netMarginPt, true)}
              tone={run.stats.netMarginPt >= 0 ? "good" : "bad"}
              rookie={run.rookieMode}
            />
          </div>
        </div>

        {/* ── 3 + 4 · Full stat sheet, with the Rookie Mode toggle ──── */}
        <SectionLabel>THE STAT SHEET</SectionLabel>
        <div className="px-3">
          <div className="nv-card flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0">
              <span className="block text-[0.9375rem] font-semibold leading-snug">
                Rookie Mode
              </span>
              <span className="mt-0.5 block text-xs leading-snug text-[var(--text-secondary)]">
                Adds a plain-English line under every term. The real word stays.
              </span>
            </span>
            <button
              type="button"
              role="switch"
              aria-checked={run.rookieMode}
              aria-label="Rookie Mode"
              onClick={() => setRookieMode(!run.rookieMode)}
              className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-200 ${
                run.rookieMode ? "bg-[var(--action)]" : "bg-[var(--chip)]"
              }`}
            >
              <span
                aria-hidden="true"
                className={`absolute top-1 h-5 w-5 rounded-full bg-[var(--card)] shadow-[var(--e1)] transition-[left] duration-200 ${
                  run.rookieMode ? "left-6" : "left-1"
                }`}
              />
            </button>
          </div>

          {/* Sound effects live beside Rookie Mode: both are how the player
              wants to be spoken to, rather than anything about the company. */}
          <div className="mt-2">
            <SoundToggle />
          </div>

          <ul className="mt-2 space-y-2">
            {rows.map((row) => {
              const tone = row.tone ?? "neutral";
              return (
                <li key={row.key} className="nv-card px-4 py-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[0.9375rem] font-semibold">
                      {row.label}
                    </span>
                    <span
                      className="tnum shrink-0 text-[0.9375rem] font-extrabold"
                      style={{ color: TONE_TEXT[tone] }}
                    >
                      {row.value}
                    </span>
                  </div>
                  {row.bar !== undefined && (
                    <Bar value={row.bar} tone={tone} label={`${row.label} out of 100`} />
                  )}
                  {run.rookieMode && (
                    <p className="mt-1.5 text-xs leading-snug text-[var(--text-tertiary)]">
                      {plainLine(row)}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>

        {/* ── 5 · Actions ───────────────────────────────────────────── */}
        <SectionLabel>WHAT YOU CAN DO TODAY</SectionLabel>
        <ul className="space-y-2 px-3">
          {actions.map((activity) => {
            const affordable = canAfford(activity, run);
            const used = spent.includes(activity.id);
            const price =
              activity.costS !== undefined
                ? fmtMoney(activity.costS * S_UNIT[run.stage])
                : null;
            return (
              <li key={activity.id}>
                <button
                  type="button"
                  disabled={!affordable || used}
                  onClick={() => {
                    runActivity(activity.id);
                    setSpent((s) => [...s, activity.id]);
                  }}
                  className="nv-card flex w-full items-start justify-between gap-3 px-4 py-3.5 text-left transition-transform duration-150 enabled:active:scale-[0.985] disabled:opacity-45"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.9375rem] font-semibold leading-snug">
                      {activity.label}
                    </span>
                    <span className="mt-0.5 block text-xs leading-snug text-[var(--text-secondary)]">
                      {used
                        ? "Done. The month has to move before you do that again."
                        : !affordable
                          ? `You don't have the ${price ?? "cash"}. That's the whole reason.`
                          : activity.signal}
                    </span>
                  </span>
                  {/*
                    Only the cash cost lives in the chip now.
                    It used to hold `activity.known` — "Cash −2S · Quality +5" —
                    which fit a 45%-wide box fine. Addendum A §7.1 replaced that
                    field with a qualitative `signal` ("Costs real money. Nobody
                    claps."), and a sentence in a chip that narrow wraps to four
                    or five lines and shoves the row apart. The signal moved up to
                    the description line where it has the width to be a sentence,
                    and the chip kept the one number a player is allowed to see
                    before committing: the money leaving the account.
                  */}
                  {price && (
                    <span className="tnum shrink-0 rounded-md bg-[var(--chip)] px-1.5 py-0.5 text-2xs font-bold text-[var(--text-secondary)]">
                      {price}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>

        <p className="px-5 pt-4 text-xs text-[var(--text-tertiary)]">
          None of this advances time.
        </p>
      </motion.section>
    </motion.div>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="px-5 pt-6 pb-2 text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
      {children}
    </h3>
  );
}

function BookTile({
  label,
  term,
  value,
  tone,
  rookie,
}: {
  label: string;
  term: string;
  value: string;
  tone: Tone;
  rookie: boolean;
}) {
  const gloss = GLOSSARY[term];
  return (
    <div className="nv-card min-w-0 px-3 py-2.5">
      <p className="truncate text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
        {label}
      </p>
      <p
        className="tnum mt-0.5 truncate text-base font-extrabold leading-tight"
        style={{ color: TONE_TEXT[tone] }}
      >
        {value}
      </p>
      {rookie && gloss && (
        <p className="mt-1 text-2xs leading-[1.3] text-[var(--text-tertiary)]">
          {gloss.rookie}
        </p>
      )}
    </div>
  );
}

function Bar({
  value,
  tone,
  label,
}: {
  value: number;
  tone: Tone;
  label: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--chip)]"
    >
      <div
        aria-hidden="true"
        className="h-full rounded-full transition-[width] duration-500"
        style={{
          width: `${pct}%`,
          background: BAR_FILL[tone],
          transitionTimingFunction: "var(--ease-out)",
        }}
      />
    </div>
  );
}

// ── The sheet itself ────────────────────────────────────────────────────────

/**
 * Every visible stat in GDD §5, in the order a founder reads them: what came
 * in, what you kept, who knows you, who stayed, who's left to build it.
 */
function buildRows(run: RunState): StatRow[] {
  const s = run.stats;
  // The roster is the truth once people have names; older saves only carried a
  // headcount, so fall back rather than showing a confident zero.
  const headcount = run.roster?.length ?? s.employees;

  return [
    {
      key: "revenue",
      label: "Revenue (annual)",
      value: fmtMoney(s.revenueAnnual),
      term: "revenue",
      plain: "everything customers paid you.",
    },
    {
      key: "gm",
      label: "Gross margin",
      value: fmtPct(s.grossMarginPt),
      bar: s.grossMarginPt,
      tone: "good",
      term: "gross margin",
      plain: "of each $1 sold, what you keep before rent & salaries.",
    },
    {
      key: "nm",
      label: "Net margin",
      // No bar: this one goes negative, and a bar that can't show that lies.
      value: fmtPct(s.netMarginPt, true),
      tone: s.netMarginPt >= 0 ? "good" : "bad",
      term: "net margin",
      plain: "of each $1, what you truly keep after everything.",
    },
    {
      key: "share",
      label: "Market share",
      value: fmtPct(s.marketSharePt),
      bar: s.marketSharePt,
      term: "market share",
      plain: "your slice of everyone buying this thing.",
    },
    {
      key: "brand",
      label: "Brand",
      value: `${Math.round(s.brand)}`,
      bar: s.brand,
      plain: "how many people have heard of you, and how they felt about it.",
    },
    {
      key: "qual",
      label: "Product quality",
      value: `${Math.round(s.qual)}`,
      bar: s.qual,
      plain: "how good the thing actually is, before marketing touches it.",
    },
    {
      key: "csat",
      label: "CSAT",
      value: `${Math.round(s.csat)}`,
      bar: s.csat,
      plain: "whether the people who already paid would do it again.",
    },
    {
      key: "churn",
      label: "Churn / yr",
      value: fmtPct(s.churnPt),
      bar: s.churnPt,
      tone: "bad", // churn is damage by definition — a short red bar is the win
      term: "churn",
      plain: "the leak in your bucket.",
    },
    {
      key: "cwp",
      label: "CWP",
      value: `${Math.round(s.cwp)}`,
      bar: s.cwp,
      term: "cwp",
      plain: "the most someone would pay before walking.",
    },
    {
      key: "cac",
      label: "CAC efficiency",
      value: `${Math.round(s.cacPt)}`,
      bar: s.cacPt,
      term: "cac",
      plain: "ad money spent per new customer won.",
    },
    {
      key: "ctr",
      label: "CTR",
      value: `${Math.round(s.ctrPt)}`,
      bar: s.ctrPt,
      term: "ctr",
      plain: "of 100 who see it, how many click.",
    },
    {
      key: "employees",
      label: "Employees",
      value: `${headcount}`,
      plain: "the number of people whose rent you are now part of.",
    },
    {
      key: "morale",
      label: "Morale",
      value: `${Math.round(s.morale)}`,
      bar: s.morale,
      plain: "whether your team is still choosing to be here.",
    },
    {
      key: "energy",
      label: "Founder energy",
      value: `${Math.round(s.energy)}`,
      bar: s.energy,
      tone: s.energy < 25 ? "bad" : "neutral",
      plain: "your own battery. At zero you start signing things you didn't read.",
    },
    {
      key: "respect",
      label: "Shark respect",
      value: `${Math.round(s.respect)}`,
      bar: s.respect,
      plain: "what the shark thinks of you before you open your mouth.",
    },
  ];
}
