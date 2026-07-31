"use client";

import { motion } from "framer-motion";
import { PANEL, type SeatState } from "@/lib/ai/panel-cast";
import type { SharkId } from "@/lib/ai/types";

/**
 * The Tank — one room, one camera angle, for the whole meeting.
 *
 * ── What changed, and why ────────────────────────────────────────────────────
 * The previous version pushed the set photograph into the background with
 * brightness and blur, then floated five cut-out shark PNGs on top of it. That
 * meant the room was wallpaper and the cast were stickers — the sharks were
 * literally sitting in front of photographs of themselves.
 *
 * Now the photograph IS the room, at full strength. Nobody floats on top of
 * it. The shark who is speaking is picked out with a light on their seat and
 * the rest of the frame dims very slightly toward them — which is how a real
 * set tells you who has the floor.
 *
 * The angle never changes: pitch, questions, negotiation and the verdict all
 * happen here. The founder never leaves the meeting.
 */

/** Where each shark sits in the set photograph, as a share of the frame. */
const SEATS: Record<SharkId, { x: number; w: number }> = {
  serena: { x: 0.145, w: 0.19 }, // blue jacket, far left
  viktor: { x: 0.335, w: 0.19 }, // black suit, glasses
  dev: { x: 0.5, w: 0.19 }, // green tie, centre
  lily: { x: 0.665, w: 0.19 }, // cream blazer
  marcus: { x: 0.855, w: 0.19 }, // pinstripe, far right
};

export function TankRoom({
  states,
  speaking,
  micLevel = 0,
  cameraStream,
  year,
  phase,
}: {
  states: Partial<Record<SharkId, SeatState>>;
  speaking: SharkId | null;
  micLevel?: number;
  cameraStream?: MediaStream | null;
  year: number;
  /** Only used for the caption strip — the ROOM itself never changes. */
  phase?: string;
}) {
  return (
    <div className="relative isolate w-full overflow-hidden rounded-[var(--radius-card)] bg-[var(--n-0)] shadow-[var(--e3)]">
      {/* The room, at full strength. 3:2 to match the plate. */}
      <div className="relative aspect-[3/2] w-full">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/sharks/tank-set.webp"
          alt="Five investors seated behind the desk in The Tank"
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
        />

        {/* Everything below is LIGHT on the room, never a sticker over it. */}
        {PANEL.map((shark) => {
          const state: SeatState = states[shark.id] ?? "idle";
          const seat = SEATS[shark.id];
          const isSpeaking = state === "speaking" || state === "bidding";
          const isOut = state === "out";
          const lean = state === "listening" ? Math.min(0.06, micLevel * 0.06) : 0;

          return (
            <motion.div
              key={shark.id}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0"
              style={{
                left: `${(seat.x - seat.w / 2) * 100}%`,
                width: `${seat.w * 100}%`,
              }}
              animate={{ opacity: isSpeaking ? 1 : isOut ? 1 : 0.001 + lean }}
              transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
            >
              {isOut ? (
                // Folded: drain their patch of the frame rather than removing
                // them. They are still sitting there, and that reads.
                <div className="absolute inset-0 bg-[oklch(0.10_0.004_260/0.62)] backdrop-grayscale" />
              ) : (
                // Has the floor: a soft key light on their seat.
                <div className="absolute inset-x-[-12%] inset-y-0 bg-[radial-gradient(60%_46%_at_50%_38%,oklch(0.95_0.03_80/0.30)_0%,transparent_72%)]" />
              )}
            </motion.div>
          );
        })}

        {/* The rest of the room settles a touch when someone is talking. */}
        <motion.div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[oklch(0.08_0.004_260)]"
          animate={{ opacity: speaking ? 0.22 : 0.08 }}
          transition={{ duration: 0.32 }}
        />

        {/* Title, bottom-left, like a broadcast bug. */}
        {/* Caption stack, bottom-LEFT and nothing else there. The speaker's
            name used to sit bottom-right, where the camera lands — so the two
            overlapped and both became unreadable. */}
        <div className="pointer-events-none absolute bottom-0 left-0 max-w-[62%] p-3">
          <p className="text-2xs font-bold tracking-[0.24em] text-[var(--n-7)]">
            FISCAL YEAR {year}
            {phase ? ` · ${phase.toUpperCase()}` : ""}
          </p>
          <p className="text-sm font-extrabold tracking-[0.14em] text-[var(--n-10)]">THE TANK</p>
          {speaking && (
            <motion.p
              key={speaking}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-1 inline-block truncate rounded-[var(--radius-pill)] bg-[oklch(0.08_0.004_260/0.8)] px-2.5 py-1 text-2xs font-bold tracking-[0.08em] text-[var(--n-11)]"
            >
              {PANEL.find((s) => s.id === speaking)?.name ?? ""}
            </motion.p>
          )}
        </div>

        <FounderCam stream={cameraStream} />
      </div>
    </div>
  );
}

/**
 * The founder's return feed — FaceTime-sized, bottom-right, inside the frame.
 *
 * It was previously large enough to sit on top of a shark's head and cover the
 * subtitles. A self-view exists so you can check you are still in frame; it
 * does not need to compete with the room.
 *
 * Mirrored, because an un-mirrored self-view is deeply strange to look at.
 */
function FounderCam({ stream }: { stream?: MediaStream | null }) {
  return (
    <div className="absolute bottom-2 right-2 z-30 h-[3.25rem] w-[2.4rem] overflow-hidden rounded-[0.45rem] bg-[oklch(0.08_0.004_260)] shadow-[var(--e3)] ring-1 ring-white/20 sm:h-[4rem] sm:w-[2.9rem]">
      {stream ? (
        <video
          autoPlay
          muted
          playsInline
          className="h-full w-full object-cover"
          style={{ transform: "scaleX(-1)" }}
          ref={(el) => {
            if (el && el.srcObject !== stream) el.srcObject = stream;
          }}
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-[var(--alert)]" />
          <span className="text-2xs font-bold tracking-[0.1em] text-[var(--n-7)]">YOU</span>
        </div>
      )}
    </div>
  );
}
