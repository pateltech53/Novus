"use client";

import { useEffect, useRef } from "react";

import type { Rarity } from "@/lib/rewards/tables";

/**
 * The confetti burst behind a reveal.
 *
 * ── Why a canvas and not DOM nodes ──────────────────────────────────────────
 *
 * Two hundred absolutely-positioned divs, each with its own transform being
 * written every frame, is two hundred entries in the compositor's layer
 * bookkeeping at the exact moment the reveal is also running a flip, a wash
 * and a rising wave. On a mid-range Android that is where the frame budget
 * goes. One canvas is one layer, and the particle loop is arithmetic the main
 * thread can afford.
 *
 * ── Why it is not framer-motion ─────────────────────────────────────────────
 *
 * Nothing here is a UI state transition, so none of the house motion tokens
 * apply — this is a physics sim that runs once and stops. The house rule the
 * burst DOES obey is `prefers-reduced-motion`: the caller passes `reduced` and
 * the component renders nothing at all rather than a gentler version, because
 * a slow shower of paper is not a kinder version of confetti, it is a longer
 * one.
 *
 * ── Why the volume tracks rarity ────────────────────────────────────────────
 *
 * The whole reveal ladder exists to answer "is it good" before "what is it".
 * A Legendary that showers the screen and a Common that pops a handful say
 * that in the one language a player reads without thinking. If every rarity
 * threw the same burst, the burst would stop meaning anything by the fourth
 * case.
 */

/** How many pieces each rarity is worth, and how long they stay up. */
const VOLUME: Record<Rarity, { count: number; ms: number; spread: number }> = {
  common:    { count: 46,  ms: 1500, spread: 0.55 },
  uncommon:  { count: 72,  ms: 1800, spread: 0.65 },
  rare:      { count: 110, ms: 2200, spread: 0.80 },
  epic:      { count: 165, ms: 2600, spread: 0.95 },
  legendary: { count: 240, ms: 3200, spread: 1.15 },
};

interface Piece {
  x: number; y: number;
  vx: number; vy: number;
  rot: number; spin: number;
  w: number; h: number;
  color: string;
  /** Per-piece flutter phase, so the sheet does not tumble in lockstep. */
  phase: number;
}

export default function Confetti({
  color,
  rarity,
  reduced = false,
}: {
  /** The rarity's colour — most of the paper is this, so the burst is read
   *  as "that rarity happened" and not as generic celebration. */
  color: string;
  rarity: Rarity;
  reduced?: boolean;
}) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (reduced) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Cap the backing store at 2× — a 3× phone gains nothing visible from
    // nine times the fill and pays for all of it.
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let width = 0;
    let height = 0;

    const resize = () => {
      width = canvas.clientWidth;
      height = canvas.clientHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const { count, ms, spread } = VOLUME[rarity];
    const palette = [color, color, color, "#FFFFFF", "#FFD166"];

    /*
     * Two origins, not one. A single point reads as a party popper; the pair
     * either side of the card reads as the room reacting to it, which is the
     * feeling the reveal is after. Both fire upward and outward from just
     * below the card's centre line.
     */
    const origins = [
      { x: width * 0.5 - width * 0.22, dir: 1 },
      { x: width * 0.5 + width * 0.22, dir: -1 },
    ];

    const pieces: Piece[] = Array.from({ length: count }, (_, i) => {
      const origin = origins[i % origins.length];
      const angle = -Math.PI / 2 + origin.dir * (Math.random() * 0.5 + 0.1);
      const speed = (7 + Math.random() * 9) * spread;
      return {
        x: origin.x + (Math.random() - 0.5) * 40,
        y: height * 0.62,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rot: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 0.34,
        w: 5 + Math.random() * 6,
        h: 8 + Math.random() * 9,
        color: palette[Math.floor(Math.random() * palette.length)],
        phase: Math.random() * Math.PI * 2,
      };
    });

    const GRAVITY = 0.34;
    const DRAG = 0.986;
    const started = performance.now();
    let frame = 0;

    const draw = (now: number) => {
      const elapsed = now - started;
      if (elapsed > ms) { ctx.clearRect(0, 0, width, height); return; }

      // The last third fades the whole sheet out rather than each piece
      // separately — one globalAlpha is cheaper than 240 rgba strings.
      const life = elapsed / ms;
      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = life < 0.66 ? 1 : 1 - (life - 0.66) / 0.34;

      for (const p of pieces) {
        p.vy += GRAVITY;
        p.vx *= DRAG;
        p.vy *= DRAG;
        // A little lateral drift so the fall looks like paper and not gravel.
        p.x += p.vx + Math.sin(now / 320 + p.phase) * 0.7;
        p.y += p.vy;
        p.rot += p.spin;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        // Squashing the height by the cosine of the spin is the cheap trick
        // that sells a flat rectangle as a tumbling sheet.
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h * Math.abs(Math.cos(p.rot)));
        ctx.restore();
      }

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [color, rarity, reduced]);

  if (reduced) return null;

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-20 h-full w-full"
    />
  );
}
