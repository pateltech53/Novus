"use client";

import { useEffect, useRef, useState } from "react";
import { useStill } from "@/components/ui/Motion";
import dynamic from "next/dynamic";

import { useScrolling } from "@/lib/scroll";

/**
 * The landing hero's mascot: the suited shark holding the champion's trophy.
 *
 * Same shape as components/SharkStage.tsx — a light shell that owns the
 * poster, WebGL detection, and reduced-motion, with the R3F half loaded on
 * demand so "/" ships no three.js until this component is actually on screen.
 *
 * ── The shark yields the page ──────────────────────────────────────────────
 *
 * The idle is a nine-and-a-half second sway. Nobody has ever noticed it stop
 * for the length of a flick, and everybody notices a landing page that stutters
 * the first time they drag it — so while the page is moving, the loop stands
 * down and the browser gets the whole frame for the scroll. It picks the sway
 * back up where it left off once the page is still.
 *
 * The mesh also waits for an idle callback before it mounts at all. three.js,
 * drei and a 2.2 MB GLB all parse on the main thread, and a visitor who lands
 * and immediately scrolls was scrolling straight through that parse. The
 * poster below is already standing in the model's place, which is what makes
 * the wait free.
 */

const LandingSharkCanvas = dynamic(
  () => import("@/components/landing/LandingSharkCanvas"),
  { ssr: false, loading: () => null },
);

export function LandingShark({ className = "" }: { className?: string }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [webglOk, setWebglOk] = useState(true);
  const [modelReady, setModelReady] = useState(false);
  /** The mesh is mounted once the browser has a spare moment — see above. */
  const [mounted, setMounted] = useState(false);
  // Assume on screen until the observer says otherwise — the hero is the top
  // of the page, so the first paint is always visible.
  const [onStage, setOnStage] = useState(true);
  const reduced = useStill();
  const scrolling = useScrolling();

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
      setWebglOk(!!gl);
    } catch {
      setWebglOk(false);
    }
  }, []);

  useEffect(() => {
    if (!webglOk) return;
    // Same shape as usePrefetch: idle if the browser has it, a short timer for
    // the ones that shipped requestIdleCallback late. The timeout matters more
    // than the callback — on a slow phone there is no idle moment, and the
    // hero must still arrive.
    const start = () => setMounted(true);
    const idle = window.requestIdleCallback;
    if (idle) {
      const id = idle(start, { timeout: 1500 });
      return () => window.cancelIdleCallback?.(id);
    }
    const id = window.setTimeout(start, 400);
    return () => window.clearTimeout(id);
  }, [webglOk]);

  // Scrolling down to the glossary should not keep a 60fps turntable running
  // off-screen. Off stage → the canvas drops to frameloop="demand" and holds
  // its last frame for free.
  useEffect(() => {
    const el = rootRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setOnStage(entry.isIntersecting),
      { threshold: 0.05 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      {/* The poster holds the champion's silhouette at the size and place the
          model lands, then fades once the mesh has resolved — arrival reads as
          a focus pull, not a pop-in. It also IS the experience for no-WebGL
          and for anyone whose connection never delivers the 2.2 MB mesh. */}
      <ChampionPoster faded={webglOk && modelReady} labelled={!webglOk} />
      {webglOk && mounted && (
        <LandingSharkCanvas
          reduced={reduced}
          spinning={onStage && !scrolling}
          onReady={() => setModelReady(true)}
        />
      )}
    </div>
  );
}

/**
 * A still of the champion — head, suit, fins, and the trophy held in front —
 * as one quiet mass. Enough to say "the shark stands here, holding the cup"
 * without pretending to be the model.
 */
function ChampionPoster({ faded, labelled }: { faded: boolean; labelled: boolean }) {
  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 flex flex-col items-center justify-end transition-opacity duration-500 ${
        faded ? "opacity-0" : "opacity-100"
      }`}
    >
      <svg
        viewBox="0 0 150 168"
        className="h-[86%] w-auto max-w-full opacity-[0.16]"
        fill="none"
        preserveAspectRatio="xMidYMax meet"
      >
        {/* Tail fin above the head, then head, suit, side fins. */}
        <path d="M75 4c0 0-8 14-10 25h20C83 18 75 4 75 4Z" fill="currentColor" className="text-[var(--n-11)]" />
        <ellipse cx="75" cy="56" rx="33" ry="28" fill="currentColor" className="text-[var(--n-11)]" />
        <path
          d="M46 80h58c6 0 10 4 10 10v46c0 7-5 12-12 12H48c-7 0-12-5-12-12V90c0-6 4-10 10-10Z"
          fill="currentColor"
          className="text-[var(--n-11)]"
        />
        <path d="M36 98 14 111l22 13V98Z" fill="currentColor" className="text-[var(--n-11)]" />
        <path d="M114 98l22 13-22 13V98Z" fill="currentColor" className="text-[var(--n-11)]" />
        {/* The trophy, held low in front — cup, stem, base. Drawn wider than
            the suit at the handles so it survives the single-tone silhouette. */}
        <path
          d="M53 118h44v8a22 22 0 0 1-44 0v-8Z"
          fill="currentColor"
          className="text-[var(--n-11)]"
        />
        <path d="M53 120h-9a9 9 0 0 0 11 12M97 120h9a9 9 0 0 1-11 12" stroke="currentColor" strokeWidth="5" className="text-[var(--n-11)]" />
        <rect x="71" y="146" width="8" height="8" fill="currentColor" className="text-[var(--n-11)]" />
        <rect x="60" y="154" width="30" height="7" rx="2" fill="currentColor" className="text-[var(--n-11)]" />
      </svg>
      {labelled && (
        <p className="pb-4 text-2xs font-bold tracking-[0.16em] text-[var(--text-tertiary)]">
          THE SHARK, HOLDING THE TROPHY
        </p>
      )}
    </div>
  );
}

