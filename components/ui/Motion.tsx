"use client";

import { MotionConfig } from "framer-motion";

/**
 * The CSS `prefers-reduced-motion` block cannot reach Framer Motion — Framer
 * animates via requestAnimationFrame in JS, so a stylesheet rule never touches
 * it. Without this, "reduced motion" was honoured by the CSS keyframes and
 * silently ignored by every sheet, card, and page transition in the app.
 *
 * `reducedMotion="user"` makes Framer read the OS setting and cut transform
 * animation to a plain opacity change — a cut, not a shortened slide.
 */
export function Motion({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}

/** Sheets and cards model physical objects, so they get a spring, not a duration. */
export const SHEET_SPRING = { type: "spring", stiffness: 380, damping: 34 } as const;

/** Everything else gets a curve. Exits are ~0.66× the entrance. */
export const ENTER = { duration: 0.28, ease: [0.16, 1, 0.3, 1] } as const;
export const EXIT = { duration: 0.18, ease: [0.7, 0, 0.84, 0] } as const;
