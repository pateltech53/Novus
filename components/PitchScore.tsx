"use client";

import { play } from "@/lib/sound";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { SharkStage } from "@/components/SharkStage";
import { SharkPanel } from "@/components/SharkPanel";
import { chairLine } from "@/lib/ai/stub";
import { speak } from "@/lib/ai/speech";
import type { CoachReport, PitchTranscript } from "@/lib/ai/types";
import type { DeliveryCoaching } from "@/lib/ai/delivery-coach";

/**
 * The verdict. Score, the transcript with every filler word marked, and the
 * coach's fixes. Grades the logic and the delivery mechanics — never the
 * accent, the voice, or the energy.
 */
export function PitchScore({
  score,
  coach,
  transcript,
  delivery,
  isYearGate,
  tutorialFloor,
  onContinue,
}: {
  score: number;
  coach: CoachReport;
  transcript: PitchTranscript;
  /**
   * The camera-and-mic coaching — eye contact, gestures, body language, volume.
   * Rendered INSIDE the feedback, where a player looks for feedback, instead of
   * as a stowable strip at the bottom of the screen that read as an ad. Still
   * never an input to `score`; the label says so on every render.
   */
  delivery?: DeliveryCoaching | null;
  isYearGate: boolean;
  tutorialFloor: boolean;
  onContinue: (dealCashS?: number, dealEquityPct?: number) => void;
}) {
  const [verdict, setVerdict] = useState("");
  const [showPanel, setShowPanel] = useState(false);

  useEffect(() => {
    play(score >= 8 ? "celebrate" : score >= 5 ? "success" : "error");
    const key = score >= 8 ? "score_high" : score >= 5 ? "score_mid" : "score_low";
    void chairLine(key).then((line) => {
      setVerdict(line);
      void speak(line, "narrator");
    });
  }, [score]);

  if (showPanel) {
    return (
      <SharkPanel
        score={score}
        onDone={(dealCashS, dealEquityPct) => onContinue(dealCashS, dealEquityPct)}
      />
    );
  }

  const metrics = coach.delivery_metrics;

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
            <p className="text-2xs font-bold tracking-[0.18em] text-[var(--n-7)]">
              THE VERDICT
            </p>
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

        <SubScores coach={coach} />

        <section className="mt-7">
          <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--n-7)]">
            WHAT YOU ACTUALLY SAID
          </h2>
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
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            <Metric label="Pace" value={`${metrics.wpm} wpm`} />
            <Metric
              label="Fillers"
              value={`${metrics.filler_count} · ${metrics.fillers_per_minute}/min`}
              alert={metrics.fillers_per_minute > 6}
            />
            <Metric label="Words" value={String(metrics.word_count)} />
          </dl>
          {/*
            The browser's recognizer strips "um" and "uh" before this app ever
            sees the text, so a zero here does not mean a clean take — it means
            those particular fillers are inaudible on this path. Saying so beats
            quietly displaying a number that reads as better than it is. The
            hearable fillers ("like", "you know", "basically") ARE counted, and
            hesitation pauses show up on the delivery card from the mic level.
          */}
          <p className="mt-1.5 text-2xs leading-snug text-[var(--text-tertiary)]">
            &ldquo;Like&rdquo; and &ldquo;you know&rdquo; are counted from the
            transcript. The browser edits out &ldquo;um&rdquo; and
            &ldquo;uh&rdquo; before we see them — pauses on the delivery card are
            the honest stand-in.
          </p>
        </section>

        <section className="mt-7">
          <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--n-7)]">
            FIX THESE THREE FIRST
          </h2>
          <ol className="mt-2 border-t border-[var(--hairline)]">
            {coach.top_3_priorities.slice(0, 3).map((priority, i) => (
              <li
                key={priority}
                className="flex items-baseline gap-3 border-b border-[var(--hairline)] py-2.5"
              >
                <span className="tnum text-xs font-bold text-[var(--action)]">
                  {i + 1}
                </span>
                <span className="text-sm leading-snug">{priority}</span>
              </li>
            ))}
          </ol>
        </section>

        {/* How you came across — eye contact, gestures, body language, volume.
            Measured on this device during the take and discarded frame by
            frame. It reads like a coach because it is one; it never touches
            the score, and it says so in its own header. */}
        {delivery && (delivery.camera.frames > 0 || delivery.volume) && (
          <section className="mt-7">
            <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--n-7)]">
              HOW YOU CAME ACROSS · NOT PART OF YOUR SCORE
            </h2>
            <ul className="mt-2 border-t border-[var(--hairline)]">
              {delivery.notes.map((note) => (
                <li
                  key={note.topic + note.text}
                  className="flex items-baseline gap-3 border-b border-[var(--hairline)] py-2.5"
                >
                  <span
                    className={`shrink-0 text-2xs font-extrabold tracking-[0.1em] ${
                      note.tone === "watch"
                        ? "text-[var(--text-primary)]"
                        : "text-[var(--n-7)]"
                    }`}
                  >
                    {note.topic === "eyes"
                      ? "EYE CONTACT"
                      : note.topic === "hands"
                        ? "GESTURES"
                        : note.topic === "sway"
                          ? "BODY LANGUAGE"
                          : "VOLUME"}
                  </span>
                  <span className="text-sm leading-snug text-[var(--text-secondary)]">
                    {note.text}
                  </span>
                </li>
              ))}
            </ul>
            <dl className="tnum mt-2 flex flex-wrap gap-x-5 gap-y-1 text-2xs text-[var(--text-tertiary)]">
              {delivery.camera.frames > 0 && (
                <div>
                  <dt className="inline font-bold">Eyes on the lens </dt>
                  <dd className="inline">
                    {Math.round(delivery.camera.eyeContactShare * 100)}% of the take
                  </dd>
                </div>
              )}
              {delivery.camera.gesturesPerMinute !== null && (
                <div>
                  <dt className="inline font-bold">Gestures </dt>
                  <dd className="inline">
                    {Math.round(delivery.camera.gesturesPerMinute)}/min
                  </dd>
                </div>
              )}
              {delivery.volume && (
                <div>
                  <dt className="inline font-bold">Inaudible </dt>
                  <dd className="inline">
                    {Math.round(delivery.volume.quietShare * 100)}% of the time
                  </dd>
                </div>
              )}
            </dl>
          </section>
        )}

        {coach.line_edits.length > 0 && (
          <section className="mt-7">
            <h2 className="text-2xs font-bold tracking-[0.16em] text-[var(--n-7)]">
              SAY IT LIKE THIS INSTEAD
            </h2>
            <ul className="mt-2 space-y-3.5">
              {coach.line_edits.slice(0, 3).map((edit) => (
                <li key={edit.quote} className="text-sm leading-snug">
                  <p className="text-[var(--n-7)] line-through decoration-[var(--alert)]/50">
                    &ldquo;{edit.quote}&rdquo;
                  </p>
                  <p className="mt-1 font-semibold text-[var(--n-11)]">
                    &ldquo;{edit.better_version}&rdquo;
                  </p>
                  <p className="mt-0.5 text-xs text-[var(--n-7)]">{edit.issue}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <button
          type="button"
          onClick={() => (isYearGate ? setShowPanel(true) : onContinue())}
          className="mt-8 w-full rounded-[var(--radius-card)] bg-[var(--action)] px-5 py-4 text-base font-extrabold tracking-[0.06em] text-[var(--n-11)] transition-colors duration-150 hover:bg-[var(--action-hover)] active:bg-[var(--action-press)]"
        >
          {isYearGate ? "FACE THE PANEL ▸" : "BACK TO THE COMPANY ▸"}
        </button>
      </div>
    </motion.section>
  );
}

function SubScores({ coach }: { coach: CoachReport }) {
  const bars = [
    { label: "Clarity", score: coach.scores.clarity.score },
    { label: "Fluency", score: coach.scores.fluency.score },
    { label: "Logic", score: coach.scores.logic.score },
    { label: "Grammar", score: coach.scores.grammar.score },
  ];
  return (
    <dl className="mt-6 space-y-2">
      {bars.map((bar) => (
        <div key={bar.label} className="flex items-center gap-3">
          <dt className="w-16 shrink-0 text-xs font-semibold text-[var(--n-8)]">
            {bar.label}
          </dt>
          <dd className="flex flex-1 items-center gap-2">
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--n-5)]">
              <motion.span
                className="block h-full rounded-full bg-[var(--n-2)]"
                initial={{ width: 0 }}
                animate={{ width: `${bar.score * 10}%` }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
              />
            </span>
            <span className="tnum w-6 text-right text-xs font-bold">{bar.score}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}

function Metric({
  label,
  value,
  alert,
}: {
  label: string;
  value: string;
  alert?: boolean;
}) {
  return (
    <div>
      <dt className="text-2xs font-bold tracking-[0.12em] text-[var(--n-7)]">
        {label.toUpperCase()}
      </dt>
      <dd
        className={`tnum text-sm font-bold ${
          alert ? "text-[var(--alert)]" : "text-[var(--n-11)]"
        }`}
      >
        {value}
      </dd>
    </div>
  );
}
