"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";

/**
 * The lock screen — the first thing you see when you pick the phone up.
 *
 * ── Why the phone locks at all ─────────────────────────────────────────────
 *
 * It used to open straight into the inbox, which made it a menu. A phone that
 * opens on a notification is a UI panel wearing a phone costume; a phone you
 * have to unlock is an object. The half-second of swiping is the entire point —
 * it puts a boundary between "playing Novus" and "checking my phone", which is
 * what makes the mail feel like it arrived rather than like it was queued.
 *
 * ── The swipe ──────────────────────────────────────────────────────────────
 *
 * Dragged, not tapped, because a tap would not feel like anything. Real physics:
 * you can drag it partway and let go, and it falls back with the wallpaper
 * settling behind it. Past roughly a third of the height it commits and finishes
 * the travel itself.
 *
 * Everything scales off the drag position rather than switching at a threshold —
 * the clock rises and fades, the hint fades first, the wallpaper lifts a little
 * slower than your finger. That last part is the trick that sells it.
 *
 * Keyboard and screen-reader users get a real button, not a fake one: Enter or
 * Space on the focused hint runs the same unlock animation. A drag-only unlock
 * would lock those players out of the phone entirely.
 */
export function LockScreen({ onUnlock }: { onUnlock: () => void }) {
  const [now, setNow] = useState<Date | null>(null);
  const y = useMotionValue(0);
  const height = useRef(0);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [committing, setCommitting] = useState(false);

  // Real clock. Sampled every ten seconds — this is the one surface where a
  // minute rolling over while you look at it actually matters.
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 10_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const measure = () => {
      height.current = wrapRef.current?.offsetHeight ?? 0;
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  // Drive everything off travel as a fraction, so the same numbers work at any
  // phone height.
  const progress = useTransform(y, (v) => {
    const h = height.current || 1;
    return Math.min(1, Math.max(0, -v / h));
  });
  const contentY = useTransform(progress, [0, 1], [0, -56]);
  const contentOpacity = useTransform(progress, [0, 0.55], [1, 0]);
  const hintOpacity = useTransform(progress, [0, 0.18], [1, 0]);
  // The wallpaper trails the sheet. Parallax is what makes it read as depth
  // rather than as one card sliding off another.
  const wallY = useTransform(progress, [0, 1], [0, -34]);
  const wallScale = useTransform(progress, [0, 1], [1, 1.06]);

  const commit = () => {
    if (committing) return;
    setCommitting(true);
    animate(y, -(height.current || 600), {
      duration: 0.32,
      ease: [0.16, 1, 0.3, 1],
      onComplete: onUnlock,
    });
  };

  const time = now
    ? now.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : "";
  const date = now
    ? now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })
    : "";

  return (
    <div ref={wrapRef} className="relative h-full w-full overflow-hidden">
      <motion.div
        aria-hidden="true"
        className="absolute inset-0 bg-cover bg-center"
        style={{
          backgroundImage: "url(/phone/lock-wallpaper.webp)",
          y: wallY,
          scale: wallScale,
        }}
      />
      {/* The clock sits over open water in the artwork, but the artwork is not
          guaranteed to load. A soft scrim keeps white type legible either way. */}
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-black/25 to-transparent"
      />

      <motion.div
        drag="y"
        dragDirectionLock
        dragConstraints={{ top: -2000, bottom: 0 }}
        dragElastic={{ top: 0.9, bottom: 0 }}
        style={{ y }}
        onDragEnd={(_, info) => {
          const h = height.current || 1;
          const travelled = -info.offset.y / h;
          // A flick counts even when it did not travel far — matching how a real
          // phone reads intent from velocity, not just distance.
          if (travelled > 0.3 || info.velocity.y < -520) commit();
          else animate(y, 0, { type: "spring", stiffness: 520, damping: 40 });
        }}
        className="absolute inset-0 cursor-grab touch-none active:cursor-grabbing"
      >
        <motion.div
          className="flex h-full flex-col items-center px-6 pt-[13%]"
          style={{ y: contentY, opacity: contentOpacity }}
        >
          <p
            className="text-center text-[1.05rem] font-semibold text-white/85"
            style={{ textShadow: "0 1px 12px rgba(0,0,0,0.35)" }}
          >
            {date}
          </p>
          <p
            // The one place --font-bubble is used. Tabular figures so the clock
            // does not jitter as the minute changes.
            className="tnum mt-1 text-center text-[4.5rem] leading-[1.05] text-white"
            style={{
              fontFamily: "var(--font-bubble), var(--font-sans)",
              fontWeight: 800,
              textShadow: "0 2px 22px rgba(0,0,0,0.35)",
            }}
          >
            {time}
          </p>
        </motion.div>

        <motion.button
          type="button"
          onClick={commit}
          style={{ opacity: hintOpacity }}
          className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-2 pb-4 pt-8 focus-visible:outline-none"
          aria-label="Swipe up to unlock"
        >
          <ChevronUp />
          <span
            className="text-2xs font-bold tracking-[0.16em] text-white/85"
            style={{ textShadow: "0 1px 8px rgba(0,0,0,0.4)" }}
          >
            SWIPE UP TO UNLOCK
          </span>
          <span
            aria-hidden="true"
            className="mt-0.5 h-1.5 w-28 rounded-full bg-white/70"
          />
        </motion.button>
      </motion.div>
    </div>
  );
}

/** A slow breathing nudge, so a still screen still reads as "drag me". */
function ChevronUp() {
  return (
    <motion.svg
      viewBox="0 0 24 14"
      className="h-3 w-6 text-white/80"
      fill="none"
      aria-hidden="true"
      animate={{ y: [0, -4, 0] }}
      transition={{ duration: 1.9, repeat: Infinity, ease: "easeInOut" }}
    >
      <path
        d="M2 11 12 3l10 8"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </motion.svg>
  );
}
