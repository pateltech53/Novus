"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import { S_UNIT } from "@/lib/engine/constants";
import { fmtMoney } from "@/lib/engine/format";
import type { Employee } from "@/lib/engine/people";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";

/**
 * The team. A roster of named people with salaries, not a headcount integer —
 * the whole point is that letting someone go has a face attached to it.
 *
 * Hiring deliberately lives on LinkedOut. This screen only ever points at the
 * phone so there is exactly one place in the game where people arrive.
 */

/** On white, the brand greens/reds need darkening to stay legible. */
const GOOD = "var(--solvency)"; // solvency, darkened
const BAD = "var(--alert)"; // alert, darkened

type Tone = "good" | "neutral" | "bad";

/** Shared thresholds so a number reads the same everywhere on this screen. */
function toneFor(value: number): Tone {
  if (value >= 75) return "good";
  if (value >= 45) return "neutral";
  return "bad";
}

const TONE_BAR: Record<Tone, string> = {
  good: GOOD,
  neutral: "var(--text-secondary)",
  bad: BAD,
};

const TONE_TEXT: Record<Tone, string> = {
  good: GOOD,
  neutral: "var(--text)",
  bad: BAD,
};

/** Aura stats are engine keys; players get finance/product words. */
const AURA_LABEL: Record<Employee["aura"]["stat"], string> = {
  qual: "Quality",
  brand: "Brand",
  morale: "Morale",
  csat: "CSAT",
  gm_pt: "Gross margin",
};

const SEAT_LABEL: Record<Employee["seat"], string> = {
  COO: "COO",
  CMO: "CMO",
  CTO: "CTO",
  CFO: "CFO",
  IC: "IC",
};

/** One dry read on the room, so morale is a sentence and not just a bar. */
function moraleLine(morale: number): string {
  if (morale >= 70) return "Nobody is updating their résumé this week.";
  if (morale >= 45) return "Fine. Fine is not a strategy.";
  return "They go quiet when you walk in. That is information.";
}

export interface TeamScreenProps {
  onClose: () => void;
  /** Owned by the caller — it decides how firing is committed to the run. */
  onFire: (id: string) => void;
  /** Opens the phone so the player can hire on LinkedOut. */
  onOpenPhone: () => void;
}

export function TeamScreen({ onClose, onFire, onOpenPhone }: TeamScreenProps) {
  const { run } = useGame();
  const upgrade = useUpgrade();
  /** Firing is two taps: the first one only admits you are thinking about it. */
  const [confirming, setConfirming] = useState<string | null>(null);

  // Escape closes the sheet — the scrim is not the only way out.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!run) return null;

  const roster = run.roster;
  const S = S_UNIT[run.stage];
  const payrollMonthly = roster.reduce((sum, e) => sum + e.salaryS, 0) * S;
  const avgPerformance = roster.length
    ? Math.round(roster.reduce((s, e) => s + e.performance, 0) / roster.length)
    : null;
  const avgLoyalty = roster.length
    ? Math.round(roster.reduce((s, e) => s + e.loyalty, 0) / roster.length)
    : null;
  const morale = Math.round(run.stats.morale);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
    >
      <button
        type="button"
        aria-label="Close the team screen"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--scrim)]"
      />

      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label="The team"
        className="relative flex max-h-[88dvh] w-full max-w-2xl flex-col overflow-y-auto rounded-t-[1.75rem] bg-[var(--sheet)] pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[var(--e3)]"
        initial={{ y: "8%", opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="min-w-0">
            <h2 className="text-xl font-extrabold tracking-[-0.01em]">
              The team
            </h2>
            <p className="mt-1 text-sm leading-snug text-[var(--text-secondary)]">
              Payroll leaves every month whether or not the month earned it.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-full bg-[var(--chip)] px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
          >
            CLOSE
          </button>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 px-3">
          <StatCard label="HEADCOUNT" value={String(roster.length)} />
          <StatCard
            label="PAYROLL / MO"
            value={fmtMoney(payrollMonthly)}
            // Red once the bank can't cover three more payrolls — payroll is
            // the bill that arrives whether or not the month went well.
            danger={payrollMonthly > 0 && run.stats.cash < payrollMonthly * 3}
          />
          <StatCard
            label="AVG PERFORMANCE"
            value={avgPerformance === null ? "—" : String(avgPerformance)}
            tone={avgPerformance === null ? undefined : toneFor(avgPerformance)}
          />
          <StatCard
            label="AVG LOYALTY"
            value={avgLoyalty === null ? "—" : String(avgLoyalty)}
            tone={avgLoyalty === null ? undefined : toneFor(avgLoyalty)}
          />
        </div>

        <div className="mt-2 px-3">
          <div className="nv-card px-4 py-3">
            <Meter label="TEAM MORALE" value={morale} />
            <p className="mt-2 text-xs leading-snug text-[var(--text-secondary)]">
              {moraleLine(morale)}
            </p>
          </div>
        </div>

        {/* ── Roster ────────────────────────────────────────────────── */}
        {roster.length === 0 ? (
          <div className="mt-4 px-3">
            <div className="nv-card px-5 py-6 text-center">
              <p className="text-[1.0625rem] font-extrabold leading-snug">
                You are the whole company. That is not a long-term plan.
              </p>
              <p className="mt-2 text-sm leading-snug text-[var(--text-secondary)]">
                Every hire is a monthly cost you cannot un-sign. It is still
                cheaper than being the only person who knows anything.
              </p>
              <button
                type="button"
                onClick={onOpenPhone}
                className="mt-5 flex h-14 w-full items-center justify-center rounded-[var(--radius-pill)] bg-[var(--action)] px-4 text-center text-sm font-extrabold leading-tight text-[var(--n-11)] transition-transform duration-150 active:scale-[0.97] sm:text-[0.9375rem]"
              >
                Open the phone → LinkedOut to hire
              </button>
            </div>
          </div>
        ) : (
          <ul className="mt-4 space-y-2 px-3">
            {roster.map((e) => (
              <RosterCard
                key={e.id}
                employee={e}
                salaryMonthly={e.salaryS * S}
                confirming={confirming === e.id}
                onAskFire={() => setConfirming(e.id)}
                onCancelFire={() => setConfirming(null)}
                onConfirmFire={() => {
                  setConfirming(null);
                  onFire(e.id);
                }}
              />
            ))}
          </ul>
        )}

        {/* ── Hiring always points at the phone; LinkedOut owns it ──── */}
        <div className="mt-5 px-3">
          <button
            type="button"
            onClick={onOpenPhone}
            className="flex h-14 w-full items-center justify-center rounded-[var(--radius-pill)] bg-[var(--action)] px-4 text-center text-sm font-extrabold leading-tight text-[var(--n-11)] transition-transform duration-150 active:scale-[0.97] sm:text-[0.9375rem]"
          >
            Hiring happens on LinkedOut. Open the phone.
          </button>
          {!run.pro && (
            // Content only, never outcomes: Pro widens the list, not the odds.
            // Tappable because it was already making the offer — it just had no
            // way to accept it, which is a sentence about a product rather than
            // a route to one.
            <button
              type="button"
              onClick={() => upgrade.open("talent_pool")}
              className="nv-press mt-3 flex w-full flex-wrap items-center justify-center gap-1.5 text-center text-2xs leading-snug text-[var(--text-tertiary)]"
            >
              <span className="rounded-full bg-[var(--color-prestige)] px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em] text-[var(--on-prestige)]">
                PRO
              </span>
              <span>
                More candidates in the pool. The same people can still say no.
              </span>
            </button>
          )}
        </div>

        <p className="px-5 pt-4 text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">
          NONE OF THIS ADVANCES TIME
        </p>
      </motion.section>
    </motion.div>
  );
}

// ── Pieces ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  tone,
  danger,
}: {
  label: string;
  value: string;
  tone?: Tone;
  danger?: boolean;
}) {
  const color = danger ? BAD : tone ? TONE_TEXT[tone] : "var(--text)";
  return (
    <div className="nv-card min-w-0 px-3 py-2.5">
      <span className="block truncate text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)] sm:text-2xs sm:tracking-[0.12em]">
        {label}
      </span>
      <span
        className="tnum mt-0.5 block truncate text-[0.9375rem] font-extrabold leading-tight"
        style={{ color }}
      >
        {value}
      </span>
    </div>
  );
}

/** A 0–100 bar. The number is text so the bar itself can stay decorative. */
function Meter({ label, value }: { label: string; value: number }) {
  const tone = toneFor(value);
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <span className="truncate text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)] sm:text-2xs">
          {label}
        </span>
        <span
          className="tnum shrink-0 text-2xs font-extrabold"
          style={{ color: TONE_TEXT[tone] }}
        >
          {pct}
        </span>
      </div>
      <div
        aria-hidden
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--chip)]"
      >
        <div
          className="h-full rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, background: TONE_BAR[tone] }}
        />
      </div>
    </div>
  );
}

function RosterCard({
  employee: e,
  salaryMonthly,
  confirming,
  onAskFire,
  onCancelFire,
  onConfirmFire,
}: {
  employee: Employee;
  salaryMonthly: number;
  confirming: boolean;
  onAskFire: () => void;
  onCancelFire: () => void;
  onConfirmFire: () => void;
}) {
  const auraSign = e.aura.amount < 0 ? "−" : "+";
  const auraLine = `${auraSign}${Math.abs(e.aura.amount)} ${AURA_LABEL[e.aura.stat]} while they're here`;

  return (
    <li className="nv-card px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[0.9375rem] font-extrabold leading-snug">
            {e.name}
          </p>
          <p className="truncate text-xs leading-snug text-[var(--text-secondary)]">
            {e.role}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="rounded-full bg-[var(--chip)] px-2 py-0.5 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)]">
            {SEAT_LABEL[e.seat]}
          </span>
          <span className="tnum text-2xs font-bold text-[var(--text)]">
            {fmtMoney(salaryMonthly)}/mo
          </span>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3">
        <Meter label="PERFORMANCE" value={e.performance} />
        <Meter label="LOYALTY" value={e.loyalty} />
      </div>

      <p className="mt-3 text-xs leading-snug text-[var(--text-secondary)]">{e.bio}</p>

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <span className="min-w-0 rounded-md bg-[var(--chip)] px-1.5 py-0.5 text-2xs font-bold text-[var(--text-secondary)]">
          {auraLine}
        </span>
        <span className="text-2xs font-semibold text-[var(--text-tertiary)]">
          Hired FY{e.hiredYear}
        </span>
        {e.loyalty < 35 && (
          // Loyalty is what a rival buys. Say so before it happens, not after.
          <span
            className="rounded-md bg-[var(--alert)]/10 px-1.5 py-0.5 text-2xs font-bold tracking-[0.1em]"
            style={{ color: BAD }}
          >
            POACHABLE
          </span>
        )}
      </div>

      {confirming ? (
        <motion.div
          className="mt-3 border-t border-[var(--hairline)] pt-3"
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.16 }}
        >
          <p className="text-xs leading-snug text-[var(--text-secondary)]">
            You deliver this yourself, in a room, to their face. The team hears
            about it within the hour — morale drops, and{" "}
            <span className="font-semibold text-[var(--text)]">{auraLine}</span>{" "}
            leaves with them.
          </p>
          <div className="mt-2.5 flex gap-2">
            <button
              type="button"
              onClick={onConfirmFire}
              aria-label={`Confirm letting ${e.name} go`}
              className="flex-1 rounded-[var(--radius-pill)] px-4 py-2.5 text-xs font-extrabold text-[var(--n-11)] transition-transform duration-150 active:scale-[0.97]"
              style={{ background: BAD }}
            >
              Do it
            </button>
            <button
              type="button"
              onClick={onCancelFire}
              className="flex-1 rounded-[var(--radius-pill)] bg-[var(--chip)] px-4 py-2.5 text-xs font-bold text-[var(--text-secondary)] transition-transform duration-150 active:scale-[0.97]"
            >
              Not today
            </button>
          </div>
        </motion.div>
      ) : (
        <div className="mt-3 border-t border-[var(--hairline)] pt-3">
          <button
            type="button"
            onClick={onAskFire}
            aria-label={`Let ${e.name} go`}
            className="rounded-[var(--radius-pill)] border border-[var(--hairline)] px-3.5 py-2 text-xs font-bold text-[var(--text-secondary)] transition-transform duration-150 active:scale-[0.97]"
          >
            Let them go
          </button>
          <span className="ml-2 text-2xs text-[var(--text-tertiary)]">
            Costs morale. You deliver it yourself.
          </span>
        </div>
      )}
    </li>
  );
}
