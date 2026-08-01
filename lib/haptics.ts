/**
 * Haptics, where the device has them.
 *
 * Four moments only — the ones where something in the game world actually
 * committed. A buzz on every tap is noise; a buzz on a decision landing is a
 * physical confirmation that a thing happened.
 *
 * Two backends. In the app it is the real Taptic Engine through Capacitor,
 * which is the only way to feel anything at all on iOS — `navigator.vibrate`
 * does not exist in Safari or in a WKWebView, so on the web an iPhone stays
 * silent by design rather than by omission. Everywhere else it is
 * `navigator.vibrate`, feature-detected and a no-op when absent.
 */

import { Haptics, ImpactStyle, NotificationType } from "@capacitor/haptics";
import { isNative } from "@/lib/native/platform";

type Moment = "choice" | "yearClosed" | "dealSigned" | "chapterSeven";

/** Short — 8–12ms. Long enough to feel, short enough not to read as an alert. */
const PATTERN: Record<Moment, number | number[]> = {
  choice: 8,
  yearClosed: 12,
  dealSigned: [10, 40, 10],
  // The one moment that earns a heavier pattern: the company just died.
  chapterSeven: [18, 60, 18, 60, 30],
};

/**
 * The same four moments in the vocabulary iOS actually has. A pattern of
 * milliseconds means nothing to the Taptic Engine — it plays named events, and
 * naming them is what makes a signed deal feel different from a dead company
 * rather than merely longer.
 */
function nativeHaptic(moment: Moment): Promise<void> {
  switch (moment) {
    case "choice":
      return Haptics.impact({ style: ImpactStyle.Light });
    case "yearClosed":
      return Haptics.impact({ style: ImpactStyle.Medium });
    case "dealSigned":
      return Haptics.notification({ type: NotificationType.Success });
    case "chapterSeven":
      return Haptics.notification({ type: NotificationType.Error });
  }
}

export function haptic(moment: Moment): void {
  if (typeof navigator === "undefined") return;
  // Respect the same preference that governs motion — someone who has asked
  // for less movement has not asked for the phone to buzz at them instead.
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  if (isNative()) {
    void nativeHaptic(moment).catch(() => {
      /* No engine, or the app is backgrounded. Silence is a correct outcome. */
    });
    return;
  }

  const vibrate = navigator.vibrate?.bind(navigator);
  if (!vibrate) return;
  try {
    vibrate(PATTERN[moment]);
  } catch {
    /* some engines throw when the page is not visible; that is fine */
  }
}
