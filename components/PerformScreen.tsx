"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useGame } from "@/lib/state/GameProvider";
import { SharkStage, type SharkState } from "@/components/SharkStage";
import { PitchScore } from "@/components/PitchScore";
import {
  createLevelMeter,
  mediaSupported,
  requestCapture,
  startRecording,
  stopStream,
  type LevelMeter,
} from "@/lib/media/recorder";
import { stubAi, tierForScore } from "@/lib/ai/stub";
import { speak, stopSpeaking } from "@/lib/ai/speech";
import type { CoachReport, PitchTranscript } from "@/lib/ai/types";
import { KNOBS } from "@/lib/engine/constants";
import { LiveTranscriber, resolveTranscript } from "@/lib/ai/transcribe";
import { CompanyDossier, DossierGlyph } from "@/components/CompanyDossier";
import { scorePitchContent, deliveryMetrics, type ContentFinding } from "@/lib/ai/pitch-content";
import {
  createDeliveryCoach,
  type DeliveryLive,
  deliveryCoachSupported,
  type DeliveryCoach,
  type DeliveryCoaching,
} from "@/lib/ai/delivery-coach";

type Phase = "brief" | "permission" | "ready" | "recording" | "processing" | "score";

const MIN_SECONDS = 20;
const MAX_SECONDS = 120;

const BRIEFS: Record<string, { title: string; beats: string[]; line: string }> = {
  pitch: {
    title: "Pitch me",
    beats: ["What you sell", "Who buys it", "Why you win", "What you want from me"],
    line: "Camera on. Sixty seconds: what you sell, who buys it, why you win, what you want from me. I judge the words and the numbers — the rest is between you and the mirror.",
  },
  nego: {
    title: "Negotiate it",
    beats: ["Your anchor", "What you'll trade", "What you won't", "Your walk-away"],
    line: "Talk them down. Name your number first, and know which one you'd walk from.",
  },
  media: {
    title: "Face the press",
    beats: ["Acknowledge", "The facts", "What changes", "Stay on message"],
    line: "A journalist is waiting and they've done their reading. Stay on message.",
  },
  allhands: {
    title: "Tell the team",
    beats: ["The truth", "The plan", "Their part", "The ask"],
    line: "Your team already knows the numbers are ugly. Rumors are worse than reality. Talk.",
  },
  board: {
    title: "Defend the call",
    beats: ["The decision", "The tradeoff", "The evidence", "The risk you accept"],
    line: "Three board members. One decision. Defend the tradeoff, not the outcome.",
  },
  consult: {
    title: "Diagnose it",
    beats: ["The symptom", "The root cause", "The fix", "How you'd know it worked"],
    line: "Somebody else's problem this time. Diagnosis, root cause, recommendation.",
  },
};

/**
 * The camera. This is the product — every fiscal year and every [P:] event
 * routes through here, and nothing closes a year without a scored performance.
 */
export function PerformScreen() {
  const game = useGame();
  const { perform, run } = game;
  const spec = BRIEFS[perform?.performType ?? "pitch"] ?? BRIEFS.pitch;

  const [phase, setPhase] = useState<Phase>("brief");
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [transcript, setTranscript] = useState<PitchTranscript | null>(null);
  const [coach, setCoach] = useState<CoachReport | null>(null);
  const [score, setScore] = useState(0);
  /** What the mic heard, live, so the player can see what will be judged. */
  const [heard, setHeard] = useState("");
  const [interim, setInterim] = useState("");
  const [findings, setFindings] = useState<ContentFinding[]>([]);
  const scribeRef = useRef<LiveTranscriber | null>(null);
  /**
   * Typed rescue.
   *
   * The pitch IS the game — nothing closes a fiscal year without one — so a
   * player whose microphone is not coming through cannot be allowed to score
   * zero for it. `SpeechRecognition` existing is not the same as it working:
   * headless Chrome reports it and returns nothing, and so does Chrome itself
   * when its cloud recognition is unreachable. This box appears when the mic has
   * produced nothing well into the take, and it feeds the same scorer.
   */
  const [typedRescue, setTypedRescue] = useState("");
  /** The founder can read their own books mid-take. Recall is not the skill. */
  const [dossier, setDossier] = useState(false);

  /*
   * Delivery coaching. Volume, gaze, sway and gestures, measured on this device
   * and REPORTED — it reaches `coaching` and nothing else. It is not an input to
   * `content.score`, to `submitPerform`, or to anything the panel or the year
   * gate reads. See the header of lib/ai/delivery-coach.ts.
   */
  const coachRef = useRef<DeliveryCoach | null>(null);
  const [coaching, setCoaching] = useState<DeliveryCoaching | null>(null);
  /** Live tracker readings, sampled four times a second while recording. */
  const [liveTrack, setLiveTrack] = useState<DeliveryLive | null>(null);
  const [coachArmed, setCoachArmed] = useState(false);
  const [coachOpen, setCoachOpen] = useState(false);
  const [coachStowed, setCoachStowed] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<LevelMeter | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const doneRef = useRef<Promise<{ blob: Blob | null; durationSeconds: number }> | null>(null);
  const rafRef = useRef<number>(0);
  const peakRef = useRef(0);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    coachRef.current?.dispose();
    coachRef.current = null;
    meterRef.current?.close();
    meterRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    stopSpeaking();
  }, []);

  useEffect(() => cleanup, [cleanup]);

  // Read the shark's brief out loud while the player reads it.
  useEffect(() => {
    if (phase === "brief") void speak(spec.line, "narrator");
  }, [phase, spec.line]);

  const openCamera = useCallback(async () => {
    if (!mediaSupported()) {
      setError(
        "This browser can't open the camera. Try Chrome, Safari or Firefox — the pitch is the whole game.",
      );
      setPhase("ready");
      return;
    }
    setPhase("permission");
    try {
      const stream = await requestCapture({ video: true });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      meterRef.current = createLevelMeter(stream);
      const tick = () => {
        const value = meterRef.current?.read() ?? 0;
        peakRef.current = Math.max(peakRef.current, value);
        setLevel(value);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);

      /*
       * Warm the coach while the player reads the framing guide. It loads its own
       * runtime in the background and reports whether it managed it; if it never
       * does, or the device is too small to try, nothing appears anywhere and the
       * take is untouched.
       */
      if (deliveryCoachSupported()) {
        const coach = createDeliveryCoach({
          video: videoRef.current,
          // The meter already running, rather than a second AudioContext.
          readLevel: () => meterRef.current?.read() ?? 0,
        });
        coachRef.current = coach;
        void coach.ready.then(setCoachArmed);
      }

      setPhase("ready");
      setError(null);
    } catch (err) {
      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      setError(
        denied
          ? "The camera is blocked. Allow it in your browser's address bar — the year doesn't close without it."
          : "Couldn't reach the camera. Check that nothing else is using it.",
      );
      setPhase("ready");
    }
  }, []);

  const beginRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    const { recorder, done } = startRecording(stream, true);
    recorderRef.current = recorder;
    doneRef.current = done;
    coachRef.current?.start();
    setElapsed(0);
    setPhase("recording");
  }, []);

  // Recording clock; hard stop at the ceiling.
  useEffect(() => {
    if (phase !== "recording") return;
    const id = setInterval(() => {
      setElapsed((e) => {
        if (e + 1 >= MAX_SECONDS) {
          window.setTimeout(() => finishRecording(), 0);
          return MAX_SECONDS;
        }
        return e + 1;
      });
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  /*
   * Live transcription runs alongside the MediaRecorder for the length of the
   * take. Two independent captures on purpose: the recorder produces audio for a
   * server STT when one is configured, and the browser's own recognition gives us
   * words immediately and offline. Whichever is better wins in
   * `resolveTranscript`, and if both fail the player can still type.
   */
  useEffect(() => {
    if (phase !== "recording") return;
    const s = new LiveTranscriber((text, mid) => {
      setHeard(text);
      setInterim(mid);
    });
    s.start();
    scribeRef.current = s;
    return () => {
      s.stop();
      scribeRef.current = null;
    };
  }, [phase]);

  // The tracker's own heartbeat, on screen while it is true. Without this the
  // coach reads as broken for the whole take and vindicated afterwards, which
  // is the wrong order to convince anyone.
  useEffect(() => {
    if (phase !== "recording") {
      setLiveTrack(null);
      return;
    }
    const t = window.setInterval(() => {
      setLiveTrack(coachRef.current?.live() ?? null);
    }, 250);
    return () => window.clearInterval(t);
  }, [phase]);

  const finishRecording = useCallback(async () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    const live = scribeRef.current?.stop();
    // Close the observation window with the take, not with the four-second race
    // below — the coaching should describe what they did, not what came after.
    setCoaching(coachRef.current?.stop() ?? null);
    setPhase("processing");

    /*
     * THIS IS WHY THE TANK NEVER APPEARED.
     *
     * MediaRecorder's stop() is not guaranteed to fire `onstop` — if the
     * stream's tracks already ended (device yanked, permission revoked
     * mid-take, another tab grabbing the camera, some mobile browsers on
     * backgrounding), the `done` promise never settles. Awaiting it bare meant
     * the screen sat on "processing" forever, the pitch never scored, and
     * because the panel is gated behind the score, The Tank was unreachable.
     *
     * A pitch that produced no blob is still a pitch: the clock knows how long
     * the founder talked. So race the promise against a short deadline and
     * score on what we have rather than hanging on what we don't.
     */
    const settled = await Promise.race([
      doneRef.current,
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    const result = settled ?? { blob: null, durationSeconds: elapsed };

    /*
     * ── What replaced the old scoring path ────────────────────────────────
     *
     * This used to call `stubAi.transcribePitch(result.blob, …)`, which takes the
     * audio as `_audio` and THROWS IT AWAY, returning a canned fixture chosen by
     * how long you recorded. Then `stubAi.scoreLanguage` picked a canned report by
     * filler words per minute. So the score was "spoke for longer, said fewer
     * ums" — it never read a word the player actually said, and filler rate is
     * exactly the speech-rhythm scoring Brand Law 5 forbids.
     *
     * Now: a real transcript (server STT if configured, otherwise the browser's
     * live recognition, otherwise typed), scored on SUBSTANCE — did the pitch
     * cover what a pitch has to cover, did it cite anything concrete, and do its
     * claims survive a look at the player's own books.
     */
    const tx =
      (await resolveTranscript({
        audio: result.blob,
        liveText: live?.text ?? heard,
        durationSeconds: result.durationSeconds,
        typedText: typedRescue,
      })) ?? { text: "", durationSeconds: result.durationSeconds, words: [] };
    setTranscript(tx);

    const content = scorePitchContent(tx.text, run!);
    setFindings(content.findings);

    /*
     * The fixture report still supplies the coach's prose — line edits, structure
     * notes, priorities — which is genuinely useful writing. But its numbers are
     * replaced with real ones, and its overall score no longer decides anything.
     * Delivery figures are REPORTED here and scored nowhere.
     */
    const report = await stubAi.scoreLanguage(tx);
    setCoach({
      ...report,
      delivery_metrics: deliveryMetrics(tx.text, tx.durationSeconds),
      scores: {
        ...report.scores,
        overall: { ...report.scores.overall, score: content.score },
      },
    });

    let final = content.score;
    // The tutorial year cannot be failed — the shark can be unimpressed only.
    if (run?.tutorial && run.year === 1) final = Math.max(KNOBS.tutorialScoreFloor, final);
    setScore(final);
    setPhase("score");
    cleanup();
  }, [elapsed, run, cleanup, heard, typedRescue]);

  const sharkState: SharkState =
    phase === "recording" ? "listening" : phase === "processing" ? "thinking" : "verdict";

  if (!perform || !run) return null;

  return (
    <main className="nv-stage fixed inset-0 z-[80] flex flex-col text-[var(--n-11)]">
      {/* Phases animate in on mount; no exit crossfade (see welcome/page.tsx). */}
      {phase === "brief" ? (
          <motion.section
            key="brief"
            className="flex flex-1 flex-col px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <SharkStage state="verdict" className="h-44 w-full shrink-0" />
            <p className="text-2xs font-bold tracking-[0.18em] text-[var(--action)]">
              {perform.kind === "yearEnd"
                ? `FISCAL YEAR ${run.year} · THE GATE`
                : "THIS ONE YOU SAY OUT LOUD"}
            </p>
            <h1 className="mt-1.5 text-[1.75rem] font-extrabold leading-tight tracking-[-0.02em]">
              {spec.title}
            </h1>
            <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed text-[var(--n-8)]">
              {spec.line}
            </p>

            <ol className="mt-6 border-t border-[var(--hairline)]">
              {spec.beats.map((beat, i) => (
                <li
                  key={beat}
                  className="flex items-baseline gap-3 border-b border-[var(--hairline)] py-2.5"
                >
                  <span className="tnum text-xs font-bold text-[var(--n-7)]">
                    {i + 1}
                  </span>
                  <span className="text-sm font-semibold">{beat}</span>
                </li>
              ))}
            </ol>

            <div className="mt-auto pt-6">
              <button
                type="button"
                onClick={openCamera}
                className="w-full rounded-[var(--radius-card)] bg-[var(--action)] px-5 py-4 text-base font-extrabold tracking-[0.06em] text-[var(--n-11)] transition-colors duration-150 hover:bg-[var(--action-hover)] active:bg-[var(--action-press)]"
              >
                OPEN THE CAMERA ▸
              </button>
              <button
                type="button"
                data-opens
                onClick={() => setDossier(true)}
                className="nv-press mt-2 flex w-full items-center justify-center gap-2 rounded-[var(--radius-card)] bg-[var(--n-4)] px-5 py-3 text-xs font-bold tracking-[0.06em] text-[var(--n-10)]"
              >
                <DossierGlyph size={15} />
                CHECK YOUR NUMBERS
              </button>
            </div>
          </motion.section>
        ) : phase === "permission" || phase === "ready" || phase === "recording" ? (
          <motion.section
            key="camera"
            className="relative flex flex-1 flex-col"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="relative flex-1 overflow-hidden bg-black">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className="absolute inset-0 h-full w-full object-cover"
                style={{ transform: "scaleX(-1)" }}
              />
              <SharkStage
                state={sharkState}
                level={level}
                className="pointer-events-none absolute bottom-0 right-0 h-40 w-40"
              />

              {phase === "recording" && (
                <div className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5">
                  <span className="h-2 w-2 animate-pulse rounded-full bg-[var(--alert)]" />
                  <span className="tnum text-xs font-bold text-[var(--n-11)]">
                    {formatClock(elapsed)}
                  </span>
                </div>
              )}

              {/* Tracking, live. Green dot = the face model is reading frames
                  right now; EYES ON/AWAY flips as you look; the gesture count
                  climbs as your hands move. Reported, never scored — the same
                  line the post-pitch card draws. */}
              {phase === "recording" && liveTrack && (
                <div className="absolute left-4 top-[calc(max(1rem,env(safe-area-inset-top))+2.6rem)] flex items-center gap-2 rounded-full bg-black/55 px-3 py-1.5">
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${
                      liveTrack.tracking && liveTrack.framesRead > 0
                        ? "bg-[var(--solvency)]"
                        : "bg-[var(--n-6)]"
                    }`}
                  />
                  <span className="text-2xs font-bold tracking-[0.08em] text-white/85">
                    {!liveTrack.tracking || liveTrack.framesRead === 0
                      ? "TRACKER WARMING UP"
                      : liveTrack.eyesOn
                        ? "EYES ON"
                        : "EYES AWAY"}
                    {liveTrack.tracking && liveTrack.gestures !== null &&
                      ` · ${liveTrack.gestures} GESTURES`}
                  </span>
                </div>
              )}

              {/* Your own books, mid-take. Opening it does not pause the clock —
                  glancing at your numbers while pitching is a real skill and a
                  real cost, same as in the room. */}
              <button
                type="button"
                data-opens
                onClick={() => setDossier(true)}
                aria-label="Company dossier"
                className="absolute right-4 top-[max(1rem,env(safe-area-inset-top))] flex h-9 w-9 items-center justify-center rounded-full bg-black/55 text-white"
              >
                <DossierGlyph />
              </button>

              {phase === "permission" && (
                <p className="absolute inset-x-0 bottom-8 text-center text-sm text-[var(--n-10)]">
                  Waiting for camera permission…
                </p>
              )}
            </div>

            <div className="shrink-0 px-6 pt-4 pb-[max(1.5rem,env(safe-area-inset-bottom))]">
              {error && (
                <p className="mb-3 text-sm leading-snug text-[var(--alert)]">{error}</p>
              )}

              {/*
                What the judge is going to read, while you are still saying it.
                The score now comes from these words, so hiding them would mean
                grading someone on something they never saw. It also does the job
                the level meter cannot: a meter proves the mic is live, this proves
                the mic is UNDERSTANDING you.
              */}
              {/* Nothing coming through after twelve seconds of talking: give them
                  a keyboard rather than a zero. */}
              {phase === "recording" && elapsed >= 12 && !heard && !interim && (
                <div className="mb-3">
                  <p className="mb-1 text-2xs font-bold tracking-[0.12em] text-white/55">
                    YOUR MIC ISN&rsquo;T COMING THROUGH — TYPE IT
                  </p>
                  <textarea
                    value={typedRescue}
                    onChange={(e) => setTypedRescue(e.target.value)}
                    rows={3}
                    placeholder="What you just said"
                    className="w-full resize-none rounded-[var(--radius-row)] bg-white/12 px-3 py-2 text-sm leading-snug text-white outline-none ring-1 ring-white/20 focus:ring-white/50 placeholder:text-white/40"
                  />
                </div>
              )}

              {phase === "recording" && (heard || interim) && (
                <div className="mb-3 max-h-24 overflow-y-auto rounded-[var(--radius-row)] bg-white/10 px-3 py-2">
                  <p className="text-2xs font-bold tracking-[0.12em] text-white/55">
                    WHAT THEY HEARD
                  </p>
                  <p className="mt-1 text-sm leading-snug text-white">
                    {heard}
                    {interim && <span className="text-white/50"> {interim}</span>}
                  </p>
                </div>
              )}

              <LevelMeterBar level={level} active={phase === "recording"} />

              {phase === "recording" ? (
                <button
                  type="button"
                  onClick={finishRecording}
                  disabled={elapsed < MIN_SECONDS}
                  className="mt-3 w-full rounded-[var(--radius-card)] bg-[var(--action)] px-5 py-4 text-base font-extrabold tracking-[0.06em] text-[var(--n-11)] transition-colors duration-150 hover:bg-[var(--action-hover)] active:bg-[var(--action-press)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  {elapsed < MIN_SECONDS
                    ? `KEEP GOING · ${MIN_SECONDS - elapsed}s`
                    : "THAT'S MY PITCH ▸"}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={beginRecording}
                  disabled={!streamRef.current}
                  className="mt-3 w-full rounded-[var(--radius-card)] bg-[var(--action)] px-5 py-4 text-base font-extrabold tracking-[0.06em] text-[var(--n-11)] transition-colors duration-150 hover:bg-[var(--action-hover)] active:bg-[var(--action-press)] disabled:cursor-not-allowed disabled:opacity-45"
                >
                  START TALKING ▸
                </button>
              )}
              <p className="mt-2 text-center text-2xs tracking-[0.1em] text-[var(--n-7)]">
                {phase === "recording"
                  ? "THE SHARK IS LISTENING"
                  : `${MIN_SECONDS}–${MAX_SECONDS} SECONDS · YOUR VIDEO NEVER LEAVES THIS DEVICE`}
              </p>
              {/* Said where the player is, not only in a comment. */}
              {coachArmed && (
                <p className="mt-1 text-center text-2xs leading-snug tracking-[0.06em] text-[var(--n-7)]">
                  DELIVERY COACHING IS READING THE PICTURE ON THIS DEVICE. EACH FRAME IS DROPPED
                  AS IT IS READ · NOTHING SAVED, NOTHING SENT · NOT PART OF YOUR SCORE
                </p>
              )}
            </div>
          </motion.section>
        ) : phase === "processing" ? (
          <motion.section
            key="processing"
            className="flex flex-1 flex-col items-center justify-center px-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <SharkStage state="thinking" className="h-56 w-full" />
            <p className="mt-2 text-sm text-[var(--n-8)]">
              The shark is thinking. It does that slowly on purpose.
            </p>
          </motion.section>
        ) : phase === "score" && transcript && coach ? (
          <>
            {/*
              The verdict owns the screen; the coaching sits under it as its own
              surface so nobody can mistake one for the other. `display: contents`
              keeps the layout identical — the wrapper exists only to notice that
              the player has moved on (to the panel, or back to the company), at
              which point a delivery strip is no longer the right thing on screen.
            */}
            <div
              className="contents"
              onClickCapture={(e) => {
                if ((e.target as HTMLElement | null)?.closest?.("button")) setCoachStowed(true);
              }}
            >
              <PitchScore
                delivery={coaching}
                key="score"
                score={score}
                coach={coach}
                transcript={transcript}
                isYearGate={perform.kind === "yearEnd"}
                tutorialFloor={!!run.tutorial && run.year === 1}
                onContinue={(dealCashS, dealEquityPct) =>
                  game.submitPerform(score, dealCashS, dealEquityPct)
                }
              />
            </div>
          </>
      ) : null}
          {dossier && (
        <CompanyDossier run={run} variant="overlay" onClose={() => setDossier(false)} />
      )}
    </main>
  );
}

/**
 * The coaching strip. Deliberately plain, deliberately below the verdict, and
 * deliberately labelled — a teenager should be able to tell at a glance that the
 * thing measuring their eyes did not mark their pitch.
 */
function DeliveryStrip({
  report,
  onOpen,
  onStow,
}: {
  report: DeliveryCoaching;
  onOpen: () => void;
  onStow: () => void;
}) {
  const headline = report.notes.find((n) => n.tone === "watch") ?? report.notes[0];
  return (
    <motion.aside
      initial={{ y: 28, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1], delay: 0.7 }}
      className="shrink-0 border-t border-[var(--hairline)] bg-[var(--surface)] px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]"
    >
      <div className="mx-auto flex w-full max-w-lg items-center gap-3">
        <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
          <p className="text-2xs font-bold tracking-[0.14em] text-[var(--n-7)]">
            DELIVERY NOTES · NOT PART OF YOUR SCORE
          </p>
          <p className="mt-0.5 truncate text-sm font-semibold text-[var(--n-10)]">
            {headline?.text ?? "How you came across"}
          </p>
        </button>
        <button
          type="button"
          onClick={onOpen}
          aria-label="Open the delivery notes"
          className="shrink-0 rounded-[var(--radius-pill)] bg-[var(--n-4)] px-3 py-1.5 text-2xs font-extrabold tracking-[0.08em] text-[var(--n-11)]"
        >
          READ ▸
        </button>
        <button
          type="button"
          onClick={onStow}
          aria-label="Hide the delivery notes"
          className="shrink-0 px-1 text-base leading-none text-[var(--n-7)]"
        >
          ×
        </button>
      </div>
    </motion.aside>
  );
}

/** The card itself. Numbers, what to do about them, and where they went. */
function DeliverySheet({
  report,
  onClose,
}: {
  report: DeliveryCoaching;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { volume, camera } = report;
  const sway = camera.torsoSway ?? camera.headSway;
  const swayUnit = camera.torsoSway !== null ? "shoulder-widths" : "head-widths";

  return (
    <div
      className="fixed inset-0 z-[95] flex items-end"
      role="dialog"
      aria-modal="true"
      aria-label="Delivery notes"
    >
      <button
        type="button"
        aria-label="Close the delivery notes"
        onClick={onClose}
        className="absolute inset-0 bg-[var(--scrim)]"
      />
      <motion.section
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.34, ease: [0.16, 1, 0.3, 1] }}
        className="relative max-h-[86%] w-full overflow-y-auto rounded-t-[var(--radius-card)] bg-[var(--sheet)] px-6 pt-5 pb-[max(1.5rem,env(safe-area-inset-bottom))]"
      >
        <div className="mx-auto w-full max-w-lg">
          <p className="text-2xs font-bold tracking-[0.18em] text-[var(--n-7)]">
            HOW YOU CAME ACROSS
          </p>
          <h2 className="mt-1 text-[1.5rem] font-extrabold leading-tight tracking-[-0.02em]">
            Delivery notes
          </h2>

          <p className="mt-3 border-l-2 border-[var(--action)] pl-3 text-sm leading-relaxed text-[var(--n-9)]">
            This didn&rsquo;t affect your score — it&rsquo;s here so you can practise. The verdict
            was about what you said and whether the books back it up, not about how you looked
            saying it.
          </p>

          <dl className="mt-6 border-t border-[var(--hairline)]">
            {volume && (
              <DeliveryRow
                label="Level"
                value={`${Math.round(volume.averageLevel * 100)}/100`}
                hint={
                  volume.dropouts > 0
                    ? `on the bar you watched · fell out of range ${volume.dropouts}×`
                    : "on the bar you watched"
                }
              />
            )}
            <DeliveryRow
              label="On the lens"
              value={`${Math.round(camera.eyeContactShare * 100)}%`}
              hint={`longest look away ${camera.longestAwaySeconds}s`}
            />
            {sway !== null && (
              <DeliveryRow label="Sway" value={String(sway)} hint={swayUnit} />
            )}
            {camera.gesturesPerMinute !== null && (
              <DeliveryRow
                label="Hands"
                value={`${camera.gesturesPerMinute}/min`}
                hint={
                  camera.handsVisibleShare !== null
                    ? `in shot ${Math.round(camera.handsVisibleShare * 100)}% of the take`
                    : undefined
                }
              />
            )}
          </dl>

          <ul className="mt-6 space-y-3">
            {report.notes.map((note) => (
              <li key={note.text} className="flex gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-[0.45rem] h-1.5 w-1.5 shrink-0 rounded-full ${
                    note.tone === "watch" ? "bg-[var(--action)]" : "bg-[var(--n-6)]"
                  }`}
                />
                <p className="text-sm leading-snug text-[var(--n-10)]">{note.text}</p>
              </li>
            ))}
          </ul>

          <p className="mt-6 border-t border-[var(--hairline)] pt-4 text-xs leading-relaxed text-[var(--n-7)]">
            The camera was read on this device, one frame at a time, and every frame was thrown
            away the moment it was read. No video, no pictures and no measurements were uploaded
            or stored. Nothing here left this device, and nothing here is kept once you close
            this card.
          </p>

          <button
            type="button"
            onClick={onClose}
            className="mt-6 w-full rounded-[var(--radius-card)] bg-[var(--n-4)] px-5 py-3.5 text-sm font-extrabold tracking-[0.06em] text-[var(--n-11)]"
          >
            DONE
          </button>
        </div>
      </motion.section>
    </div>
  );
}

function DeliveryRow({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-[var(--hairline)] py-2.5">
      <dt className="text-sm font-semibold text-[var(--n-9)]">{label}</dt>
      <dd className="text-right">
        <span className="tnum text-sm font-bold text-[var(--n-11)]">{value}</span>
        {hint && <span className="ml-2 text-2xs text-[var(--n-7)]">{hint}</span>}
      </dd>
    </div>
  );
}

function LevelMeterBar({ level, active }: { level: number; active: boolean }) {
  const bars = 28;
  const lit = Math.round(level * bars);
  return (
    <div className="flex h-6 items-end gap-[2px]" aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        const on = i < lit;
        const tooLoud = i > bars * 0.88;
        return (
          <span
            key={i}
            className={`flex-1 rounded-[1px] transition-[height,background-color] duration-75 ${
              on
                ? tooLoud
                  ? "bg-[var(--alert)]"
                  : active
                    ? "bg-[var(--action)]"
                    : "bg-[var(--text-secondary)]"
                : "bg-[var(--n-5)]"
            }`}
            style={{ height: on ? `${30 + (i / bars) * 70}%` : "22%" }}
          />
        );
      })}
    </div>
  );
}

const formatClock = (s: number) =>
  `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export { tierForScore };
