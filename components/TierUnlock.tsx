"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { SHEET_SPRING } from "@/components/ui/Motion";
import { tierDef, tierVideoSrc, type Gender, type Tier } from "@/lib/engine/avatar";
import { haptic } from "@/lib/haptics";
import { play } from "@/lib/sound";

/**
 * The tier unlock — the one moment the character video plays.
 *
 * It fires when the company promotes a stage and the founder's wardrobe opens
 * with it. The clip is ~4 MB, so it is never preloaded: the <video> is only
 * mounted once this component is on screen, which means a player who never
 * reaches Scale never downloads the Scale clip.
 *
 * Sound is off by default and the card is fully legible without it. Autoplay
 * with audio is blocked on iOS anyway, and a celebration that hijacks the room
 * is a worse celebration.
 */
export function TierUnlock({
  gender,
  tier,
  onClose,
}: {
  gender: Gender;
  tier: Tier;
  onClose: () => void;
}) {
  const def = tierDef(tier);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const still = `/founder/${gender}-${tier}.webp`;

  useEffect(() => {
    haptic("yearClosed");
    play("unlock");
  }, []);

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    // play() rejects on some engines when the tab is not visible or the user
    // has data-saver on. That is not an error worth showing — fall back to the
    // still, which says the same thing.
    v.play().catch(() => setFailed(true));
  }, []);

  return (
    <motion.div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-[var(--scrim)] px-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28 }}
      role="dialog"
      aria-label={`New tier unlocked: ${def.label}`}
    >
      <motion.div
        className="w-full max-w-sm overflow-hidden rounded-[var(--radius-card)] bg-[var(--surface)] shadow-[var(--e4)]"
        initial={{ scale: 0.94, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        transition={SHEET_SPRING}
      >
        <div className="relative aspect-square w-full bg-[var(--n-0)]">
          {!failed ? (
            <video
              ref={videoRef}
              src={tierVideoSrc(gender, tier)}
              /*
               * The still, as the poster.
               *
               * `.gitignore` keeps `public/founder/*.mp4` out of git — ~38 MB of
               * source video — so NO clone, CI build or deploy has these clips.
               * The `onError` below has therefore always been the live path in
               * production, not the fallback: every unlock 404s, then swaps.
               *
               * Without a poster that swap is what the player sees — a black
               * square for a network round-trip, then the still appearing. With
               * one, the still is on screen in the first frame and the swap
               * underneath it is invisible. Where the clips DO exist (a machine
               * that ran make-characters.mjs against the raw renders) the video
               * paints over the poster exactly as before.
               */
              poster={still}
              muted
              playsInline
              autoPlay
              onError={() => setFailed(true)}
              className="h-full w-full object-contain"
            />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={still} alt="" className="h-full w-full object-contain" />
          )}
        </div>

        <div className="p-5">
          <p className="text-2xs font-bold tracking-[0.18em] text-[var(--text-tertiary)]">
            TIER {tier} UNLOCKED
          </p>
          <h2 className="mt-1 text-xl font-extrabold tracking-[-0.01em]">{def.label}</h2>
          <p className="mt-1.5 text-sm leading-snug text-[var(--text-secondary)]">{def.blurb}</p>

          <button
            type="button"
            onClick={onClose}
            className="nv-gc mt-5 h-14 w-full rounded-[var(--radius-pill)] nv-t-action text-base font-extrabold tracking-[0.04em] shadow-[var(--e3)]"
          >
            WEAR IT ▸
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
