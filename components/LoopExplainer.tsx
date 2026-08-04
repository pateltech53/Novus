"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ENTER } from "@/components/ui/Motion";
import { PrimaryButton, StepShell } from "@/components/StepShell";

/**
 * O6 · What this game is — shown, not described.
 *
 * Three beats, one idea each, each carried by a clip of the real thing.
 *
 * ── What changed and why ───────────────────────────────────────────────────
 * The first version of this screen taught the *rhythm*: eleven taps are cheap,
 * the twelfth is expensive. That is a true and interesting thing about Novus and
 * it is the wrong thing to lead with, because it describes the CONTROLS of a
 * game the player cannot picture yet. Someone who does not know what Novus is
 * learns from it that a button will stop working.
 *
 * So these three beats answer the only question a new player actually has —
 * *what is this?* — in the order you would answer it out loud: you run a
 * company, the decisions have costs, and once a year you defend it to five
 * investors. The rhythm teaches itself in ten seconds of play; what it IS does
 * not.
 *
 * ── On the audio ───────────────────────────────────────────────────────────
 * Every clip is hard-muted at the element and ships no controls. The sources
 * carry loud room noise, and an onboarding screen that shouts at someone on a
 * bus is worse than no onboarding at all. Nothing here needs sound: each beat
 * has a caption, and the caption is the content.
 *
 * ── On trimming ────────────────────────────────────────────────────────────
 * There is no ffmpeg in this toolchain, so the clips are not re-encoded. They
 * are trimmed at PLAYBACK via the in/out points below — cheaper than a render,
 * reversible, and it leaves the originals intact. Change `from`/`to` and
 * reload; nothing needs rebuilding.
 */

interface Beat {
  id: string;
  src: string;
  /** Playback window in seconds. `to: null` runs to the end of the file. */
  from: number;
  to: number | null;
  /**
   * Whether this clip sits on a removable matte.
   *
   * Sampled from the files rather than assumed. Two of the three are a mascot
   * rendered on flat white (944×960, rgb 255,255,255 on every border pixel) —
   * that white is a matte and it goes. The third is a lit 3D set (1168×768, the
   * five sharks behind the desk under "THE TANK"), where the darkness is the
   * *scene*, not a backdrop. There is nothing to key: its corners sample to
   * four different colours. It keeps its ground, and that darkness earns its
   * keep — beat three is where the film changes temperature.
   */
  matte: "white" | "none";
  kicker: string;
  title: string;
  body: string;
}

const BEATS: Beat[] = [
  {
    id: "months",
    src: "/onboarding/months.mp4",
    matte: "white",
    from: 0,
    to: null,
    kicker: "ONE",
    title: "You run a company.",
    body: "Not a character with a job — the whole business. Hiring, pricing, product, cash. You move it forward one month at a time.",
  },
  {
    id: "choices",
    src: "/onboarding/choices.mp4",
    matte: "white",
    from: 0,
    to: null,
    kicker: "TWO",
    title: "Every call costs something.",
    body: "There is no free option and no right answer waiting to be spotted. You spend cash, people, time or goodwill, and you find out later which one you could least afford.",
  },
  {
    id: "tank",
    src: "/onboarding/tank.mp4",
    matte: "none",
    from: 0,
    to: null,
    kicker: "THREE",
    title: "Once a year, you defend it.",
    body: "Twelve months in, you go into The Tank and pitch out loud to five investors who have read your numbers. That is how a year ends \u2014 and how the next one gets funded.",
  },
];

export function LoopExplainer({ onDone }: { onDone: () => void }) {
  const [i, setI] = useState(0);
  const beat = BEATS[i];
  const last = i === BEATS.length - 1;

  const next = useCallback(() => {
    if (last) onDone();
    else setI((n) => n + 1);
  }, [last, onDone]);

  return (
    <StepShell>
      <div className="flex w-full flex-1 flex-col justify-center">
        <AnimatePresence mode="wait">
          <motion.div
            key={beat.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={ENTER}
            className="w-full"
          >
            <BeatVideo beat={beat} />

            <p className="mt-5 text-2xs font-bold tracking-[0.24em] text-[var(--text-tertiary)]">
              {beat.kicker}
            </p>
            <h2 className="mt-1 text-[1.625rem] font-extrabold leading-tight tracking-[-0.02em]">
              {beat.title}
            </h2>
            <p className="mt-2 max-w-[22rem] text-sm leading-snug text-[var(--text-secondary)]">
              {beat.body}
            </p>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Three steps, because there are three ideas — not a dot per screen. */}
      <div className="mb-3 flex justify-center gap-1.5" aria-hidden="true">
        {BEATS.map((b, n) => (
          <span
            key={b.id}
            className={`h-1 rounded-full transition-all duration-300 ${
              n === i ? "w-6 bg-[var(--text-secondary)]" : "w-1.5 bg-[var(--n-5)]"
            }`}
          />
        ))}
      </div>

      <div className="w-full">
        <PrimaryButton onClick={next}>{last ? "I'M READY" : "NEXT"}</PrimaryButton>
      </div>
    </StepShell>
  );
}

function BeatVideo({ beat }: { beat: Beat }) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;

    const start = () => {
      v.currentTime = beat.from;
      // Rejections here are normal — data saver, reduced motion, a backgrounded
      // tab. The first frame still carries the meaning, so there is nothing to
      // report and nothing to fall back to.
      void v.play().catch(() => {});
    };

    // Loop the WINDOW, not the file, so a clip with a long tail does not sit on
    // a frozen frame for five seconds.
    const onTime = () => {
      if (beat.to !== null && v.currentTime >= beat.to) start();
    };

    v.addEventListener("loadedmetadata", start);
    v.addEventListener("timeupdate", onTime);
    if (v.readyState >= 1) start();
    return () => {
      v.removeEventListener("loadedmetadata", start);
      v.removeEventListener("timeupdate", onTime);
    };
  }, [beat]);

  /*
   * ── Dropping the matte without a canvas ──────────────────────────────────
   *
   * The mascot clips ship on flat white, and that white has to go or every beat
   * is a bright box pasted onto a warm page.
   *
   * A per-frame canvas keyer would work, and would also burn CPU on every frame
   * of every clip, on a phone, during onboarding. `multiply` does it for free
   * and does it EXACTLY, because white is multiply's identity:
   *
   *   white × plate = plate     → the matte becomes the plate, i.e. vanishes
   *
   * It also beats a hard chroma key on this footage specifically: the mascot
   * casts a soft grey ground shadow, and multiply composites that shadow onto
   * the plate as a shadow. A threshold key turns it into a grey smear or clips
   * it off entirely.
   *
   * The one thing to respect is that multiply only reads correctly against a
   * LIGHT plate — against a dark one it would crush the whole mascot to black.
   * So the plate is a fixed warm off-white in both themes. In dark mode that
   * reads as an illustration plate, which is what it is.
   */
  const keyed = beat.matte === "white";

  return (
    <div
      className="overflow-hidden rounded-[var(--radius-card)] shadow-[var(--e2)]"
      style={{ background: keyed ? "#f6f4f1" : "#191a1e" }}
    >
      <video
        ref={ref}
        src={beat.src}
        // muted + playsInline + no controls: this is illustration, not media.
        muted
        playsInline
        autoPlay
        loop={beat.to === null}
        preload="metadata"
        aria-hidden="true"
        className={`block w-full ${keyed ? "aspect-square object-contain" : "aspect-[3/2] object-cover"}`}
        style={keyed ? { mixBlendMode: "multiply" } : undefined}
      />
    </div>
  );
}
