"use client";

import { MotionConfig, useReducedMotion } from "framer-motion";

/**
 * The motion system. Every duration, curve and spring in the app comes from
 * here.
 *
 * ── Why this file was rewritten ─────────────────────────────────────────────
 *
 * It already held the right three tokens. Nothing imported them.
 *
 * Measured before this change: 78 `motion.*` elements across the app carrying
 * **30 distinct transition objects**. `ENTER` was imported by ZERO files while
 * six sites hand-wrote its exact literal — `duration: 0.28, ease: [0.16, 1,
 * 0.3, 1]` — in LoopExplainer, DecisionSheet, phone/Phone, panel/AnswerTurn,
 * SharkPanel and PositioningSheet. `SHEET_SPRING` was inlined at TierUnlock,
 * ClosetScreen and SettingsScreen. Eleven sheet implementations used six
 * different enter timings and six different scrim timings between them.
 *
 * That is not a tidiness complaint. It is a ceiling: with the values copied
 * into thirty places, changing how the app FEELS costs thirty edits and gets
 * three, so nobody ever changes it and the feel is whatever it accreted into.
 * The point of naming these is that the next person can retune the whole app
 * from one screen.
 *
 * design.md §5 is the specification these implement; where a number here
 * disagrees with a component, this file wins.
 */
export function Motion({ children }: { children: React.ReactNode }) {
  /*
   * The CSS `prefers-reduced-motion` block cannot reach Framer Motion — Framer
   * animates via requestAnimationFrame in JS, so a stylesheet rule never
   * touches it. Without this, "reduced motion" was honoured by the CSS
   * keyframes and silently ignored by every sheet, card and page transition.
   *
   * `reducedMotion="user"` makes Framer read the OS setting and cut transform
   * animation to a plain opacity change — a cut, not a shortened slide.
   */
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

// ── Curves ──────────────────────────────────────────────────────────────────
//
// Three, matching --ease-out / --ease-in / --ease-in-out in globals.css. The
// literals are duplicated across the CSS/JS boundary because there is no way
// to hand a cubic-bezier from a custom property to Framer; they are the same
// three curves and must be changed together.

export const EASE_OUT = [0.16, 1, 0.3, 1] as const;
export const EASE_IN = [0.7, 0, 0.84, 0] as const;
export const EASE_IN_OUT = [0.65, 0, 0.35, 1] as const;

// ── Durations ───────────────────────────────────────────────────────────────

/**
 * The standard entrance. Anything arriving that is not a physical object.
 *
 * design.md §5: "Enter ~280 ms, exit ~180 ms."
 */
export const ENTER = { duration: 0.28, ease: EASE_OUT } as const;

/**
 * The standard exit, at ~0.66× the entrance — leaving is quicker than
 * arriving, because a player who has decided to close something is already
 * done with it.
 *
 * It carries `EASE_IN` now. It did not before: six sites wrote a bare
 * `duration: 0.18` with the browser default curve, which design.md §5
 * explicitly forbids ("Never the browser default").
 */
export const EXIT = { duration: 0.18, ease: EASE_IN } as const;

/**
 * Small, immediate state flips: a chip toggling, a label swapping, a value
 * changing under the reader. Short enough to read as a response to the tap
 * rather than as an animation of its own.
 */
export const QUICK = { duration: 0.16, ease: EASE_OUT } as const;

/**
 * A modal scrim — the dimming behind a sheet, never the sheet itself.
 *
 * Shorter than `ENTER` on purpose: the room should finish dimming just before
 * the panel lands on top of it, so the sequence reads as "the lights go down,
 * then the thing arrives" rather than as two objects moving at once.
 *
 * All six modal scrims in the app were writing a bare `duration: 0.18` — the
 * exit duration, with the browser's default curve, on an entrance. This is the
 * one they meant.
 */
export const SCRIM = { duration: 0.22, ease: EASE_OUT } as const;

/**
 * A crossfade between two states of the same element — the advance button
 * changing what it is for, a caption replacing a caption. Both halves share
 * one duration so the swap has no gap and no overlap.
 */
export const SWAP = { duration: 0.2, ease: EASE_IN_OUT } as const;

// ── Springs ─────────────────────────────────────────────────────────────────

/**
 * Sheets and cards model physical objects, so they get a spring, not a
 * duration. design.md §5 fixes these two numbers; ios/App/App/Native/
 * GlassSheetController.swift runs the UIKit equivalent at damping 0.88 so the
 * web and native sheets read as the same object.
 */
export const SHEET_SPRING = { type: "spring", stiffness: 380, damping: 34 } as const;

/**
 * Softer and heavier — for something with more mass than a sheet: the in-game
 * phone rising, a full-screen stage settling. Was inlined once as
 * `stiffness: 260, damping: 26`.
 */
export const SETTLE_SPRING = { type: "spring", stiffness: 260, damping: 26 } as const;

// ── Choreography ────────────────────────────────────────────────────────────

/**
 * The delay unit between children of one orchestrated moment.
 *
 * design.md §5 allows ONE orchestrated moment per screen, so this should be
 * rare. 60 ms is fast enough that four rows read as one gesture rather than as
 * four separate arrivals.
 */
export const STAGGER = 0.06;

/**
 * How long a consequence stays legible after a decision.
 *
 * One number, because a decision currently produces three reactions on three
 * unrelated clocks — the rings ease over 600 ms, The Books hold an outline for
 * exactly 700 ms with no transition on either edge, and the impact chip floats
 * for 1700 ms. Three timings for one event is why a choice reads as several
 * unrelated glitches instead of one consequence.
 */
export const IMPACT_MS = 700;

/**
 * Reduced motion, as a hook, for the places that have to branch in JS rather
 * than hand Framer a transition.
 *
 * `MotionConfig reducedMotion="user"` covers everything Framer animates. What
 * it cannot cover is a component deciding whether to mount a canvas, run a
 * loop, or pick a different layout — and six of those were each doing their
 * own raw `window.matchMedia("(prefers-reduced-motion: reduce)")` read, most
 * of them non-reactive, so a player toggling the OS setting kept the old
 * answer until reload.
 *
 * Named `useStill` rather than `useReducedMotion` so the two are not confused
 * at a call site: this one is re-exported from Framer's, and returns a plain
 * boolean rather than `boolean | null`.
 */
export function useStill(): boolean {
  return useReducedMotion() ?? false;
}

/**
 * Snappier and heavily damped — a control returning to rest, not an object
 * arriving. The lock screen's swipe uses it when a drag is released short of
 * the commit threshold: the sheet has to come back fast enough that the phone
 * reads as rejecting the gesture, and settle without a bounce, because a
 * bounce would read as a second gesture.
 */
export const SNAP_SPRING = { type: "spring", stiffness: 520, damping: 40 } as const;
