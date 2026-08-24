"use client";

import { useState } from "react";
import { motion } from "framer-motion";

import { useGame } from "@/lib/state/GameProvider";
import { industryByCode } from "@/lib/engine/constants";
import { tradeIndex } from "@/lib/ai/callers";
import { play } from "@/lib/sound";

/**
 * THE INDEX — the trade book for your industry.
 *
 * ── Why this screen exists ─────────────────────────────────────────────────
 *
 * The Room used to open on a list of people with a handset beside each name.
 * Tap, talk, done. That is a contacts app, and it quietly taught the opposite
 * of what a cold call is: the hard part of the real thing — the part actually
 * worth a mechanic — is that nobody hands you the list. Somebody has to go and
 * find out who buys what you sell, and then find their number.
 *
 * So the roster moved out here, and there is **no way to place a call from this
 * screen**. That absence is the design. You read, you find someone whose line
 * of business matches yours, you take their number, and you dial it next door.
 * Three steps where there was one, and the two new ones are the lesson.
 *
 * ── What is in the book, and why it is different today ─────────────────────
 *
 * Only businesses in this company's own niche, and only those who would take a
 * call at this stage — drawn from the same set The Room will actually connect,
 * because both read `availableCallers`. A book that printed numbers the dialler
 * refuses would be a worse lie than no book.
 *
 * And it is a PAGE, not the whole book: four listings, redrawn every real day.
 * It used to print everybody, which meant it printed the same names on Monday
 * and on every Monday after, and working down a fixed list is exactly the
 * contacts app this screen was rebuilt to stop being. Four against a ration of
 * three calls, so there is always one business you could have rung and did not.
 *
 * What does NOT rotate is who answers. A number copied yesterday still rings,
 * and rings the same person: the draw governs what is printed and nothing else.
 *
 * Ordered by how hard they are to win, not alphabetically. A directory sorted
 * by name is a phone book; sorted by difficulty it is a ladder, and the first
 * entry is the one a founder at this stage should be ringing today.
 *
 * ── Copying ────────────────────────────────────────────────────────────────
 *
 * The clipboard, with the select-all fallback the landing page's team address
 * already uses — `navigator.clipboard` is refused often enough (an insecure
 * origin, a webview that never asked, a locked-down browser) that a button
 * which silently does nothing would strand the player in the middle of the one
 * flow this screen exists for. Selected text can always be copied by hand.
 */
export function TradeIndex({ onCall }: { onCall: () => void }) {
  const { run } = useGame();
  const [copied, setCopied] = useState<string | null>(null);

  if (!run) return null;

  const listings = tradeIndex(run);
  const industry = industryByCode(run.industry);

  const copy = async (phone: string, id: string) => {
    try {
      await navigator.clipboard.writeText(phone);
      setCopied(id);
      play("click");
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1800);
    } catch {
      /* Clipboard refused. Select the number instead so a long-press copy
         lands on the right thing — the number, not the whole row. */
      const node = document.getElementById(`line-${id}`);
      if (node) {
        const range = document.createRange();
        range.selectNodeContents(node);
        const sel = window.getSelection();
        sel?.removeAllRanges();
        sel?.addRange(range);
      }
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="px-4 pt-3 pb-6"
    >
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-extrabold tracking-[-0.01em]">The Index</h2>
        <span className="text-2xs font-bold tracking-[0.1em] text-[var(--text-tertiary)]">
          {industry.name.toUpperCase()}
        </span>
      </div>
      <p className="mt-1 text-2xs leading-snug text-[var(--text-tertiary)]">
        Who buys what you sell, today. Take a number, then dial it in The Room.
      </p>

      {listings.length === 0 ? (
        <p className="mt-4 rounded-[var(--radius-row)] bg-[var(--n-3)] px-3 py-2.5 text-xs leading-snug text-[var(--text-secondary)]">
          Nobody in this book takes calls at your stage yet. Build something
          first — they can look you up too.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {listings.map(({ caller, phone }) => (
            <li
              key={caller.id}
              className="rounded-[var(--radius-row)] bg-[var(--n-3)] px-3 py-3"
            >
              {/* The BUSINESS first and the person second. This is a trade
                  index — you look up a company, and the name of who answers
                  is what the listing gives you once you have found it. */}
              <p className="text-sm font-bold leading-snug">{caller.company}</p>
              <p className="mt-0.5 text-2xs text-[var(--text-tertiary)]">
                {caller.name} · {caller.title}
              </p>
              <p className="mt-1.5 text-2xs leading-snug text-[var(--text-secondary)]">
                Listening for: {caller.wants}
              </p>

              <div className="mt-2.5 flex items-center gap-2">
                <span
                  id={`line-${caller.id}`}
                  className="tnum select-all rounded-[var(--radius-chip)] bg-[var(--surface)] px-2.5 py-1.5 text-sm font-extrabold tracking-[0.02em]"
                >
                  {phone}
                </span>
                <button
                  type="button"
                  onClick={() => void copy(phone, caller.id)}
                  className="nv-gc ml-auto rounded-[var(--radius-pill)] px-4 py-2 text-2xs font-extrabold tracking-[0.1em]"
                  aria-label={`Copy ${caller.company}'s number`}
                >
                  {copied === caller.id ? "COPIED ✓" : "COPY"}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Said plainly, because a page that quietly changed overnight would read
          as a bug rather than as a market. It is also the nudge: three calls, a
          fourth listing, and a page that will not be here tomorrow. */}
      {listings.length > 0 && (
        <p className="mt-3 text-2xs leading-snug text-[var(--text-tertiary)]">
          The page turns over tomorrow. Anyone you have already written down still
          answers.
        </p>
      )}

      {/* The one door out, and it is a door rather than a dial: it opens the
          dialler with nothing in it. Handing the number over automatically
          would put the contacts app back one layer down. */}
      {listings.length > 0 && (
        <button
          type="button"
          onClick={onCall}
          className="nv-gc mt-4 w-full rounded-[var(--radius-card)] nv-t-action px-4 py-3 text-2xs font-extrabold tracking-[0.12em]"
        >
          OPEN THE ROOM ▸
        </button>
      )}
    </motion.div>
  );
}
