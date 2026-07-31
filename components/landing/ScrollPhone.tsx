"use client";

import { useEffect, useRef, useState } from "react";
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
 */

const ScrollPhoneCanvas = dynamic(
  () => import("@/components/landing/ScrollPhoneCanvas"),
  { ssr: false, loading: () => null },
);

export function ScrollPhone({ children }: { children: React.ReactNode }) {
  const sectionRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef(0);
  const [webglOk, setWebglOk] = useState(true);
  const [active, setActive] = useState(false);
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

  // Progress = how far the section has been scrolled through, 0 at the moment
  // its top hits the viewport top, 1 when its bottom leaves. Written to a ref —
  // never state — because it changes every scroll frame and only the canvas
  // needs it.
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const onScroll = () => {
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      if (total <= 0) return;
      progressRef.current = Math.min(1, Math.max(0, -rect.top / total));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      ([entry]) => setActive(entry.isIntersecting),
      { threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <div ref={sectionRef} className="relative h-[300vh]">
      <div className="sticky top-0 flex h-screen items-center overflow-hidden">
        <div className="mx-auto grid w-full max-w-6xl grid-cols-1 items-center gap-4 px-6 lg:grid-cols-12 lg:gap-6 lg:px-10">
          <div className="order-2 lg:order-1 lg:col-span-5">{children}</div>
          <div className="relative order-1 h-[52vh] min-h-[320px] lg:order-2 lg:col-span-7 lg:h-[78vh]">
            {webglOk ? (
              <ScrollPhoneCanvas
                progressRef={progressRef}
                reduced={reduced}
                active={active}
              />
            ) : (
              // No WebGL: the same capture, flat, framed. Nothing is lost but
              // the turn.
              <div className="flex h-full items-center justify-center">
                <Image
                  src="/landing/play.webp"
                  alt="The company screen: the founder over the live books — cash, burn, runway, valuation."
                  width={640}
                  height={1385}
                  className="max-h-full w-auto rounded-[1.4rem] shadow-[var(--e3)] ring-1 ring-[var(--hairline)]"
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
