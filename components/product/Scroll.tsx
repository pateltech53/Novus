"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStill } from "@/components/ui/Motion";

/**
 * The product story's scene player.
 *
 * ── Scrubbed, then triggered — and why it changed ──────────────────────────
 *
 * The first build tied every scene to scroll position: a pinned frame five
 * viewports tall, with the choreography played by the visitor's own thumb.
 * Technically elegant, and wrong for the audience — the feedback, verbatim,
 * was "得一点一点滑": you had to feed the page scroll to watch it move.
 *
 * So the driver changed and the choreography did not. A scene is now ONE
 * viewport-height slide in normal flow. When it enters the viewport's middle
 * band, it plays: every element runs its own eased entrance after its own
 * delay, the counters roll, the lines draw — on a clock, not on the thumb.
 * One flick per scene, the way the Apple product pages this imitates
 * actually behave. Proximity scroll-snap (globals.css, on pages that opt in
 * with `data-pv-snap`) settles each flick onto the next slide.
 *
 * The vocabulary survived the change of driver: `fx(at, …)` still authors an
 * element's moment as a 0–1 fraction — it now maps to a transition delay of
 * `at × --pv-beat` (the scene's total playing time) instead of a scroll
 * window, so every storyboard written for the scrubbed engine plays back
 * unchanged. Entrances are real CSS transitions on `--ease-out`, which is
 * what the scrubbed version's linear tweens could never be.
 *
 * ── The three states, and who sees which ───────────────────────────────────
 *
 *   rest      the FINISHED composition. What the server renders, what a
 *             crawler reads, what no-JS and reduced motion get. Never a page
 *             of opacity-0.
 *   armed     hidden at its start positions, transitions off. Applied by the
 *             client after hydration, before the scene is reached — every
 *             scene after the first sits below the fold, so the reset is
 *             never watched.
 *   playing   armed + `data-play`: every transition runs, each after its
 *             authored delay.
 *
 * Reduced motion never arms, so the finished state simply is the page — a
 * cut, not a shortening (design.md §5).
 */

type ProgressFn = (p: number) => void;

interface PinHandle {
  /** Subscribe to the scene's clock, 0→1 over the beat. Replays the current
   *  value on subscribe, so a component mounting late starts correct. */
  subscribe: (fn: ProgressFn) => () => void;
  /** True when the scene will never play: reduced motion. Consumers render
   *  their finished values directly. */
  still: boolean;
}

const PinContext = createContext<PinHandle | null>(null);

export function usePin(): PinHandle {
  const handle = useContext(PinContext);
  if (!handle) throw new Error("usePin must be used inside <Pin>");
  return handle;
}

export function Pin({
  beat = 2600,
  ariaLabel,
  className = "",
  playOnMount = false,
  children,
}: {
  /** The scene's total playing time in ms — what an element's `fx(at)`
   *  fraction is a delay into. */
  beat?: number;
  ariaLabel: string;
  className?: string;
  /** The scene at the fold plays as the page arrives instead of waiting to
   *  be scrolled to. */
  playOnMount?: boolean;
  children: React.ReactNode;
}) {
  const still = useStill();
  const sectionRef = useRef<HTMLElement>(null);
  const subscribers = useRef(new Set<ProgressFn>());
  const clock = useRef(0);
  const [armed, setArmed] = useState(false);
  const [playing, setPlaying] = useState(false);

  // Arm after hydration: the server ships the finished state, the client
  // resets the scene to its start positions before it scrolls into view.
  useEffect(() => {
    if (!still) setArmed(true);
  }, [still]);

  // Play when the scene crosses the viewport's middle band — a 40% strip,
  // rather than an intersection ratio, so a scene taller than the viewport
  // (phones) still fires. Once is enough; a story re-read is not re-told.
  useEffect(() => {
    if (still || playing) return;
    if (playOnMount) {
      setPlaying(true);
      return;
    }
    const el = sectionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setPlaying(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setPlaying(true);
          io.disconnect();
        }
      },
      { rootMargin: "-30% 0px -30% 0px", threshold: 0 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [still, playing, playOnMount]);

  // The clock the JS consumers (counters, the REC timer) run on: linear
  // 0→1 over the beat, so an `fx` fraction means the same moment to a
  // CountUp as it does to a transition delay.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - started) / beat);
      clock.current = p;
      for (const fn of subscribers.current) fn(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, beat]);

  const handle = useMemo<PinHandle>(
    () => ({
      subscribe: (fn) => {
        subscribers.current.add(fn);
        fn(still ? 1 : clock.current);
        return () => {
          subscribers.current.delete(fn);
        };
      },
      still,
    }),
    [still],
  );

  return (
    <PinContext.Provider value={handle}>
      <section
        ref={sectionRef}
        aria-label={ariaLabel}
        data-pv-scene
        data-arm={armed || undefined}
        data-play={playing || undefined}
        className={`pv-scene relative flex min-h-[100svh] flex-col ${className}`}
        style={{ "--pv-beat": `${beat}ms` } as React.CSSProperties}
      >
        {children}
      </section>
    </PinContext.Provider>
  );
}

/**
 * The window an element animates inside, as inline custom properties.
 *
 * `at` is the element's moment as a fraction of the scene's beat; the
 * distances are where it arrives FROM. `over`, `until`, `overOut` and `uy`
 * are accepted for compatibility with storyboards written for the scrubbed
 * engine and are inert here — an element that has entered, stays.
 */
export function fx(
  at: number,
  over = 0.18,
  opts: {
    dx?: number;
    dy?: number;
    /** Scale deficit on arrival: 0.06 arrives from 94%. */
    ds?: number;
    /** Degrees the element un-rotates on arrival: 6 arrives from +6°. */
    dr?: number;
    until?: number;
    overOut?: number;
    uy?: number;
  } = {},
): React.CSSProperties {
  const style: Record<string, string> = {
    "--a": String(at),
    "--w": String(over),
  };
  if (opts.dx !== undefined) style["--pv-dx"] = `${opts.dx}px`;
  if (opts.dy !== undefined) style["--pv-dy"] = `${opts.dy}px`;
  if (opts.ds !== undefined) style["--pv-ds"] = String(opts.ds);
  if (opts.dr !== undefined) style["--pv-dr"] = `${opts.dr}deg`;
  return style as React.CSSProperties;
}

/**
 * The reading rail: how much of the story has been read, as a 2px hairline.
 * One scaleX write per frame through one rAF latch; absent under reduced
 * motion, where a progress bar that cannot move is a stray line.
 */
export function Rail() {
  const still = useStill();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || still) return;
    let queued = 0;
    const write = () => {
      queued = 0;
      const span = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
      const p = Math.min(1, Math.max(0, window.scrollY / span));
      el.style.setProperty("--pv-read", p.toFixed(4));
    };
    const onScroll = () => {
      if (!queued) queued = requestAnimationFrame(write);
    };
    write();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (queued) cancelAnimationFrame(queued);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [still]);

  if (still) return null;
  return <div ref={ref} aria-hidden="true" className="pv-rail" />;
}

/**
 * A figure that rolls to its value as the scene's clock reaches it.
 *
 * JS rather than CSS because a number is CONTENT: the real value is in the
 * markup — the server renders the destination, and the clock merely replays
 * the journey. `.tnum` at every call site keeps the digits from shifting.
 */
export function CountUp({
  to,
  from = 0,
  at,
  over = 0.2,
  format,
  className = "",
}: {
  to: number;
  from?: number;
  /** Window on the scene's clock, same vocabulary as fx(). */
  at: number;
  over?: number;
  format?: (n: number) => string;
  className?: string;
}) {
  const { subscribe, still } = usePin();
  const ref = useRef<HTMLSpanElement>(null);
  const fmt = useRef(format);
  fmt.current = format;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const print = (n: number) =>
      (fmt.current ?? ((v: number) => Math.round(v).toLocaleString("en-US")))(n);
    if (still) {
      el.textContent = print(to);
      return;
    }
    return subscribe((p) => {
      const t = Math.min(1, Math.max(0, (p - at) / over));
      el.textContent = print(from + (to - from) * t);
    });
  }, [subscribe, still, to, from, at, over]);

  const resting = (format ?? ((v: number) => Math.round(v).toLocaleString("en-US")))(to);

  return (
    <span ref={ref} className={className}>
      {resting}
    </span>
  );
}
