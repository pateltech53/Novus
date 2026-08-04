"use client";

import { useState } from "react";

import { ScreenSheet } from "@/components/screens/ScreenSheet";
import { KeyTermsSheet } from "@/components/KeyTermsSheet";
import type { RunState, StageNum } from "@/lib/engine/types";
import { STAGE_NAME, STAGE_REVENUE_FLOOR, S_UNIT } from "@/lib/engine/constants";
import { deriveRunwayMonths } from "@/lib/engine/sim";
import { fmtMoney, fmtMonths } from "@/lib/engine/format";

/**
 * "Where am I, and what does all this mean?" — answered per stage, for a rookie.
 *
 * Younger players told us the game was too hard, and the honest reason is that
 * the screen assumes you already know what a $25K company in a "Garage" is
 * supposed to do next. This is the missing page: opened from the stage line in
 * the masthead, it says in plain words what this stage is, what the four
 * numbers on the Books are telling you right now, what your one job is, and what
 * it takes to reach the next stage. Rookie Mode turns the stage line into an
 * obvious way in; the guide is here for everyone who opens it.
 *
 * Nothing here is authored twice: the numbers come straight off the run and the
 * same constants the engine promotes on, so the guide can never tell a player
 * they need $1M to advance when the engine asks for something else.
 */

interface StageCopy {
  what: string;
  job: string;
}

const STAGE_COPY: Record<StageNum, StageCopy> = {
  1: {
    what: "You just started. Everything is small — your money is counted in thousands, and nobody has heard of you yet.",
    job: "Stay alive and make your first real sales. Don't spend money you can't get back.",
  },
  2: {
    what: "People are actually buying. Now you're spending to grow, and the numbers are in the tens of thousands.",
    job: "Grow without running out of cash. Growing too fast is how good companies still die — watch your runway.",
  },
  3: {
    what: "It's working. This stage is about doing more of what already works without breaking it. Money is in the hundreds of thousands.",
    job: "Turn what works into a machine. Protect your margins while you scale up.",
  },
  4: {
    what: "You're a real company now. The numbers are in the millions, and so are the mistakes and the wins.",
    job: "Make big bets carefully. At this size one bad call costs a year — and one good one makes ten.",
  },
  5: {
    what: "The big leagues. Money is counted in tens of millions, and the whole market is watching.",
    job: "Play to win, not just to survive. Defend your lead and go for the record.",
  },
};

export function StageGuide({ run, onClose }: { run: RunState; onClose: () => void }) {
  const [terms, setTerms] = useState(false);

  const stage = run.stage as StageNum;
  const copy = STAGE_COPY[stage];
  const next = (stage + 1) as StageNum;
  const hasNext = stage < 5;
  const nextFloor = hasNext ? STAGE_REVENUE_FLOOR[next] : 0;

  const runway = deriveRunwayMonths(run);
  const burn = run.stats.burnMonthly;

  const books: { label: string; value: string; reading: string }[] = [
    {
      label: "CASH",
      value: fmtMoney(run.stats.cash),
      reading: "The money in the bank right now. When it hits $0, the company is over.",
    },
    {
      label: "BURN",
      value: burn <= 0 ? `+${fmtMoney(-burn)}` : fmtMoney(burn),
      reading:
        burn <= 0
          ? "You're making money each month, not losing it. That plus sign is the goal."
          : "How much cash you lose every month. Lower is safer; a plus sign means you're profitable.",
    },
    {
      label: "RUNWAY",
      value: fmtMonths(runway),
      reading:
        runway < 6
          ? "Months of cash left at this burn. Yours is short — take cheaper options and buy time."
          : "Months of cash left at this burn. Under six, survival beats growth. Over twelve, you can invest.",
    },
    {
      label: "VALUATION",
      value: fmtMoney(run.stats.valuation),
      reading:
        "What the whole company is worth — mostly your yearly revenue times how good the business looks.",
    },
  ];

  return (
    <>
      <ScreenSheet
        label={`Stage guide: ${STAGE_NAME[stage]}`}
        closeLabel="Close the stage guide"
        onClose={onClose}
        eyebrow={`YEAR ${run.year} · STAGE ${stage} OF 5`}
        title={STAGE_NAME[stage]}
        blurb={copy.what}
      >
        <div className="px-5 pb-6 pt-4">
          {/* The one job, loud, because "what am I even trying to do" is the
              question a stuck rookie is actually asking. */}
          <div className="rounded-[var(--radius-row)] bg-[var(--surface)] px-4 py-3 ring-1 ring-[var(--hairline)]">
            <p className="text-2xs font-bold tracking-[0.14em] text-[var(--action)]">
              YOUR JOB THIS STAGE
            </p>
            <p className="mt-1 text-sm leading-snug text-[var(--text-primary)]">
              {copy.job}
            </p>
          </div>

          {/* The four numbers, read for THIS company right now — not a generic
              definition but "here is what yours is saying". */}
          <p className="mt-6 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
            YOUR BOOKS, RIGHT NOW
          </p>
          <dl className="mt-2 divide-y divide-[var(--hairline)]">
            {books.map((b) => (
              <div key={b.label} className="py-2.5">
                <dt className="flex items-baseline justify-between gap-3">
                  <span className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                    {b.label}
                  </span>
                  <span className="tnum text-sm font-extrabold text-[var(--text-primary)]">
                    {b.value}
                  </span>
                </dt>
                <dd className="mt-0.5 text-sm leading-snug text-[var(--text-secondary)]">
                  {b.reading}
                </dd>
              </div>
            ))}
          </dl>

          {/* How to level up, from the same floor the engine promotes on. */}
          {hasNext ? (
            <div className="mt-6 rounded-[var(--radius-row)] bg-[var(--surface)] px-4 py-3 ring-1 ring-[var(--hairline)]">
              <p className="text-2xs font-bold tracking-[0.14em] text-[var(--color-prestige)]">
                REACHING {STAGE_NAME[next].toUpperCase()}
              </p>
              <p className="mt-1 text-sm leading-snug text-[var(--text-primary)]">
                Grow your yearly revenue to{" "}
                <span className="tnum font-bold">{fmtMoney(nextFloor)}</span> and you move up a
                stage — bigger numbers, bigger swings. It's announced when you close the year.
              </p>
            </div>
          ) : (
            <div className="mt-6 rounded-[var(--radius-row)] bg-[var(--surface)] px-4 py-3 ring-1 ring-[var(--hairline)]">
              <p className="text-2xs font-bold tracking-[0.14em] text-[var(--color-prestige)]">
                TOP STAGE
              </p>
              <p className="mt-1 text-sm leading-snug text-[var(--text-primary)]">
                This is as big as it gets. Now it's about the record — survive, and put up a
                valuation the board remembers.
              </p>
            </div>
          )}

          <button
            type="button"
            onClick={() => setTerms(true)}
            className="nv-gc mt-6 flex w-full items-center justify-center gap-2 rounded-[var(--radius-pill)] nv-on px-5 py-3 text-2xs font-extrabold tracking-[0.1em] text-[var(--text-primary)] shadow-[var(--e1)]"
          >
            SEE EVERY KEY TERM ▸
          </button>
        </div>
      </ScreenSheet>

      {terms && <KeyTermsSheet onClose={() => setTerms(false)} />}
    </>
  );
}
