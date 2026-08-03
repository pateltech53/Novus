"use client";

import { play } from "@/lib/sound";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SharkStage } from "@/components/SharkStage";
import { SharkPanel, type TankOutcome } from "@/components/SharkPanel";
import { TankDebrief } from "@/components/TankDebrief";
import { chairLine } from "@/lib/ai/stub";
import { speak } from "@/lib/ai/speech";
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
 * THE VERDICT, AND THEN THE ROOM, AND THEN THE REPORT.
 *
 * ── The order changed, and the order was the bug ───────────────────────────
 *
 * This screen used to be the whole of the feedback: a score, sub-scores, line
 * edits, three priorities — and then, underneath it, a button into The Tank.
 * So the report a player read was written before the hardest part of the
 * exercise had happened. Nothing it said could possibly cover how they held up
 * under questioning, which is the half that actually teaches pitching.
 *
 * Now this screen is deliberately thin: what you said, whether it hit the seven
 * beats, and the door into the room. The full report is `TankDebrief`, after.
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
  const [stage, setStage] = useState<"score" | "panel" | "debrief">("score");
  const [debrief, setDebrief] = useState<TankDebriefData | null>(null);
  const [deal, setDeal] = useState<{ cashS?: number; equityPct?: number }>({});

  useEffect(() => {
    play(score >= 8 ? "celebrate" : score >= 5 ? "success" : "error");
    const key = score >= 8 ? "score_high" : score >= 5 ? "score_mid" : "score_low";
    void chairLine(key).then((line) => {
      setVerdict(line);
      void speak(line, "narrator");
    });
  }, [score]);

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
      setStage("debrief");
      const data = await buildDebrief({
        run,
        ctx: buildPanelContext({
          run,
          pitchTranscript: transcript.text,
          askFloorUsd: 4 * S_UNIT[run.stage],
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
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className="mx-auto w-full max-w-lg px-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))]">
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
                <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--n-5)]">
                  <motion.span
                    className="block h-full rounded-full bg-[var(--n-2)]"
                    initial={{ width: 0 }}
                    animate={{ width: `${d.score * 10}%` }}
                    transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
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
            <p className="mt-2 flex flex-wrap gap-x-[0.28em] gap-y-1 text-sm leading-relaxed text-[var(--n-8)]">
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
          onClick={() => (isYearGate ? setStage("panel") : onContinue())}
          className="nv-gc mt-8 w-full rounded-[var(--radius-card)] nv-t-action px-5 py-4 text-base font-extrabold tracking-[0.06em]"
        >
          {isYearGate ? "FACE THE PANEL ▸" : "BACK TO THE COMPANY ▸"}
        </button>
        {isYearGate && (
          <p className="mt-2 text-center text-2xs leading-snug tracking-[0.06em] text-[var(--n-7)]">
            THE FULL BREAKDOWN COMES AFTER THE ROOM — HOW YOU ANSWERED MATTERS MORE
            THAN HOW YOU OPENED
          </p>
        )}
      </div>
    </motion.section>
  );
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
