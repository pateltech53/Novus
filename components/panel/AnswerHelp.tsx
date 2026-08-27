"use client";

import { useCallback, useState } from "react";
import { motion } from "framer-motion";

import { apiUrl } from "@/lib/native/origin";

/**
 * STUCK? — help with the question, never an answer to it.
 *
 * ── What it is allowed to give ─────────────────────────────────────────────
 *
 * Three things: what the shark is really testing, which of the founder's own
 * numbers bear on it, and the commonest way the question is answered badly.
 * That is the whole surface, and it is a deliberate shape — there is nowhere in
 * it to put a sentence the player could read aloud.
 *
 * The rule it protects is the one `PitchNotes` states in its own header: the
 * player's words are the player's. A pitch read off a generated line teaches
 * nothing and scores somebody who is not there. So this points at the question
 * and at the founder's own books, and then gets out of the way.
 *
 * ── Why it is limited, and why the limit is small ──────────────────────────
 *
 * Three per room. A founder who can ask for help on every question is not
 * being coached, they are being carried — and the room only asks three
 * questions, so this is deliberately not enough to cover all of them. Choosing
 * WHICH question to spend it on is itself part of the exercise.
 *
 * The server has its own ceiling behind this (`AI_LIMITS.coachPerIp`), because
 * a client-side count is a suggestion to anyone holding devtools.
 *
 * ── Offline ────────────────────────────────────────────────────────────────
 *
 * No key, no quota, no network: the local hint. It knows nothing about the
 * question, so it says the one thing that is true of every question in this
 * room — the answer is in the notes card, and the trap is inventing a number.
 * Less useful, never absent, and it costs nothing.
 */

export interface AnswerHelpData {
  testing: string;
  your_numbers: string[];
  trap: string;
}

const OFFLINE: AnswerHelpData = {
  testing:
    "Whether you know your own company well enough to answer without guessing.",
  your_numbers: ["Open THE NUMBERS on your notes — the figure they want is on it"],
  trap: "Inventing a number. Saying you do not track it yet is a real answer; a made-up one gets checked.",
};

export function AnswerHelp({
  question,
  shark,
  facts,
  remaining,
  onUsed,
}: {
  question: string;
  shark: string;
  /** The founder's own figures, so the hint can point AT them, never invent. */
  facts: Record<string, string | number>;
  remaining: number;
  onUsed: () => void;
}) {
  const [help, setHelp] = useState<AnswerHelpData | null>(null);
  const [busy, setBusy] = useState(false);

  const ask = useCallback(async () => {
    if (busy || remaining <= 0) return;
    setBusy(true);
    try {
      const res = await fetch(apiUrl("/api/coach"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, shark, facts }),
      });
      if (res.ok) {
        setHelp((await res.json()) as AnswerHelpData);
        // Spent only on a real answer. A deploy with no key would otherwise
        // charge a founder two uses for the same generic line twice.
        onUsed();
      } else {
        setHelp(OFFLINE);
      }
    } catch {
      setHelp(OFFLINE);
    } finally {
      setBusy(false);
    }
  }, [busy, facts, onUsed, question, remaining, shark]);

  if (help) {
    return (
      <motion.div
        initial={{ opacity: 0, y: -4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-3 rounded-[var(--radius-row)] bg-[var(--surface)] p-3"
      >
        <p className="text-2xs font-bold tracking-[0.14em] text-[var(--prestige)]">
          WHAT THEY ARE REALLY ASKING
        </p>
        <p className="mt-1 text-sm leading-snug text-[var(--text-primary)]">
          {help.testing}
        </p>

        {help.your_numbers.length > 0 && (
          <>
            <p className="mt-2.5 text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
              YOUR OWN NUMBERS
            </p>
            <ul className="mt-1 space-y-0.5">
              {help.your_numbers.map((n) => (
                <li key={n} className="text-sm leading-snug text-[var(--text-secondary)]">
                  · {n}
                </li>
              ))}
            </ul>
          </>
        )}

        <p className="mt-2.5 text-2xs font-bold tracking-[0.14em] text-[var(--text-tertiary)]">
          THE USUAL MISTAKE
        </p>
        <p className="mt-1 text-sm leading-snug text-[var(--text-secondary)]">{help.trap}</p>

        {/* Said out loud, because a player who expected a script should know
            they are not getting one rather than hunting for it. */}
        <p className="mt-3 text-2xs leading-snug tracking-[0.06em] text-[var(--text-tertiary)]">
          THE WORDS ARE YOURS. NOVUS WILL NOT WRITE THEM.
        </p>
      </motion.div>
    );
  }

  if (remaining <= 0) return null;

  return (
    <button
      type="button"
      onClick={() => void ask()}
      disabled={busy}
      className="nv-gc mt-2 h-11 w-full rounded-[var(--radius-card)] text-sm font-bold tracking-[0.04em] text-[var(--text-secondary)] disabled:opacity-60"
    >
      {busy ? "THINKING…" : `STUCK? · ${remaining} LEFT`}
    </button>
  );
}
