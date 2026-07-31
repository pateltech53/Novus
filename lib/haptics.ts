/**
 * Haptics, where the device has them.
 *
 * Four moments only — the ones where something in the game world actually
 * committed. A buzz on every tap is noise; a buzz on a decision landing is a
 * physical confirmation that a thing happened.
 *
 * Feature-detected, never assumed: `navigator.vibrate` is absent on iOS Safari
 * and on desktop, where these calls become no-ops rather than throwing.
 * Silence is a correct outcome here, not a degraded one.
 */

type Moment = "choice" | "yearClosed" | "dealSigned" | "chapterSeven";

/** Short — 8–12ms. Long enough to feel, short enough not to read as an alert. */
const PATTERN: Record<Moment, number | number[]> = {
  choice: 8,
  yearClosed: 12,
  dealSigned: [10, 40, 10],
  // The one moment that earns a heavier pattern: the company just died.
  chapterSeven: [18, 60, 18, 60, 30],
};

export function haptic(moment: Moment): void {
  if (typeof navigator === "undefined") return;
  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return;
  // Respect the same preference that governs motion — someone who has asked
  // for less movement has not asked for the phone to buzz at them instead.
  if (
    typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
  ) {
    return;
  }
  try {
    vibrate(PATTERN[moment]);
  } catch {
    /* some engines throw when the page is not visible; that is fine */
  }
}
