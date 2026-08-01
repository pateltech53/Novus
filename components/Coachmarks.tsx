"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { motion } from "framer-motion";

/**
 * The guided first play.
 *
 * Dims the screen, cuts a hole around exactly the control being taught, puts
 * the shark's line beside it, and — this is the point — BLOCKS every other tap
 * until you use that control. You learn the button by pressing it, not by
 * reading about it.
 *
 * Steps are addressed by `data-coach="<id>"` on the target element, so the
 * tutorial never holds a React ref to a component it doesn't own.
 */

export interface CoachStep {
  id: string;
  /** data-coach attribute of the element to spotlight. */
  target: string;
  title: string;
  body: string;
  /**
   * "tap"  — the player must actually hit the target to continue.
   * "ack"  — a Got it button continues (used where there's nothing to press).
   */
  mode: "tap" | "ack";
  /** Where the card sits relative to the hole. */
  place?: "above" | "below";
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}


/**
 * The spotlight anchor is often a wrapper div (so the hole can hug a group of
 * controls). Clicking a div does nothing, so resolve down to the real control.
 */
function activate(targetId: string): boolean {
  const host = document.querySelector<HTMLElement>(`[data-coach="${targetId}"]`);
  if (!host) return false;
  const control =
    host.matches("button, a, input, [role='button']")
      ? host
      : host.querySelector<HTMLElement>("button:not(:disabled), a, [role='button']");
  if (!control) return false;
  control.click();
  return true;
}

export function Coachmarks({
  steps,
  index,
  onAdvance,
  onFinish,
}: {
  steps: CoachStep[];
  index: number;
  onAdvance: () => void;
  onFinish: () => void;
}) {
  const step = steps[index];
  const [rect, setRect] = useState<Rect | null>(null);

  // Track the target's box: it moves when the log grows or a sheet opens.
  // Deliberately NOT requestAnimationFrame — rAF is suspended while a tab is
  // hidden, which would leave the hole unmeasured and every tap ignored.
  useLayoutEffect(() => {
    if (!step) return;

    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-coach="${step.target}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const r = el.getBoundingClientRect();
      setRect((prev) =>
        prev &&
        Math.abs(prev.top - r.top) < 0.5 &&
        Math.abs(prev.left - r.left) < 0.5 &&
        Math.abs(prev.width - r.width) < 0.5 &&
        Math.abs(prev.height - r.height) < 0.5
          ? prev // no change: don't re-render on a timer
          : { top: r.top, left: r.left, width: r.width, height: r.height },
      );
    };

    measure();
    const id = window.setInterval(measure, 200);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    const observer =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(measure) : null;
    const host = document.querySelector<HTMLElement>(`[data-coach="${step.target}"]`);
    if (host && observer) observer.observe(host);

    return () => {
      window.clearInterval(id);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      observer?.disconnect();
    };
  }, [step]);

  // A tap inside the hole counts as completing the step.
  const onOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (!step || !rect) return;
      const inside =
        e.clientX >= rect.left &&
        e.clientX <= rect.left + rect.width &&
        e.clientY >= rect.top &&
        e.clientY <= rect.top + rect.height;
      if (!inside) return; // everything outside the hole is deliberately dead

      // Let the real control receive the click, then move on. If the control
      // is missing or disabled, the step stays put rather than skipping ahead.
      if (!activate(step.target)) return;
      if (index >= steps.length - 1) onFinish();
      else onAdvance();
    },
    [step, rect, index, steps.length, onAdvance, onFinish],
  );

  useEffect(() => {
    // Keyboard parity: Enter completes a step for anyone not using a pointer.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Enter" || !step) return;
      if (!activate(step.target)) return;
      if (index >= steps.length - 1) onFinish();
      else onAdvance();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, index, steps.length, onAdvance, onFinish]);

  if (!step) return null;

  const pad = 8;
  const hole = rect
    ? {
        top: rect.top - pad,
        left: rect.left - pad,
        width: rect.width + pad * 2,
        height: rect.height + pad * 2,
      }
    : null;

  const place = step.place ?? (hole && hole.top > window.innerHeight * 0.55 ? "above" : "below");

  return (
    <div className="fixed inset-0 z-[85]" onClick={onOverlayClick} role="presentation">
      {/* The scrim is drawn as four panels around the hole, so the control
          underneath stays genuinely visible and clickable. */}
      {hole ? (
        <>
          <Scrim style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }} />
          <Scrim style={{ top: hole.top + hole.height, left: 0, right: 0, bottom: 0 }} />
          <Scrim style={{ top: hole.top, left: 0, width: Math.max(0, hole.left), height: hole.height }} />
          <Scrim
            style={{
              top: hole.top,
              left: hole.left + hole.width,
              right: 0,
              height: hole.height,
            }}
          />
          <motion.div
            className="pointer-events-none absolute rounded-[1.25rem] ring-4 ring-[var(--action)]"
            style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height }}
            animate={{ opacity: [0.55, 1, 0.55] }}
            transition={{ duration: 1.6, repeat: Infinity }}
          />
        </>
      ) : (
        <Scrim style={{ inset: 0 }} />
      )}

      <motion.div
        className="pointer-events-none absolute inset-x-4 mx-auto max-w-md"
        style={
          hole
            ? place === "above"
              ? { bottom: window.innerHeight - hole.top + 14 }
              : { top: hole.top + hole.height + 14 }
            : { top: "40%" }
        }
        initial={{ opacity: 0, y: place === "above" ? 10 : -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
        key={step.id}
      >
        <div className="rounded-[1.25rem] bg-[var(--surface-overlay)] px-4 py-3.5 shadow-[var(--e4)]">
          <p className="text-2xs font-bold tracking-[0.16em] text-[var(--action)]">
            STEP {index + 1} OF {steps.length}
          </p>
          <p className="mt-1 text-base font-extrabold leading-snug text-[var(--n-11)]">{step.title}</p>
          <p className="mt-1 text-sm leading-snug text-[var(--n-8)]">{step.body}</p>

          {/* A "tap it" step whose target could not be measured has no hole to
              tap and no control to activate, which would leave a first-time
              player with a dimmed screen and no way forward. An unmeasurable
              target falls back to an acknowledgeable one: a tutorial that can
              be skipped beats a tutorial that traps. */}
          {step.mode === "ack" || !rect ? (
            <button
              type="button"
              className="pointer-events-auto mt-3 h-11 w-full rounded-[var(--radius-pill)] bg-[var(--action)] text-sm font-extrabold tracking-[0.04em] text-[var(--n-11)] active:scale-[0.97]"
              onClick={(e) => {
                e.stopPropagation();
                if (index >= steps.length - 1) onFinish();
                else onAdvance();
              }}
            >
              GOT IT
            </button>
          ) : (
            <p className="mt-2.5 text-2xs font-bold tracking-[0.1em] text-[var(--action)]">
              ↑ TAP IT TO CONTINUE
            </p>
          )}
        </div>
      </motion.div>
    </div>
  );
}

function Scrim({ style }: { style: React.CSSProperties }) {
  return <div className="absolute bg-[var(--scrim)]" style={style} />;
}

/**
 * The first-run script. Order matters: read the books, move time, make a
 * decision, then discover the depth behind the tabs.
 */
export const FIRST_RUN_STEPS: CoachStep[] = [
  {
    id: "books",
    target: "books",
    title: "These are The Books.",
    body: "Cash, burn, runway, valuation. They never leave the screen, and every decision you make moves at least one of them. Tap them to see what each word means.",
    mode: "ack",
    place: "below",
  },
  {
    id: "advance",
    target: "advance",
    title: "This is the only thing that moves time.",
    body: "One tap, one month. Nothing else in the app advances the clock. Press it.",
    mode: "tap",
    place: "above",
  },
  {
    id: "decide",
    target: "books",
    title: "Decisions cost you something. Always.",
    body: "Months bring choices, and there is no free option — every one spends cash, time, people, or goodwill. Read what it COSTS you, not which number is bigger. \u201cCheaper, and your support team eats it\u201d is a real answer when you have cash but no runway to spare.",
    mode: "ack",
    place: "below",
  },
  {
    id: "runway",
    target: "books",
    title: "When you are stuck, look at runway.",
    body: "Runway is how many months your cash lasts at this burn. Under six, survival beats growth \u2014 take the cheap option and buy yourself time. Above twelve, you can afford to spend on something that pays back later.",
    mode: "ack",
    place: "below",
  },
  {
    id: "tabs",
    target: "tabs",
    title: "Everything else lives down here.",
    body: "Your company, your team, your assets, the market, your closet. None of it costs you a month — you can look as much as you like.",
    mode: "ack",
    place: "above",
  },
  {
    id: "phone",
    target: "phone",
    title: "And this is your phone.",
    body: "RobinGhood for the market, BeeMail for the mail you'd rather not open, LinkedOut for hiring. It runs on real time — the market moves while you're away.",
    mode: "ack",
    place: "above",
  },
];
