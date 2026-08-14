"use client";

import Image from "next/image";
import Link from "next/link";
import { AccountGate } from "@/components/landing/AccountGate";
import { StoryFooter, Wordbar } from "@/components/product/Bits";
import { CountUp, Pin, Rail, fx } from "@/components/product/Scroll";

/**
 * /product/you — the player's story, told by the scrollbar.
 *
 * Four pinned scenes and a close, choreographed in scene-progress windows
 * (see Scroll.tsx for the engine and globals.css for the `.pv-*` vocabulary):
 *
 *   1 · THE PROMISE   navy stage, the two lines of the promise, one per beat.
 *   2 · THE BOOKS     a phone assembles itself: four figures roll to life,
 *                     a year draws itself, the runway gauge loses months.
 *   3 · THE WORLD     the event deck fans out — real cards, real vocabulary —
 *                     and Today's Market steps forward.
 *   4 · THE PITCH     the lights go down, a viewfinder assembles, the meter
 *                     runs, and five investors take their seats.
 *   5 · THE DOOR      the account gate, on the same navy the story opened on.
 *
 * Every scene's finished state is its resting state, so reduced motion, a
 * crawler and a no-JS visitor read the same page the scroll performs.
 */

const MONEY = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/** The pitch meter's authored bar heights — a take, not noise. */
const METER: readonly number[] = [
  0.22, 0.38, 0.6, 0.44, 0.72, 0.9, 0.62, 0.35, 0.5, 0.78, 0.95, 0.66, 0.4,
  0.58, 0.82, 0.52, 0.3, 0.62, 0.88, 0.7, 0.46, 0.68, 0.5, 0.28, 0.55, 0.74,
  0.42, 0.24,
];

const TRANSCRIPT = "…we're at eleven months of runway, and I'm asking for a year.".split(
  " ",
);

const SHARKS = [
  { name: "Marcus", photo: "/sharks/marcus.webp" },
  { name: "Serena", photo: "/sharks/serena.webp" },
  { name: "Dev", photo: "/sharks/dev.webp" },
  { name: "Lily", photo: "/sharks/lily.webp" },
  { name: "Viktor", photo: "/sharks/viktor.webp" },
] as const;

/**
 * Real cards from the authored library — quoted, not invented. `rest` is
 * where a card lands: a two-by-two spread on a phone (a fan wider than the
 * screen is a fan the screen crops), the dealt fan from `sm` up.
 */
const EVENTS = [
  {
    title: "Refund Storm",
    line: "A batch went out wrong, and the inbox knows it.",
    choices: ["Refund every order", "Hold the line"],
    rest: "left-[3%] top-[2%] -rotate-6 sm:left-[2%] sm:top-[16%]",
    from: { dx: 150, dy: 30, dr: 10 },
  },
  {
    title: "The Convertible Note",
    line: "Money now, dilution later. The note is on the table.",
    choices: ["Sign it", "Walk"],
    rest: "left-[52%] top-[4%] -rotate-2 sm:left-[27%] sm:top-[2%]",
    from: { dx: 60, dy: 70, dr: -8 },
  },
  {
    title: "The Embezzler",
    line: "The numbers don't add up — and it's someone you hired.",
    choices: ["Audit quietly", "Confront them"],
    rest: "left-[3%] top-[56%] rotate-3 sm:left-[52%] sm:top-[10%]",
    from: { dx: -60, dy: 50, dr: 9 },
  },
  {
    title: "Down Round or Die",
    line: "The valuation fell. So did your runway.",
    choices: ["Take the round", "Die proud"],
    rest: "left-[52%] top-[58%] rotate-[8deg] sm:left-[74%] sm:top-[22%]",
    from: { dx: -160, dy: 20, dr: -12 },
  },
] as const;

export function YouStory() {
  return (
    <main className="min-h-dvh">
      <Rail />
      {/* ── 1 · The promise ─────────────────────────────────────────────── */}
      <Pin
        length={2.2}
        initial={0}
        ariaLabel="The promise"
        className="pv-dark nv-stage rounded-b-[2.5rem]"
      >
        <div className="mx-auto flex h-full w-full max-w-6xl flex-1 flex-col px-6 lg:px-10">
          <Wordbar other={{ label: "FOR INSTITUTIONS →", href: "/product/institutions" }} />
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <h1 className="text-[2.5rem] font-extrabold leading-[1.03] tracking-[-0.03em] sm:text-[3.25rem] lg:text-[4rem]">
              <span
                className="nv-rise pv-t pv-fx block"
                style={fx(-1, 0.01, { until: 0.86, overOut: 0.1, uy: 26 })}
              >
                Keep a company alive.
              </span>
              <span
                className="pv-t pv-fx block"
                style={fx(0.12, 0.16, { dy: 30, until: 0.86, overOut: 0.1, uy: 26 })}
              >
                Defend it out loud.
              </span>
            </h1>
            <p
              className="pv-t pv-fx mt-6 max-w-[30rem] text-[0.9375rem] leading-relaxed text-[var(--text-secondary)] lg:text-base"
              style={fx(0.42, 0.18, { dy: 22, until: 0.86, overOut: 0.1, uy: 20 })}
            >
              A life sim for a company. Hiring, pricing, product — every call
              is yours. And once a year the game stops, and turns on your
              camera.
            </p>
          </div>
          <p
            className="pv-t pv-fx pb-[max(1.25rem,var(--nv-safe-bottom))] text-center text-2xs font-bold tracking-[0.24em] text-[var(--text-tertiary)]"
            style={fx(-1, 0.01, { until: 0.1, overOut: 0.08, uy: 0 })}
          >
            SCROLL
            <span
              aria-hidden="true"
              className="mx-auto mt-2 block h-6 w-px bg-[var(--text-tertiary)]/50"
            />
          </p>
        </div>
      </Pin>

      {/* ── 2 · The Books ───────────────────────────────────────────────── */}
      <Pin length={4.5} ariaLabel="The simulation and The Books">
        <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 content-center items-center gap-6 px-6 lg:grid-cols-12 lg:gap-10 lg:px-10">
          <div className="pt-[max(1rem,var(--nv-safe-top))] lg:col-span-5 lg:pt-0">
            <p
              className="pv-kicker tnum pv-t pv-fx text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
              style={fx(0.03, 0.1)}
            >
              01 · THE SIMULATION
            </p>
            <h2
              className="pv-t pv-fx mt-2 text-[1.625rem] font-extrabold leading-tight tracking-[-0.02em] sm:text-[2rem] lg:text-[2.25rem]"
              style={fx(0.05, 0.14, { dy: 26 })}
            >
              Time only moves
              <br />
              when you move it.
            </h2>
            <p
              className="pv-t pv-fx mt-3 max-w-[24rem] text-sm leading-relaxed text-[var(--text-secondary)] lg:text-[0.9375rem]"
              style={fx(0.1, 0.14, { dy: 20 })}
            >
              Advance the month, and the consequences land: payroll clears, a
              rival ships, the books move under you.
            </p>
            <ul className="mt-6 hidden max-w-[24rem] space-y-3.5 lg:block">
              {[
                {
                  at: 0.32,
                  title: "The Books, always on top",
                  body: "Cash, burn, runway, valuation — live, with a month-over-month delta on each figure.",
                },
                {
                  at: 0.58,
                  title: "Twelve months of truth",
                  body: "A sparkline drawn from your own ledger, not a stock photo of a chart.",
                },
                {
                  at: 0.76,
                  title: "A gauge you can feel",
                  body: "Runway in twelve segments. Watch a bad quarter eat three of them.",
                },
              ].map((row) => (
                <li
                  key={row.title}
                  className="pv-t pv-fx border-t border-[var(--hairline)] pt-3"
                  style={fx(row.at, 0.14, { dy: 18 })}
                >
                  <p className="text-sm font-extrabold">{row.title}</p>
                  <p className="mt-0.5 text-sm leading-relaxed text-[var(--text-secondary)]">
                    {row.body}
                  </p>
                </li>
              ))}
            </ul>
          </div>

          {/* The device, assembling itself. */}
          <div className="flex items-center justify-center lg:col-span-7">
            <div
              className="pv-t pv-fx w-full max-w-[22rem] rounded-[2.25rem] bg-[var(--n-3)] p-4 shadow-[var(--e3)] ring-8 ring-[var(--color-navy)]/90 sm:max-w-[24rem]"
              style={fx(0.06, 0.2, { dy: 120, ds: 0.04, dr: -5 })}
            >
              <div
                aria-hidden="true"
                className="mx-auto mb-3 h-1 w-14 rounded-[var(--radius-pill)] bg-[var(--color-navy)]/20"
              />
              <div className="flex items-baseline justify-between gap-3">
                <p className="truncate text-sm font-extrabold tracking-[0.02em]">
                  Northwind Outfitters
                </p>
                <p className="tnum shrink-0 rounded-[var(--radius-chip)] bg-[var(--surface)] px-1.5 py-0.5 text-2xs font-bold text-[var(--text-tertiary)] ring-1 ring-[var(--hairline)]">
                  YR 3 · MO 07
                </p>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2">
                <div className="pv-t pv-fx rounded-[var(--radius-row)] bg-[var(--surface)] p-3 ring-1 ring-[var(--hairline)]" style={fx(0.3, 0.12, { dy: 16 })}>
                  <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                    CASH
                  </p>
                  <p className="tnum mt-1 text-[1.0625rem] font-bold leading-none">
                    <CountUp to={412_380} from={512_000} at={0.34} over={0.2} format={MONEY} />
                  </p>
                  <p className="tnum mt-1 text-2xs font-bold text-[var(--alert)]">−$18.4K MoM</p>
                </div>
                <div className="pv-t pv-fx rounded-[var(--radius-row)] bg-[var(--surface)] p-3 ring-1 ring-[var(--hairline)]" style={fx(0.37, 0.12, { dy: 16 })}>
                  <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                    BURN
                  </p>
                  <p className="tnum mt-1 text-[1.0625rem] font-bold leading-none">
                    <CountUp to={38_400} from={31_000} at={0.4} over={0.18} format={MONEY} />
                  </p>
                  <p className="tnum mt-1 text-2xs font-bold text-[var(--text-tertiary)]">/ MONTH</p>
                </div>
                <div className="pv-t pv-fx rounded-[var(--radius-row)] bg-[var(--surface)] p-3 ring-1 ring-[var(--hairline)]" style={fx(0.44, 0.12, { dy: 16 })}>
                  <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                    RUNWAY
                  </p>
                  <p className="tnum mt-1 text-[1.0625rem] font-bold leading-none">
                    <CountUp to={11} from={14} at={0.72} over={0.2} format={(n) => `${Math.round(n)} mo`} />
                  </p>
                  {/* The death gauge: twelve segments, and the scroll takes three. */}
                  <div className="mt-2 flex gap-[3px]" aria-hidden="true">
                    {Array.from({ length: 12 }, (_, i) => (
                      <span
                        key={i}
                        className={`h-1.5 flex-1 rounded-[2px] ${
                          i >= 11 - 3
                            ? "pv-t pv-dim bg-[var(--text-primary)]"
                            : "bg-[var(--text-primary)]"
                        }`}
                        style={
                          i >= 11 - 3
                            ? ({
                                "--a": String(0.72 + (i - 8) * 0.05),
                                "--w": "0.05",
                              } as React.CSSProperties)
                            : undefined
                        }
                      />
                    ))}
                  </div>
                </div>
                <div className="pv-t pv-fx rounded-[var(--radius-row)] bg-[var(--surface)] p-3 ring-1 ring-[var(--hairline)]" style={fx(0.51, 0.12, { dy: 16 })}>
                  <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                    VALUATION
                  </p>
                  <p className="tnum mt-1 text-[1.0625rem] font-bold leading-none">
                    <CountUp to={2.4} from={1.8} at={0.54} over={0.18} format={(n) => `$${n.toFixed(1)}M`} />
                  </p>
                  <p className="tnum mt-1 text-2xs font-bold text-[var(--solvency)]">+$0.3M MoM</p>
                </div>
              </div>

              {/* Twelve months, drawn from the ledger as the visitor scrolls. */}
              <div className="pv-t pv-fx mt-2 rounded-[var(--radius-row)] bg-[var(--surface)] p-3 ring-1 ring-[var(--hairline)]" style={fx(0.56, 0.12, { dy: 16 })}>
                <div className="flex items-baseline justify-between">
                  <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                    REVENUE · 12 MO
                  </p>
                  <p className="tnum text-2xs font-bold text-[var(--solvency)]">+64% YoY</p>
                </div>
                <svg
                  viewBox="0 0 240 56"
                  className="mt-2 block h-14 w-full text-[var(--text-secondary)]"
                  aria-hidden="true"
                >
                  <path
                    d="M4 48 L24 44 L44 46 L64 38 L84 40 L104 30 L124 33 L144 24 L164 27 L184 18 L204 20 L236 8"
                    pathLength={1}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="pv-t pv-draw"
                    style={{ "--a": "0.6", "--w": "0.22" } as React.CSSProperties}
                  />
                  <circle
                    cx="236"
                    cy="8"
                    r="3.5"
                    fill="currentColor"
                    className="pv-t pv-fx"
                    style={fx(0.82, 0.06, { dy: 0 })}
                  />
                </svg>
              </div>

              <p className="mt-3 text-center text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                THE BOOKS — PINNED TO EVERY SCREEN
              </p>
            </div>
          </div>
        </div>
      </Pin>

      {/* ── 3 · The world pushes back ───────────────────────────────────── */}
      <Pin length={3.6} ariaLabel="The event library">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 lg:px-10">
          <div className="text-center">
            <p
              className="pv-kicker pv-kicker-c tnum pv-t pv-fx text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
              style={fx(0.02, 0.1)}
            >
              02 · THE WORLD
            </p>
            <h2
              className="pv-t pv-fx mt-2 text-[1.625rem] font-extrabold leading-tight tracking-[-0.02em] sm:text-[2rem] lg:text-[2.25rem]"
              style={fx(0.03, 0.14, { dy: 24 })}
            >
              The world pushes back.
            </h2>
            <p
              className="pv-t pv-fx mx-auto mt-3 max-w-[30rem] text-sm leading-relaxed text-[var(--text-secondary)] lg:text-[0.9375rem]"
              style={fx(0.07, 0.14, { dy: 18 })}
            >
              289 authored events — suppliers squeeze, rivals copy, the tax
              letter arrives. Your industry, your problems.
            </p>
          </div>

          {/* The deck, fanning out of one pile. Rest position is the fan;
              each card arrives from the centre of it. */}
          <div className="relative mx-auto mt-6 h-[34rem] w-full max-w-3xl min-[360px]:h-[29rem] sm:h-[17rem]">
            {EVENTS.map((card, i) => (
              <div
                key={card.title}
                className={`absolute w-[45%] max-w-[13rem] sm:w-[24%] sm:max-w-none ${card.rest}`}
              >
                <div
                  className="pv-t pv-fx rounded-[var(--radius-card)] bg-[var(--n-3)] p-3.5 shadow-[var(--e2)] ring-1 ring-[var(--hairline)]"
                  style={fx(0.14 + i * 0.09, 0.16, { dx: card.from.dx, dy: card.from.dy, dr: card.from.dr, ds: 0.06 })}
                >
                  <p className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
                    EVENT
                  </p>
                  <p className="mt-1 text-sm font-extrabold leading-tight">{card.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                    {card.line}
                  </p>
                  <div className="mt-2.5 space-y-1.5">
                    {card.choices.map((c) => (
                      <div
                        key={c}
                        className="rounded-[var(--radius-chip)] bg-[var(--surface)] px-2 py-1 text-2xs font-bold text-[var(--text-secondary)] ring-1 ring-[var(--hairline)]"
                      >
                        {c}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div
            className="pv-t pv-fx mx-auto mt-5 flex max-w-[34rem] flex-wrap items-center justify-center gap-1.5"
            style={fx(0.62, 0.14, { dy: 16 })}
          >
            {["BURN RATE", "RUNWAY", "DILUTION", "CHAPTER 7"].map((term) => (
              <span
                key={term}
                className="tnum rounded-[var(--radius-chip)] bg-[var(--surface)] px-2 py-1 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)] ring-1 ring-[var(--hairline)]"
              >
                {term}
              </span>
            ))}
            <span className="basis-full pt-2 text-center text-2xs leading-relaxed text-[var(--text-tertiary)]">
              Real words only — no coins, no XP. Rookie Mode adds plain
              English beside the term, never instead of it.
            </span>
          </div>

          <div
            className="pv-t pv-fx mx-auto mt-5 w-full max-w-[26rem] rounded-[var(--radius-card)] bg-[var(--n-3)] p-4 shadow-[var(--e3)] ring-2 ring-[var(--text-primary)]"
            style={fx(0.8, 0.14, { dy: 50, ds: 0.05 })}
          >
            <div className="flex items-baseline justify-between gap-3">
              <p className="text-2xs font-extrabold tracking-[0.16em]">TODAY&rsquo;S MARKET</p>
              <p className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
                SEEDED BY TODAY&rsquo;S DATE
              </p>
            </div>
            <p className="mt-1.5 text-sm leading-relaxed text-[var(--text-secondary)]">
              One dated case, drawn for the whole world at once. Every player
              faces the same market today — compare scars tomorrow.
            </p>
          </div>
        </div>
      </Pin>

      {/* ── 4 · The pitch ───────────────────────────────────────────────── */}
      <Pin length={5} ariaLabel="The camera pitch and the shark panel" className="pv-dark nv-stage rounded-t-[2.5rem]">
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center px-6 lg:px-10">
          <p
            className="pv-kicker pv-kicker-c tnum pv-t pv-fx text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
            style={fx(0.015, 0.08, { until: 0.13, overOut: 0.06, uy: 18 })}
          >
            03 · THE PITCH
          </p>
          <p
            className="pv-t pv-fx mt-2 text-center text-[2rem] font-extrabold leading-tight tracking-[-0.03em] sm:text-[2.75rem]"
            style={fx(0.02, 0.09, { dy: 24, until: 0.13, overOut: 0.06, uy: 24 })}
          >
            Then the year ends.
          </p>

          {/* The viewfinder assembles around the take. */}
          <div
            className="pv-t pv-fx relative w-full max-w-[34rem]"
            style={fx(0.16, 0.12, { dy: 30 })}
          >
            <div className="relative aspect-[4/3] w-full sm:aspect-[16/10]">
              {/* Corner brackets. */}
              {[
                "left-0 top-0 border-l-2 border-t-2 rounded-tl-md",
                "right-0 top-0 border-r-2 border-t-2 rounded-tr-md",
                "left-0 bottom-0 border-l-2 border-b-2 rounded-bl-md",
                "right-0 bottom-0 border-r-2 border-b-2 rounded-br-md",
              ].map((pos, i) => (
                <span
                  key={pos}
                  aria-hidden="true"
                  className={`pv-t pv-fx absolute h-7 w-7 border-[var(--text-primary)]/70 ${pos}`}
                  style={fx(0.17 + i * 0.02, 0.08, { dy: 0, ds: 0.35 })}
                />
              ))}

              <div
                className="pv-t pv-fx absolute left-4 top-3 flex items-center gap-1.5"
                style={fx(0.24, 0.08, { dy: 8 })}
              >
                <span className="pv-rec h-2 w-2 rounded-full bg-[var(--alert)]" aria-hidden="true" />
                <span className="text-2xs font-extrabold tracking-[0.18em]">REC</span>
                <span className="tnum pl-1 text-2xs font-bold text-[var(--text-secondary)]">
                  <CountUp
                    to={92}
                    at={0.26}
                    over={0.52}
                    format={(n) => {
                      const s = Math.max(0, Math.round(n));
                      return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
                    }}
                  />
                </span>
              </div>

              {/* The meter: your voice, drawn as you scroll. */}
              <div
                className="absolute left-1/2 top-1/2 flex h-16 -translate-x-1/2 -translate-y-1/2 items-center gap-[3px]"
                aria-hidden="true"
              >
                {METER.map((h, i) => (
                  <span
                    key={i}
                    className="pv-t pv-bar h-full w-1 rounded-full bg-[var(--text-primary)]/80"
                    style={
                      {
                        "--a": String(0.3 + i * 0.006),
                        "--w": "0.1",
                        "--h": String(h),
                      } as React.CSSProperties
                    }
                  />
                ))}
              </div>

              <p className="absolute inset-x-6 bottom-8 text-center text-sm leading-relaxed text-[var(--text-secondary)] sm:text-[0.9375rem]">
                {TRANSCRIPT.map((word, i) => (
                  <span
                    key={i}
                    className="pv-t pv-fx inline-block"
                    style={fx(0.34 + i * 0.013, 0.06, { dy: 8 })}
                  >
                    {word}
                    {i < TRANSCRIPT.length - 1 ? " " : ""}
                  </span>
                ))}
              </p>

              <p
                className="pv-t pv-fx absolute bottom-2 right-4 hidden text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)] sm:block"
                style={fx(0.42, 0.1)}
              >
                20–120 SECONDS · SCORED ON WHAT YOU SAY
              </p>
            </div>
          </div>

          {/* The panel takes its seats. */}
          <div className="mt-6 flex items-end justify-center gap-2.5 sm:gap-4">
            {SHARKS.map((shark, i) => (
              <figure
                key={shark.name}
                className="pv-t pv-fx w-14 text-center sm:w-[4.5rem]"
                style={fx(0.52 + i * 0.055, 0.13, { dy: 60, ds: 0.1 })}
              >
                <div className="overflow-hidden rounded-[var(--radius-row)] shadow-[var(--e2)] ring-1 ring-[var(--hairline)]">
                  <Image
                    src={shark.photo}
                    alt={`${shark.name}, one of the five sharks on the panel`}
                    width={144}
                    height={144}
                    className="block aspect-square w-full object-cover"
                  />
                </div>
                <figcaption className="mt-1.5 text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
                  {shark.name.toUpperCase()}
                </figcaption>
              </figure>
            ))}
          </div>

          <div
            className="pv-t pv-fx mt-5 w-full max-w-[26rem] rounded-[var(--radius-card)] bg-[var(--surface)] p-3.5 shadow-[var(--e2)] ring-1 ring-[var(--hairline)]"
            style={fx(0.72, 0.1, { dy: 26 })}
          >
            <p className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
              SERENA
            </p>
            <p className="mt-1 text-sm font-bold leading-relaxed">
              &ldquo;Your burn doubled in March. Walk me through it.&rdquo;
            </p>
          </div>

          <div
            className="pv-t pv-fx mt-2.5 flex w-full max-w-[26rem] items-baseline justify-between rounded-[var(--radius-card)] bg-[var(--surface)] p-3.5 shadow-[var(--e2)] ring-1 ring-[var(--hairline)]"
            style={fx(0.84, 0.1, { dy: 26 })}
          >
            <p className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">OFFER</p>
            <p className="tnum text-sm font-extrabold text-[var(--solvency)]">$150K FOR 12%</p>
            <p className="text-2xs text-[var(--text-tertiary)]">sized to your books</p>
          </div>

          <div
            className="pv-t pv-fx mt-2.5 flex w-full max-w-[26rem] items-baseline justify-between rounded-[var(--radius-card)] bg-[var(--surface)] p-3.5 shadow-[var(--e2)] ring-1 ring-[var(--hairline)]"
            style={fx(0.9, 0.08, { dy: 26 })}
          >
            <p className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">SCORED</p>
            <p className="tnum text-sm font-extrabold">7 / 10</p>
            {/* The gate's real arithmetic: M = 0.4 + 0.12 × score. */}
            <p className="tnum text-2xs font-bold text-[var(--text-secondary)]">NEXT YEAR <span className="text-[var(--solvency)]">×1.24</span></p>
          </div>

          <p
            className="pv-t pv-fx mt-6 text-center text-sm font-extrabold tracking-[0.02em] text-[var(--text-secondary)]"
            style={fx(0.955, 0.045, { dy: 14 })}
          >
            Score it. Survive it. Go again.
          </p>
        </div>
      </Pin>

      {/* ── 5 · The door ────────────────────────────────────────────────── */}
      <section aria-label="Start playing" className="pv-dark">
        <div className="mx-auto w-full max-w-6xl px-6 pb-[max(3rem,var(--nv-safe-bottom))] pt-20 lg:px-10 lg:pt-28">
          <h2 className="text-[2rem] font-extrabold leading-none tracking-[-0.03em] lg:text-[2.75rem]">
            Your first year is waiting.
          </h2>
          <p className="mt-3 max-w-[30rem] text-sm leading-relaxed text-[var(--text-secondary)] lg:text-[0.9375rem]">
            Free is the whole game — four industries, the full pitch, the same
            score. An account is what keeps your companies, and it costs
            nothing.
          </p>
          <div className="mt-7 max-w-[24rem]">
            <AccountGate />
          </div>
          <div className="mt-10 flex flex-col gap-3 sm:flex-row sm:items-baseline sm:gap-8">
            <a
              href="/download"
              className="text-sm font-bold underline decoration-[var(--hairline)] underline-offset-4 transition-colors hover:decoration-[var(--text-primary)]"
            >
              Get the app
            </a>
            <Link
              href="/product/institutions"
              className="text-sm font-bold underline decoration-[var(--hairline)] underline-offset-4 transition-colors hover:decoration-[var(--text-primary)]"
            >
              Running a class or a competition? For institutions →
            </Link>
          </div>
          <StoryFooter />
        </div>
      </section>
    </main>
  );
}
