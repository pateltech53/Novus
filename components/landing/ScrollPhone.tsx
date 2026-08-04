"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";

/**
 * Shell for the scroll-driven phone: owns the sticky scrollytelling frame, the
 * scroll → progress mapping, WebGL detection, and the flat fallback. The R3F
 * half loads on demand so "/" ships no extra three.js until this section is
 * actually approached.
 *
 * The pattern: the section is three viewports tall; a sticky child pins the
 * phone in view while the visitor scrolls through it, and that scroll fraction
 * drives the model's rotation. The scrollbar is the turntable handle.
 *
 * ── Why the frame budget is guarded so carefully here ──────────────────────
 *
 * This section is a third of the page's scroll length, and it holds a live
 * WebGL canvas. Three things were costing the visitor a smooth scroll, and all
 * three are structural rather than a matter of tuning:
 *
 *   1. The canvas mounted with the page, two viewports above where it is
 *      first seen — three.js, drei and the screen texture all parsed while the
 *      visitor was reading the hero. It now mounts when the section comes
 *      within half a screen (`approached`).
 *   2. It then rendered at 60fps for as long as any part of the section was on
 *      screen, including the whole time someone stood still reading the copy
 *      beside it. It is now a `demand` loop: frames are asked for by scrolling,
 *      and the chase in ScrollPhoneCanvas asks for its own until it settles.
 *   3. The scroll → progress mapping re-measured the section on every scroll
 *      event. `window.innerHeight` changes continuously while a mobile
 *      browser collapses its toolbar, so the divisor moved underneath the
 *      mapping mid-gesture and the phone's angle stepped. The geometry is
 *      measured once and re-measured only when something actually resizes.
 *
 * Sizes are `svh`, not `dvh` or `vh`. `dvh` is right for an app screen that
 * must fit the visible viewport; on a long scrolling page it is the opposite,
 * because every box sized in it resizes on every frame of the toolbar
 * animation — which reflows the page and reallocates the canvas's drawing
 * buffer while the visitor is mid-flick. `svh` is the one viewport unit that
 * holds still, and being a little short of the tallest viewport costs a
 * pinned section nothing.
 */

const ScrollPhoneCanvas = dynamic(
  () => import("@/components/landing/ScrollPhoneCanvas"),
  { ssr: false, loading: () => null },
);

export function ScrollPhone({ children }: { children: React.ReactNode }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  /** Set by the canvas once it is live: R3F's own "draw one more frame". */
  const invalidateRef = useRef<(() => void) | null>(null);
  /** Whether a scroll should bother asking for a frame. A ref, not state —
   *  it is read on the scroll path and must not cause a render. */
  const nearRef = useRef(false);

  const [webglOk, setWebglOk] = useState(true);
  /** Latches on the first approach; the canvas is never unmounted after that,
   *  because tearing down a WebGL context to save frames it is no longer
   *  drawing would only buy a rebuild on the way back up. */
  const [approached, setApproached] = useState(false);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      setWebglOk(!!(canvas.getContext("webgl2") ?? canvas.getContext("webgl")));
    } catch {
      setWebglOk(false);
    }
  }, []);

  /** Where the section sits in the document, and how much of it scrolls past.
   *  Cached: see note 3 above. */
  const geometry = useRef({ top: 0, length: 1 });

  const measure = useCallback(() => {
    const el = sectionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    geometry.current = {
      top: rect.top + window.scrollY,
      length: Math.max(1, rect.height - window.innerHeight),
    };
  }, []);

  // Progress = how far the section has been scrolled through, 0 at the moment
  // its top hits the viewport top, 1 when its bottom leaves. Written to a ref —
  // never state — because it changes every scroll frame and only the canvas
  // needs it.
  useEffect(() => {
    if (!sectionRef.current) return;

    /*
     * One frame requested per animation frame, never per scroll event.
     *
     * R3F's invalidate() ADDS to a queue (capped at 60) rather than setting a
     * flag, and a scroll can fire several events per frame — so calling it
     * straight from the handler banks a tail of renders that keep firing
     * after the visitor has stopped, which is the opposite of the point.
     */
    let queued = 0;
    const askForAFrame = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        invalidateRef.current?.();
      });
    };

    const read = () => {
      const { top, length } = geometry.current;
      const p = (window.scrollY - top) / length;
      progressRef.current = p < 0 ? 0 : p > 1 ? 1 : p;
      if (nearRef.current) askForAFrame();
    };

    const remeasure = () => {
      measure();
      read();
    };

    remeasure();
    window.addEventListener("scroll", read, { passive: true });
    window.addEventListener("resize", remeasure);

    // The section's own height moves with the copy beside the phone — a font
    // arriving or a heading re-wrapping is a resize the window never reports.
    const ro = new ResizeObserver(remeasure);
    ro.observe(sectionRef.current);

    return () => {
      if (queued) cancelAnimationFrame(queued);
      window.removeEventListener("scroll", read);
      window.removeEventListener("resize", remeasure);
      ro.disconnect();
    };
  }, [measure]);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => {
        nearRef.current = entry.isIntersecting;
        // Half a screen of warning: the chunk, the texture and the first
        // render all land before the section is looked at, not during.
        if (entry.isIntersecting) setApproached(true);
      },
      { rootMargin: "50% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={sectionRef} className="relative h-[300svh]">
      <div className="sticky top-0 flex h-[100svh] items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-4 px-6 lg:grid-cols-12 lg:gap-6 lg:px-10">
          <div className="order-2 lg:order-1 lg:col-span-5">{children}</div>
          <div className="relative order-1 h-[52svh] min-h-[320px] lg:order-2 lg:col-span-7 lg:h-[78svh]">
            {!webglOk ? (
              // No WebGL: the same capture, flat, framed. Nothing is lost but
              // the turn.
              <div className="flex h-full items-center justify-center">
                <Image
                  src="/landing/play.webp"
                  alt="The company screen: the founder over the live books — cash, burn, runway, valuation."
                  width={640}
                  height={1385}
                  className="max-h-full w-auto rounded-[var(--radius-sheet)] shadow-[var(--e3)] ring-1 ring-[var(--hairline)]"
                />
              </div>
            ) : approached ? (
              <ScrollPhoneCanvas
                progressRef={progressRef}
                reduced={reduced}
                invalidateRef={invalidateRef}
              />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
