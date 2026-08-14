"use client";

import Image from "next/image";
import Link from "next/link";
import { StoryFooter, Wordbar } from "@/components/product/Bits";
import { CountUp, Pin, Rail, fx } from "@/components/product/Scroll";
import { CHAPTER_LICENCES, formatPrice } from "@/lib/monetization";

/**
 * /product/institutions — the other door: classrooms, clubs, summer programs
 * and competitions. Same engine as YouStory, different argument:
 *
 *   1 · THE CLAIM       practiced, not watched.
 *   2 · ONE SEAT        the whole loop a student runs — run, decide, defend.
 *   3 · YOUR SYLLABUS   the stock rubric struck through, line by line, and
 *                       replaced with the institution's own standards.
 *   4 · THE PANEL       what the interrogation is actually made of.
 *   5 · THE SEASON      the seat console filling, and the chapter board.
 *   6 · THE CARE        the privacy posture, stated as fact.
 *   7 · THE DOOR        talk to the team.
 *
 * The personalisation scenes are deliberately written as a SERVICE — "shaped
 * with your team", "tell us what you teach" — because that is what it is
 * today: chapters are set up and tuned with a person, and the call to action
 * is the address. Nothing on this page claims a self-serve feature that does
 * not exist.
 */

const SHARKS = [
  { name: "Marcus", photo: "/sharks/marcus.webp" },
  { name: "Serena", photo: "/sharks/serena.webp" },
  { name: "Dev", photo: "/sharks/dev.webp" },
  { name: "Lily", photo: "/sharks/lily.webp" },
  { name: "Viktor", photo: "/sharks/viktor.webp" },
] as const;

/** The stock rubric line, and the line your program writes over it. */
const RUBRIC = [
  { stock: "Problem and solution", yours: "Unit economics, argued from the year's books" },
  { stock: "Market size", yours: "Marketing mix, applied to a real launch" },
  { stock: "Confidence on camera", yours: "Sources of finance, weighed out loud" },
  { stock: "A memorable story", yours: "Your capstone criteria, scored at every year-end" },
] as const;

const SUBJECTS = ["MARKETING", "FINANCE", "ECONOMICS", "ACCOUNTING", "BUSINESS LAW", "CAPSTONE"] as const;

const SEATS = [
  { label: "seat 01", email: "a•••@yourschool.edu" },
  { label: "seat 02", email: "j•••@yourschool.edu" },
  { label: "seat 03", email: "m•••@yourschool.edu" },
  { label: "seat 04", email: "r•••@yourschool.edu" },
  { label: "seat 05", email: "s•••@yourschool.edu" },
] as const;

const BOARD = [
  { rank: 1, handle: "Brave Falcon 4821", years: 7 },
  { rank: 2, handle: "Quiet Harbor 118", years: 6 },
  { rank: 3, handle: "Solar Badger 77", years: 5 },
  { rank: 4, handle: "Iron Kestrel 3042", years: 4 },
] as const;

export function InstitutionsStory() {
  const [seats35, seats100] = CHAPTER_LICENCES;

  return (
    <main className="min-h-dvh">
      <Rail />
      {/* ── 1 · The claim ───────────────────────────────────────────────── */}
      <Pin length={2.2} initial={0} ariaLabel="The claim" className="pv-dark nv-stage rounded-b-[2.5rem]">
        <div className="mx-auto flex h-full w-full max-w-6xl flex-1 flex-col px-6 lg:px-10">
          <Wordbar other={{ label: "FOR YOU →", href: "/product/you" }} />
          <div className="flex flex-1 flex-col items-center justify-center text-center">
            <p
              className="nv-rise text-2xs font-bold tracking-[0.24em] text-[var(--text-tertiary)]"
            >
              NOVUS FOR INSTITUTIONS
            </p>
            <h1 className="mt-4 font-display text-[2.75rem] font-normal leading-[1.04] tracking-[-0.015em] sm:text-[3.5rem] lg:text-[4.25rem]">
              <span
                className="nv-rise pv-t pv-fx block"
                style={fx(-1, 0.01, { until: 0.86, overOut: 0.1, uy: 26 })}
              >
                Entrepreneurship, practiced.
              </span>
              <span
                className="pv-t pv-fx block"
                style={fx(0.12, 0.16, { dy: 30, until: 0.86, overOut: 0.1, uy: 26 })}
              >
                Not watched.
              </span>
            </h1>
            <p
              className="pv-t pv-fx mt-6 max-w-[32rem] text-[0.9375rem] leading-relaxed text-[var(--text-secondary)] lg:text-base"
              style={fx(0.42, 0.18, { dy: 22, until: 0.86, overOut: 0.1, uy: 20 })}
            >
              Every student gets a company of their own to run — and once a
              year, a panel to face, out loud, on camera. For classrooms,
              clubs, summer programs and competitions.
            </p>
          </div>
          <p
            className="pv-t pv-fx pb-[max(1.25rem,var(--nv-safe-bottom))] text-center text-2xs font-bold tracking-[0.24em] text-[var(--text-tertiary)]"
            style={fx(-1, 0.01, { until: 0.1, overOut: 0.08, uy: 0 })}
          >
            SCROLL
          </p>
        </div>
      </Pin>

      {/* ── 2 · One seat is a whole company ─────────────────────────────── */}
      <Pin length={3.6} ariaLabel="What one seat contains">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 lg:px-10">
          <div className="text-center">
            <p
              className="tnum pv-t pv-fx text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
              style={fx(0.02, 0.1)}
            >
              01 · THE GAME
            </p>
            <h2
              className="font-display pv-t pv-fx mt-2 text-[1.875rem] font-normal leading-[1.1] tracking-[-0.01em] sm:text-[2.25rem] lg:text-[2.625rem]"
              style={fx(0.03, 0.14, { dy: 24 })}
            >
              One seat is a whole company.
            </h2>
            <p
              className="pv-t pv-fx mx-auto mt-3 max-w-[32rem] text-sm leading-relaxed text-[var(--text-secondary)] lg:text-[0.9375rem]"
              style={fx(0.07, 0.14, { dy: 18 })}
            >
              Not a worksheet about a business — a business. A student hires,
              prices, ships, and sits with the quarter they caused.
            </p>
          </div>

          <div className="mx-auto mt-8 grid w-full max-w-4xl gap-4 sm:grid-cols-3">
            {/* RUN */}
            <div
              className="pv-t pv-fx rounded-[var(--radius-card)] bg-[var(--n-3)] p-4 shadow-[var(--e2)] ring-1 ring-[var(--hairline)]"
              style={fx(0.16, 0.15, { dy: 44, ds: 0.05 })}
            >
              <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">RUN</p>
              <div className="mt-3 space-y-2">
                <div className="flex items-baseline justify-between border-t border-[var(--hairline)] pt-2">
                  <span className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">CASH</span>
                  <span className="tnum text-sm font-bold">
                    <CountUp to={412_380} from={520_000} at={0.24} over={0.18} format={(n) => `$${Math.round(n).toLocaleString("en-US")}`} />
                  </span>
                </div>
                <div className="flex items-baseline justify-between border-t border-[var(--hairline)] pt-2">
                  <span className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">RUNWAY</span>
                  <span className="tnum text-sm font-bold">
                    <CountUp to={11} from={14} at={0.28} over={0.16} format={(n) => `${Math.round(n)} mo`} />
                  </span>
                </div>
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                The Books — cash, burn, runway, valuation — live on every
                screen, in real vocabulary.
              </p>
            </div>

            {/* DECIDE */}
            <div
              className="pv-t pv-fx rounded-[var(--radius-card)] bg-[var(--n-3)] p-4 shadow-[var(--e2)] ring-1 ring-[var(--hairline)]"
              style={fx(0.34, 0.15, { dy: 44, ds: 0.05 })}
            >
              <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">DECIDE</p>
              <p className="mt-3 text-sm font-extrabold leading-tight">Down Round or Die</p>
              <p className="mt-1 text-xs leading-relaxed text-[var(--text-secondary)]">
                The valuation fell. So did your runway.
              </p>
              <div className="mt-2.5 space-y-1.5">
                {["Take the round", "Die proud"].map((c) => (
                  <div
                    key={c}
                    className="rounded-[var(--radius-chip)] bg-[var(--surface)] px-2 py-1 text-2xs font-bold text-[var(--text-secondary)] ring-1 ring-[var(--hairline)]"
                  >
                    {c}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                289 authored events push back — drawn toward whatever a student
                is weakest at.
              </p>
            </div>

            {/* DEFEND */}
            <div
              className="pv-t pv-fx rounded-[var(--radius-card)] bg-[var(--n-3)] p-4 shadow-[var(--e2)] ring-1 ring-[var(--hairline)]"
              style={fx(0.52, 0.15, { dy: 44, ds: 0.05 })}
            >
              <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">DEFEND</p>
              <div className="mt-3 flex items-center gap-1.5">
                <span className="pv-rec h-2 w-2 rounded-full bg-[var(--alert)]" aria-hidden="true" />
                <span className="text-2xs font-extrabold tracking-[0.18em]">REC</span>
                <span className="tnum text-2xs font-bold text-[var(--text-tertiary)]">01:32</span>
              </div>
              <div className="mt-3 flex -space-x-1.5">
                {SHARKS.map((shark, i) => (
                  <span
                    key={shark.name}
                    className="pv-t pv-fx inline-block"
                    style={fx(0.6 + i * 0.03, 0.08, { dy: 10 })}
                  >
                    <Image
                      src={shark.photo}
                      alt={shark.name}
                      width={64}
                      height={64}
                      className="block h-9 w-9 rounded-full object-cover ring-2 ring-[var(--n-3)]"
                    />
                  </span>
                ))}
              </div>
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                The fiscal year will not close without a scored, on-camera
                pitch to the five-shark panel.
              </p>
            </div>
          </div>

          <p
            className="pv-t pv-fx mx-auto mt-7 max-w-[30rem] text-center text-sm font-bold leading-relaxed text-[var(--text-primary)]"
            style={fx(0.82, 0.12, { dy: 16 })}
          >
            A year of company life, ended the only honest way: standing up and
            defending it.
          </p>
        </div>
      </Pin>

      {/* ── 3 · Your syllabus, not ours ─────────────────────────────────── */}
      <Pin length={4} ariaLabel="Personalised curriculum and rubric">
        <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 content-center items-center gap-8 px-6 lg:grid-cols-12 lg:gap-10 lg:px-10">
          <div className="lg:col-span-5">
            <p
              className="tnum pv-t pv-fx text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
              style={fx(0.03, 0.1)}
            >
              02 · PERSONALISED, PROPERLY
            </p>
            <h2
              className="font-display pv-t pv-fx mt-2 text-[1.875rem] font-normal leading-[1.1] tracking-[-0.01em] sm:text-[2.25rem] lg:text-[2.625rem]"
              style={fx(0.05, 0.14, { dy: 26 })}
            >
              Your syllabus,
              <br />
              not ours.
            </h2>
            <p
              className="pv-t pv-fx mt-3 max-w-[26rem] text-sm leading-relaxed text-[var(--text-secondary)] lg:text-[0.9375rem]"
              style={fx(0.1, 0.14, { dy: 20 })}
            >
              The knowledge inside the run and the standard the panel scores
              by can both be shaped to your program. Preparing a cohort for a
              business competition? Tune the rubric to the judging sheet.
              Teaching finance? Weight the events that stress the books.
            </p>
            <div
              className="pv-t pv-fx mt-5 flex max-w-[26rem] flex-wrap gap-1.5"
              style={fx(0.3, 0.14, { dy: 14 })}
            >
              {SUBJECTS.map((s, i) => (
                <span
                  key={s}
                  className="pv-t pv-fx rounded-[var(--radius-chip)] bg-[var(--n-3)] px-2 py-1 text-2xs font-bold tracking-[0.08em] text-[var(--text-secondary)] ring-1 ring-[var(--hairline)]"
                  style={fx(0.32 + i * 0.05, 0.1, { dy: 8 })}
                >
                  {s}
                </span>
              ))}
            </div>
            <p
              className="pv-t pv-fx mt-5 max-w-[26rem] text-sm font-bold leading-relaxed"
              style={fx(0.82, 0.12, { dy: 14 })}
            >
              Tell us what you teach. We tune the season with you, before it
              starts.
            </p>
          </div>

          {/* The rubric card: the stock line struck through, yours written in. */}
          <div className="lg:col-span-7">
            <div
              className="pv-t pv-fx mx-auto w-full max-w-[30rem] rounded-[var(--radius-card)] bg-[var(--n-3)] p-5 shadow-[var(--e3)] ring-1 ring-[var(--hairline)]"
              style={fx(0.12, 0.16, { dy: 60, ds: 0.04, dr: -3 })}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-2xs font-extrabold tracking-[0.16em]">PITCH RUBRIC</p>
                <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                  YOURS, NOT STOCK
                </p>
              </div>
              <ul className="mt-4 space-y-4">
                {RUBRIC.map((row, i) => {
                  const at = 0.3 + i * 0.13;
                  return (
                    <li key={row.stock} className="border-t border-[var(--hairline)] pt-3">
                      <p className="relative inline-block text-sm text-[var(--text-tertiary)]">
                        {row.stock}
                        {/* The strike draws itself across the stock line. */}
                        <span
                          aria-hidden="true"
                          className="pv-t pv-wipe absolute left-0 top-1/2 h-[2px] w-full bg-current"
                          style={{ "--a": String(at), "--w": "0.06" } as React.CSSProperties}
                        />
                      </p>
                      <p
                        className="pv-t pv-fx mt-1 text-sm font-extrabold leading-snug"
                        style={fx(at + 0.05, 0.08, { dy: 10 })}
                      >
                        {row.yours}
                      </p>
                    </li>
                  );
                })}
              </ul>
            </div>
          </div>
        </div>
      </Pin>

      {/* ── 4 · The panel ───────────────────────────────────────────────── */}
      <Pin length={4} ariaLabel="The trained panel">
        <div className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 content-center items-center gap-8 px-6 lg:grid-cols-12 lg:gap-10 lg:px-10">
          <div className="lg:col-span-5">
            <p
              className="tnum pv-t pv-fx text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
              style={fx(0.03, 0.1)}
            >
              03 · THE PANEL
            </p>
            <h2
              className="font-display pv-t pv-fx mt-2 text-[1.875rem] font-normal leading-[1.1] tracking-[-0.01em] sm:text-[2.25rem] lg:text-[2.625rem]"
              style={fx(0.05, 0.14, { dy: 26 })}
            >
              An examiner that has
              <br />
              done its homework.
            </h2>
            <p
              className="pv-t pv-fx mt-3 max-w-[26rem] text-sm leading-relaxed text-[var(--text-secondary)] lg:text-[0.9375rem]"
              style={fx(0.1, 0.14, { dy: 20 })}
            >
              The five sharks are built and trained for exactly one job:
              interrogating a student&rsquo;s company the way an investor
              would — from the student&rsquo;s own numbers, in front of the
              class&rsquo;s own standards.
            </p>
            <ul className="mt-6 max-w-[26rem] space-y-3.5">
              {[
                {
                  at: 0.44,
                  line: "It reads the year's real books before it asks anything.",
                },
                { at: 0.54, line: "It never asks the same question twice." },
                {
                  at: 0.64,
                  line: "Its offers are sized to the numbers on the table, not to a script.",
                },
                {
                  at: 0.74,
                  line: "Delivery — eye contact, pace, filler — is measured on device, and scored nowhere.",
                  sub: "The panel grades the logic, not the kid. That is a design law, not a setting.",
                },
              ].map((row) => (
                <li
                  key={row.line}
                  className="pv-t pv-fx border-t border-[var(--hairline)] pt-3"
                  style={fx(row.at, 0.12, { dy: 16 })}
                >
                  <p className="text-sm font-bold leading-relaxed">{row.line}</p>
                  {row.sub ? (
                    <p className="mt-0.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                      {row.sub}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          {/* The transcript, read the way the panel reads it. */}
          <div className="lg:col-span-7">
            <div
              className="pv-t pv-fx mx-auto w-full max-w-[30rem] rounded-[var(--radius-card)] bg-[var(--n-3)] p-5 shadow-[var(--e3)] ring-1 ring-[var(--hairline)]"
              style={fx(0.12, 0.16, { dy: 60, ds: 0.04, dr: 3 })}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-2xs font-extrabold tracking-[0.16em]">LIVE TRANSCRIPT</p>
                <p className="tnum text-2xs font-bold text-[var(--text-tertiary)]">00:47</p>
              </div>
              <p className="mt-3 text-[0.9375rem] leading-[1.8] text-[var(--text-secondary)]">
                &ldquo;…gross margin is{" "}
                <Marked at={0.3}>41 points</Marked>, up nine since the spring —
                the discounting experiment{" "}
                <Marked at={0.42}>paid for itself</Marked>, and I can show you{" "}
                <Marked at={0.54}>where it shows up in the books</Marked>
                …&rdquo;
              </p>
              <div className="mt-4 flex items-center justify-between border-t border-[var(--hairline)] pt-3">
                <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                  WHAT THE PANEL HEARD
                </p>
                <p className="tnum text-2xs font-bold text-[var(--text-secondary)]">
                  CLAIMS TO PRESS: <CountUp to={3} at={0.3} over={0.3} format={(n) => String(Math.round(n))} />
                </p>
              </div>
              <div
                className="pv-t pv-fx mt-3 rounded-[var(--radius-row)] bg-[var(--surface)] p-3 ring-1 ring-[var(--hairline)]"
                style={fx(0.68, 0.1, { dy: 18 })}
              >
                <p className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
                  VIKTOR
                </p>
                <p className="mt-1 text-sm font-bold leading-relaxed">
                  &ldquo;Show me. Which line of the books did the discount move?&rdquo;
                </p>
              </div>
            </div>
          </div>
        </div>
      </Pin>

      {/* ── 5 · The season ──────────────────────────────────────────────── */}
      <Pin length={4.5} ariaLabel="The seat console and the chapter board">
        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-6 lg:px-10">
          <div className="text-center">
            <p
              className="tnum pv-t pv-fx text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
              style={fx(0.02, 0.1)}
            >
              04 · THE SEASON
            </p>
            <h2
              className="font-display pv-t pv-fx mt-2 text-[1.875rem] font-normal leading-[1.1] tracking-[-0.01em] sm:text-[2.25rem] lg:text-[2.625rem]"
              style={fx(0.03, 0.14, { dy: 24 })}
            >
              Seated in minutes. Scored all season.
            </h2>
          </div>

          <div className="mx-auto mt-7 grid w-full max-w-4xl gap-4 lg:grid-cols-2">
            {/* The console. */}
            <div
              className="pv-t pv-fx rounded-[var(--radius-card)] bg-[var(--n-3)] p-4 shadow-[var(--e2)] ring-1 ring-[var(--hairline)]"
              style={fx(0.1, 0.15, { dy: 44, ds: 0.04 })}
            >
              <div className="flex items-baseline justify-between gap-3">
                <p className="text-2xs font-extrabold tracking-[0.16em]">YOUR CHAPTER</p>
                <p className="tnum text-2xs font-bold text-[var(--text-tertiary)]">
                  <CountUp to={35} from={0} at={0.42} over={0.3} format={(n) => `${Math.round(n)} SEATS`} />
                </p>
              </div>
              <ul className="mt-3">
                {SEATS.map((seat, i) => {
                  const claimAt = 0.42 + i * 0.06;
                  return (
                    <li
                      key={seat.label}
                      // The last two rows yield on a phone: the pinned frame
                      // is one viewport tall, and five rows plus the board
                      // below it is a composition for a screen with room.
                      className={`pv-t pv-fx items-center justify-between gap-3 border-t border-[var(--hairline)] py-2 ${
                        i >= 3 ? "hidden sm:flex" : "flex"
                      }`}
                      style={fx(0.16 + i * 0.045, 0.1, { dy: 12 })}
                    >
                      <p className="tnum text-xs font-bold text-[var(--text-secondary)]">
                        {seat.label} · {seat.email}
                      </p>
                      <span className="tnum relative text-2xs font-bold">
                        <span
                          className="pv-t pv-fx rounded-[var(--radius-chip)] bg-[var(--surface)] px-1.5 py-0.5 text-[var(--text-tertiary)] ring-1 ring-[var(--hairline)]"
                          style={fx(-1, 0.01, { until: claimAt, overOut: 0.04, uy: 0 })}
                        >
                          INVITED
                        </span>
                        <span
                          className="pv-t pv-fx absolute right-0 top-0 rounded-[var(--radius-chip)] bg-[var(--surface)] px-1.5 py-0.5 text-[var(--text-primary)] ring-1 ring-[var(--text-primary)]"
                          style={fx(claimAt, 0.05, { dy: 4 })}
                        >
                          CLAIMED
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                Invite by email or register a whole class from a list. Every
                seat is Pro for the year, and no student is asked for a card.
                The roster survives renewal — and even a lapse.
              </p>
            </div>

            {/* The board. */}
            <div
              className="pv-t pv-fx rounded-[var(--radius-card)] bg-[var(--n-3)] p-4 shadow-[var(--e2)] ring-1 ring-[var(--hairline)]"
              style={fx(0.5, 0.15, { dy: 44, ds: 0.04 })}
            >
              <div className="flex items-center justify-between gap-3">
                <p className="text-2xs font-extrabold tracking-[0.16em]">STILL STANDING</p>
                <div className="flex gap-1" aria-hidden="true">
                  <span className="rounded-[var(--radius-pill)] bg-[var(--surface-elevated)] px-2 py-0.5 text-2xs font-bold shadow-[var(--e1)]">
                    MY CHAPTER
                  </span>
                  <span className="rounded-[var(--radius-pill)] px-2 py-0.5 text-2xs font-bold text-[var(--text-tertiary)]">
                    GLOBAL
                  </span>
                </div>
              </div>
              <ul className="mt-3">
                {BOARD.map((row, i) => (
                  <li
                    key={row.handle}
                    className="pv-t pv-fx flex items-baseline justify-between gap-3 border-t border-[var(--hairline)] py-2"
                    style={fx(0.58 + i * 0.05, 0.1, { dy: 12 })}
                  >
                    <p className="tnum text-xs font-bold">
                      <span className="pr-2 text-[var(--text-tertiary)]">{row.rank}</span>
                      {row.handle}
                    </p>
                    <p className="tnum text-xs font-bold text-[var(--text-secondary)]">
                      {row.years} yrs standing
                    </p>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-[var(--text-secondary)]">
                A board scoped to your chapter, over anonymous handles, season
                by season — every number re-verified by the server before it
                ranks. Built for competitions, honest by construction.
              </p>
              <p className="mt-2 text-xs font-bold leading-relaxed">
                A place on the board is never for sale — that rule is enforced
                in the build, not the marketing.
              </p>
            </div>
          </div>
        </div>
      </Pin>

      {/* ── 6 · The care ────────────────────────────────────────────────── */}
      <Pin length={2.8} ariaLabel="Privacy and compliance posture">
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-6 lg:px-10">
          <div className="text-center">
            <p
              className="tnum pv-t pv-fx text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]"
              style={fx(0.03, 0.1)}
            >
              05 · THE CARE
            </p>
            <h2
              className="font-display pv-t pv-fx mt-2 text-[1.875rem] font-normal leading-[1.1] tracking-[-0.01em] sm:text-[2.25rem] lg:text-[2.625rem]"
              style={fx(0.05, 0.14, { dy: 24 })}
            >
              Built for minors, on purpose.
            </h2>
          </div>
          <div className="mx-auto mt-7 grid w-full max-w-3xl gap-3 sm:grid-cols-2">
            {[
              {
                title: "Video never leaves the device",
                body: "Delivery is analysed on the student's own hardware; the frames are discarded, not uploaded.",
              },
              {
                title: "Anonymous in public",
                body: "Boards run on curated handles and moderated company names — never real names, never exact timestamps.",
              },
              {
                title: "No tracking in the mail",
                body: "Seat invitations are plain messages. A student's email is visible to their own teacher, and to no one else.",
              },
              {
                title: "Nothing buys a score",
                body: "Score, survival, revives and board position are unpurchasable at any price, in any build.",
              },
            ].map((card, i) => (
              <div
                key={card.title}
                className="pv-t pv-fx rounded-[var(--radius-card)] bg-[var(--n-3)] p-4 shadow-[var(--e1)] ring-1 ring-[var(--hairline)]"
                style={fx(0.14 + i * 0.1, 0.14, { dy: 30 })}
              >
                <p className="text-sm font-extrabold leading-tight">{card.title}</p>
                <p className="mt-1.5 text-xs leading-relaxed text-[var(--text-secondary)]">
                  {card.body}
                </p>
              </div>
            ))}
          </div>
          <p
            className="pv-t pv-fx mx-auto mt-7 max-w-[28rem] text-center text-sm font-bold leading-relaxed"
            style={fx(0.68, 0.12, { dy: 14 })}
          >
            The camera is the product — so the camera is where the care went.
          </p>
        </div>
      </Pin>

      {/* ── 7 · The door ────────────────────────────────────────────────── */}
      <section aria-label="Talk to the team" className="pv-dark rounded-t-[2.5rem]">
        <div className="mx-auto w-full max-w-6xl px-6 pb-[max(3rem,var(--nv-safe-bottom))] pt-20 lg:px-10 lg:pt-28">
          <h2 className="font-display max-w-[16em] text-[2.25rem] font-normal leading-[1.08] tracking-[-0.015em] lg:text-[3rem]">
            Bring Novus to your institution.
          </h2>
          <p className="mt-3 max-w-[32rem] text-sm leading-relaxed text-[var(--text-secondary)] lg:text-[0.9375rem]">
            Tell us about your class, club, cohort or competition — what you
            teach, what you score, how many seats. We set the chapter up and
            tune the season with you.
          </p>
          <div className="mt-7 flex max-w-[30rem] flex-col gap-3 sm:flex-row sm:items-center">
            <a
              href="mailto:team@novuspitch.com?subject=Novus%20for%20our%20institution"
              className="nv-gc nv-t-action rounded-[var(--radius-card)] px-6 py-3.5 text-center text-sm font-extrabold tracking-[0.04em]"
            >
              TALK TO THE TEAM
            </a>
            <a
              href="/#pro"
              className="px-2 py-2 text-center text-sm font-bold underline decoration-[var(--hairline)] underline-offset-4 transition-colors hover:decoration-[var(--text-primary)] sm:text-left"
            >
              Or start a licence now
            </a>
          </div>
          <p className="tnum mt-4 max-w-[32rem] text-xs leading-relaxed text-[var(--text-tertiary)]">
            Licences run {formatPrice(seats35.priceCents)} a year for{" "}
            {seats35.seats} seats and {formatPrice(seats100.priceCents)} for{" "}
            {seats100.seats} — or any size you type. Every seat is Pro, and no
            student ever pays.
          </p>
          <div className="mt-10">
            <Link
              href="/product/you"
              className="text-sm font-bold underline decoration-[var(--hairline)] underline-offset-4 transition-colors hover:decoration-[var(--text-primary)]"
            >
              Just playing? The player&rsquo;s side →
            </Link>
          </div>
          <StoryFooter />
        </div>
      </section>
    </main>
  );
}

/**
 * A phrase the panel underlined while listening: the ink lifts to full
 * strength as a hairline draws itself beneath — never colour alone.
 */
function Marked({ at, children }: { at: number; children: React.ReactNode }) {
  return (
    <span className="relative whitespace-nowrap font-bold text-[var(--text-primary)]">
      {children}
      <span
        aria-hidden="true"
        className="pv-t pv-wipe absolute -bottom-0.5 left-0 h-[2px] w-full bg-current"
        style={{ "--a": String(at), "--w": "0.08" } as React.CSSProperties}
      />
    </span>
  );
}
