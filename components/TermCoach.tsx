"use client";

import { useEffect } from "react";
import { motion } from "framer-motion";
import { ENTER } from "@/components/ui/Motion";
import { GLOSSARY } from "@/lib/engine/constants";
import { Glass } from "@/components/ui/Glass";

/**
 * Term-on-first-use. The shark defines a word the moment it first appears on
 * screen — never in advance, never in a glossary you have to go find.
 *
 * It docks above the advance bar rather than floating over the log: it quotes
 * a live number, so it must never cover the thing it is describing.
 *
 * Glass, and always was in every renderer but this one: on iOS the identical
 * note is a floated `UIGlassEffect` panel (GlassChromeController.toast). This
 * is a toast, which design.md names as one of the surfaces glass is for — it
 * explains the board rather than being part of it.
 */
export function TermCoach({
  term,
  detail,
  onDismiss,
}: {
  term: string | null;
  /** A live sentence using the player's real number. */
  detail?: string;
  onDismiss: () => void;
}) {
  const gloss = term ? GLOSSARY[term.toLowerCase()] : null;

  // It quotes a number, so it has to leave before that number changes.
  useEffect(() => {
    if (!term) return;
    const id = setTimeout(onDismiss, 9000);
    return () => clearTimeout(id);
  }, [term, onDismiss]);

  if (!term || !gloss) return null;

  return (
    <motion.div
      className="px-4 pb-2"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...ENTER }}
    >
      <Glass className="mx-auto w-full max-w-2xl overflow-hidden rounded-[var(--radius-row)]">
        <button
          type="button"
          onClick={onDismiss}
          className="nv-gc nv-flat flex w-full items-start gap-3 rounded-[var(--radius-row)] px-4 py-3 text-left"
        >
          <span className="nv-gc nv-flat mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-extrabold text-[var(--text-primary)]">
            ?
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-2xs font-bold tracking-[0.14em] text-[var(--text-secondary)]">
              {term.toUpperCase()}
            </span>
            <span className="mt-0.5 block text-sm leading-snug text-[var(--text-primary)]">
              {detail ?? capitalize(gloss.rookie)}
            </span>
            <span className="mt-1 block text-2xs text-[var(--text-tertiary)]">
              {gloss.pro} · tap to dismiss
            </span>
          </span>
        </button>
      </Glass>
    </motion.div>
  );
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
