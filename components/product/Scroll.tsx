"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useStill } from "@/components/ui/Motion";

/**
 * A viewport too short to pin in.
 *
 * A pinned scene is a composition for one viewport, and under ~640px of
 * height there is no viewport to compose in — an SE-class phone, a phone on
 * its side, a split window. Pinning there means cropping: `overflow-hidden`
 * eats whatever the frame cannot hold, and a visitor cannot scroll to what a
 * sticky frame has cropped. So a short viewport gets the same treatment
 * reduced motion does — the scene unpins, flows at its natural height, and
 * rests in its finished state, which the engine guarantees is the whole
 * composition.
 */
function useShortViewport(): boolean {
  const [short, setShort] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-height: 640px)");
    setShort(mq.matches);
    const onChange = () => setShort(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  return short;
}

/**
 * The product story's scroll engine.
 *
 * One idea, applied strictly: a pinned scene is driven by ONE number — how far
 * the visitor has scrolled through it — and that number leaves JavaScript
 * exactly once per frame, as the `--p` custom property on the scene root.
 * Everything visual derives from it in CSS (see the `.pv-*` rules in
 * globals.css), so a scene with forty animating elements still costs one
 * setProperty per frame, and every one of those elements animates only
 * transform and opacity.
 *
 * The mapping is ScrollPhone's, kept for the same reasons it was earned there:
 *
 *   · geometry is measured once and re-measured only on an actual resize —
 *     `window.innerHeight` moves continuously while a phone collapses its
 *     toolbar, and a divisor that moves mid-gesture steps the animation;
 *   · progress is written from a scroll listener through ONE
 *     requestAnimationFrame latch, never once per scroll event;
 *   · heights are `svh`, the one viewport unit that holds still.
 *
 * ── Server render, no-JS, and reduced motion ───────────────────────────────
 *
 * `.pv-scene` declares `--p: 1` — the FINISHED composition — so the prerender,
 * a crawler and a no-JS visitor see the story's final frames rather than a
 * column of opacity-0. The client writes true progress on mount; every scene
 * after the first sits below the fold, so the correction is never watched.
 *
 * Reduced motion is a cut, not a shortening: the scene renders unpinned at
 * natural height, `--p` is never written, and the default IS the page.
 */

type ProgressFn = (p: number) => void;

interface PinHandle {
  /** Subscribe to this scene's progress. Replays the latest value on
   *  subscribe, so a component mounting mid-scene starts correct. */
  subscribe: (fn: ProgressFn) => () => void;
  /** Reduced motion, resolved once for the scene. */
  still: boolean;
}

const PinContext = createContext<PinHandle | null>(null);

export function usePin(): PinHandle {
  const handle = useContext(PinContext);
  if (!handle) throw new Error("usePin must be used inside <Pin>");
  return handle;
}

export function Pin({
  length = 3,
  ariaLabel,
  className = "",
  stickyClassName = "",
  initial,
  children,
}: {
  /** How many viewports of scroll drive this scene. */
  length?: number;
  ariaLabel: string;
  className?: string;
  /** Extra classes for the pinned frame (the 100svh sticky child). */
  stickyClassName?: string;
  /**
   * Server-rendered `--p`, for the ONE scene that sits at the fold: the
   * default of 1 exists so below-the-fold scenes prerender finished, but a
   * hero at scroll position zero prerendering finished would flash — its
   * later beats would paint and then vanish when the client writes the truth.
   * Ignored under reduced motion, where the finished state IS the page.
   */
  initial?: number;
  children: React.ReactNode;
}) {
  const still = useStill();
  const short = useShortViewport();
  /** Unpinned: reduced motion, or a viewport with no room to pin in. */
  const flat = still || short;
  const sectionRef = useRef<HTMLElement>(null);
  const subscribers = useRef(new Set<ProgressFn>());
  /*
   * -1, not 0, and the difference was a visible bug: the first write's
   * dedupe check compared the computed 0 against an initial 0 and skipped
   * the write — so a scene the visitor had not reached yet kept the CSS
   * default `--p: 1` and showed its FINISHED frame until the first pixel of
   * real progress snapped it back to zero. A sentinel below the valid range
   * makes the first write unconditional.
   */
  const lastP = useRef(-1);

  const geometry = useRef({ top: 0, span: 1 });

  const measure = useCallback(() => {
    const el = sectionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    geometry.current = {
      top: rect.top + window.scrollY,
      span: Math.max(1, rect.height - window.innerHeight),
    };
  }, []);

  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    if (flat) {
      // Entering flat mode leaves a stale progress behind; the default
      // `--p: 1` — the finished state — is the correct layout there. The
      // sentinel resets with it, so returning to pinned rewrites at once.
      el.style.removeProperty("--p");
      lastP.current = -1;
      return;
    }

    let queued = 0;
    const write = () => {
      queued = 0;
      const { top, span } = geometry.current;
      const raw = (window.scrollY - top) / span;
      const p = raw < 0 ? 0 : raw > 1 ? 1 : raw;
      if (p === lastP.current) return;
      lastP.current = p;
      el.style.setProperty("--p", p.toFixed(4));
      for (const fn of subscribers.current) fn(p);
    };

    const onScroll = () => {
      if (!queued) queued = requestAnimationFrame(write);
    };

    const remeasure = () => {
      measure();
      onScroll();
    };

    remeasure();
    // The first write must not wait for a scroll event — the server said
    // `--p: 1`, and the truth (usually 0, this scene being below the fold)
    // has to land before the scene ever enters the viewport.
    write();

    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", remeasure);
    const ro = new ResizeObserver(remeasure);
    ro.observe(el);

    return () => {
      if (queued) cancelAnimationFrame(queued);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", remeasure);
      ro.disconnect();
    };
  }, [measure, flat]);

  const handle = useMemo<PinHandle>(
    () => ({
      subscribe: (fn) => {
        subscribers.current.add(fn);
        // The sentinel never leaves this module: before the first write a
        // subscriber is told 0, which is where an unreached scene stands.
        fn(flat ? 1 : Math.max(0, lastP.current));
        return () => {
          subscribers.current.delete(fn);
        };
      },
      still: flat,
    }),
    [flat],
  );

  return (
    <PinContext.Provider value={handle}>
      <section
        ref={sectionRef}
        aria-label={ariaLabel}
        className={`pv-scene relative ${className}`}
        style={
          flat
            ? undefined
            : ({
                height: `${length * 100}svh`,
                ...(initial !== undefined ? { "--p": String(initial) } : {}),
              } as React.CSSProperties)
        }
      >
        <div
          className={
            flat
              ? `relative py-14 ${stickyClassName}`
              : `sticky top-0 flex h-[100svh] flex-col overflow-hidden ${stickyClassName}`
          }
        >
          {children}
        </div>
      </section>
    </PinContext.Provider>
  );
}

/**
 * The window an element animates inside, as inline custom properties.
 *
 * `at` is where the window opens in scene progress, `over` how long it runs;
 * `until`/`overOut` open a leaving window. The distances are the `.pv-fx`
 * knobs. Numbers in, tokens out — so a scene reads as a storyboard.
 */
export function fx(
  at: number,
  over = 0.18,
  opts: {
    dx?: number;
    dy?: number;
    /** Scale deficit at rest: 0.06 arrives from 94%. */
    ds?: number;
    /** Degrees the element un-rotates on arrival: 6 arrives from +6°. */
    dr?: number;
    until?: number;
    overOut?: number;
    /** How far the element rises while leaving. */
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
  if (opts.until !== undefined) {
    style["--oa"] = String(opts.until);
    style["--ow"] = String(opts.overOut ?? 0.12);
    style["--pv-uy"] = `${opts.uy ?? 18}px`;
  }
  return style as React.CSSProperties;
}

/**
 * The reading rail: how much of the story has been read, as a 2px hairline.
 *
 * Page-level rather than per-scene, so it lives beside <Pin> instead of
 * inside one. Same discipline as the scene engine — one scaleX write per
 * frame through one rAF latch — and it simply does not render for reduced
 * motion: a progress bar that cannot move is a stray line.
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
 * A figure that rolls to its value as the scene reaches it.
 *
 * JS rather than CSS because a number is CONTENT: it is read, selected and
 * crawled, so the real value has to be in the markup — the server renders the
 * destination, and the scroll merely replays the journey. `.tnum` at every
 * call site keeps the rolling digits from shifting a pixel.
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
  /** Window in scene progress, same vocabulary as fx(). */
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
