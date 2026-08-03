"use client";

import { useEffect } from "react";
import { unlockSpeech } from "@/lib/ai/speech";
import { play, unlockSound, type Cue } from "@/lib/sound";

/**
 * Mounts the interface-sound layer.
 *
 * ── Why this routes instead of firing one click ──────────────────────────────
 * The first version played the same click on every button in the app. With
 * ~200 buttons that is not a sound design, it is a metronome — and it made the
 * loud, rare moments feel identical to opening a tab.
 *
 * So the delegated listener CLASSIFIES the control before it plays anything:
 *
 *   tab bar               → tab        (you move along it constantly)
 *   opens a screen/sheet  → activity   (a place opening)
 *   commits something     → success    (a decision landing)
 *   dismiss / back / quiet→ click      (barely there)
 *
 * Anything with a genuine consequence — money moving, a hire landing, a tier
 * opening — sets `data-sfx` itself and is excluded here, so the two never
 * stack into a double-hit.
 */

const COMMIT =
  /\b(found it|advance|close the year|got it|start|sign|take|answer|that's my|confirm|buy|sell|hire|open the camera|wear it|face the)\b/i;
const QUIET =
  /\b(done|close|cancel|back|dismiss|not now|skip|say nothing|type it)\b/i;

function classify(el: HTMLElement): Cue | null {
  const explicit = el.getAttribute("data-sfx");
  if (explicit === "none") return null;
  if (explicit) return explicit as Cue;

  // The bottom menu bar has its own movement sound.
  if (el.closest('nav[aria-label="Activities"]')) return "tab";

  const label = (el.textContent ?? "").trim();

  // Quiet exits first: "DONE" on a sheet should not sound like a commit.
  if (QUIET.test(label)) return "click";

  // Opening a place, rather than deciding something.
  if (el.getAttribute("aria-haspopup") || el.hasAttribute("data-opens"))
    return "activity";

  if (COMMIT.test(label)) return "success";

  return "click";
}

export function Sound() {
  useEffect(() => {
    /*
     * Browsers refuse audio until a real gesture. This is that gesture — for
     * the cues, and for the shark's voice.
     *
     * The voice needs it more than the cues do: a cue plays inside the click
     * that caused it, while a spoken line arrives several awaits after the tap
     * that asked for it, which on iOS Safari is no longer a gesture at all.
     * unlockSpeech() primes one element here so the line has somewhere to play
     * later. See lib/ai/speech.ts.
     */
    const onFirst = () => {
      unlockSound();
      unlockSpeech();
    };
    window.addEventListener("pointerdown", onFirst, {
      once: true,
      capture: true,
    });

    /*
     * Three gesture types, not one, and not `once`.
     *
     * WebKit is particular about which event counts as the gesture that
     * permits playback, and unlockSpeech() returns immediately once silence
     * has actually played — so a listener that lives all session costs one
     * boolean check per tap and buys back the case where the first attempt was
     * refused. On an iPhone that case is the difference between the shark's
     * voice and a synthesiser.
     */
    const retryUnlock = () => unlockSpeech();
    const GESTURES = ["pointerdown", "touchend", "click"] as const;
    for (const type of GESTURES) {
      window.addEventListener(type, retryUnlock, {
        capture: true,
        passive: true,
      });
    }

    const onClick = (e: MouseEvent) => {
      const t = (e.target as HTMLElement | null)?.closest<HTMLElement>(
        "button,[role='button'],a[href]",
      );
      if (!t || t.hasAttribute("disabled")) return;
      const cue = classify(t);
      if (cue) play(cue);
    };
    document.addEventListener("click", onClick, true);

    return () => {
      window.removeEventListener("pointerdown", onFirst, true);
      for (const type of GESTURES) {
        window.removeEventListener(type, retryUnlock, true);
      }
      document.removeEventListener("click", onClick, true);
    };
  }, []);

  return null;
}
