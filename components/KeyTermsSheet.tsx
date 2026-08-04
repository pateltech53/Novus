"use client";

import { useMemo, useState } from "react";

import { ScreenSheet } from "@/components/screens/ScreenSheet";
import { RookieToggle } from "@/components/ui/RookieToggle";
import { GLOSSARY } from "@/lib/engine/constants";

/**
 * Every business word the game uses, in one place, on demand.
 *
 * The glossary was always there — tap a figure on the Books, or a metric row in
 * the notes, and the term coach explained that ONE word. What there was no way
 * to do was see the whole vocabulary at once: a player mid-Tank who blanks on
 * "dilution" could not look it up unless dilution happened to be a row in front
 * of them. This is that list — searchable, scrollable, and reachable from the
 * pitch (where it matters most) and from the stage guide.
 *
 * The definitions come from GLOSSARY, the same source the Books, the term coach
 * and the tutorial read, so the four surfaces can never drift into four
 * different meanings of "runway".
 */

/** The four numbers on the Books lead, because they are the ones on screen at
 *  all times; the rest follow in the order they were authored. */
const LEAD = ["cash", "burn rate", "runway", "valuation"];

function orderedTerms(): string[] {
  const all = Object.keys(GLOSSARY);
  const lead = LEAD.filter((t) => t in GLOSSARY);
  const rest = all.filter((t) => !lead.includes(t));
  return [...lead, ...rest];
}

export function KeyTermsSheet({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState("");
  const terms = useMemo(() => orderedTerms(), []);

  const q = query.trim().toLowerCase();
  const shown = q
    ? terms.filter(
        (t) =>
          t.includes(q) ||
          GLOSSARY[t].rookie.toLowerCase().includes(q) ||
          GLOSSARY[t].pro.toLowerCase().includes(q),
      )
    : terms;

  return (
    <ScreenSheet
      label="Key terms"
      closeLabel="Close the key terms"
      onClose={onClose}
      title="Key terms"
      blurb="Every word the game uses, in plain English. The real term is on top; the textbook line is under it. Tap any figure on your Books or in your notes to get the same thing, one at a time."
    >
      <div className="px-5 pb-5 pt-3">
        {/* The vocabulary switch lives WITH the vocabulary. Rookie Mode was a
            Settings row and a mid-tutorial card — both places you find after
            you needed it. Here it sits on the page the book button opens, where
            someone confused by a word already is. */}
        <div className="mb-3 rounded-[var(--radius-row)] bg-[var(--surface)] px-3.5 py-3 ring-1 ring-[var(--hairline)]">
          <RookieToggle />
        </div>

        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a word — runway, dilution, churn…"
          autoComplete="off"
          className="mb-3 w-full rounded-[var(--radius-row)] bg-[var(--surface)] px-3.5 py-2.5 text-sm text-[var(--text-primary)] outline-none ring-1 ring-[var(--hairline)] transition-shadow focus:ring-[var(--text-secondary)] placeholder:text-[var(--text-tertiary)]"
        />

        {shown.length === 0 ? (
          <p className="py-6 text-center text-sm text-[var(--text-tertiary)]">
            No term matches “{query}”.
          </p>
        ) : (
          <dl className="divide-y divide-[var(--hairline)]">
            {shown.map((term) => {
              const gloss = GLOSSARY[term];
              const lead = LEAD.includes(term);
              return (
                <div key={term} className="py-3">
                  <dt className="flex items-baseline gap-2">
                    <span className="text-sm font-extrabold tracking-[0.02em] text-[var(--text-primary)]">
                      {term.toUpperCase()}
                    </span>
                    {lead && (
                      <span className="rounded-full bg-[var(--chip)] px-1.5 py-0.5 text-[0.5625rem] font-bold tracking-[0.1em] text-[var(--text-secondary)]">
                        ON YOUR BOOKS
                      </span>
                    )}
                  </dt>
                  {/* Plain English first — the line a rookie can act on — then
                      the textbook definition under it. Same order as the Books
                      and the term coach: Rookie Mode adds a translation, it
                      never replaces the real term. */}
                  <dd className="mt-1 text-sm leading-snug text-[var(--text-secondary)]">
                    {capitalise(gloss.rookie)}
                  </dd>
                  <dd className="mt-0.5 text-2xs leading-snug text-[var(--text-tertiary)]">
                    {gloss.pro}
                  </dd>
                </div>
              );
            })}
          </dl>
        )}
      </div>
    </ScreenSheet>
  );
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
