"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import type { LevelMeter } from "@/lib/media/recorder";
import {
  createLevelMeter,
  mediaSupported,
  requestCapture,
  startRecording,
  stopStream,
} from "@/lib/media/recorder";

/**
 * The player's turn.
 *
 * The panel stops here and does not move until the founder answers. Nothing on
 * this screen advances on a timer — the shark asked you something and is now
 * waiting, which is the entire point of the feature.
 *
 * Two ways to answer, and the typed one is not a consolation prize: a player
 * who cannot speak, or is on a bus, or shares a room, must be able to play. It
 * is scored on content only, and it is offered plainly rather than buried.
 *
 * A player may also decline. That is a legitimate move with a consequence —
 * the shark reacts to the silence — so it is a visible button, not a trapdoor.
 */
export function AnswerTurn({
  question,
  onAnswer,
  onDecline,
  onLevel,
  maxSeconds = 45,
}: {
  question: string;
  /** transcript (typed, or a placeholder for the recording) */
  onAnswer: (answer: { text: string; spoken: boolean; seconds: number }) => void;
  onDecline: () => void;
  onLevel?: (level: number) => void;
  maxSeconds?: number;
}) {
  const [mode, setMode] = useState<"choose" | "recording" | "typing">("choose");
  const [seconds, setSeconds] = useState(0);
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const meterRef = useRef<LevelMeter | null>(null);
  const rafRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    meterRef.current?.close();
    meterRef.current = null;
    stopStream(streamRef.current);
    streamRef.current = null;
    onLevel?.(0);
  }, [onLevel]);

  useEffect(() => cleanup, [cleanup]);

  // The clock only runs while recording, and it stops the take at the cap
  // rather than cutting the player off mid-sentence without warning.
  useEffect(() => {
    if (mode !== "recording") return;
    const id = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [mode]);

  useEffect(() => {
    if (mode === "recording" && seconds >= maxSeconds) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seconds, mode]);

  const beginRecording = useCallback(async () => {
    setErr(null);
    if (!mediaSupported()) {
      setErr("This browser will not open a microphone. You can type your answer instead.");
      setMode("typing");
      return;
    }
    try {
      // Permission is asked HERE, at the moment of use, not on page load.
      const stream = await requestCapture({ video: false });
      streamRef.current = stream;
      // The meter is poll-based (read/close), so drive it from rAF rather
      // than expecting a callback — this is what makes the listening shark
      // lean in proportional to how loud the player actually is.
      const meter = createLevelMeter(stream);
      meterRef.current = meter;
      const pump = () => {
        if (!meterRef.current) return;
        onLevel?.(meterRef.current.read());
        rafRef.current = requestAnimationFrame(pump);
      };
      rafRef.current = requestAnimationFrame(pump);
      const { recorder } = startRecording(stream, false);
      stopRef.current = () => recorder.state === "recording" && recorder.stop();
      setSeconds(0);
      setMode("recording");
    } catch {
      setErr("No microphone. You can type your answer instead — it is scored the same.");
      setMode("typing");
    }
  }, [onLevel]);

  function finish() {
    stopRef.current?.();
    cleanup();
    onAnswer({
      // Until live transcription lands, a spoken take carries no text; the
      // panel scores it on delivery signals and length. Never invent words the
      // player did not say.
      text: "",
      spoken: true,
      seconds,
    });
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-[var(--radius-card)] bg-[var(--surface-elevated)] p-4 shadow-[var(--e3)]"
    >
      <p className="text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
        THEY ARE WAITING
      </p>
      <p className="mt-1.5 text-base font-semibold leading-snug text-[var(--text-primary)]">
        {question}
      </p>

      {err && (
        <p className="mt-3 text-sm leading-snug text-[var(--text-secondary)]">{err}</p>
      )}

      {mode === "choose" && (
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={beginRecording}
            className="nv-press h-14 w-full rounded-[var(--radius-pill)] bg-[var(--action)] text-base font-extrabold tracking-[0.04em] text-[var(--on-action)] shadow-[var(--e3)]"
          >
            ANSWER OUT LOUD
          </button>
          <button
            type="button"
            onClick={() => setMode("typing")}
            className="nv-press h-12 w-full rounded-[var(--radius-pill)] bg-[var(--surface-overlay)] text-sm font-bold tracking-[0.04em] text-[var(--text-primary)]"
          >
            Type it instead
          </button>
          <button
            type="button"
            onClick={onDecline}
            className="h-10 w-full text-2xs font-bold tracking-[0.12em] text-[var(--text-tertiary)]"
          >
            SAY NOTHING
          </button>
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
          <button
            type="button"
            onClick={finish}
            className="nv-press mt-4 h-14 w-full rounded-[var(--radius-pill)] bg-[var(--action)] text-base font-extrabold tracking-[0.04em] text-[var(--on-action)] shadow-[var(--e3)]"
          >
            THAT&rsquo;S MY ANSWER
          </button>
        </div>
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
            className="nv-press mt-3 h-14 w-full rounded-[var(--radius-pill)] bg-[var(--action)] text-base font-extrabold tracking-[0.04em] text-[var(--on-action)] shadow-[var(--e3)] disabled:opacity-40"
          >
            THAT&rsquo;S MY ANSWER
          </button>
        </div>
      )}
    </motion.div>
  );
}
