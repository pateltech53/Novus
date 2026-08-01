"use client";

import { useEffect } from "react";
import { NovusGlass } from "@/lib/native/glass";
import { useNativeChromeOwned } from "@/lib/native/chrome";
import { GLOSSARY } from "@/lib/engine/constants";

/**
 * Term-on-first-use, as a native glass note.
 *
 * Same job as components/TermCoach.tsx: the shark defines a word the moment it
 * first appears on screen, never in advance and never in a glossary you have
 * to go find. It is chrome rather than content — it explains the board instead
 * of being part of it — which is what puts it among the surfaces design.md
 * allows glass on.
 *
 * The DOM version docks above the advance bar so it cannot cover the number it
 * is quoting. The native one arrives from the top for the same reason: the
 * bottom of the screen is where that number lives.
 */
export function useNativeTermCoach(
  term: string | null,
  detail: string | undefined,
  onDismiss: () => void,
): boolean {
  const owned = useNativeChromeOwned();

  useEffect(() => {
    if (!owned || !term) return;
    const gloss = GLOSSARY[term.toLowerCase()];
    if (!gloss) return;

    const rookie = detail ?? gloss.rookie.charAt(0).toUpperCase() + gloss.rookie.slice(1);
    const text = gloss.pro ? `${rookie}\n${gloss.pro}` : rookie;

    NovusGlass.toast({ title: term, text, tone: "neutral" }).catch(() => {});

    /*
     * The note takes itself away; this clears the React state behind it.
     * Without it the same term would count as still showing and never fire
     * again — and the nine seconds is the same budget the DOM version uses,
     * because it is quoting a live number and has to leave before that number
     * can change underneath it.
     */
    const timer = window.setTimeout(onDismiss, 9000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owned, term, detail]);

  return owned;
}
