"use client";

import { useCallback, useEffect, useLayoutEffect, useState } from "react";
import { motion } from "framer-motion";
import { ENTER } from "@/components/ui/Motion";

import { GLOSSARY } from "@/lib/engine/constants";
import { RookieToggle } from "@/components/ui/RookieToggle";

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
  /**
   * The native surface this step teaches, when the chrome is UIKit's.
   *
   * `"advance"`, `"tabs"` or a masthead control id. Present on exactly the
   * steps whose target is a control the native chrome draws instead of the
   * DOM — those have no element to measure, so the box comes from the plugin.
   * Absent means the target is web content and is measured the usual way.
   */
  native?: string;
  title: string;
  body: string;
  /**
   * "tap"  — the player must actually hit the target to continue.
   * "ack"  — a Got it button continues (used where there's nothing to press).
   */
  mode: "tap" | "ack";
  /** Where the card sits relative to the hole. */
  place?: "above" | "below";
  /**
   * Words this step defines, in the player's own vocabulary.
   *
   * Rendered as a list under the body. The meanings come from GLOSSARY rather
   * than being retyped here, so the tutorial, the Books and the term coach can
   * never drift into three different definitions of "runway".
   */
  terms?: string[];
  /**
   * Render the live Rookie Mode switch inside this step's card.
   *
   * The tutorial is the one moment every player is guaranteed to meet the
   * vocabulary question, so the answer is offered where the question happens —
   * flipping it here takes effect immediately (the rookie definitions step
   * appears right after) rather than being a setting discovered in week two.
   */
  rookieToggle?: boolean;
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
  const host = document.querySelector<HTMLElement>(
    `[data-coach="${targetId}"]`,
  );
  if (!host) return false;
  const control = host.matches("button, a, input, [role='button']")
    ? host
    : host.querySelector<HTMLElement>(
        "button:not(:disabled), a, [role='button']",
      );
  if (!control) return false;
  control.click();
  return true;
}

export function Coachmarks({
  steps,
  index,
  onAdvance,
  onFinish,
  nativeChrome = false,
  nativeRect,
}: {
  steps: CoachStep[];
  index: number;
  onAdvance: () => void;
  onFinish: () => void;
  /**
   * True only while UIKit is drawing the chrome.
   *
   * `step.native` says a step COULD be taught natively; this says it is. On
   * Android and on the web the same steps target real DOM elements and are
   * measured the ordinary way, so reading `step.native` alone would look for a
   * box nobody is reporting and strand the tutorial on step two.
   */
  nativeChrome?: boolean;
  /**
   * The box of the control being taught, when UIKit is the one drawing it.
   *
   * Supplied rather than measured because there is no element to measure: the
   * native chrome reports its own frame on every layout pass. The step is
   * completed by the native control's own callback for the same reason — the
   * tap never reaches this overlay, since a native view sits above it.
   */
  nativeRect?: Rect | null;
}) {
  const step = steps[index];
  const [domRect, setRect] = useState<Rect | null>(null);
  const native = !!step?.native && nativeChrome;
  const rect = native ? (nativeRect ?? null) : domRect;

  // Track the target's box: it moves when the log grows or a sheet opens.
  // Deliberately NOT requestAnimationFrame — rAF is suspended while a tab is
  // hidden, which would leave the hole unmeasured and every tap ignored.
  useLayoutEffect(() => {
    if (!step || (step.native && nativeChrome)) return;

    /*
     * The target, cached.
     *
     * `measure` ran a fresh `document.querySelector` every time, and it is
     * called from four sources — a 200 ms interval, resize, a ResizeObserver,
     * and a CAPTURE-phase scroll listener that sees every scroller on the
     * page. The selector was being evaluated on every scroll event, and then
     * `getBoundingClientRect` forced a synchronous layout on each one.
     *
     * The element is re-queried only when the cached one has left the document,
     * which is the only case that can invalidate it.
     */
    let cached: HTMLElement | null = null;
    const target = () => {
      if (cached?.isConnected) return cached;
      cached = document.querySelector<HTMLElement>(`[data-coach="${step.target}"]`);
      return cached;
    };

    const measure = () => {
      const el = target();
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

    /*
     * Scroll is coalesced to one measurement per frame.
     *
     * This listener is on the capture phase, so it fires for every scroller on
     * the page — and it called `measure` directly, meaning a forced synchronous
     * layout per scroll event rather than per frame. Same guard as
     * ScrollPhone.tsx:113.
     *
     * The note above about rAF still holds and is not contradicted here: the
     * INTERVAL stays a timer, because it is the mechanism that has to keep
     * working while the tab is hidden. Scroll events do not fire in a hidden
     * tab at all, so coalescing this one through a frame gives up nothing.
     */
    let queued = 0;
    const onScroll = () => {
      if (queued) return;
      queued = requestAnimationFrame(() => {
        queued = 0;
        measure();
      });
    };

    measure();
    const id = window.setInterval(measure, 200);
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", onScroll, true);
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : null;
    const host = target();
    if (host && observer) observer.observe(host);

    return () => {
      window.clearInterval(id);
      if (queued) cancelAnimationFrame(queued);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", onScroll, true);
      observer?.disconnect();
    };
  }, [step, nativeChrome]);

  /*
   * The page holds still while the tutorial speaks.
   *
   * /play is one scrolling document on a phone, and the overlay used to sit on
   * top of it without pinning it: a drag on the scrim — or reaching the end of
   * the card's own scroll — chained into the page, the spotlighted target
   * drifted under the card's anchor, and the max-height maths below went
   * negative, which is exactly the reported "text clips off and the screen
   * scrolls down" break. So each step does the scrolling ITSELF, once: settle
   * the target into the upper third where the card has room, then freeze the
   * body until the step changes. The player reads a stationary screen, always.
   */
  useLayoutEffect(() => {
    if (!step || typeof window === "undefined") return;

    const el =
      step.native && nativeChrome
        ? null
        : document.querySelector<HTMLElement>(`[data-coach="${step.target}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      const vh = window.visualViewport?.height ?? window.innerHeight;
      // Only move if the target sits outside the comfortable band — a page
      // already showing it should not lurch on every step.
      if (r.top < 64 || r.bottom > vh * 0.6) {
        window.scrollTo({ top: Math.max(0, window.scrollY + r.top - vh * 0.22) });
      }
    }

    const body = document.body;
    const y = window.scrollY;
    const prev = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
    };
    // position:fixed rather than overflow:hidden — iOS Safari ignores the
    // latter on body, and the shipped app runs in exactly that engine.
    body.style.position = "fixed";
    body.style.top = `-${y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";

    return () => {
      body.style.position = prev.position;
      body.style.top = prev.top;
      body.style.left = prev.left;
      body.style.right = prev.right;
      body.style.width = prev.width;
      window.scrollTo({ top: y });
    };
  }, [step, nativeChrome]);

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

  /*
   * Which side of the spotlight the card sits on, and how tall it may be.
   *
   * The authored `place` is honoured when the space is there, but a tall card
   * (the rookie "four words" step, four definitions and a button) against a
   * spotlight near the top or bottom of a short phone is the reported break:
   * anchored to the cramped side, its content and its GOT IT button fell off
   * the screen. So we measure the room on each side and flip to the roomier one
   * when the authored side is too tight — then cap the card to that room and let
   * it scroll. The margin subtracts the safe area and any native chrome.
   */
  /*
   * One viewport number for everything. The anchor used to be computed from
   * `innerHeight` while the cap used `100dvh` — two different answers on iOS
   * with toolbars showing — and the cap itself could go NEGATIVE for a target
   * near a screen edge. A negative max-height is invalid CSS, the browser
   * dropped the declaration entirely, and the card rendered at natural height
   * with its text sheared off under the pinned button: the reported clip.
   * `visualViewport` is the height the player can actually see.
   */
  const vh =
    typeof window !== "undefined"
      ? (window.visualViewport?.height ?? window.innerHeight)
      : 800;
  const MARGIN = 16;
  const spaceBelow = hole ? vh - (hole.top + hole.height + 14) - MARGIN : 0;
  const spaceAbove = hole ? hole.top - 14 - MARGIN : 0;

  let place = step.place ?? (spaceBelow >= spaceAbove ? "below" : "above");
  if (hole) {
    const roomHere = place === "below" ? spaceBelow : spaceAbove;
    const roomThere = place === "below" ? spaceAbove : spaceBelow;
    if (roomHere < 280 && roomThere > roomHere) {
      place = place === "below" ? "above" : "below";
    }
  }

  /*
   * The room the card actually has, clamped to always be usable. Under 180px
   * neither side can hold a readable card, so it stops hugging the hole and
   * takes the screen instead — a centred, fully readable card beats an
   * anchored, clipped one.
   */
  const room = place === "above" ? spaceAbove : spaceBelow;
  const anchored = !!hole && room >= 180;
  const cardMaxHeight = anchored
    ? `${Math.round(Math.min(Math.max(200, room), vh * 0.78))}px`
    : "78dvh";

  return (
    <div
      className="fixed inset-0 z-[85]"
      onClick={onOverlayClick}
      role="presentation"
    >
      {/* The scrim is drawn as four panels around the hole, so the control
          underneath stays genuinely visible and clickable. */}
      {hole ? (
        <>
          <Scrim
            style={{ top: 0, left: 0, right: 0, height: Math.max(0, hole.top) }}
          />
          <Scrim
            style={{
              top: hole.top + hole.height,
              left: 0,
              right: 0,
              bottom: 0,
            }}
          />
          <Scrim
            style={{
              top: hole.top,
              left: 0,
              width: Math.max(0, hole.left),
              height: hole.height,
            }}
          />
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
            style={{
              top: hole.top,
              left: hole.left,
              width: hole.width,
              height: hole.height,
            }}
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
          anchored && hole
            ? place === "above"
              ? { bottom: vh - hole.top + 14 }
              : { top: hole.top + hole.height + 14 }
            : { top: "10%" }
        }
        initial={{ opacity: 0, y: place === "above" ? 10 : -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ ...ENTER }}
        key={step.id}
      >
        {/*
         * The card is bounded to the space it actually has and scrolls inside
         * it — the fix for the reported mobile break, where the rookie
         * "four words" card (a title, four definitions and a button) was taller
         * than a phone's Safari viewport, so the definitions and the GOT IT
         * button fell under the browser toolbar with no way to reach them (the
         * scrim outside the card is deliberately dead, so the page cannot
         * scroll). maxHeight is the room between the card's anchor and the safe
         * area / native chrome, set on THIS flex column (a definite value, so
         * its scroll child can resolve) rather than the auto-height wrapper. The
         * content region scrolls and the button below it never leaves the screen.
         */}
        <div
          className="flex flex-col overflow-hidden rounded-[1.25rem] bg-[var(--surface-overlay)] shadow-[var(--e4)]"
          style={{ maxHeight: cardMaxHeight }}
        >
          {/* The reading half scrolls; the button below never does. The fade
              at its foot is the scroll affordance — on iOS there is no
              persistent scrollbar, and clipped text with no cue reads as
              broken, not scrollable. overscroll-contain keeps the card's own
              scroll from ever chaining into the page behind it. */}
          <div
            className="pointer-events-auto min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pt-3.5"
            style={{
              maskImage:
                "linear-gradient(to bottom, black calc(100% - 18px), transparent)",
              WebkitMaskImage:
                "linear-gradient(to bottom, black calc(100% - 18px), transparent)",
            }}
          >
            <p className="text-2xs font-bold tracking-[0.16em] text-[var(--action)]">
              STEP {index + 1} OF {steps.length}
            </p>
            <p className="mt-1 text-base font-extrabold leading-snug text-[var(--n-11)]">
              {step.title}
            </p>
            <p className="mt-1 text-sm leading-snug text-[var(--n-8)]">
              {step.body}
            </p>

            {step.rookieToggle && (
              <div
                className="mt-3 border-t border-[var(--hairline)] pt-3"
                /* The switch is its own control, not a step-completing tap — a
                   flip must never be read by the overlay as "activate the target
                   and advance". */
                onClick={(e) => e.stopPropagation()}
              >
                <RookieToggle />
              </div>
            )}

            {step.terms && step.terms.length > 0 && (
              <dl className="mt-3 space-y-2 border-t border-[var(--hairline)] pt-3">
                {step.terms.map((term) => {
                  const gloss = GLOSSARY[term];
                  if (!gloss) return null;
                  return (
                    <div key={term}>
                      <dt className="text-2xs font-bold tracking-[0.12em] text-[var(--n-11)]">
                        {term.toUpperCase()}
                      </dt>
                      {/* The plain-English line first, because that is the one a
                          rookie can act on, and the textbook definition under it
                          — Rookie Mode ADDS a translation, it never replaces the
                          real term. Same rule TheBooks follows. */}
                      <dd className="text-sm leading-snug text-[var(--n-8)]">
                        {capitalise(gloss.rookie)}
                      </dd>
                      <dd className="text-2xs leading-snug text-[var(--n-7)]">
                        {gloss.pro}
                      </dd>
                    </div>
                  );
                })}
              </dl>
            )}
          </div>

          {/* Pinned below the scroll region, so it is on screen no matter how
              tall the content is. A "tap it" step whose target could not be
              measured has no hole to tap and no control to activate, which would
              leave a first-time player with a dimmed screen and no way forward.
              An unmeasurable target falls back to an acknowledgeable one: a
              tutorial that can be skipped beats a tutorial that traps. */}
          <div className="shrink-0 px-4 pt-2 pb-3.5">
            {step.mode === "ack" || !rect ? (
              <button
                type="button"
                className="nv-gc pointer-events-auto h-11 w-full rounded-[var(--radius-pill)] nv-t-action text-sm font-extrabold tracking-[0.04em]"
                onClick={(e) => {
                  e.stopPropagation();
                  if (index >= steps.length - 1) onFinish();
                  else onAdvance();
                }}
              >
                GOT IT
              </button>
            ) : (
              <p className="text-2xs font-bold tracking-[0.1em] text-[var(--action)]">
                ↑ TAP IT TO CONTINUE
              </p>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

/** "money in the bank right now." → "Money in the bank right now." */
function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function Scrim({ style }: { style: React.CSSProperties }) {
  return <div className="absolute bg-[var(--scrim)]" style={style} />;
}

/**
 * The first-run script. Order matters: read the books, move time, make a
 * decision, then discover the depth behind the tabs.
 *
 * `firstRunSteps(rookieMode)` builds it, because one step exists only for a
 * rookie: the four words on The Books, defined. A player who chose the pro
 * vocabulary has said they do not need that, and a tutorial that explains
 * "runway" to someone who came here knowing it is a tutorial they will skip.
 */
const BASE_STEPS: CoachStep[] = [
  {
    id: "books",
    target: "books",
    title: "These are The Books.",
    body: "Cash, burn, runway, valuation. They never leave the screen, and every decision you make moves at least one of them. Tap any of them at any time to see what the word means.",
    mode: "ack",
    place: "below",
  },
  /*
   * Where the key terms live, taught as a place rather than a list.
   *
   * Players reported learning mid-Tank that the vocabulary had been explained
   * all along — the coach card, the tappable rows, Rookie Mode — because
   * nothing ever pointed at any of it. This step points, and carries the
   * switch itself: the choice about HOW terms are explained is made here,
   * where the question first comes up, with the rookie definitions step
   * appearing immediately after for anyone who flips it on.
   */
  {
    id: "key-terms",
    target: "books",
    title: "Every key term explains itself.",
    body: "Anywhere you see a business word — on these Books, on your pitch notes, in The Tank — tap it and you get the meaning, once, when it matters. Want a plain-English line under every term as you go? That switch is Rookie Mode — it lives here and on the ⓘ page this tour ends at.",
    mode: "ack",
    place: "below",
    rookieToggle: true,
  },
  {
    id: "advance",
    target: "advance",
    native: "advance",
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
    native: "tabs",
    title: "Everything else lives down here.",
    body: "Your company, your team, your assets, the market, your closet. None of it costs you a month — you can look as much as you like.",
    mode: "ack",
    place: "above",
  },
  /*
   * The two tabs players reported never finding, named individually. Both
   * point at the same bar as the step above — there is nothing else to point
   * at until the tab is opened — but each names its tab and what is behind
   * it, because "everything lives down here" taught the bar and still left
   * the first product unlaunched and the closet undiscovered.
   */
  {
    id: "product",
    target: "tabs",
    native: "tabs",
    title: "PRODUCT is where you launch what you sell.",
    body: "Open it, press ADD, give it a name and a price. Everything else in the game — revenue, margin, the pitch itself — starts from having something on the shelf, so make this the first place you go.",
    mode: "ack",
    place: "above",
  },
  {
    id: "closet",
    target: "tabs",
    native: "tabs",
    title: "CLOSET is yours.",
    body: "The fits you earn by surviving years and finishing runs. It changes how your founder looks in the room — and nothing else. Style is earned here, never bought advantage.",
    mode: "ack",
    place: "above",
  },
  {
    id: "phone",
    target: "phone",
    native: "phone",
    title: "And this is your phone.",
    body: "RobinGhood for the market, BeeMail for the mail you'd rather not open, LinkedOut for hiring. It runs on real time — the market moves while you're away.",
    mode: "ack",
    place: "above",
  },
  /*
   * The tour ends ON the key terms page, not at a card about it. The step is
   * a tap: pressing ⓘ opens the glossary — with the Rookie switch at the top
   * — as the tutorial's last act, so every player has stood in the place
   * confused players need to know exists.
   */
  {
    id: "info",
    target: "info",
    native: "keyterms",
    title: "Stuck on a word? It lives here.",
    body: "This ⓘ is every term the game uses, searchable, in plain English — and the Rookie Mode switch is at the top of it. Tap it to finish the tour and have a look around.",
    mode: "tap",
    place: "below",
  },
];

/**
 * The four words on The Books, defined, for a player in Rookie Mode.
 *
 * It sits immediately after the key-terms step — the one carrying the switch —
 * because the tutorial that follows talks in these terms ("look at runway",
 * "read what it COSTS you") and asking someone to act on a word they have not
 * been given is how a first play becomes a guessing game. The definitions come
 * from GLOSSARY, the same source the Books and the term coach read.
 */
const ROOKIE_TERMS_STEP: CoachStep = {
  id: "book-terms",
  target: "books",
  title: "Four words, before anything moves.",
  body: "These are the only four numbers on screen at all times. Every choice you make changes at least one.",
  terms: ["cash", "burn rate", "runway", "valuation"],
  mode: "ack",
  place: "below",
};

/**
 * The first-run script for this player.
 *
 * Rookie Mode adds one step, and it is inserted AFTER the key-terms step that
 * carries the switch. That ordering is load-bearing: flipping Rookie Mode on
 * that step rebuilds this array (app/play memoises on `run.rookieMode`), and
 * because the insertion point is behind the step being viewed, the current
 * index still names the same step — the script grows ahead of the player,
 * never underneath them. The step count shown ("STEP 2 OF 8") recomputes and
 * stays honest either way.
 */
export function firstRunSteps(rookieMode: boolean): CoachStep[] {
  if (!rookieMode) return BASE_STEPS;
  const at = BASE_STEPS.findIndex((s) => s.id === "key-terms") + 1;
  return [...BASE_STEPS.slice(0, at), ROOKIE_TERMS_STEP, ...BASE_STEPS.slice(at)];
}

/** The pro script, for callers that have no profile to read. */
export const FIRST_RUN_STEPS = BASE_STEPS;
