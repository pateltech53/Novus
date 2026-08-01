"use client";

import { play } from "@/lib/sound";

import { useMemo } from "react";
import { useGame } from "@/lib/state/GameProvider";
import { candidatePool, type Candidate, type Seat } from "@/lib/engine/people";
import { KNOBS, S_UNIT } from "@/lib/engine/constants";
import { fmtMoney, MONTH_NAMES } from "@/lib/engine/format";
import { useUpgrade } from "@/components/upgrade/UpgradeProvider";

/**
 * LinkedOut — the hiring app. It looks like a professional network because
 * that is the joke: the headlines are polished, the cost is not. Every card
 * has to show the salary as plainly as it shows the talent, because payroll
 * is the one bill in this game that arrives whether or not you had a good month.
 */

const SEAT_LABEL: Record<Seat, string> = {
  COO: "Operations seat",
  CMO: "Marketing seat",
  CTO: "Engineering seat",
  CFO: "Finance seat",
  IC: "Individual contributor",
};

/** Aura stats are engine shorthand; the feed has to say them out loud. */
const AURA_LABEL: Record<Candidate["aura"]["stat"], string> = {
  qual: "Quality",
  brand: "Brand",
  morale: "Morale",
  csat: "Customer satisfaction",
  gm_pt: "points of Gross Margin",
};

/** The aura is the only stat effect a hire has; say it as a sentence, not a tag. */
function auraSentence(aura: Candidate["aura"]): string {
  return `Brings +${aura.amount} ${AURA_LABEL[aura.stat]} while they're on the team.`;
}

function monogram(name: string): string {
  return name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

export function LinkedOut({ onHire }: { onHire: (candidateId: string) => void }) {
  const { run } = useGame();

  // candidatePool is seeded by run id + year + month, so it returns the identical
  // six people all month and a fresh board on the first of the next one. The memo
  // is only for referential stability across unrelated commits.
  const pool = useMemo(() => (run ? candidatePool(run, 6) : []), [run]);

  if (!run) return null;

  const S = S_UNIT[run.stage];
  const scale = run.burnScale ?? 1;

  // hire() bumps BOTH burnDeltaS (their salary) and stats.employees (which
  // deriveBurn multiplies by the per-head overhead), so the honest monthly
  // number a founder should brace for is the sum of the two — not the salary alone.
  const monthlyCostOf = (c: Candidate) =>
    (c.salaryS + KNOBS.salaryPerEmployeeS) * S * scale;

  const costs = pool.map(monthlyCostOf);
  const cheapest = costs.length ? Math.min(...costs) : 0;
  const dearest = costs.length ? Math.max(...costs) : 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-3 pb-8">
      {/* ── App chrome ─────────────────────────────────────────────────── */}
      <header className="px-2 pt-4">
        <h1 className="text-xl font-extrabold tracking-[-0.01em]">LinkedOut</h1>
        <p className="mt-0.5 text-xs text-[var(--text-secondary)]">
          Everyone here is passionate about impact. Everyone here also invoices
          on the first.
        </p>
      </header>

      {/* ── The promise you're about to make ───────────────────────────── */}
      <section
        className="nv-card mt-3 px-4 py-3.5"
        aria-label="What hiring costs you"
      >
        <p className="text-[0.9375rem] font-semibold leading-snug">
          Payroll is a promise you make every month, not a purchase you make
          once.
        </p>
        <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
          You carry{" "}
          <span className="tnum font-bold text-[var(--text)]">
            {run.stats.employees}
          </span>{" "}
          {run.stats.employees === 1 ? "person" : "people"} today. One more name
          off this board adds{" "}
          <span className="tnum font-bold text-[var(--text)]">
            {cheapest === dearest
              ? fmtMoney(dearest)
              : `${fmtMoney(cheapest)}–${fmtMoney(dearest)}`}
          </span>{" "}
          to monthly burn — every month, whether or not the quarter went your
          way. The signing cost is the cheap part.
        </p>
      </section>

      {/* ── The feed ───────────────────────────────────────────────────── */}
      <ul className="mt-3 space-y-2.5">
        {pool.map((c) => (
          <CandidateCard
            key={c.id}
            candidate={c}
            unitS={S}
            cash={run.stats.cash}
            monthlyCost={monthlyCostOf(c)}
            proUnlocked={run.pro}
            onHire={onHire}
          />
        ))}
      </ul>

      {/* ── Why the board looks different next time ────────────────────── */}
      <p className="px-2 pt-4 text-xs leading-relaxed text-[var(--text-tertiary)]">
        This board is Year {run.year}, {MONTH_NAMES[run.month - 1]}. Six new
        names post every fiscal month. The ones you scroll past do not wait
        around for you.
      </p>
    </div>
  );
}

function CandidateCard({
  candidate,
  unitS,
  cash,
  monthlyCost,
  proUnlocked,
  onHire,
}: {
  candidate: Candidate;
  unitS: number;
  cash: number;
  monthlyCost: number;
  proUnlocked: boolean;
  onHire: (candidateId: string) => void;
}) {
  const upgrade = useUpgrade();
  const salary = candidate.salaryS * unitS;
  const signing = candidate.signingS * unitS;

  // Pro gates CONTENT, never outcomes: the card renders in full, and the only
  // thing withheld is the ability to hire this particular face (Brand Law 4).
  const proLocked = !!candidate.pro && !proUnlocked;
  const broke = cash < signing;
  const disabled = proLocked || broke;

  const reason = proLocked
    ? "Pro founders see the whole talent pool."
    : broke
      ? `You're short. Signing costs ${fmtMoney(signing)} and you hold ${fmtMoney(cash)}.`
      : null;

  return (
    <li className="nv-card px-4 py-4">
      {/* Identity row */}
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden="true"
          className="tnum grid h-11 w-11 shrink-0 place-items-center rounded-full bg-[var(--color-navy)] text-sm font-extrabold text-[var(--n-11)]"
        >
          {monogram(candidate.name)}
        </span>

        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="min-w-0 truncate text-[0.9375rem] font-extrabold leading-tight">
              {candidate.name}
            </h2>
            {candidate.pro && (
              <span
                className="shrink-0 rounded-full bg-[var(--color-prestige)] px-1.5 py-0.5 text-2xs font-extrabold tracking-[0.1em] text-[var(--color-navy)]"
                title="Pro talent pool"
              >
                PRO
              </span>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">
            {candidate.headline}
          </p>
          <span
            className="mt-1.5 inline-block rounded-full bg-[var(--chip)] px-2 py-0.5 text-2xs font-bold tracking-[0.1em] text-[var(--text-secondary)]"
            title={SEAT_LABEL[candidate.seat]}
          >
            {candidate.seat}
          </span>
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
        {candidate.bio}
      </p>

      {/* Metrics — a number AND a bar, because a bar alone is a vibe */}
      <div className="mt-3 space-y-2">
        <Meter label="Performance" value={candidate.performance} />
        <Meter label="Loyalty" value={candidate.loyalty} />
      </div>

      {/* Money — cost, so never rendered in solvency green */}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Figure label="SALARY" value={`${fmtMoney(salary)}/mo`} />
        <Figure label="SIGNING" value={fmtMoney(signing)} danger={broke} />
      </div>

      <p className="mt-2.5 text-xs leading-relaxed text-[var(--text-secondary)]">
        {auraSentence(candidate.aura)}{" "}
        <span className="text-[var(--text-tertiary)]">
          Costs you {fmtMoney(monthlyCost)} a month in burn, all in.
        </span>
      </p>

      {/*
        A Pro-locked candidate does not get a greyed-out HIRE. The person is
        real, the salary is real, and the only missing piece is the plan — so
        the control says what to do about that instead of going dead and
        explaining itself in 13px underneath. Being short of cash still greys
        out, because that one is answered by playing, not by paying.
      */}
      {proLocked ? (
        <button
          type="button"
          onClick={() => upgrade.open("talent_pool")}
          aria-label={`${candidate.name} is in the Pro talent pool. See what Pro adds.`}
          aria-describedby={`${candidate.id}-why`}
          className="nv-press mt-3.5 h-14 w-full rounded-[var(--radius-pill)] bg-[var(--color-prestige)] text-sm font-extrabold tracking-[0.04em] text-[var(--on-prestige)]"
        >
          SEE WHAT PRO ADDS
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            play("hire");
            onHire(candidate.id);
          }}
          data-sfx="none"
          aria-label={`Hire ${candidate.name}, ${candidate.role}`}
          aria-describedby={reason ? `${candidate.id}-why` : undefined}
          className="mt-3.5 h-14 w-full rounded-[var(--radius-pill)] bg-[var(--action)] text-sm font-extrabold tracking-[0.04em] text-[var(--n-11)] transition-transform duration-150 enabled:active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40"
        >
          HIRE
        </button>
      )}

      {reason && (
        <p
          id={`${candidate.id}-why`}
          className={`mt-2 text-center text-xs leading-snug ${
            proLocked ? "text-[var(--text-secondary)]" : "text-[var(--alert)]"
          }`}
        >
          {reason}
        </p>
      )}
    </li>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className="truncate text-2xs font-bold tracking-[0.06em] text-[var(--text-secondary)]">
          {label}
        </span>
        <span className="tnum shrink-0 text-2xs font-extrabold">
          {pct}
          <span className="text-[var(--text-tertiary)]">/100</span>
        </span>
      </div>
      {/* Decorative: the number above it is the accessible source of truth. */}
      <div
        aria-hidden="true"
        className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-[var(--chip)]"
      >
        <div
          className="h-full rounded-full bg-[var(--color-navy)]"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function Figure({
  label,
  value,
  danger,
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div className="min-w-0 rounded-[0.625rem] bg-[var(--chip)] px-2.5 py-2">
      <span className="block truncate text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
        {label}
      </span>
      <span
        className={`tnum mt-0.5 block truncate text-xs font-extrabold leading-tight ${
          danger ? "text-[var(--alert)]" : "text-[var(--text)]"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
