"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

/**
 * The mascot. A light shell: the WebGL half lives in SharkCanvas and is loaded
 * on demand, so importing this component no longer drags 23 MB of GLB onto
 * routes that only ever show the poster.
 *
 * The supplied mesh has no rig or animation clips, so the five states are
 * driven procedurally: idle breath, a listening lean, a thinking tilt, a
 * celebrate bounce, and a verdict settle.
 */
export type SharkState = "idle" | "listening" | "thinking" | "celebrate" | "verdict";

const SharkCanvas = dynamic(() => import("@/components/SharkCanvas"), {
  ssr: false,
  loading: () => null,
});

export function SharkStage({
  state = "idle",
  /** Live mic level 0..1 — the shark leans in when you actually speak. */
  level = 0,
  className = "",
  tint,
  suitTint,
  /**
   * Hold the canvas back until the surface is actually visible. Off-screen or
   * secondary mascots pass false and cost nothing but the poster.
   */
  active = true,
}: {
  state?: SharkState;
  level?: number;
  className?: string;
  /** Closet: recolour the shark's skin. Cosmetic only. */
  tint?: string;
  /** Closet: recolour the suit. */
  suitTint?: string;
  active?: boolean;
}) {
  const [webglOk, setWebglOk] = useState(true);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      setWebglOk(!!gl);
    } catch {
      setWebglOk(false);
    }
  }, []);

  if (!webglOk) return <SharkFallback state={state} className={className} />;

  return (
    <div className={`relative ${className}`}>
      {/* The poster sits under the canvas so the stage never reads as broken
          while the mesh lands, or before the first frame paints. */}
      <StagePoster />
      {active && (
        <SharkCanvas
          state={state}
          level={level}
          reduced={reduced}
          tint={tint}
          suitTint={suitTint}
        />
      )}
    </div>
  );
}

/**
 * A still frame of the mascot's silhouette, at the size and position the real
 * model occupies — so the canvas arriving is a fade, not a jump.
 */
function StagePoster() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 flex items-end justify-center"
    >
      <svg
        viewBox="0 0 120 130"
        className="h-full w-auto opacity-[0.18]"
        fill="none"
        preserveAspectRatio="xMidYMax meet"
      >
        {/* Head, body and tail as one mass — enough to hold the space and read
            as "a suited shark stands here", without pretending to be the model. */}
        <ellipse cx="60" cy="42" rx="30" ry="26" fill="currentColor" className="text-[var(--n-11)]" />
        <path
          d="M34 62h52c5 0 8 4 8 9v38c0 6-4 10-10 10H36c-6 0-10-4-10-10V71c0-5 3-9 8-9Z"
          fill="currentColor"
          className="text-[var(--n-11)]"
        />
        <path d="M60 8c0 0-7 12-9 22h18c-2-10-9-22-9-22Z" fill="currentColor" className="text-[var(--n-11)]" />
        <path d="M26 84 6 96l20 10V84Z" fill="currentColor" className="text-[var(--n-11)]" />
      </svg>
    </div>
  );
}

/** No WebGL: the same silhouette, stated plainly rather than left blank. */
function SharkFallback({ state, className }: { state: SharkState; className?: string }) {
  return (
    <div className={`relative flex items-center justify-center ${className ?? ""}`}>
      <StagePoster />
      <p className="relative text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
        {state === "listening" ? "LISTENING" : "THE SHARK"}
      </p>
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
