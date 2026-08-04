"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { motion } from "framer-motion";
import { ENTER } from "@/components/ui/Motion";
import type { LevelMeter, Recording } from "@/lib/media/recorder";
import { stopSpeaking } from "@/lib/ai/speech";
import { AnswerHelp } from "@/components/panel/AnswerHelp";
import {
  createLevelMeter,
  mediaSupported,
  requestCapture,
  startRecording,
  stopStream,
} from "@/lib/media/recorder";
import { LiveTranscriber, resolveTranscript } from "@/lib/ai/transcribe";

/**
 * The player's turn.
 *
 * The panel stops here and does not move until the founder answers. Nothing on
 * this screen advances on a timer — the shark asked you something and is now
 * waiting, which is the entire point of the feature.
 *
 * Two ways to answer, and the typed one is not a consolation prize: a player
 * who cannot speak, or is on a bus, or shares a room, must be able to play. It
 * is judged on content only, and it is offered plainly rather than buried.
 *
 * A player may also decline. That is a legitimate move with a consequence —
 * the shark reacts to the silence — so it is a visible button, not a trapdoor.
 *
 * ── What changed, and why it was the biggest hole in the room ──────────────
 *
 * `finish()` used to do exactly this:
 *
 *     onAnswer({ text: "", spoken: true, seconds })
 *
 * A spoken answer carried NO WORDS. The microphone opened, the audio was
 * recorded, and the recording was dropped on the floor — so the sharks had
 * nothing to read, and the only thing the room could react to was how long the
 * founder talked for. That is speech rhythm reaching an outcome, which Brand
 * Law 5 exists to prevent; it is also why the debrief could never say anything
 * specific about the questioning, because there was nothing to be specific
 * about.
 *
 * Now a spoken answer is transcribed on the same three-path ladder the pitch
 * already uses (`lib/ai/transcribe.ts`): a server STT when one is configured,
 * the browser's own recognition otherwise, and the keyboard when neither
 * works. The words reach the sharks and the debrief. Nothing reads the
 * duration.
 */
export function AnswerTurn({
  question,
  onAnswer,
  onDecline,
  levelRef,
  maxSeconds = 45,
  label = "THEY ARE WAITING",
  speakLabel = "ANSWER OUT LOUD",
  declineLabel = "SAY NOTHING",
  allowDecline = true,
  shark = "an investor",
  helpFacts,
  helpRemaining = 0,
  onHelpUsed,
}: {
  question: string;
  /** The founder's actual words, however they arrived. */
  onAnswer: (answer: { text: string; spoken: boolean; seconds: number }) => void;
  onDecline: () => void;
  /**
   * Where the live mic level goes. A ref rather than a callback: the callback
   * was `setMicLevel` on SharkPanel, so every quantised step re-rendered a
   * 1041-line screen. TankRoom subscribes to this ref on its own rAF instead.
   */
  levelRef?: RefObject<number>;
  maxSeconds?: number;
  /** Overridden for the counter-offer turn, which is not a question. */
  label?: string;
  speakLabel?: string;
  declineLabel?: string;
  allowDecline?: boolean;
  /** Who asked, so the help can be told whose question it is. */
  shark?: string;
  /**
   * The founder's own figures. Passed so the help can POINT at them and is
   * never in a position to invent one — see components/panel/AnswerHelp.tsx.
   * Absent means no help is offered at all, which is the counter-offer turn:
   * naming your own number is the exercise there, and a hint would be the
   * answer.
   */
  helpFacts?: Record<string, string | number>;
  helpRemaining?: number;
  onHelpUsed?: () => void;
}) {
  const [mode, setMode] = useState<"choose" | "recording" | "transcribing" | "typing">("choose");
  const [seconds, setSeconds] = useState(0);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  /** What the mic is picking up, live, so the player sees what will be read. */
  const [heard, setHeard] = useState("");
  const [interim, setInterim] = useState("");

  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const doneRef = useRef<Promise<Recording> | null>(null);
  const scribeRef = useRef<LiveTranscriber | null>(null);
  const meterRef = useRef<LevelMeter | null>(null);
  const rafRef = useRef<number | null>(null);
  /** Guards the double-finish the clock and the button can both cause. */
  const finishingRef = useRef(false);
  /** Read inside `finish`, which is not re-created when the text changes. */
  const heardRef = useRef("");
  heardRef.current = heard;
  const secondsRef = useRef(0);
  secondsRef.current = seconds;

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    meterRef.current?.close();
    meterRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    if (levelRef) levelRef.current = 0;
  }, [levelRef]);

  useEffect(() => cleanup, [cleanup]);

  // The clock only runs while recording, and it stops the take at the cap
  // rather than cutting the player off mid-sentence without warning.
  useEffect(() => {
    if (mode !== "recording") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    if (mode === "recording" && seconds >= maxSeconds) void finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, mode]);

  const beginRecording = useCallback(async () => {
    setErr(null);
    if (!mediaSupported()) {
      setErr("This browser will not open a microphone. You can type your answer instead.");
      setMode("typing");
      return;
    }
    /*
     * The room goes quiet BEFORE the microphone opens, not after.
     *
     * The shark's question is spoken and the answer turn appears while that
     * line is still playing. Opening an echo-cancelled mic flips the
     * platform's audio session (iOS drops to play-and-record and the echo
     * canceller starts pumping the in-flight audio), so a line still playing
     * across `requestCapture` came out mangled — the reported crackle. And a
     * player who starts straight away would otherwise be talking over the
     * shark into a mic recording both. This is the barge-in half of the fix;
     * the visible SKIP is the other.
     */
    stopSpeaking();
    try {
      // Permission is asked HERE, at the moment of use, not on page load.
      const stream = await requestCapture({ video: false });
      streamRef.current = stream;
      // The meter is poll-based (read/close), so drive it from rAF rather
      // than expecting a callback — this is what makes the listening shark
      // lean in proportional to how loud the player actually is. The reading
      // is quantised before it leaves this component: SharkPanel holds it as
      // state, and 60 distinct values a second re-rendered the whole Tank —
      // room, beats list, notes — per frame. Twelve steps is visually
      // identical and drops that to a handful of renders a second.
      const meter = createLevelMeter(stream);
      meterRef.current = meter;
      let lastStep = -1;
      const pump = () => {
        if (!meterRef.current) return;
        const value = meterRef.current.read();
        const step = Math.round(value * 12);
        if (step !== lastStep) {
          lastStep = step;
          if (levelRef) levelRef.current = step / 12;
        }
        rafRef.current = requestAnimationFrame(pump);
      };
      rafRef.current = requestAnimationFrame(pump);

      /*
       * Two captures at once, on purpose and for different jobs — the same
       * arrangement `PerformScreen` uses for the pitch itself. The recorder
       * produces audio for a server STT when one is configured (accurate, and
       * it keeps the "um"s the filler count needs); the browser's own
       * recogniser gives words immediately and works offline.
       * `resolveTranscript` takes whichever turns out better.
       */
      const { recorder, done } = startRecording(stream, false);
      recorderRef.current = recorder;
      doneRef.current = done;

      const scribe = new LiveTranscriber((text, mid) => {
        setHeard(text);
        setInterim(mid);
      });
      scribe.start();
      scribeRef.current = scribe;

      setHeard("");
      setInterim("");
      setSeconds(0);
      finishingRef.current = false;
      setMode("recording");
    } catch {
      setErr("No microphone. You can type your answer instead — it is judged the same.");
      setMode("typing");
    }
  }, [levelRef]);

  async function finish() {
    if (finishingRef.current) return;
    finishingRef.current = true;

    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    const live = scribeRef.current?.stop();
    scribeRef.current = null;
    setMode("transcribing");

    /*
     * Race the blob against a short deadline.
     *
     * `MediaRecorder.stop()` is not guaranteed to fire `onstop` — a yanked
     * device, a revoked permission, another tab taking the microphone, some
     * mobile browsers on backgrounding. Awaiting it bare is what once left the
     * pitch screen hung on "processing" forever, and a hang HERE would be
     * worse: the room would be stopped on a question with no way to move it.
     */
    const settled = await Promise.race([
      doneRef.current,
      new Promise<null>((r) => setTimeout(() => r(null), 4000)),
    ]);
    const blob = settled?.blob ?? null;
    const durationSeconds = settled?.durationSeconds ?? secondsRef.current;

    const tx = await resolveTranscript({
      audio: blob,
      liveText: live?.text || heardRef.current,
      durationSeconds,
    });

    cleanup();
    onAnswer({
      // Empty only when every path failed. The room treats that the same way it
      // treats silence, and the player is offered the keyboard next time rather
      // than being quietly judged on nothing.
      text: tx?.text ?? "",
      spoken: true,
      seconds: Math.round(durationSeconds),
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={ENTER}
      className="rounded-[var(--radius-card)] bg-[var(--surface-elevated)] p-4 shadow-[var(--e3)]"
    >
      <p className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">{label}</p>
      <p className="mt-1.5 text-base font-semibold leading-snug text-[var(--text-primary)]">
        {question}
      </p>

      {err && <p className="mt-3 text-sm leading-snug text-[var(--text-secondary)]">{err}</p>}

      {mode === "choose" && (
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={beginRecording}
            className="nv-gc h-14 w-full rounded-[var(--radius-pill)] nv-t-action text-base font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
          >
            {speakLabel}
          </button>
          <button
            type="button"
            onClick={() => setMode("typing")}
            className="nv-gc h-12 w-full rounded-[var(--radius-pill)] text-sm font-bold tracking-[0.04em] text-[var(--text-primary)]"
          >
            Type it instead
          </button>
          {/* Only before the microphone opens. Reading a hint while recording
              is how a hint becomes a script being read aloud. */}
          {helpFacts && onHelpUsed && (
            <AnswerHelp
              question={question}
              shark={shark}
              facts={helpFacts}
              remaining={helpRemaining}
              onUsed={onHelpUsed}
            />
          )}
          {allowDecline && (
            <button
              type="button"
              onClick={onDecline}
              className="h-10 w-full text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]"
            >
              {declineLabel}
            </button>
          )}
        </div>
      )}

      {mode === "recording" && (
        <div className="mt-4">
          <p className="tnum text-center text-2xl font-extrabold text-[var(--text-primary)]">
            0:{String(seconds).padStart(2, "0")}
          </p>
          <p className="mt-0.5 text-center text-2xs tracking-[0.1em] text-[var(--text-tertiary)]">
            {maxSeconds - seconds}s LEFT
          </p>

          {/* What the room is going to read, while you are still saying it.
              The sharks answer these words now, so hiding them would mean
              being judged on something you never got to see. */}
          {(heard || interim) && (
            <div className="mt-3 max-h-24 overflow-y-auto rounded-[var(--radius-row)] bg-[var(--surface)] px-3 py-2">
              <p className="text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]">
                WHAT THEY HEARD
              </p>
              <p className="mt-1 text-sm leading-snug text-[var(--text-primary)]">
                {heard}
                {interim && <span className="text-[var(--text-tertiary)]"> {interim}</span>}
              </p>
            </div>
          )}
          {/* Nothing coming through well into the answer: say so, rather than
              letting a working microphone with a broken recogniser land as a
              refusal to answer. */}
          {seconds >= 8 && !heard && !interim && (
            <p className="mt-3 text-2xs leading-snug text-[var(--text-tertiary)]">
              Nothing is coming through yet. Finish anyway and the recording is
              still sent, or type it instead — typed answers are judged the same.
            </p>
          )}

          <button
            type="button"
            onClick={() => void finish()}
            className="nv-gc mt-4 h-14 w-full rounded-[var(--radius-pill)] nv-t-action text-base font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
          >
            THAT&rsquo;S MY ANSWER
          </button>
        </div>
      )}

      {mode === "transcribing" && (
        <p className="mt-5 text-center text-sm text-[var(--text-secondary)]">
          Reading back what you said&hellip;
        </p>
      )}

      {mode === "typing" && (
        <div className="mt-4">
          <textarea
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value.slice(0, 600))}
            rows={4}
            placeholder="Answer them."
            className="w-full resize-none rounded-[var(--radius-row)] bg-[var(--surface)] p-3 text-sm leading-snug text-[var(--text-primary)] outline-none ring-1 ring-[var(--hairline)] focus:ring-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)]"
          />
          <button
            type="button"
            disabled={!typed.trim()}
            onClick={() => onAnswer({ text: typed.trim(), spoken: false, seconds: 0 })}
            className="nv-gc mt-3 h-14 w-full rounded-[var(--radius-pill)] nv-t-action text-base font-extrabold tracking-[0.04em] shadow-[var(--e3)] disabled:opacity-40"
          >
            THAT&rsquo;S MY ANSWER
          </button>
        </div>
      )}
    </motion.div>
  );
}
