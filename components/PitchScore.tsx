"use client";

import { play } from "@/lib/sound";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { ENTER } from "@/components/ui/Motion";
import { SharkStage } from "@/components/SharkStage";
import { SharkPanel, type TankOutcome } from "@/components/SharkPanel";
import { TankDebrief } from "@/components/TankDebrief";
import { speak } from "@/lib/ai/speech";
import { getPlayerAsk } from "@/lib/ai/ask";
import { CAST } from "@/lib/ai/panel-cast";
import { latchRejectedOffers } from "@/lib/rewards/latch";
import { reportPlay } from "@/lib/rewards/report";
import { fmtMoney } from "@/lib/engine/format";
import type { PitchTranscript } from "@/lib/ai/types";
import type { DeliveryCoaching } from "@/lib/ai/delivery-coach";
import type { ContentFinding } from "@/lib/ai/pitch-content";
import type { RunState } from "@/lib/engine/types";
import { PITCH_FRAMEWORK, beatsCovered } from "@/lib/engine/company-brief";
import { buildPanelContext } from "@/lib/ai/panel-context";
import { buildDebrief } from "@/lib/ai/debrief";
import type { TankDebriefData } from "@/lib/ai/debrief-types";
import { S_UNIT } from "@/lib/engine/constants";

/**
 * THE ROOM, AND THEN THE VERDICT, AND THEN THE REPORT.
 *
 * ── The order changed twice, and the order was the bug both times ──────────
 *
 * Originally this screen was the whole of the feedback — score, sub-scores,
 * line edits, priorities — with a button into The Tank underneath it. So the
 * report was written before the hardest part of the exercise had happened, and
 * could say nothing about how the player held up under questioning.
 *
 * The first fix made this screen thin and put the full report after the room.
 * That left the SCORE still in front of it, which has the same shape of
 * problem: a number on the opening two minutes, delivered before the room has
 * asked a single question, that the room then spends ten turns contradicting.
 *
 * So for a year gate the order is now: the room, then this score, then
 * `TankDebrief`. A performance with no room to face still opens here.
 *
 * ── The other bug: the feedback was somebody else's ────────────────────────
 *
 * The old card rendered `coach.line_edits` and `coach.top_3_priorities`
 * straight out of `lib/ai/fixtures/coach-reports.json`. That fixture's quotes
 * include "Hi. I'm sixteen, and I've been running this company for eleven
 * months." Players saw feedback about being sixteen no matter what they said,
 * because the card was quoting a fixture rather than reading a transcript.
 *
 * Nothing here renders a fixture. Every line below comes from
 * `scorePitchContent`, which reads the player's actual words and checks their
 * claims against their actual books.
 *
 * ── And the sub-scores went too ────────────────────────────────────────────
 *
 * They were Clarity, Fluency, Logic and Grammar — from the same fixture, and
 * two of those four are things Brand Law 5 forbids scoring at all. They are
 * replaced by the four things the content scorer genuinely measures: whether
 * the pitch covered what a pitch must cover, whether it cited anything
 * concrete, whether its claims survive the books, and how much of the standard
 * structure it reached.
 */
export function PitchScore({
  score,
  run,
  transcript,
  findings,
  delivery,
  isYearGate,
  tutorialFloor,
  onContinue,
}: {
  score: number;
  run: RunState;
  transcript: PitchTranscript;
  /** What the content scorer actually found in these words. */
  findings: ContentFinding[];
  /**
   * The camera-and-mic coaching — eye contact, gestures, body language, volume.
   * Carried through to the debrief, where it is rendered under a header that
   * says it changed nothing. Never an input to `score`.
   */
  delivery?: DeliveryCoaching | null;
  isYearGate: boolean;
  tutorialFloor: boolean;
  onContinue: (dealCashS?: number, dealEquityPct?: number) => void;
}) {
  const [verdict, setVerdict] = useState("");
  /*
   * ── The order, changed again ──────────────────────────────────────────────
   *
   * It was score → room → report. The score is a verdict on the opening two
   * minutes, and reading a verdict BEFORE the questioning tells a player how
   * they did before the hardest part has happened — and worse, sets an
   * expectation the room then contradicts.
   *
   * It is now room → score → report. You pitch, you get questioned, and only
   * then does anything put a number on it; the full breakdown follows. A
   * performance that is not a year gate has no room to face, so it opens on
   * the score exactly as before.
   */
  const [stage, setStage] = useState<"score" | "panel" | "debrief">(
    isYearGate ? "panel" : "score",
  );
  const [debrief, setDebrief] = useState<TankDebriefData | null>(null);
  const [deal, setDeal] = useState<{ cashS?: number; equityPct?: number }>({});
  /** What actually happened in the room, kept for the verdict line. */
  const [tankFacts, setTankFacts] = useState<{
    offers: number;
    acceptedUsd: number | null;
    acceptedPct: number | null;
    acceptedFrom: string | null;
  } | null>(null);

  /*
   * The verdict cue fires when the score is REACHED, not when this component
   * mounts.
   *
   * On a year gate this component now mounts straight into the room, and this
   * effect used to run on mount: a celebration sting and the Chair reading the
   * verdict out loud over the top of the Tank's own opening — a spoiler and a
   * second voice, both at the worst possible moment. Keying it to the stage
   * makes it what it always read as: the sound of the number landing.
   *
   * The line itself is COMPOSED from this session, not drawn from a fixture.
   * `chairLine("score_mid")` picked from four canned sentences, so a founder
   * who never made an ask and a founder whose margin claim contradicted their
   * own P&L heard the same words — a verdict that describes nothing convinces
   * nobody. Every clause below traces to a finding, a beat, or an offer that
   * actually happened.
   */
  useEffect(() => {
    if (stage !== "score") return;
    play(score >= 8 ? "celebrate" : score >= 5 ? "success" : "error");
    const line = verdictLine({
      score,
      findings,
      transcriptText: transcript.text,
      tank: isYearGate ? tankFacts : null,
    });
    setVerdict(line);
    void speak(line, "narrator");
  }, [score, stage, findings, transcript.text, tankFacts, isYearGate]);

  /**
   * The room finished. Build the report from the WHOLE session and show it.
   *
   * The deal is banked here rather than applied immediately, because the player
   * has not seen the debrief yet and the debrief is the point — closing the year
   * before they read it would put the report behind a screen nobody returns to.
   */
  const tankDone = useCallback(
    async (dealCashS: number | undefined, dealEquityPct: number | undefined, outcome: TankOutcome) => {
      setDeal({ cashS: dealCashS, equityPct: dealEquityPct });
      // The facts the verdict line reads: how many bid, and what was signed.
      setTankFacts({
        offers: outcome.offers.length,
        acceptedUsd: outcome.accepted?.amount_usd ?? null,
        acceptedPct: outcome.accepted?.equity_pct ?? null,
        acceptedFrom: outcome.acceptedFrom ? (CAST[outcome.acceptedFrom]?.name ?? null) : null,
      });
      /*
       * Straight to the score, and the report is built while it is being read.
       * The debrief takes a real model call; starting it here means the player
       * spends that time reading their number instead of watching a spinner,
       * and it is usually finished before they press through.
       */
      /*
       * ── The panel's moments, all from one place ─────────────────────────
       *
       * Every fact the deals family grades on is in `outcome`, and this is the
       * only point where all of it is in one scope: how many bid, what was
       * signed, by whom, and whether the founder pushed back first. Reporting
       * from `SharkPanel` would mean four call sites inside a step machine;
       * reporting from `submitPerform` would mean the shark's name never
       * arrives, because the deal is banked as two numbers.
       *
       * `deal.closed` lives here rather than beside the year close for that
       * reason — the server ignores the amount and re-reads the books either
       * way, but D4 ("close a deal with {shark}") has nothing to grade without
       * the name.
       */
      const bidders = outcome.offers.length;
      reportPlay("panel.qna", { answered: outcome.answers.filter((a) => !a.declined).length });
      if (bidders > 0) {
        reportPlay("panel.offers", { offers: bidders });
        if (bidders >= 2) reportPlay("panel.bidwar", { sharks: bidders });
      }
      if (outcome.accepted) {
        reportPlay("deal.closed", {
          amount: outcome.accepted.amount_usd,
          equityPct: outcome.accepted.equity_pct,
          shark: outcome.acceptedFrom ? (CAST[outcome.acceptedFrom]?.name ?? "") : "",
          sharks: bidders,
        });
        // D6 asks for a counter that was ACCEPTED, so both halves are required
        // — a push-back that ended in no deal is not the mission.
        if (outcome.countered) reportPlay("deal.countered", {});
      } else if (bidders > 0) {
        // Walked away from a full table. D7 grades the quarter that follows.
        latchRejectedOffers();
      }
      setStage("score");
      const data = await buildDebrief({
        run,
        ctx: buildPanelContext({
          run,
          pitchTranscript: transcript.text,
          askFloorUsd: 4 * S_UNIT[run.stage],
          // The founder's own terms — the same ask the room was built from,
          // so the report critiques the raise they actually made.
          ask: getPlayerAsk(run),
        }),
        pitchTranscript: transcript.text,
        pitchDurationSeconds: transcript.durationSeconds,
        delivery: delivery ?? null,
        answers: outcome.answers,
        log: outcome.beats.map((b) => ({
          speaker: b.speaker,
          spoken: b.spoken,
          questions: b.question ? [b.question] : undefined,
        })),
        privateNotes: outcome.privateNotes,
        offers: outcome.offers,
        accepted: outcome.accepted,
        acceptedFrom: outcome.acceptedFrom,
        acceptedWith: outcome.acceptedWith,
        panelWasOffline: outcome.offline,
      });
      setDebrief(data);
    },
    [delivery, run, transcript],
  );

  if (stage === "panel") {
    return <SharkPanel score={score} pitchTranscript={transcript.text} onDone={tankDone} />;
  }

  if (stage === "debrief") {
    if (!debrief) {
      return (
        <section className="flex flex-1 flex-col items-center justify-center px-6">
          <SharkStage state="thinking" className="h-48 w-full" />
          <p className="mt-2 text-sm text-[var(--n-8)]">
            They&rsquo;re writing up what just happened&hellip;
          </p>
        </section>
      );
    }
    return (
      <TankDebrief
        data={debrief}
        companyName={run.companyName}
        onContinue={() => onContinue(deal.cashS, deal.equityPct)}
      />
    );
  }

  const covered = beatsCovered(transcript.text);
  const coveredCount = PITCH_FRAMEWORK.filter((b) => covered[b.n]).length;
  const dims = dimensions(findings, coveredCount);

  return (
    <motion.section
      className="flex-1 overflow-y-auto"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ENTER }}
    >
      <div className="mx-auto w-full max-w-lg px-6 pt-[max(1.5rem,var(--nv-safe-top))] pb-[max(2rem,var(--nv-safe-bottom))]">
        <SharkStage state={score >= 8 ? "celebrate" : "verdict"} className="h-36 w-full" />

        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-2xs font-bold tracking-[0.18em] text-[var(--n-7)]">THE VERDICT</p>
            <p className="tnum mt-1 text-[3rem] font-extrabold leading-none tracking-[-0.03em]">
              {score}
              <span className="text-[1.25rem] text-[var(--n-7)]">/10</span>
            </p>
          </div>
          {tutorialFloor && (
            <p className="pb-2 text-right text-2xs leading-tight text-[var(--n-7)]">
              FIRST YEAR
              <br />
              CANNOT FAIL
            </p>
          )}
        </div>

        {verdict && (
          <p className="mt-3 border-l-2 border-[var(--action)] pl-3 text-[0.9375rem] leading-relaxed">
            {verdict}
          </p>
        )}

        {/* Four things the scorer genuinely measured, and nothing it did not. */}
        <dl className="mt-6 space-y-2">
          {dims.map((d) => (
            <div key={d.label} className="flex items-center gap-3">
              <dt className="w-24 shrink-0 text-xs font-semibold text-[var(--n-8)]">{d.label}</dt>
              <dd className="flex flex-1 items-center gap-2">
                {/*
                  scaleX, not width — the last non-compositable animation left
                  in the app.

                  `width` is a layout property: animating it invalidates layout
                  on every frame, for every one of these bars, on the screen the
                  player is reading their score on. `transform` is compositor-
                  only. design.md §5 has forbidden this since it was written
                  ("Only transform and opacity animate. Never width…"); this was
                  the one site still doing it.

                  `origin-left` so the bar grows from its start rather than its
                  middle, which is what `width` did.
                */}
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--n-5)]">
                  <motion.span
                    className="block h-full origin-left rounded-full bg-[var(--n-2)]"
                    style={{ width: "100%" }}
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: d.score / 10 }}
                    transition={{ ...ENTER, duration: 0.5, delay: 0.1 }}
                  />
                </span>
                <span className="tnum w-6 text-right text-xs font-bold">{d.score}</span>
              </dd>
            </div>
          ))}
        </dl>

        <section className="mt-7">
          <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--n-7)]">
            WHAT YOU ACTUALLY SAID
          </h2>
          {transcript.text ? (
            /*
             ── Why the transcript is a box and not a paragraph ───────────────
             *
             * A pitch runs to two minutes, and two minutes of talking is three
             * hundred words. Laid out as an ordinary paragraph that is most of
             * a phone screen of grey text sitting between the scores above it
             * and the seven beats, the room and the CONTINUE button below —
             * so the longer somebody talked, the further their own verdict
             * scrolled away from them. The player who most needs to read the
             * rest of this page is exactly the one who gave the longest pitch.
             *
             * So it takes a fixed share of the screen and scrolls inside
             * itself. `overscroll-contain` is what stops flicking through it
             * from carrying on into the page underneath once it hits the end,
             * which is the thing that makes a nested scroller feel broken.
             *
             * It is framed rather than free-floating, and that is doing real
             * work: text meeting an unmarked boundary reads as clipped, and
             * the same text meeting the edge of a panel reads as continuing.
             * Same pixels, opposite conclusions.
             */
            <div className="mt-2 max-h-[13.5rem] overflow-y-auto overscroll-contain rounded-[var(--radius-row)] bg-[var(--n-2)] px-3 py-2.5 ring-1 ring-[var(--hairline)]">
              <p className="flex flex-wrap gap-x-[0.28em] gap-y-1 text-sm leading-relaxed text-[var(--n-8)]">
                {transcript.words.map((word, i) => (
                  <span
                    key={`${word.w}-${i}`}
                    className={
                      word.filler
                        ? "rounded-[3px] bg-[var(--alert)]/15 px-1 font-semibold text-[var(--alert)]"
                        : undefined
                    }
                  >
                    {word.w}
                  </span>
                ))}
              </p>
            </div>
          ) : (
            <p className="mt-2 text-sm leading-relaxed text-[var(--n-8)]">
              Nothing came through. That is a microphone problem rather than a pitch
              problem — next time the typing box appears after twelve seconds of
              silence, and typed pitches are judged exactly the same.
            </p>
          )}
        </section>

        {/* The structure, marked off. The full version, with what to say in each
            missed beat, is in the debrief after the room. */}
        <section className="mt-7">
          <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--n-7)]">
            THE SEVEN BEATS · {coveredCount}/7
          </h2>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {PITCH_FRAMEWORK.map((b) => (
              <li
                key={b.n}
                className={`rounded-[var(--radius-pill)] px-2.5 py-1 text-2xs font-bold tracking-[0.06em] ${
                  covered[b.n]
                    ? "bg-[var(--n-4)] text-[var(--n-11)]"
                    : "bg-transparent text-[var(--n-7)] ring-1 ring-[var(--hairline)]"
                }`}
              >
                {b.title.toUpperCase()}
              </li>
            ))}
          </ul>
        </section>

        {/* Only what was found in THESE words. Never a fixture. */}
        {findings.filter((f) => f.kind === "contradiction").length > 0 && (
          <section className="mt-7">
            <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--alert)]">
              YOUR OWN BOOKS DISAGREE
            </h2>
            <ul className="mt-2 space-y-2">
              {findings
                .filter((f) => f.kind === "contradiction")
                .map((f) => (
                  <li key={f.note} className="text-sm leading-snug text-[var(--n-9)]">
                    {f.note}
                  </li>
                ))}
            </ul>
          </section>
        )}

        <button
          type="button"
          onClick={() => (isYearGate ? setStage("debrief") : onContinue())}
          className="nv-gc mt-8 w-full rounded-[var(--radius-card)] nv-t-action px-5 py-4 text-base font-extrabold tracking-[0.06em]"
        >
          {isYearGate ? "READ THE FULL BREAKDOWN ▸" : "BACK TO THE COMPANY ▸"}
        </button>
        {isYearGate && (
          <p className="mt-2 text-center text-2xs leading-snug tracking-[0.06em] text-[var(--n-7)]">
            THIS SCORES THE TWO MINUTES YOU OPENED WITH · HOW YOU ANSWERED IN THE
            ROOM IS IN THE BREAKDOWN
          </p>
        )}
      </div>
    </motion.section>
  );
}

/**
 * The verdict, in one or two sentences that are TRUE OF THIS SESSION.
 *
 * Voice v2 — second person, present tense, dry. The first clause names the
 * sharpest thing the content scorer actually found (a contradiction beats a
 * missing beat beats vagueness, because that is the order of expense); the
 * second reports what the room did about it, when there was a room. Delivery —
 * pace, fillers, nerves — is deliberately absent, as everywhere (Brand Law 5).
 */
function verdictLine(opts: {
  score: number;
  findings: ContentFinding[];
  transcriptText: string;
  tank: {
    offers: number;
    acceptedUsd: number | null;
    acceptedPct: number | null;
    acceptedFrom: string | null;
  } | null;
}): string {
  const { score, findings, tank } = opts;
  const count = (kind: ContentFinding["kind"]) => findings.filter((f) => f.kind === kind).length;
  const covered = beatsCovered(opts.transcriptText);
  const coveredCount = PITCH_FRAMEWORK.filter((b) => covered[b.n]).length;
  const contradictions = count("contradiction");
  const madeAsk = covered[7];

  let pitch: string;
  if (!opts.transcriptText.trim()) {
    pitch = "Nothing came through, so the room judged silence. That is a microphone problem, not a valuation.";
  } else if (contradictions > 0) {
    pitch =
      contradictions === 1
        ? "Your own books disagreed with one of your claims — that is the expensive kind of wrong."
        : `Your own books disagreed with you ${contradictions} times — that is what priced you.`;
  } else if (score >= 8) {
    pitch = `Structure, real numbers, ${coveredCount} of the seven beats. You argued a business, not a dream.`;
  } else if (!madeAsk) {
    pitch = "Two minutes on the company and you never made the ask. Rooms don't chase.";
  } else if (coveredCount <= 3) {
    pitch = `You covered ${coveredCount} of the seven beats. The room filled in the rest — on their numbers, not yours.`;
  } else if (count("specific") === 0 && count("vague") > 0) {
    pitch = "Not one hard number out loud. Without figures it's a story, and they price stories low.";
  } else {
    pitch = `${coveredCount} of seven beats, nothing contradicted. Solid — and the missing beats are where the questions came from.`;
  }

  if (!tank) return pitch;
  if (tank.acceptedUsd != null) {
    return `${pitch} You leave with ${fmtMoney(tank.acceptedUsd)} for ${tank.acceptedPct}%${
      tank.acceptedFrom ? ` from ${tank.acceptedFrom}` : ""
    }.`;
  }
  if (tank.offers > 0) {
    return `${pitch} ${tank.offers === 1 ? "One offer" : `${tank.offers} offers`} on the table and you walked — a real answer, and it cost you only the money.`;
  }
  return `${pitch} Nobody bid. Every reason why is in the breakdown.`;
}

/**
 * The four dimensions, straight from the findings.
 *
 * Each one is a count of things the scorer actually did, so a player can trace
 * every bar back to a sentence they said. Nothing here reads pace, fillers or
 * fluency — those live in the delivery half of the debrief and are scored
 * nowhere at all.
 */
function dimensions(findings: ContentFinding[], coveredBeats: number) {
  const count = (kind: ContentFinding["kind"]) => findings.filter((f) => f.kind === kind).length;
  const covered = count("covered");
  const contradictions = count("contradiction");
  const honest = count("honest");

  return [
    {
      label: "Coverage",
      // Four jobs a pitch has to do: what it is, who pays, the economics, the ask.
      score: Math.round((covered / 4) * 10),
    },
    {
      label: "Specifics",
      score: count("specific") > 0 ? 10 : count("vague") > 0 ? 2 : 5,
    },
    {
      label: "Holds up",
      score: Math.max(
        0,
        Math.min(10, 6 + honest * 2 - contradictions * 4),
      ),
    },
    {
      label: "Structure",
      score: Math.round((coveredBeats / 7) * 10),
    },
  ];
}
