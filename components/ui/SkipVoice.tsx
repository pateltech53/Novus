"use client";

import { useEffect, useState } from "react";

import { isSpeaking, onSpeakingChange, stopSpeaking } from "@/lib/ai/speech";

/**
 * SKIP — get the voice out of the way.
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 *
 * Spoken lines are an enhancement, and until now they were an enhancement you
 * could not decline in the moment. Two places made that hurt:
 *
 *   · The framing line before a pitch, which a player on their fourth run has
 *     heard four times and is waiting out.
 *   · The Tank. A shark finishes a question, the answer turn opens, and the
 *     player starts talking while the shark is still talking — two voices into
 *     one microphone, and on a phone the shark is the louder one.
 *
 * The second half of that fix is in the answer turn, which now stops the room
 * the instant a microphone opens. This is the first half: a control that is
 * there whenever anything is speaking and gone the rest of the time.
 *
 * It renders nothing when nothing is speaking, so it can be dropped into a
 * screen without reserving space or drawing an empty box.
 */
export function SkipVoice({ className = "" }: { className?: string }) {
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => {
    // Read once on mount as well as subscribing: a line that started before
    // this mounted is exactly the line a player most wants to skip.
    setSpeaking(isSpeaking());
    return onSpeakingChange(setSpeaking);
  }, []);

  if (!speaking) return null;

  return (
    <button
      type="button"
      onClick={stopSpeaking}
      // Not `data-opens`: this closes something rather than opening it, and the
      // sound layer classifies by that attribute.
      aria-label="Skip the spoken line"
      className={`nv-press inline-flex items-center gap-1.5 rounded-[var(--radius-pill)] bg-[var(--n-4)] px-3 py-1.5 text-2xs font-extrabold tracking-[0.1em] text-[var(--n-10)] ${className}`}
    >
      <SkipGlyph />
      SKIP
    </button>
  );
}

function SkipGlyph() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M1.5 1.5 8 6l-6.5 4.5V1.5Z" />
      <rect x="9" y="1.5" width="1.8" height="9" rx="0.6" />
    </svg>
  );
}
