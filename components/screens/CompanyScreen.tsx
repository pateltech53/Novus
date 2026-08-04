"use client";

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
import { ScreenSheet } from "@/components/screens/ScreenSheet";

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
  const { run, runActivity } = useGame();
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
    <ScreenSheet
      label={`${run.companyName} — company detail`}
      closeLabel="Close the company sheet"
      onClose={onClose}
      eyebrow={`${industry.name.toUpperCase()} · ${STAGE_NAME[run.stage].toUpperCase()}`}
      title={run.companyName}
    >
      {/*
        The dateline and the founder's stake.

        These were the third line of the header until the header became
        glass. Equity is a financial figure and money is read on solid
        ground — the rule does not bend for a surface being chrome. So they
        moved down one element, onto the sheet, where the rest of the
        numbers on this screen already live.
      */}
      <p className="tnum px-5 pt-4 text-sm text-[var(--text-secondary)]">
        Fiscal year {run.year} · {MONTH_NAMES[Math.min(11, Math.max(0, run.month - 1))]} · you
        own{" "}
        <span className="font-bold text-[var(--text)]">
          {fmtPct(run.founderEquityPct)}
        </span>
      </p>
      {run.rookieMode && (
        // The real term stays above; this only ADDS a translation.
        <p className="px-5 pt-1 text-xs leading-snug text-[var(--text-tertiary)]">
          Equity — {GLOSSARY["equity"].rookie}
        </p>
      )}

      {/* ── 2 · The Books, at a glance ────────────────────────────── */}
      <SectionLabel>THE BOOKS</SectionLabel>
      <div className="px-3">
        {/*
          One glance-strip instead of five cards. The play screen carries
          these four figures at display size now; repeating them here at the
          same weight made this sheet a second ledger, and the sheet is for
          what the play screen does NOT show. The figures wrap as label–value
          pairs rather than truncating, because a clipped financial figure is
          the one thing this strip must never produce (§7, and the phone
          audit measures it). NET MARGIN is not here twice — it stays in the
          stat sheet below, where it always was.
        */}
        <div
          className={`nv-card flex flex-wrap items-baseline gap-x-4 gap-y-1.5 px-4 py-3 ${
            run.stats.cash < 0 ? "ring-1 ring-[var(--alert)]/40" : ""
          }`}
        >
          <BookFigure
            label="CASH"
            value={fmtMoney(run.stats.cash)}
            tone={run.stats.cash < 0 ? "bad" : "neutral"}
          />
          <BookFigure
            label="BURN / MO"
            value={profitable ? `+${fmtMoney(-burn)}` : fmtMoney(burn)}
            tone={profitable ? "good" : "neutral"}
          />
          <BookFigure
            label="RUNWAY"
            value={fmtMonths(runway)}
            tone={runway < 4 ? "bad" : "neutral"}
          />
          <BookFigure
            label="VALUATION"
            value={fmtMoney(run.stats.valuation)}
            tone="neutral"
          />
        </div>
      </div>

      {/* ── 3 + 4 · Full stat sheet ───────────────────────────────── */}
      <SectionLabel>THE STAT SHEET</SectionLabel>
      <div className="px-3">
        <ul className="space-y-2">
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
                  <span className="tnum shrink-0 text-2xs font-semibold text-[var(--text-primary)]">
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
    </ScreenSheet>
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

/** One label–value pair on the glance-strip. No box of its own, no rookie
 *  line: the terms are taught on the play screen's ledger, and glossed again
 *  in the stat sheet below where each figure has the width for a sentence. */
function BookFigure({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: Tone;
}) {
  return (
    <span className="flex items-baseline gap-1.5">
      <span className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <span
        className="tnum text-[0.9375rem] font-extrabold leading-tight"
        style={{ color: TONE_TEXT[tone] }}
      >
        {value}
      </span>
    </span>
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
