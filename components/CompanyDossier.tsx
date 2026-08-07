"use client";

import { useEffect } from "react";
import { useNativeGlassClose } from "@/components/native/useNativeOverlay";
import { motion } from "framer-motion";
import { ENTER } from "@/components/ui/Motion";
import type { RunState, StageNum } from "@/lib/engine/types";
import { fmtMoney, fmtMonths, fmtPct, MONTH_NAMES } from "@/lib/engine/format";
import { deriveRunwayMonths } from "@/lib/engine/sim";
import {
  KNOBS,
  STAGE_NAME,
  STAGE_REVENUE_FLOOR,
  S_UNIT,
  industryByCode,
} from "@/lib/engine/constants";
import { specForRun } from "@/lib/engine/industries/index";
import {
  earningItems,
  ensurePortfolio,
  liveItems,
  portfolioCap,
} from "@/lib/engine/portfolio";
import { holdingsValue } from "@/lib/engine/holdings";

/**
 * THE DOSSIER — every number the founder is entitled to, on one scroll.
 *
 * ── What it is for ─────────────────────────────────────────────────────────
 *
 * The books, the cap table, the catalogue and the roster were spread across
 * four screens, and one of them (the pitch) had none of them. A founder walking
 * into a room knows their own gross margin; making the player memorise it before
 * the camera opens taxes recall, not business skill. So this mounts in two
 * places — off the home masthead, and over the camera during a performance.
 *
 * ── What it deliberately does not show ─────────────────────────────────────
 *
 * `risk`, `tdebt`, `suploy`, `invsent` and `teamloy` are hidden stats. They
 * reach the player through events and the autopsy, in words, after the fact.
 * Printing them here would hand over the answer key — you would stop reading the
 * business and start reading the gauge. Same reason nothing forward-looking
 * appears: no projections, no perceived value, no recommended price. Every
 * figure below is something that already happened.
 */

/**
 * The button face, exported so every surface that opens the dossier — the home
 * masthead, the camera — uses the same mark rather than three near-identical
 * hand-drawn "i"s.
 */
export function DossierGlyph({ size = 17 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <circle cx="9" cy="9" r="7.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="9" cy="5.4" r="0.95" fill="currentColor" />
      <path d="M9 8.1v4.7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  );
}

type Tone = "good" | "bad" | "flat";

const TONE_TEXT: Record<Tone, string> = {
  good: "var(--solvency)",
  bad: "var(--alert)",
  flat: "var(--text)",
};

export function CompanyDossier({
  run,
  onClose,
  variant = "sheet",
}: {
  run: RunState;
  onClose: () => void;
  /**
   * "sheet" rises from the bottom of the home screen. "overlay" is the compact
   * card that sits above the camera mid-pitch: same content, tighter frame, and
   * a z-index above the perform screen.
   */
  variant?: "sheet" | "overlay";
}) {
  const overlay = variant === "overlay";

  /*
   * The way out is UIKit's.
   *
   * A real `UIGlassEffect` circle over the scrim, and the DOM chip below is
   * not rendered at all when it is up — a hidden button still takes a tap on
   * iOS if the native view above it passes the touch through, and the player
   * gets a dead zone nobody can see.
   *
   * `chevron.backward` in the overlay variant, where this sits ON another
   * screen and dismissing returns you to it rather than to the board. The
   * glyph is the difference between "close this" and "go back one".
   */
  const native = useNativeGlassClose(
    overlay ? "Back" : "Close the dossier",
    onClose,
    overlay ? "chevron.backward" : "xmark",
  );

  // Escape closes it. Mid-pitch that matters more than usual — the player is
  // on a clock and should not have to hunt for a target.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <motion.div
      className={`fixed inset-0 flex justify-center ${
        overlay
          ? "z-[90] items-start px-3 pt-[max(0.75rem,var(--nv-safe-top))] pb-3"
          : "z-50 items-end"
      }`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.16 }}
    >
      <button
        type="button"
        aria-label="Close the dossier"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--scrim)]"
      />

      <motion.section
        role="dialog"
        aria-modal="true"
        aria-label={`${run.companyName} — company dossier`}
        /*
          ── A frame, with the scrolling inside it ────────────────────────────

          The whole section used to be the scroller, so opening the dossier
          mid-take gave you a card whose header — the company's name and the
          way BACK — left the screen the moment you read anything, and whose
          bottom edge was wherever the viewport happened to cut it. On the
          pitch screen that is the worst version of it: the camera is running,
          the clock is going, and the way out has scrolled away.

          Now the card is a fixed frame with its corners visible on all four
          sides, the header is pinned, and the body is the only thing that
          moves. `overflow-hidden` on the frame is what makes the rounded
          corners clip what passes under them.
        */
        className={`relative flex w-full flex-col overflow-hidden bg-[var(--sheet)] shadow-[var(--e3)] ${
          overlay
            ? "max-h-full max-w-md rounded-[var(--radius-card)]"
            : "max-h-[min(88dvh,calc(100dvh-var(--nv-overlay-top)-0.75rem))] max-w-2xl rounded-t-[var(--radius-sheet)]"
        }`}
        initial={overlay ? { opacity: 0, scale: 0.98 } : { y: "8%", opacity: 0 }}
        animate={overlay ? { opacity: 1, scale: 1 } : { y: 0, opacity: 1 }}
        transition={{ ...ENTER }}
      >
        {/* Pinned. `shrink-0` because the frame is a flex column with a
            bounded height, and a header that may shrink is a header that
            disappears when the body is long. */}
        <div className="shrink-0">
          <Header run={run} overlay={overlay} onClose={onClose} native={native} />
        </div>

        {/* The only thing that scrolls. `min-h-0` so it may actually be
            shorter than its content — a flex child's automatic minimum is its
            content, and without this the frame grows instead of the body
            scrolling, which is the whole bug. */}
        <div
          className={`min-h-0 flex-1 overflow-y-auto overscroll-contain ${
            overlay ? "pb-4" : "pb-[max(1rem,var(--nv-safe-bottom))]"
          }`}
        >
          <Body run={run} />
          <p className="px-4 pt-5 text-2xs leading-snug text-[var(--text-tertiary)]">
            {overlay
              ? "The camera is still running. Nothing here is a projection — every figure is a year that already closed."
              : "Nothing here advances time, and nothing here is a projection. Every figure is a month or a year that already closed."}
          </p>
        </div>
      </motion.section>
    </motion.div>
  );
}

// ── Header ──────────────────────────────────────────────────────────────────

function Header({
  run,
  overlay,
  onClose,
  native,
}: {
  run: RunState;
  overlay: boolean;
  /** UIKit drew the way out, so this must not draw a second one. */
  native: boolean;
  onClose: () => void;
}) {
  const industry = industryByCode(run.industry);
  const month = MONTH_NAMES[Math.min(11, Math.max(0, run.month - 1))];

  return (
    <header className="sticky top-0 z-10 flex items-start justify-between gap-3 bg-[var(--sheet)] px-4 pb-2 pt-4">
      <div className="min-w-0">
        <p className="truncate text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
          {industry.name.toUpperCase()} · {STAGE_NAME[run.stage].toUpperCase()}
        </p>
        <h2 className="mt-1 truncate text-lg font-extrabold tracking-[-0.01em]">
          {run.companyName}
        </h2>
        <p className="tnum mt-0.5 truncate text-2xs text-[var(--text-secondary)]">
          FY {run.year} · {month} · you own {fmtPct(run.founderEquityPct)}
        </p>
      </div>
      {native ? null : (
        <button
          type="button"
          onClick={onClose}
          className="nv-gc shrink-0 rounded-full px-3 py-1.5 text-2xs font-bold tracking-[0.12em] text-[var(--text-secondary)]"
        >
          {overlay ? "BACK" : "CLOSE"}
        </button>
      )}
    </header>
  );
}

// ── The sheet itself ────────────────────────────────────────────────────────

function Body({ run }: { run: RunState }) {
  const s = run.stats;
  const burn = s.burnMonthly;
  const profitable = burn <= 0;
  const runway = deriveRunwayMonths(run);
  const spec = specForRun(run);

  const p = ensurePortfolio(run);
  const live = liveItems(p);
  const cap = portfolioCap(run);
  const earning = [...earningItems(p)].sort(
    (a, b) => (b.history.at(-1)?.revenue ?? 0) - (a.history.at(-1)?.revenue ?? 0),
  );
  const developing = live.filter((i) => i.state === "development");
  const retired = p.items.filter((i) => i.state === "retired" || i.state === "recalled");

  // The roster is the truth once people have names; older saves carried only a
  // headcount, so fall back rather than printing a confident zero.
  const roster = run.roster ?? [];
  const headcount = roster.length || s.employees;
  const payrollMonthly = roster.reduce((sum, e) => sum + e.salaryS, 0) * S_UNIT[run.stage];
  const companyAssets = holdingsValue(run, "company");
  const nextFloor =
    run.stage < 5 ? STAGE_REVENUE_FLOOR[(run.stage + 1) as StageNum] : null;

  return (
    <>
      {/* ── The books ──────────────────────────────────────────────────── */}
      <Section title="THE BOOKS">
        <div
          className={`nv-gc rounded-[var(--radius-row)] px-4 py-3 ${
            s.cash < 0 ? "outline -outline-offset-1 outline-[var(--alert)]/45" : ""
          }`}
        >
          <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
            CASH ON HAND
          </p>
          <p
            className="tnum mt-0.5 truncate text-2xl font-extrabold leading-none"
            style={{ color: s.cash < 0 ? TONE_TEXT.bad : TONE_TEXT.flat }}
          >
            {fmtMoney(s.cash)}
          </p>
          {run.redMonths > 0 && (
            <p className="tnum mt-1.5 text-2xs leading-snug text-[var(--alert)]">
              Month {run.redMonths} of {KNOBS.redMonthsBeforeDeath} in the red. The last
              one files Chapter 7.
            </p>
          )}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <Tile
            label="BURN / MO"
            value={profitable ? `+${fmtMoney(-burn)}` : fmtMoney(burn)}
            tone={profitable ? "good" : "flat"}
            note={profitable ? "you make more than you spend" : "net cash out, every month"}
          />
          <Tile
            label="RUNWAY"
            value={fmtMonths(runway)}
            tone={runway < 4 ? "bad" : "flat"}
            note={profitable ? "no clock while you are profitable" : "months until zero"}
          />
          <Tile label="REVENUE / YR" value={fmtMoney(s.revenueAnnual)} note="trailing twelve months" />
          <Tile label="VALUATION" value={fmtMoney(s.valuation)} note="what the company is priced at" />
          <Tile
            label="GROSS MARGIN"
            value={fmtPct(s.grossMarginPt)}
            note="kept per $1 before overhead"
          />
          <Tile
            label="NET MARGIN"
            value={fmtPct(s.netMarginPt, true)}
            tone={s.netMarginPt >= 0 ? "good" : "bad"}
            note="kept per $1 after everything"
          />
        </div>

        {companyAssets > 0 && (
          <ul className="mt-2">
            <Row label="Company assets" value={fmtMoney(companyAssets)} />
          </ul>
        )}
      </Section>

      {/* ── Ownership ──────────────────────────────────────────────────── */}
      <Section title="WHAT YOU OWN">
        <ul>
          <Row
            label="Founder equity"
            value={fmtPct(run.founderEquityPct)}
            meter={run.founderEquityPct}
            tone={run.founderEquityPct < 50 ? "bad" : "flat"}
          />
          <Row
            label="Held by everyone else"
            value={fmtPct(Math.max(0, 100 - run.founderEquityPct))}
          />
          <Row label="Stage" value={STAGE_NAME[run.stage]} plain />
          {nextFloor !== null && (
            <Row
              label={`${STAGE_NAME[(run.stage + 1) as StageNum]} opens at`}
              value={fmtMoney(nextFloor)}
            />
          )}
        </ul>
      </Section>

      {/* ── Product ────────────────────────────────────────────────────── */}
      <Section title={spec.reportLabel}>
        <div className="flex items-baseline justify-between gap-3">
          <p className="min-w-0 text-2xs leading-snug text-[var(--text-tertiary)]">
            {live.length >= cap
              ? `Your team can support ${cap} ${
                  cap === 1 ? spec.noun.toLowerCase() : spec.nounPlural.toLowerCase()
                } well. You have ${live.length}.`
              : `Room for ${cap - live.length} more before the team is stretched.`}
          </p>
          <span className="tnum shrink-0 text-2xs font-bold text-[var(--text-tertiary)]">
            {live.length} / {cap}
          </span>
        </div>

        {earning.length === 0 && developing.length === 0 ? (
          <p className="mt-2 text-2xs leading-snug text-[var(--text-secondary)]">
            Nothing launched yet. Revenue starts when something does.
          </p>
        ) : (
          <ul className="mt-1">
            {earning.map((item) => {
              const h = item.history.at(-1);
              return (
                <li
                  key={item.id}
                  className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] py-2 last:border-b-0"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-bold">{item.name}</span>
                    <span className="tnum block truncate text-2xs text-[var(--text-tertiary)]">
                      {fmtMoney(item.price)}
                      {h
                        ? ` · ${h.units.toLocaleString()} ${spec.demandUnit} in FY${h.year}`
                        : " · no closed year yet"}
                      {item.state === "declining" ? " · past peak" : ""}
                    </span>
                  </span>
                  {h && (
                    <span className="shrink-0 text-right">
                      <span className="tnum block text-xs font-extrabold">
                        {fmtMoney(h.revenue)}
                      </span>
                      <span className="tnum block text-2xs text-[var(--text-tertiary)]">
                        {h.grossMargin}% GM · {h.share}%
                      </span>
                    </span>
                  )}
                </li>
              );
            })}
            {developing.map((item) => (
              <li
                key={item.id}
                className="flex items-baseline justify-between gap-3 border-b border-[var(--hairline)] py-2 last:border-b-0"
              >
                <span className="min-w-0">
                  <span className="block truncate text-xs font-bold">{item.name}</span>
                  <span className="tnum block truncate text-2xs text-[var(--text-tertiary)]">
                    {fmtMoney(item.price)} · starts earning next year
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}

        {retired.length > 0 && (
          <p className="tnum mt-2 text-2xs text-[var(--text-tertiary)]">
            {retired.length} discontinued.
          </p>
        )}

        <ul className="mt-2">
          <Row label="Product quality" value={`${Math.round(s.qual)}`} meter={s.qual} />
          <Row label="CSAT" value={`${Math.round(s.csat)}`} meter={s.csat} />
          <Row
            label="Churn / yr"
            value={fmtPct(s.churnPt)}
            meter={s.churnPt}
            tone="bad"
          />
        </ul>
      </Section>

      {/* ── Market ─────────────────────────────────────────────────────── */}
      <Section title="THE MARKET">
        <ul>
          <Row label="Market share" value={fmtPct(s.marketSharePt)} meter={s.marketSharePt} />
          <Row label="Brand" value={`${Math.round(s.brand)}`} meter={s.brand} />
          <Row label="CWP" value={`${Math.round(s.cwp)}`} meter={s.cwp} />
          <Row label="CAC efficiency" value={`${Math.round(s.cacPt)}`} meter={s.cacPt} />
          <Row label="CTR" value={`${Math.round(s.ctrPt)}`} meter={s.ctrPt} />
        </ul>
      </Section>

      {/* ── People ─────────────────────────────────────────────────────── */}
      <Section title="THE ROOM">
        <ul>
          <Row label="Employees" value={`${headcount}`} />
          {payrollMonthly > 0 && (
            <Row label="Payroll / mo" value={fmtMoney(payrollMonthly)} />
          )}
          <Row label="Morale" value={`${Math.round(s.morale)}`} meter={s.morale} />
          <Row
            label="Founder energy"
            value={`${Math.round(s.energy)}`}
            meter={s.energy}
            tone={s.energy < 25 ? "bad" : "flat"}
          />
          <Row label="Shark respect" value={`${Math.round(s.respect)}`} meter={s.respect} />
        </ul>
      </Section>
    </>
  );
}

// ── Pieces ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-4 pt-5">
      <h3 className="text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
        {title}
      </h3>
      <div className="mt-2">{children}</div>
    </section>
  );
}

function Tile({
  label,
  value,
  tone = "flat",
  note,
}: {
  label: string;
  value: string;
  tone?: Tone;
  note?: string;
}) {
  return (
    <div className="nv-gc min-w-0 rounded-[var(--radius-row)] px-3 py-2.5">
      <p className="truncate text-2xs font-bold tracking-[0.08em] text-[var(--text-tertiary)]">
        {label}
      </p>
      <p
        className="tnum mt-0.5 truncate text-base font-extrabold leading-tight"
        style={{ color: TONE_TEXT[tone] }}
      >
        {value}
      </p>
      {note && (
        <p className="mt-0.5 text-2xs leading-[1.3] text-[var(--text-tertiary)]">{note}</p>
      )}
    </div>
  );
}

function Row({
  label,
  value,
  meter,
  tone = "flat",
  plain,
}: {
  label: string;
  value: string;
  /** 0–100 scalar. Omitted for money and counts, which have no ceiling. */
  meter?: number;
  tone?: Tone;
  /** Word rather than figure — the ledger face is for digits only. */
  plain?: boolean;
}) {
  return (
    <li className="border-b border-[var(--hairline)] py-2.5 last:border-b-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="min-w-0 truncate text-2xs font-semibold text-[var(--text-secondary)]">
          {label}
        </span>
        <span
          className={`shrink-0 text-xs font-extrabold ${plain ? "" : "tnum"}`}
          style={{ color: TONE_TEXT[tone] }}
        >
          {value}
        </span>
      </div>
      {meter !== undefined && <Meter value={meter} tone={tone} label={label} />}
    </li>
  );
}

function Meter({ value, tone, label }: { value: number; tone: Tone; label: string }) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      role="meter"
      aria-label={`${label} out of 100`}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
      className="mt-1.5 h-1 w-full overflow-hidden rounded-full bg-[var(--chip)]"
    >
      <div
        aria-hidden="true"
        className="h-full rounded-full transition-[width] duration-500"
        style={{
          width: `${pct}%`,
          background: tone === "flat" ? "var(--text-primary)" : TONE_TEXT[tone],
          transitionTimingFunction: "var(--ease-out)",
        }}
      />
    </div>
  );
}
