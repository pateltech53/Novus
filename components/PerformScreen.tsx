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
import { tierForScore } from "@/lib/ai/stub";
import { speak, stopSpeaking } from "@/lib/ai/speech";
import type { PitchTranscript } from "@/lib/ai/types";
import { KNOBS } from "@/lib/engine/constants";
import { LiveTranscriber, resolveTranscript } from "@/lib/ai/transcribe";
import { CompanyDossier, DossierGlyph } from "@/components/CompanyDossier";
import { PitchNotes } from "@/components/PitchNotes";
import { scorePitchContent, type ContentFinding } from "@/lib/ai/pitch-content";
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

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const meterRef = useRef<LevelMeter | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const doneRef = useRef<Promise<{ blob: Blob | null; durationSeconds: number }> | null>(null);
  const rafRef = useRef<number>(0);
  const peakRef = useRef(0);

  /*
   * Whether the stream is live, as STATE.
   *
   * START TALKING was disabled on `!streamRef.current`, and a ref read during
   * render is a value React never re-renders for. It happened to work only
   * because setPhase("ready") re-rendered on the same tick — invisible until
   * anything else set the stream without changing phase.
   */
  const [streamReady, setStreamReady] = useState(false);

  const cleanup = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    coachRef.current?.dispose();
    coachRef.current = null;
    meterRef.current?.close();
    meterRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    setStreamReady(false);
    stopSpeaking();
  }, []);

  useEffect(() => cleanup, [cleanup]);

  // Read the shark's brief out loud while the player reads it.
  useEffect(() => {
    if (phase === "brief") void speak(spec.line, "narrator");
  }, [phase, spec.line]);

  /*
   * Opening the camera, and — the part that was missing — failing to.
   *
   * Every failure below used to land on `phase: "ready"`, which draws the
   * camera view: a black rectangle, START TALKING disabled because there is no
   * stream, and an error line. The OPEN THE CAMERA button lives on the brief,
   * which is gone by then, so there was no way to try again. One dismissed
   * permission prompt, one camera another tab still held, and the fiscal year
   * could not be closed without reloading the page.
   *
   * Failures now return to the brief — the screen with the button on it — and
   * carry the reason with them.
   */
  const openCamera = useCallback(async () => {
    if (!mediaSupported()) {
      setError(
        "This browser can't open the camera. Try Chrome, Safari or Firefox — the pitch is the whole game.",
      );
      setPhase("brief");
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

      setStreamReady(true);
      setPhase("ready");
      setError(null);
    } catch (err) {
      // Whatever we did manage to open, close. A half-opened attempt that left
      // the camera light on is the worst thing to leave behind on a screen
      // about a teenager's camera.
      cancelAnimationFrame(rafRef.current);
      meterRef.current?.close();
      meterRef.current = null;
      stopStream(streamRef.current);
      streamRef.current = null;
      setStreamReady(false);

      const denied = err instanceof DOMException && err.name === "NotAllowedError";
      const inUse = err instanceof DOMException && err.name === "NotReadableError";
      setError(
        denied
          ? "The camera is blocked. Allow it for this site — in the address bar on a computer, or in Settings on a phone — then try again."
          : inUse
            ? "Something else is using the camera. Close the other tab or app, then try again."
            : "Couldn't reach the camera. Check that nothing else is using it, then try again.",
      );
      setPhase("brief");
    }
  }, []);

  const beginRecording = useCallback(() => {
    const stream = streamRef.current;
    if (!stream) return;
    /*
     * A throw here used to escape into the click handler, which is a button
     * that does nothing — no error, no phase change, no clue. That is what
     * START TALKING did on iOS Safari: `new MediaRecorder` refuses a container
     * WebKit cannot encode, and every candidate ahead of mp4 is one of those.
     *
     * makeRecorder() now degrades through the containers and finally to audio
     * only, so this should be unreachable. If it is ever reached, it says so on
     * screen instead of pretending the tap never happened.
     */
    try {
      const { recorder, done } = startRecording(stream, true);
      recorderRef.current = recorder;
      doneRef.current = done;
    } catch {
      setError(
        "This browser won't record on this device. Try Safari or Chrome — or type your pitch when the box appears.",
      );
      return;
    }
    // The coach is an enhancement; it must never be why a take fails to start.
    try {
      coachRef.current?.start();
    } catch {
      /* the take is the point, not the coaching */
    }
    setElapsed(0);
    setError(null);
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
     * ── The fixture is gone ───────────────────────────────────────────────
     *
     * This used to call `stubAi.scoreLanguage(tx)` and keep the fixture's
     * prose — line edits, structure notes, three priorities — while replacing
     * its numbers. The prose was the problem: those line edits quote a founder
     * saying "Hi. I'm sixteen, and I've been running this company for eleven
     * months", which is a sentence in
     * `lib/ai/fixtures/coach-reports.json` and not a sentence any player ever
     * said. That is the "why does it think I'm sixteen" report, exactly.
     *
     * Nothing on this path reads a fixture now. `content.findings` come from
     * the player's own words checked against their own books, and the full
     * write-up happens after The Tank, where it can also cover the questioning.
     */

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
            /*
             * `overflow-y-auto` is what makes this brief reachable on a short
             * screen.
             *
             * The stage is `fixed inset-0`, so the document itself never
             * scrolls — deliberately, because a game screen that scrolls its
             * whole self is one you can scroll away from. But nothing inside
             * scrolled either, and this is the tallest section in the app: a
             * title, the shark's line, four numbered beats and two buttons. On
             * a laptop with browser chrome and a taskbar — about 560px of
             * usable height — OPEN THE CAMERA laid out at y=541 in a 560px
             * viewport with no scrollable ancestor. The fiscal year could not
             * be closed at all.
             *
             * `min-h-0` is belt and braces: setting `overflow` to anything but
             * `visible` already resolves this flex child's `min-height: auto`
             * to zero, but the two are edited independently and stating the
             * shrink means removing the overflow cannot quietly restore it.
             */
            className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]"
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

            {/* Read your own company back before the camera opens. Same card
                that stays on screen through the take, so nothing about the
                layout moves when the clock starts. */}
            <PitchNotes run={run} variant="camera" defaultTab="company" className="mt-5" />

            <div className="mt-auto pt-6">
              {/* A failed attempt comes back here rather than stranding the
                  player on a black screen, so this is where it says what went
                  wrong — directly above the button that tries again. */}
              {error && (
                <p className="mb-3 text-sm leading-snug text-[var(--alert)]">
                  {error}
                </p>
              )}
              <button
                type="button"
                onClick={openCamera}
                className="w-full rounded-[var(--radius-card)] bg-[var(--action)] px-5 py-4 text-base font-extrabold tracking-[0.06em] text-[var(--n-11)] transition-colors duration-150 hover:bg-[var(--action-hover)] active:bg-[var(--action-press)]"
              >
                {error ? "TRY THE CAMERA AGAIN ▸" : "OPEN THE CAMERA ▸"}
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
                Your notes, on screen, the whole time — not behind the dossier
                button, which is still there for the full books.

                A founder pitching from memory is being tested on recall, and
                recall is not the skill. The numbers here are derived from the
                same stats the scorer checks claims against, so glancing down
                is what STOPS a player contradicting their own P&L rather than
                a way around the test. Opens on THE ORDER before the clock
                starts (what do I say first?) and on THE NUMBERS once it is
                running (what was that figure?).
              */}
              <PitchNotes
                run={run}
                variant="camera"
                defaultTab={phase === "recording" ? "numbers" : "order"}
                className="mb-3"
              />


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
                  disabled={!streamReady}
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
        ) : phase === "score" && transcript ? (
          <>
            {/*
              The verdict, then the room, then the report. PitchScore owns all
              three — see its header for why the order is the fix.
            */}
            <div className="contents">
              <PitchScore
                delivery={coaching}
                key="score"
                score={score}
                run={run}
                findings={findings}
                transcript={transcript}
                isYearGate={perform.kind === "yearEnd"}
                tutorialFloor={!!run.tutorial && run.year === 1}
                onContinue={(dealCashS, dealEquityPct) =>
                  // The words, not the number. `score` above is this client's
                  // reading of them; the leaderboard rescores the transcript
                  // server-side with the same `scorePitchContent` that produced
                  // it, so nothing a devtools console can type reaches a rank.
                  game.submitPerform(score, dealCashS, dealEquityPct, transcript.text)
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

/*
 * DeliveryStrip, DeliverySheet and DeliveryRow used to live here.
 *
 * They rendered eye contact, gestures, sway and volume as a stowable strip
 * under the verdict — before The Tank, and separate from every other piece of
 * feedback. Players asked for all of it in ONE report, after the room, and that
 * is now `components/TankDebrief.tsx`: same measurements, same on-device
 * privacy promise, same very loud "this changed nothing" header, in the place
 * somebody actually reads it.
 *
 * The measuring itself has not moved. `coachRef` still runs during the take and
 * still hands its report to PitchScore, which carries it into the debrief.
 */

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
